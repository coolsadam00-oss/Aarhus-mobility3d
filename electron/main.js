'use strict';
/**
 * Electron main process (v2).
 *  - SQLite database in %APPDATA%\Aarhus Mobility 3D\ (comments, settings, lookup cache, activity log)
 *  - city packs (OpenStreetMap downloads + bundled GeoDanmark starter) served to the renderer via am3d://
 *  - NetAScore datasets (GeoJSON / GeoPackage), online lookups (Nominatim, Wikipedia, Wikidata)
 *  - a narrow, validated IPC API (see preload.js)
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const { openDatabase } = require('./db');
const { loadDataset } = require('./data-loader');
const { fetchAarhusOsmLite } = require('./osm-fetch');
const { toCsv, toGeoJson } = require('./export');
const { PRESETS, downloadPack, MAX_AREA_KM2 } = require('./citypack');
const { listPacks, readManifest, deletePack } = require('./citypack-io');
const { createLookup } = require('./lookup');

const isDev = !app.isPackaged;
let win = null;
let db = null;
let lookup = null;
let currentDataset = null;
let packDownload = null; // { controller, area }

protocol.registerSchemesAsPrivileged([
  { scheme: 'am3d', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

// ------------------------------------------------------------------ paths
function resourcePath(...p) {
  return app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, '..', ...p);
}
function dataDir() {
  if (process.env.AM3D_DATA_DIR) return process.env.AM3D_DATA_DIR;
  const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  const portable = path.join(exeDir, 'AarhusMobility3D-data');
  if (app.isPackaged && fs.existsSync(portable)) return portable;
  return app.getPath('userData');
}
const datasetsDir = () => { const d = path.join(dataDir(), 'datasets'); fs.mkdirSync(d, { recursive: true }); return d; };
const packsRoot = () => { const d = path.join(dataDir(), 'citypacks'); fs.mkdirSync(d, { recursive: true }); return d; };
const starterDir = () => resourcePath('data', 'starter');

function packDir(id) {
  if (id === 'starter-aarhus-8000') return starterDir();
  if (!/^[a-z0-9-]+$/i.test(String(id))) return null;
  return path.join(packsRoot(), id);
}

function allPacks() {
  const out = [];
  const starter = readManifest(starterDir());
  if (starter) out.push({ ...starter, builtin: true });
  for (const m of listPacks(packsRoot())) out.push(m);
  return out.map(({ dir, log, ...m }) => ({ ...m, logCount: log ? log.length : 0 }));
}

function defaultDatasetCandidates() {
  const out = [];
  const saved = db.getSetting('dataset_path');
  if (saved) out.push(saved);
  for (const f of ['aarhus_netascore.gpkg', 'aarhus_netascore.geojson', 'netascore_aarhus.gpkg']) out.push(resourcePath('data', f));
  out.push(path.join(datasetsDir(), 'aarhus_osm_lite.geojson'));
  out.push(resourcePath('data', 'aarhus_demo.geojson'));
  return out;
}

// ------------------------------------------------------------------ am3d:// protocol (read-only access to pack files)
function registerProtocol() {
  protocol.handle('am3d', async (request) => {
    try {
      const u = new URL(request.url);
      // am3d://pack/<id>/<file>
      if (u.hostname !== 'pack') return new Response('Not found', { status: 404 });
      const [, id, file] = decodeURIComponent(u.pathname).split('/');
      if (!/^[a-zA-Z0-9_]+\.(json|bin)$/.test(file || '')) return new Response('Bad request', { status: 400 });
      const dir = packDir(id);
      if (!dir) return new Response('Not found', { status: 404 });
      const full = path.join(dir, file);
      if (!full.startsWith(dir) || !fs.existsSync(full)) return new Response('Not found', { status: 404 });
      const res = await net.fetch(pathToFileURL(full).toString());
      return new Response(res.body, {
        status: 200,
        headers: { 'Content-Type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }
      });
    } catch (e) {
      return new Response(String(e.message), { status: 500 });
    }
  });
}

// ------------------------------------------------------------------ window & menu
function createWindow() {
  win = new BrowserWindow({
    width: 1680, height: 1000, minWidth: 1100, minHeight: 700, backgroundColor: '#0d1117', title: 'Aarhus Mobility 3D', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false }
  });
  win.once('ready-to-show', () => { win.show(); if (!isDev) win.maximize(); });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

function buildMenu() {
  const m = (action) => () => send('menu', action);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open NetAScore file…', accelerator: 'CmdOrCtrl+O', click: m('open') },
      { label: 'Download city data…', accelerator: 'CmdOrCtrl+D', click: m('data') },
      { type: 'separator' },
      { label: 'Export feedback as CSV…', click: m('export-csv') },
      { label: 'Export feedback as GeoJSON…', click: m('export-geojson') },
      { label: 'Save screenshot…', accelerator: 'F12', click: m('screenshot') },
      { type: 'separator' },
      { label: 'Open data folder', click: () => shell.openPath(dataDir()) },
      { type: 'separator' }, { role: 'quit' }
    ] },
    { label: 'View', submenu: [
      { label: 'Map view', accelerator: 'CmdOrCtrl+1', click: m('view-map') },
      { label: '3D explore (walk / bike / drive / fly)', accelerator: 'CmdOrCtrl+2', click: m('view-explore') },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: m('settings') },
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools', visible: isDev },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' }
    ] },
    { label: 'Help', submenu: [
      { label: 'Controls & shortcuts', accelerator: 'F1', click: m('help') },
      { label: 'Data sources & attribution', click: m('about') },
      { type: 'separator' },
      { label: 'NetAScore on GitHub', click: () => shell.openExternal('https://github.com/plus-mobilitylab/netascore') },
      { label: 'OpenStreetMap copyright', click: () => shell.openExternal('https://www.openstreetmap.org/copyright') }
    ] }
  ]));
}

// ------------------------------------------------------------------ helpers
const cleanErr = (e) => String(e && e.message ? e.message : e);
function datasetResponse(file) {
  send('progress', `Loading ${path.basename(file)} …`);
  const { geojson, meta } = loadDataset(file);
  currentDataset = meta;
  return { meta, geojson: JSON.stringify(geojson) };
}
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) && u.length < 2048;

// ------------------------------------------------------------------ IPC
function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(), dataDir: dataDir(), dbFile: path.join(dataDir(), 'feedback.sqlite'), platform: process.platform,
    packsRoot: packsRoot(), cacheEntries: db.cacheCount(), electron: process.versions.electron, chrome: process.versions.chrome
  }));

  // settings (one JSON document, merged)
  ipcMain.handle('settings:get', () => db.getJson('settings_v2', {}));
  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return db.getJson('settings_v2', {});
    const next = { ...db.getJson('settings_v2', {}), ...patch };
    const json = JSON.stringify(next);
    if (json.length > 200000) throw new Error('Settings too large');
    db.setSetting('settings_v2', json);
    return next;
  });

  // NetAScore datasets
  ipcMain.handle('dataset:loadDefault', () => {
    const errors = [];
    for (const f of defaultDatasetCandidates()) {
      if (!f || !fs.existsSync(f)) continue;
      try { return datasetResponse(f); } catch (e) { errors.push(`${path.basename(f)}: ${e.message}`); }
    }
    throw new Error(`No dataset could be loaded. ${errors.join(' | ')}`);
  });
  ipcMain.handle('dataset:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Open NetAScore street network', properties: ['openFile'],
      filters: [{ name: 'NetAScore output', extensions: ['gpkg', 'geojson', 'json'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    const res = datasetResponse(r.filePaths[0]);
    db.setSetting('dataset_path', r.filePaths[0]);
    db.log('import', `Imported NetAScore dataset ${path.basename(r.filePaths[0])}`, { count: res.meta.count, file: r.filePaths[0] });
    return res;
  });
  ipcMain.handle('dataset:resetDefault', () => {
    db.setSetting('dataset_path', null);
    const f = defaultDatasetCandidates().slice(1).find(p => fs.existsSync(p));
    return datasetResponse(f);
  });
  ipcMain.handle('dataset:fetchOsm', async () => {
    const fc = await fetchAarhusOsmLite({ onProgress: (m) => send('progress', m) });
    const file = path.join(datasetsDir(), 'aarhus_osm_lite.geojson');
    fs.writeFileSync(file, JSON.stringify(fc));
    db.setSetting('dataset_path', file);
    db.log('download', `Downloaded ${fc.features.length} streets from OpenStreetMap (approximate scores)`, { file });
    return datasetResponse(file);
  });

  // city packs
  ipcMain.handle('packs:list', () => allPacks());
  ipcMain.handle('packs:presets', () => ({ presets: PRESETS, maxAreaKm2: MAX_AREA_KM2 }));
  ipcMain.handle('packs:download', async (_e, area) => {
    if (packDownload) throw new Error('A download is already running.');
    if (!area || !Array.isArray(area.bbox)) throw new Error('No area given.');
    const controller = new AbortController();
    packDownload = { controller, area };
    db.log('download', `Started city-data download: ${area.name}`, { bbox: area.bbox });
    try {
      const m = await downloadPack({ bbox: area.bbox, name: String(area.name || 'Custom area').slice(0, 80), id: area.id && /^[a-z0-9-]+$/.test(area.id) ? area.id : undefined },
        { packsRoot: packsRoot(), starterDir: starterDir(), signal: controller.signal, onProgress: (p) => send('pack-progress', p) });
      db.log('download', `City data ready: ${m.name} – ${m.layers.buildings ? m.layers.buildings.count : 0} buildings, ${m.layers.roads ? m.layers.roads.count : 0} streets, ${m.layers.pois ? m.layers.pois.count : 0} places (${(m.stats.downloadBytes / 1048576).toFixed(1)} MB)`,
        { id: m.id, layers: m.layers, osmBase: m.osmBase, stats: m.stats });
      const { dir, log, ...rest } = m;
      return rest;
    } catch (e) {
      db.log('error', `City-data download failed: ${cleanErr(e)}`, { area });
      throw e;
    } finally {
      packDownload = null;
    }
  });
  ipcMain.handle('packs:cancel', () => { if (packDownload) packDownload.controller.abort(); return true; });
  ipcMain.handle('packs:delete', (_e, id) => {
    if (id === 'starter-aarhus-8000') throw new Error('The built-in starter data cannot be deleted.');
    deletePack(packsRoot(), String(id));
    db.log('delete', `Deleted city pack ${id}`);
    return allPacks();
  });
  ipcMain.handle('packs:log', (_e, id) => { const d = packDir(id); const m = d && readManifest(d); return m ? (m.log || []) : []; });

  // lookups
  ipcMain.handle('lookup:search', (_e, q) => lookup.search(q));
  ipcMain.handle('lookup:reverse', (_e, lat, lon) => lookup.reverse(lat, lon));
  ipcMain.handle('lookup:wiki', (_e, tags) => lookup.wiki(tags && typeof tags === 'object' ? tags : {}));
  ipcMain.handle('lookup:osmAt', (_e, lat, lon) => lookup.osmBuildingAt(lat, lon));
  ipcMain.handle('lookup:clearCache', () => { db.cacheClear(); db.log('privacy', 'Cleared the online lookup cache'); return true; });

  // comments
  ipcMain.handle('comments:list', (_e, wayId) => db.listComments(wayId ? String(wayId) : null));
  ipcMain.handle('comments:add', (_e, payload) => {
    const c = db.addComment({ ...payload, dataset: currentDataset ? currentDataset.fileName : null });
    db.log('comment', `Comment on ${c.target_type} ${c.street_name || c.osm_way_id}: ${c.category}`, { id: c.id });
    return c;
  });
  ipcMain.handle('comments:delete', (_e, id) => db.deleteComment(id));
  ipcMain.handle('comments:export', async (_e, format) => {
    const fmt = format === 'geojson' ? 'geojson' : 'csv';
    const r = await dialog.showSaveDialog(win, { title: 'Export feedback', defaultPath: path.join(app.getPath('documents'), `aarhus_feedback_${new Date().toISOString().slice(0, 10)}.${fmt}`),
      filters: fmt === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: 'GeoJSON', extensions: ['geojson'] }] });
    if (r.canceled || !r.filePath) return null;
    const rows = db.listComments(null);
    fs.writeFileSync(r.filePath, fmt === 'csv' ? toCsv(rows) : toGeoJson(rows), 'utf8');
    db.log('export', `Exported ${rows.length} comments as ${fmt.toUpperCase()}`, { file: r.filePath });
    return { file: r.filePath, count: rows.length };
  });

  // activity log
  ipcMain.handle('activity:list', (_e, limit) => db.listLog(limit));

  // screenshot
  ipcMain.handle('screenshot:save', async (_e, dataUrl) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('Invalid image');
    const r = await dialog.showSaveDialog(win, { title: 'Save screenshot', defaultPath: path.join(app.getPath('pictures'), `aarhus-3d-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`), filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    db.log('export', `Saved screenshot ${path.basename(r.filePath)}`);
    return r.filePath;
  });

  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (isHttpUrl(url)) { shell.openExternal(url); return true; }
    return false;
  });
}

// ------------------------------------------------------------------ lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    fs.mkdirSync(dataDir(), { recursive: true });
    db = openDatabase(path.join(dataDir(), 'feedback.sqlite'));
    lookup = createLookup({
      cacheGet: (k, ttl) => db.cacheGet(k, ttl),
      cacheSet: (k, v) => db.cacheSet(k, v),
      enabled: () => db.getJson('settings_v2', {}).onlineLookups !== false
    });
    registerProtocol();
    registerIpc();
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => {
    if (packDownload) packDownload.controller.abort();
    if (db) { db.close(); db = null; }
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { packDir };
