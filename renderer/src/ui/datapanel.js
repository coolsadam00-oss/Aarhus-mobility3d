// "📦 Data" window: city packs (download / switch / delete), exactly what was downloaded, activity log, about.
import { $, $$, esc, fmtBytes, fmtDate, modal, toast, cleanError, loading } from '../util.js';
import * as settings from '../settings.js';
import { cityData } from '../citydata.js';

const api = window.mobility;
let onActivate = null;
let downloading = false;

export function initDataPanel(cb) {
  onActivate = cb;
  api.onPackProgress((p) => {
    const bar = $('#dl-bar'), msg = $('#dl-msg');
    if (!bar || !msg) return;
    msg.textContent = p.message || '';
    if (p.phase === 'download') bar.style.width = `${Math.round(((p.layerIndex + (p.tile - 1) / p.tiles) / p.layerCount) * 90)}%`;
    if (p.phase === 'convert') bar.style.width = '93%';
    if (p.phase === 'write') bar.style.width = '97%';
    if (p.phase === 'done') bar.style.width = '100%';
  });
}

export async function openDataPanel(tab = 'packs') {
  const m = modal({ title: 'City data & downloads', wide: true, tabs: [
    { id: 'packs', label: '🏙️ City data packs' }, { id: 'download', label: '⬇ Download more' }, { id: 'activity', label: '🧾 Activity & downloads log' }, { id: 'about', label: 'ℹ️ Sources & attribution' }
  ] });
  const show = async (id) => {
    m.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    m.body.innerHTML = '<div class="muted">Loading…</div>';
    if (id === 'packs') await renderPacks(m);
    if (id === 'download') await renderDownload(m);
    if (id === 'activity') await renderActivity(m);
    if (id === 'about') await renderAbout(m);
  };
  m.tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
  await show(tab);
  return m;
}

function packCard(p, activeId) {
  const L = p.layers || {};
  const n = (k) => (L[k] ? L[k].count.toLocaleString('da-DK') : '–');
  const isActive = p.id === activeId;
  const hs = p.stats && p.stats.buildings;
  return `<div class="pack ${isActive ? 'active' : ''}" data-id="${esc(p.id)}">
    <div class="pack-head"><b>${esc(p.name)}</b>${p.builtin ? '<span class="tag info">built-in · offline</span>' : '<span class="tag ok">OpenStreetMap</span>'}${isActive ? '<span class="tag ok">active</span>' : ''}</div>
    <div class="muted" style="margin-top:4px">${p.builtin ? esc(p.description || '') : `Downloaded ${esc(fmtDate(p.created))} · OSM data as of ${esc(fmtDate(p.osmBase))} · ${p.areaKm2 || '?'} km² · ${fmtBytes(p.totalBytes || 0)}`}</div>
    <div class="pack-grid">
      <span>Buildings <b>${n('buildings')}</b></span><span>Streets & paths <b>${n('roads')}</b></span><span>Places <b>${n('pois')}</b></span><span>Addresses <b>${n('addresses')}</b></span>
      <span>Trees <b>${n('trees')}</b></span><span>Street furniture <b>${n('furniture')}</b></span><span>Water areas <b>${n('water')}</b></span><span>Land use areas <b>${n('landuse')}</b></span>
      ${hs ? `<span>Heights tagged <b>${(hs.heightTag + hs.levels).toLocaleString('da-DK')}</b></span><span>Heights measured <b>${hs.measured.toLocaleString('da-DK')}</b></span><span>Type known <b>${(hs.tagged + hs.name + hs.context).toLocaleString('da-DK')}</b></span><span>Requests <b>${p.logCount || 0}</b></span>` : ''}
    </div>
    <div class="btn-row">
      ${isActive ? '' : `<button class="btn primary" data-act="use">Use this data</button>`}
      ${p.builtin ? '' : `<button class="btn ghost" data-act="log">🧾 What was downloaded</button><button class="btn danger" data-act="del">🗑 Delete</button>`}
    </div><div class="pack-log"></div></div>`;
}

