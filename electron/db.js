'use strict';
/**
 * Embedded SQLite store for community feedback, keyed by OSM way id.
 * The file lives in Electron's userData directory (%APPDATA%\Aarhus Mobility 3D\ on Windows).
 */
// Electron 45+ ships Node 24 with the built-in node:sqlite module: no native addon to compile.
const { DatabaseSync } = require('node:sqlite');

const CATEGORIES = [
  'missing_bike_lane',
  'poor_pavement',
  'steep_incline',
  'safety_hazard',
  'missing_sidewalk',
  'dangerous_crossing',
  'poor_lighting',
  'traffic_speed',
  'positive',
  'other'
];

const MIGRATIONS = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS comments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    osm_way_id   TEXT    NOT NULL,
    segment_id   TEXT,
    street_name  TEXT,
    category     TEXT    NOT NULL,
    body         TEXT    NOT NULL,
    author       TEXT,
    mode         TEXT    CHECK (mode IN ('bike','walk','both')) DEFAULT 'both',
    severity     INTEGER CHECK (severity BETWEEN 1 AND 5) DEFAULT 3,
    lng          REAL,
    lat          REAL,
    dataset      TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_comments_way ON comments(osm_way_id);
  CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  `,
  // v2 — comments on any target (street / building / poi / place), lookup cache, activity log
  `
  ALTER TABLE comments ADD COLUMN target_type TEXT NOT NULL DEFAULT 'street';
  CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, osm_way_id);

  CREATE TABLE IF NOT EXISTS lookup_cache (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    kind    TEXT NOT NULL,
    message TEXT NOT NULL,
    data    TEXT
  );
  `
];

const TARGET_TYPES = ['street', 'building', 'poi', 'place'];

function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  const stmts = {
    listAll: db.prepare('SELECT * FROM comments ORDER BY created_at DESC'),
    listWay: db.prepare('SELECT * FROM comments WHERE osm_way_id = ? ORDER BY created_at DESC'),
    insert: db.prepare(`INSERT INTO comments (osm_way_id, segment_id, street_name, category, body, author, mode, severity, lng, lat, dataset, target_type)
                        VALUES ($osm_way_id, $segment_id, $street_name, $category, $body, $author, $mode, $severity, $lng, $lat, $dataset, $target_type)`),
    get: db.prepare('SELECT * FROM comments WHERE id = ?'),
    del: db.prepare('DELETE FROM comments WHERE id = ?'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    cacheGet: db.prepare('SELECT value, fetched_at FROM lookup_cache WHERE key = ?'),
    cacheSet: db.prepare('INSERT INTO lookup_cache(key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at'),
    cacheCount: db.prepare('SELECT COUNT(*) AS n FROM lookup_cache'),
    cacheClear: db.prepare('DELETE FROM lookup_cache'),
    logAdd: db.prepare('INSERT INTO activity_log(kind, message, data) VALUES (?, ?, ?)'),
    logList: db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?')
  };

  return {
    raw: db,
    listComments(wayId) { return (wayId ? stmts.listWay.all(String(wayId)) : stmts.listAll.all()).map(r => ({ ...r })); },
    addComment(input) {
      const c = validateComment(input);
      const info = stmts.insert.run(Object.fromEntries(Object.entries(c).map(([k, v]) => ['$' + k, v])));
      return { ...stmts.get.get(Number(info.lastInsertRowid)) };
    },
    deleteComment(id) { return Number(stmts.del.run(Number(id)).changes) > 0; },
    getSetting(key) { const r = stmts.getSetting.get(key); return r ? r.value : null; },
    setSetting(key, value) { stmts.setSetting.run(key, value == null ? null : String(value)); },
    getJson(key, fallback) { try { const v = this.getSetting(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    setJson(key, value) { this.setSetting(key, JSON.stringify(value)); },
    /** returns undefined on miss/expired so callers can distinguish a cached null */
    cacheGet(key, ttlDays) {
      const r = stmts.cacheGet.get(key);
      if (!r) return undefined;
      if (ttlDays && Date.now() - Number(r.fetched_at) > ttlDays * 86400000) return undefined;
      try { return JSON.parse(r.value); } catch { return undefined; }
    },
    cacheSet(key, value) { stmts.cacheSet.run(key, JSON.stringify(value === undefined ? null : value), Date.now()); },
    cacheCount() { return Number(stmts.cacheCount.get().n); },
    cacheClear() { stmts.cacheClear.run(); },
    log(kind, message, data) { stmts.logAdd.run(String(kind).slice(0, 40), String(message).slice(0, 500), data === undefined ? null : JSON.stringify(data).slice(0, 20000)); },
    listLog(limit = 200) { return stmts.logList.all(Math.max(1, Math.min(1000, Number(limit) || 200))).map(r => ({ ...r, data: r.data ? safeParse(r.data) : null })); },
    close() { db.close(); }
  };
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

function str(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
function coord(v, lim) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= lim ? n : null;
}

function validateComment(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid comment payload.');
  const osm_way_id = str(input.osm_way_id, 64);
  const body = str(input.body, 4000);
  const category = CATEGORIES.includes(input.category) ? input.category : null;
  if (!osm_way_id) throw new Error('A street segment must be selected.');
  if (!body) throw new Error('Comment text is required.');
  if (!category) throw new Error('Please choose a valid category.');
  const mode = ['bike', 'walk', 'both'].includes(input.mode) ? input.mode : 'both';
  let severity = Math.round(Number(input.severity));
  if (!(severity >= 1 && severity <= 5)) severity = 3;
  const target_type = TARGET_TYPES.includes(input.target_type) ? input.target_type : 'street';
  return {
    target_type,
    osm_way_id,
    segment_id: str(input.segment_id, 64),
    street_name: str(input.street_name, 200),
    category,
    body,
    author: str(input.author, 80),
    mode,
    severity,
    lng: coord(input.lng, 180),
    lat: coord(input.lat, 90),
    dataset: str(input.dataset, 260)
  };
}

module.exports = { openDatabase, CATEGORIES, TARGET_TYPES };
