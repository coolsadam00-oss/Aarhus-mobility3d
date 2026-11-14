// Renderer entry point: wires views, data, search, panels and menus together.
import { $, $$, toast, loading, cleanError } from './util.js';
import * as settings from './settings.js';
import { cityData, STARTER_ID } from './citydata.js';
import * as panel from './infopanel.js';
import * as mapview from './map/mapview.js';
import { initSearch } from './ui/search.js';
import { initDataPanel, openDataPanel } from './ui/datapanel.js';
import { openSettings, openHelp } from './ui/settingspanel.js';

const api = window.mobility;
let view = 'map';
let explorer = null;
let explorerLoading = null;

async function getExplorer() {
  if (explorer) return explorer;
  if (!explorerLoading) {
    explorerLoading = import('./explore/explorer.js').then(m => {
      explorer = new m.Explorer($('#explore-root'));
      return explorer;
    });
  }
  return explorerLoading;
}

async function setView(v, opts = {}) {
  if (v === view && !opts.force) return;
  view = v;
  document.body.classList.toggle('explore', v === 'explore');
  $$('#topbar .views .seg').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $('#view-map').classList.toggle('active', v === 'map');
  $('#view-explore').classList.toggle('active', v === 'explore');
  panel.closePanel();
  if (v === 'explore') {
    try {
      const ex = await getExplorer();
      let at = opts.at;
      if (!at) {
        const map = mapview.getMap();
        const c = map.getCenter();
        at = { lng: c.lng, lat: c.lat, heading: map.getBearing() };
      }
      await ex.enter(at);
    } catch (e) {
      console.error(e);
      toast('3D explorer failed to start: ' + cleanError(e), 'error', 9000);
      setView('map');
    }
  } else {
    if (explorer) explorer.exit();
    mapview.resize();
  }
}

async function activatePack(id) {
  loading(true, 'Loading city data…');
  try {
    await cityData.load(id || STARTER_ID, (s) => loading(true, 'Loading city data…', s));
    settings.set({ activePack: id && id !== STARTER_ID ? id : null });
    if (explorer) explorer.onDataChanged();
    toast(`City data: ${cityData.manifest.name}`, 'ok');
  } catch (e) {
    toast('Could not load city data: ' + cleanError(e), 'error', 8000);
    if (id && id !== STARTER_ID) { settings.set({ activePack: null }); await cityData.load(STARTER_ID); }
  } finally { loading(false); }
}

function onSearchSelect(r) {
  const { lng, lat } = r;
  if (view === 'explore' && explorer) { explorer.teleport(lng, lat); }
  else mapview.flyTo(lng, lat, r.kind === 'street' ? 17 : 18);
  const f = r.ref && r.ref.id ? cityData.byId.get(r.ref.id) : null;
  if (r.ref.type === 'building' && f) panel.showBuilding(f);
  else if (r.ref.type === 'poi' && f) panel.showPoi(f);
  else if (r.ref.type === 'road' && f) panel.showRoad(f, { lng, lat });
  else if (r.ref.type === 'address' || r.ref.type === 'online') {
    const b = cityData.buildingAt(lng, lat);
    if (b) panel.showBuilding(b, { lngLat: { lng, lat } }); else panel.showPlace(lng, lat);
  } else panel.showPlace(lng, lat);
}

async function boot() {
  loading(true, 'Starting Aarhus Mobility 3D…');
  await settings.loadSettings();
  await cityData.loadDem();
  const want = settings.get('activePack');
  try { await cityData.load(want || STARTER_ID, (s) => loading(true, 'Loading city data…', s)); }
  catch (e) { console.warn(e); settings.set({ activePack: null }); await cityData.load(STARTER_ID); }

  panel.initPanel({
    onExplore: ({ lng, lat }) => setView('explore', { at: { lng, lat }, force: view === 'explore' }),
    onCommentsChanged: () => mapview.refreshComments(),
    onClose: () => { mapview.onPanelClosed(); if (explorer) explorer.onPanelClosed(); },
    getMode: () => mapview.getMode()
  });
  const map = mapview.initMapView({ explore: (at) => setView('explore', { at, force: view === 'explore' }) });
  window.__am3d = { map, cityData, settings, getExplorer, comments: [] };
  document.addEventListener('comments-changed', (e) => { window.__am3d.comments = e.detail || []; });
  initSearch(onSearchSelect);
  initDataPanel(activatePack);

  $$('#topbar .views .seg').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#btn-data').addEventListener('click', () => openDataPanel());
  $('#btn-settings').addEventListener('click', () => openSettings());
  $('#btn-help').addEventListener('click', () => openHelp());
  api.onProgress((msg) => { $('#loading-msg').textContent = msg; });
  api.onMenu(async (action) => {
    if (action === 'open') $('#btn-open').click();
    if (action === 'export-csv') mapview.doExport('csv');
    if (action === 'export-geojson') mapview.doExport('geojson');
    if (action === 'data') openDataPanel();
    if (action === 'settings') openSettings();
    if (action === 'help') openHelp();
    if (action === 'about') openDataPanel('about');
    if (action === 'view-map') setView('map');
    if (action === 'view-explore') setView('explore');
    if (action === 'screenshot') screenshot();
  });
  document.addEventListener('keydown', (e) => {
    // Esc closes the info panel in both views (also from inside its comment box)
    if (e.key === 'Escape' && panel.isOpen() && !document.querySelector('.modal-backdrop')) { panel.closePanel(); return; }
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'F1') { e.preventDefault(); openHelp(); }
  });
  window.addEventListener('resize', () => mapview.resize());
  loading(false);

  if (cityData.isStarter) {
    setTimeout(() => toast('Tip: 📦 Data → download OpenStreetMap city data for building types, names, addresses and shops. 🎮 3D Explore lets you walk, cycle, drive and fly.', 'info', 9000), 1500);
  }
}

async function screenshot() {
  try {
    let url;
    if (view === 'explore' && explorer) url = explorer.screenshot();
    else { const map = mapview.getMap(); map.triggerRepaint(); await new Promise(r => map.once('render', r)); url = map.getCanvas().toDataURL('image/png'); }
    const file = await api.saveScreenshot(url);
    if (file) toast('Screenshot saved: ' + file, 'ok');
  } catch (e) { toast('Screenshot failed: ' + cleanError(e), 'error'); }
}
window.__am3dScreenshot = screenshot;

boot().catch((e) => { console.error(e); loading(false); toast('Startup error: ' + cleanError(e), 'error', 12000); });