async function renderPacks(m) {
  const packs = await api.listPacks();
  const activeId = cityData.manifest ? cityData.manifest.id : null;
  m.body.innerHTML = `<p class="muted" style="margin-top:0">The app always works offline with the built-in GeoDanmark starter data for central Aarhus (real footprints, measured heights, trees, terrain). Download OpenStreetMap city data for <b>current</b> buildings with types (apartment, university, station …), names, addresses, shops, street details, street furniture and more.</p>
    <div class="pack-list">${packs.map(p => packCard(p, activeId)).join('')}</div>
    ${packs.length < 2 ? '<div class="btn-row"><button class="btn primary" id="go-dl">⬇ Download OpenStreetMap city data</button></div>' : ''}`;
  const go = $('#go-dl', m.body); if (go) go.onclick = () => m.tabs.find(t => t.dataset.tab === 'download').click();
  $$('.pack', m.body).forEach(card => {
    const id = card.dataset.id;
    const act = (a) => card.querySelector(`[data-act=${a}]`);
    if (act('use')) act('use').onclick = async () => { m.close(); await onActivate(id); };
    if (act('del')) act('del').onclick = async () => {
      if (act('del').dataset.armed !== '1') { act('del').dataset.armed = '1'; act('del').textContent = 'Click again to delete'; return; }
      try { await api.deletePack(id); if (settings.get('activePack') === id) { settings.set({ activePack: null }); await onActivate(null); } toast('City pack deleted', 'ok'); renderPacks(m); } catch (e) { toast(cleanError(e), 'error'); }
    };
    if (act('log')) act('log').onclick = async () => {
      const log = await api.packLog(id);
      card.querySelector('.pack-log').innerHTML = `<table class="log-table"><tr><th>Layer</th><th>Part</th><th>Server</th><th>Elements</th><th>Size</th><th>Time</th><th>Overpass query</th></tr>
        ${log.map(l => `<tr><td>${esc(l.layer)}</td><td>${l.tile}/${l.tiles}</td><td>${esc(new URL(l.endpoint).host)}</td><td>${l.elements.toLocaleString('da-DK')}</td><td>${fmtBytes(l.bytes)}</td><td>${(l.ms / 1000).toFixed(1)} s</td><td class="q">${esc(l.query)}</td></tr>`).join('')}</table>`;
    };
  });
}

async function renderDownload(m) {
  const { presets, maxAreaKm2 } = await api.packPresets();
  m.body.innerHTML = `<p class="muted" style="margin-top:0">Downloads come from the public OpenStreetMap Overpass API (© OpenStreetMap contributors, ODbL). Each pack contains buildings, streets, railways, water, parks, campuses, places, street furniture, trees, hedges and addresses. Heights missing in OSM are filled from the GeoDanmark roof survey where the buildings match.</p>
    <div class="presets">${presets.map(p => `<div class="preset"><b>${esc(p.name)}</b><span class="muted">${esc(p.note)}</span><code class="muted" style="font-size:10.5px">${p.bbox.map(v => v.toFixed(3)).join(', ')}</code><button class="btn primary" data-preset="${esc(p.id)}">⬇ Download</button></div>`).join('')}
      <div class="preset"><b>Current map view</b><span class="muted">Whatever the map currently shows (max ${maxAreaKm2} km²)</span><button class="btn" id="dl-view">⬇ Download view</button></div></div>
    <div id="dl-status" class="hidden"><div class="progress"><i id="dl-bar" style="width:2%"></i></div><div id="dl-msg" class="muted"></div><div class="btn-row"><button class="btn danger" id="dl-cancel">Cancel download</button></div></div>`;
  const start = async (area) => {
    if (downloading) return;
    downloading = true;
    $('#dl-status', m.body).classList.remove('hidden');
    $$('[data-preset], #dl-view', m.body).forEach(b => { b.disabled = true; });
    try {
      const res = await api.downloadPack(area);
      toast(`Downloaded ${res.name}: ${res.layers.buildings ? res.layers.buildings.count.toLocaleString('da-DK') : 0} buildings`, 'ok', 6000);
      m.close();
      await onActivate(res.id);
    } catch (e) {
      toast(cleanError(e), 'error', 8000);
      const msg = $('#dl-msg', m.body); if (msg) msg.textContent = cleanError(e);
    } finally {
      downloading = false;
      $$('[data-preset], #dl-view', m.body).forEach(b => { b.disabled = false; });
    }
  };
  $$('[data-preset]', m.body).forEach(b => b.onclick = () => { const p = presets.find(x => x.id === b.dataset.preset); start({ bbox: p.bbox, name: p.name }); });
  $('#dl-view', m.body).onclick = () => {
    const map = window.__am3d && window.__am3d.map;
    if (!map) return;
    const b = map.getBounds();
    start({ bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], name: 'Map view ' + new Date().toLocaleDateString('da-DK') });
  };
  $('#dl-cancel', m.body).onclick = () => api.cancelPackDownload();
}

