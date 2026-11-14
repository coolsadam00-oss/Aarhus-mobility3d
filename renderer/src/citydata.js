// City data (active city pack) in the renderer: loading via am3d://, spatial indices, search and scores.
import geo from '../../shared/geo.js';
import lite from '../../shared/netascore-lite.js';
import dd from '../../shared/dedupe.js';
import { heightfield } from './heightfield.js';

const { GridIndex, bboxOfGeometry, pointInGeometry, geometryCentroid, haversine, normText, distPointSegment, mPerDegLng, mPerDegLat } = geo;
const STARTER_ID = 'starter-aarhus-8000';

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
async function getBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

export class CityData {
  constructor() {
    this.manifest = null;
    this.layers = {};
    this.byId = new Map();
    this.buildingIndex = null;
    this.roadIndex = null;
    this.poiIndex = null;
    this.searchEntries = [];
    this.netScores = new Map();   // osm way id (numeric string) -> {bike, walk, src}
    this.liteCache = new Map();
    this.listeners = new Set();
    this.loadedAt = 0;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const l of this.listeners) l(this); }

  get bbox() { return this.manifest ? this.manifest.bbox : null; }
  get isStarter() { return this.manifest && this.manifest.id === STARTER_ID; }

  async loadDem() {
    try {
      const m = await getJson(`am3d://pack/${STARTER_ID}/manifest.json`);
      if (!m.dem) return;
      const [data, conf] = await Promise.all([getBin(`am3d://pack/${STARTER_ID}/${m.dem.file}`), m.dem.confFile ? getBin(`am3d://pack/${STARTER_ID}/${m.dem.confFile}`) : null]);
      heightfield.setGrid({ bbox: m.dem.bbox, nx: m.dem.nx, ny: m.dem.ny, data: new Int16Array(data), conf: conf ? new Uint8Array(conf) : null });
    } catch (e) { console.warn('DEM load failed', e); }
  }

  async load(packId, onStatus) {
    const id = packId || STARTER_ID;
    const base = `am3d://pack/${id}/`;
    onStatus && onStatus('Reading city data …');
    const manifest = await getJson(base + 'manifest.json');
    const layers = {};
    const names = Object.keys(manifest.layers || {});
    await Promise.all(names.map(async (n) => {
      onStatus && onStatus(`Loading ${n} …`);
      layers[n] = (await getJson(base + manifest.layers[n].file)).features || [];
    }));
    this.manifest = manifest;
    this.layers = layers;
    this._index();
    this.loadedAt = Date.now();
    this._emit();
    return this;
  }

  layer(name) { return this.layers[name] || []; }

  _index() {
    // twin footprints would draw flickering coplanar walls: keep one (older packs, GeoDanmark versions)
    const dup = dd.dedupeBuildings(this.layers.buildings || []);
    if (dup.dropped.length) this.layers.buildings = dup.features;
    this.duplicatesRemoved = dup.dropped.length;
    this.byId = new Map();
    this.buildingIndex = new GridIndex(0.0015);
    for (const f of this.layer('buildings')) {
      f.bbox = bboxOfGeometry(f.geometry);
      f.properties.centroid = geometryCentroid(f.geometry);
      this.byId.set(f.id, f);
      this.buildingIndex.insert(f, f.bbox);
    }
    this.roadIndex = new GridIndex(0.0015);
    for (const f of this.layer('roads')) {
      this.byId.set(f.id, f);
      const c = f.geometry.coordinates;
      for (let i = 1; i < c.length; i++) {
        const seg = { f, i, a: c[i - 1], b: c[i] };
        this.roadIndex.insert(seg, [Math.min(c[i - 1][0], c[i][0]), Math.min(c[i - 1][1], c[i][1]), Math.max(c[i - 1][0], c[i][0]), Math.max(c[i - 1][1], c[i][1])]);
      }
    }
    this.poiIndex = new GridIndex(0.002);
    for (const f of this.layer('pois')) { this.byId.set(f.id, f); const p = f.geometry.coordinates; this.poiIndex.insert(f, [p[0], p[1], p[0], p[1]]); }
    for (const n of ['context', 'landuse', 'water', 'railways', 'furniture']) for (const f of this.layer(n)) if (!this.byId.has(f.id)) this.byId.set(f.id, f);
    this._buildSearch();
  }

  _buildSearch() {
    const E = [];
    const seenRoad = new Map();
    for (const f of this.layer('roads')) {
      const n = f.properties.n;
      if (!n) continue;
      const len = f.geometry.coordinates.length;
      const prev = seenRoad.get(n);
      if (!prev || len > prev.len) seenRoad.set(n, { f, len, kinds: new Set([...(prev ? prev.kinds : []), f.properties.lbl]) });
      else prev.kinds.add(f.properties.lbl);
    }
    for (const [name, v] of seenRoad) {
      const c = v.f.geometry.coordinates[Math.floor(v.f.geometry.coordinates.length / 2)];
      E.push({ t: normText(name), label: name, sub: [...v.kinds].slice(0, 2).join(' / '), icon: '🛣️', kind: 'street', lng: c[0], lat: c[1], ref: { type: 'road', id: v.f.id }, rank: 3 });
    }
    for (const f of this.layer('buildings')) {
      const p = f.properties;
      if (!p.n) continue;
      E.push({ t: normText(p.n), label: p.n, sub: p.lbl + (p.a ? ` · ${p.a}` : ''), icon: p.ic || '🏢', kind: 'building', lng: p.centroid[0], lat: p.centroid[1], ref: { type: 'building', id: f.id }, rank: 4 });
    }
    for (const f of this.layer('pois')) {
      const p = f.properties;
      if (!p.n) continue;
      const c = f.geometry.coordinates;
      E.push({ t: normText(p.n + ' ' + (p.lbl || '')), label: p.n, sub: p.lbl, icon: p.ic || '📍', kind: 'poi', lng: c[0], lat: c[1], ref: { type: 'poi', id: f.id }, rank: 5 });
    }
    for (const f of this.layer('context')) {
      const p = f.properties;
      if (!p.n) continue;
      const c = geometryCentroid(f.geometry);
      E.push({ t: normText(p.n), label: p.n, sub: p.lbl, icon: '📍', kind: 'area', lng: c[0], lat: c[1], ref: { type: 'area', id: f.id }, rank: 4 });
    }
    for (const f of this.layer('addresses')) {
      const p = f.properties;
      const c = f.geometry.coordinates;
      const label = `${p.s} ${p.hn}`.trim();
      E.push({ t: normText(label), label, sub: [p.pc, p.c].filter(Boolean).join(' ') || 'Address', icon: '🏠', kind: 'address', lng: c[0], lat: c[1], ref: { type: 'address', id: f.id }, rank: 2 });
    }
    this.searchEntries = E;
  }

  /** Local, offline search over streets, buildings, places, areas and addresses. */
  search(q, limit = 12) {
    const nq = normText(q);
    if (nq.length < 2) return [];
    const tokens = nq.split(' ');
    const out = [];
    for (const e of this.searchEntries) {
      let score = 0;
      if (e.t === nq) score = 100;
      else if (e.t.startsWith(nq)) score = 80;
      else if (tokens.every(tk => e.t.includes(tk))) score = e.t.split(' ').some(w => w.startsWith(tokens[0])) ? 60 : 40;
      else continue;
      score += e.rank - e.t.length * 0.05;
      out.push({ ...e, score });
    }
    out.sort((a, b) => b.score - a.score);
    // de-duplicate identical labels (e.g. same street name twice)
    const seen = new Set();
    return out.filter(r => { const k = r.label + '|' + r.kind; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
  }

  buildingAt(lng, lat) {
    if (!this.buildingIndex) return null;
    const pt = [lng, lat];
    let best = null;
    for (const f of this.buildingIndex.queryPoint(pt)) {
      if (lng < f.bbox[0] || lng > f.bbox[2] || lat < f.bbox[1] || lat > f.bbox[3]) continue;
      if (!pointInGeometry(pt, f.geometry)) continue;
      // prefer building:part (more specific) and then the tallest
      if (!best || (f.properties.part && !best.properties.part) || ((!!f.properties.part === !!best.properties.part) && f.properties.h > best.properties.h)) best = f;
    }
    return best;
  }

  /** Nearest street/path segment within maxDist metres. */
  roadNear(lng, lat, maxDist = 25, filter) {
    if (!this.roadIndex) return null;
    const kx = mPerDegLng(lat), ky = mPerDegLat(lat);
    const d = maxDist / ky;
    let best = null, bestD = Infinity;
    for (const s of this.roadIndex.query([lng - d * 2, lat - d, lng + d * 2, lat + d])) {
      if (filter && !filter(s.f)) continue;
      const dist = distPointSegment(lng * kx, lat * ky, s.a[0] * kx, s.a[1] * ky, s.b[0] * kx, s.b[1] * ky);
      if (dist < bestD) { bestD = dist; best = s; }
    }
    if (!best || bestD > maxDist) return null;
    return { feature: best.f, dist: bestD, segment: best.i };
  }

  poisNear(lng, lat, r = 60) {
    if (!this.poiIndex) return [];
    const d = r / 111000;
    const out = [];
    for (const f of this.poiIndex.query([lng - d * 2, lat - d, lng + d * 2, lat + d])) {
      const dist = haversine([lng, lat], f.geometry.coordinates);
      if (dist <= r) out.push({ f, dist });
    }
    return out.sort((a, b) => a.dist - b.dist);
  }

  /** Points of interest located inside a building footprint (shops, cafés … in that building). */
  poisInBuilding(f) {
    if (!this.poiIndex || !f.bbox) return [];
    const out = [];
    for (const p of this.poiIndex.query(f.bbox)) if (pointInGeometry(p.geometry.coordinates, f.geometry)) out.push(p);
    return out;
  }

  // ---------------------------------------------------------------- scores
  setNetAScore(fc) {
    this.netScores = new Map();
    const acc = new Map();
    for (const f of (fc && fc.features) || []) {
      const p = f.properties;
      if (!/^\d+$/.test(String(p._wid))) continue;
      let a = acc.get(p._wid);
      if (!a) { a = { b: 0, nb: 0, w: 0, nw: 0 }; acc.set(p._wid, a); }
      if (p._bike !== null && p._bike !== undefined) { a.b += p._bike; a.nb++; }
      if (p._walk !== null && p._walk !== undefined) { a.w += p._walk; a.nw++; }
    }
    for (const [k, a] of acc) this.netScores.set(k, { bike: a.nb ? a.b / a.nb : null, walk: a.nw ? a.w / a.nw : null, src: (fc.metadata && fc.metadata.source === 'osm-lite') ? 'lite' : (fc.demo ? 'demo' : 'netascore') });
    this.netDemo = !!(fc && fc.demo);
    this._emit();
  }

  /** NetAScore score for a city-pack road: official dataset if it has the way, otherwise NetAScore-lite from tags. */
  scoreForRoad(f) {
    if (!f) return null;
    const wid = String(f.id || '').replace(/^w/, '');
    const s = this.netScores.get(wid);
    if (s && !this.netDemo) return s;
    if (this.liteCache.has(f.id)) return this.liteCache.get(f.id);
    const t = f.properties.t || { highway: f.properties.k };
    const r = lite.scoreWay(t);
    const v = { bike: r.index_bike, walk: r.index_walk, src: 'lite', ind: r };
    this.liteCache.set(f.id, v);
    return v;
  }
}

export const cityData = new CityData();
export { STARTER_ID };