async function renderActivity(m) {
  const rows = await api.activity(300);
  const info = await api.info();
  const ICON = { download: '⬇', import: '📂', export: '⬆', comment: '💬', delete: '🗑', error: '⚠️', privacy: '🔒' };
  m.body.innerHTML = `<p class="muted" style="margin-top:0">Everything the app downloaded, imported or exported on this PC. Data folder: <code>${esc(info.dataDir)}</code> · ${info.cacheEntries} cached online lookups.</p>
    <div class="btn-row" style="margin-bottom:12px"><button class="btn ghost" id="clear-cache">🔒 Clear online lookup cache</button></div>
    ${rows.length ? `<ul class="activity">${rows.map(r => `<li><time>${esc(fmtDate(r.at))}</time><span>${ICON[r.kind] || '•'} ${esc(r.kind)}</span><span>${esc(r.message)}</span></li>`).join('')}</ul>` : '<div class="muted">Nothing yet.</div>'}`;
  $('#clear-cache', m.body).onclick = async () => { await api.clearLookupCache(); toast('Lookup cache cleared', 'ok'); renderActivity(m); };
}

async function renderAbout(m) {
  const info = await api.info();
  m.body.innerHTML = `<h3>Data sources</h3><ul class="attrib">
    <li><b>OpenStreetMap</b> – buildings, streets, places, addresses, furniture via the Overpass API. © OpenStreetMap contributors, ODbL. Live search & addresses via Nominatim.</li>
    <li><b>GeoDanmark (FOT) 2016</b> – built-in starter data: 7 032 building footprints with surveyed roof heights, 3 807 road centrelines, 5 251 surveyed trees and a 5 m terrain model for Aarhus 8000. Contains data from Styrelsen for Dataforsyning og Infrastruktur; converted from the CityPulse 3D Map project (MIT licence).</li>
    <li><b>Aerial imagery</b> – Esri World Imagery (Maxar, Earthstar Geographics) or your own XYZ imagery (Settings → Data).</li>
    <li><b>Terrain</b> – AWS Terrain Tiles (Mapzen; SRTM, GMTED, ETOPO1 and others) plus the GeoDanmark grid.</li>
    <li><b>Vector basemap</b> – OpenFreeMap / OpenMapTiles.</li>
    <li><b>Wikipedia / Wikidata / Wikimedia Commons</b> – descriptions, facts and photos (CC BY-SA; image licences on each file page).</li>
    <li><b>NetAScore</b> – mobility index by PLUS Mobility Lab, University of Salzburg (MIT). “NetAScore-lite” scores are approximations computed in this app.</li></ul>
    <h3>About</h3><p>Aarhus Mobility 3D ${esc(info.version)} · Electron ${esc(info.electron)} · Chromium ${esc(info.chrome)}<br>Data folder: <code>${esc(info.dataDir)}</code></p>`;
}

export async function quickLoad(id, msg = 'Loading city data…') {
  loading(true, msg);
  try { await cityData.load(id, (s) => { loading(true, msg, s); }); } finally { loading(false); }
}
