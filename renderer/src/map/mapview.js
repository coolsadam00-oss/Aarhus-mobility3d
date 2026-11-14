// 2.5D analysis map (MapLibre): NetAScore streets, typed 3D buildings, places, feedback pins.
import geo from '../../../shared/geo.js';
import cls from '../../../shared/classify.js';
import { $, $$, esc, fmt, scoreColor, RAMP, NULL_COLOR, toast, loading, cleanError, CATEGORIES, fmtDate } from '../util.js';
import { buildStyle, AARHUS, BASEMAP_LAYERS } from './style.js';
import { cityData } from '../citydata.js';
import * as settings from '../settings.js';
import * as panel from '../infopanel.js';
import { facadeColor, facadeStyle } from '../appearance.js';

const api = window.mobility;
const maplibregl = window.maplibregl;
const { GROUP_COLORS } = cls;

const state = { mode: 'bike', minScore: 0, hideUnscored: false, meta: null, bySid: new Map(), comments: [], markers: [], hoverSid: null, topDown: false, booted: false };
let map = null;
let onExplore = null;

export function getMap() { return map; }
export function getMode() { return state.mode; }

// ------------------------------------------------------------------ init
export function initMapView({ explore }) {
  onExplore = explore;
  map = new maplibregl.Map({
    container: 'map', style: buildStyle(settings.get('customImagery')), center: AARHUS.center, zoom: AARHUS.zoom, pitch: AARHUS.pitch, bearing: AARHUS.bearing,
    maxPitch: 85, attributionControl: { compact: true }, canvasContextAttributes: { antialias: true }, fadeDuration: 150
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new maplibregl.FullscreenControl(), 'top-right');
  map.on('error', (e) => console.warn('[map]', e && e.error && e.error.message));
  map.on('style.load', async () => {
    if (state.booted) return;
    state.booted = true;
    addLayers();
    applyBasemap();
    applyBuildingColors();
    applyToggles();
    await runDatasetAction(api.loadDefaultDataset, 'Loading NetAScore network…', { fit: false });
    await refreshComments();
    refreshCityLayers();
  });
  map.on('moveend', updateOfmBuildingVisibility);
  wireControls();
  cityData.onChange(() => { if (state.booted) refreshCityLayers(); });
  settings.onChange((ch) => {
    if ('mapBasemap' in ch) applyBasemap();
    if ('mapBuildingColors' in ch) applyBuildingColors();
    if (['mapBuildings', 'mapPois', 'mapLabels', 'mapNetascore', 'mapPins', 'mapHillshade', 'mapTerrainExag'].some(k => k in ch)) applyToggles();
  });
  return map;
}

export function resize() { if (map) map.resize(); }

// ------------------------------------------------------------------ layers
function colorExpr() {
  const field = state.mode === 'bike' ? '_bike' : '_walk';
  return ['case', ['==', ['typeof', ['get', field]], 'number'], ['interpolate', ['linear'], ['get', field], ...RAMP], NULL_COLOR];
}
function networkFilter() {
  const field = state.mode === 'bike' ? '_bike' : '_walk';
  const parts = ['all'];
  if (state.hideUnscored || state.minScore > 0) parts.push(['==', ['typeof', ['get', field]], 'number']);
  if (state.minScore > 0) parts.push(['>=', ['to-number', ['coalesce', ['get', field], -1]], state.minScore]);
  return parts.length > 1 ? parts : null;
}

function addLayers() {
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('pack-buildings', { type: 'geojson', data: empty, promoteId: 'id' });
  map.addSource('pack-labels', { type: 'geojson', data: empty });
  map.addSource('pois', { type: 'geojson', data: empty });
  map.addSource('netascore', { type: 'geojson', data: empty, promoteId: '_sid', tolerance: 0.2 });
  map.addSource('selected', { type: 'geojson', data: empty });
  map.addSource('selected-building', { type: 'geojson', data: empty });

  const before = 'street-labels';
  map.addLayer({ id: 'pack-buildings', type: 'fill-extrusion', source: 'pack-buildings', minzoom: 12,
    paint: { 'fill-extrusion-color': ['get', 'mc'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.94, 'fill-extrusion-vertical-gradient': true } }, before);
  map.addLayer({ id: 'pack-building-sel', type: 'fill-extrusion', source: 'selected-building',
    paint: { 'fill-extrusion-color': '#4dabf7', 'fill-extrusion-height': ['+', ['get', 'top'], 0.4], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.75 } }, before);

  const hover = ['boolean', ['feature-state', 'hover'], false];
  const stop = (w) => ['case', hover, w * 1.7, w];
  const widthBase = ['interpolate', ['exponential', 1.5], ['zoom'], 11, stop(1.2), 14, stop(3), 16, stop(6), 18, stop(12)];
  map.addLayer({ id: 'net-casing', type: 'line', source: 'netascore', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#1b1f24', 'line-opacity': 0.55, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 2, 14, 4.5, 16, 8.5, 18, 16] } }, before);
  map.addLayer({ id: 'net-line', type: 'line', source: 'netascore', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colorExpr(), 'line-width': widthBase, 'line-opacity': 0.95 } }, before);
  map.addLayer({ id: 'net-commented', type: 'line', source: 'netascore', filter: ['in', ['get', '_wid'], ['literal', []]], paint: { 'line-color': '#ffffff', 'line-dasharray': [1.2, 1.2], 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 2, 18, 3.5] } }, before);
  map.addLayer({ id: 'sel-glow', type: 'line', source: 'selected', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4dabf7', 'line-blur': 4, 'line-opacity': 0.9, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 8, 16, 20, 18, 34] } }, before);
  map.addLayer({ id: 'sel-core', type: 'line', source: 'selected', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, 2, 16, 5, 18, 9] } }, before);

  map.addLayer({ id: 'pois-circle', type: 'circle', source: 'pois', minzoom: 14.5,
    paint: { 'circle-color': ['get', 'col'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14.5, 3, 18, 7], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-pitch-alignment': 'viewport' } });
  map.addLayer({ id: 'pois-label', type: 'symbol', source: 'pois', minzoom: 16.2,
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 9 },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.4 } });
  map.addLayer({ id: 'pack-labels', type: 'symbol', source: 'pack-labels', minzoom: 16.6,
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 16.6, 10, 19, 13], 'text-max-width': 10, 'text-padding': 4 },
    paint: { 'text-color': '#fff7d6', 'text-halo-color': 'rgba(20,20,20,0.8)', 'text-halo-width': 1.5 } });

  map.addLayer({ id: 'net-hit', type: 'line', source: 'netascore', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 8, 16, 18, 18, 28] } });

  // ---- interaction
  map.on('mousemove', (e) => onHover(e));
  map.on('mouseout', () => { $('#hover-tip').classList.add('hidden'); });
  map.on('click', (e) => onClick(e));
  map.on('contextmenu', (e) => onContext(e));
}

function hitLayers() { return ['pois-circle', 'net-hit', 'pack-buildings', 'building-ofm'].filter(l => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none'); }

function onHover(e) {
  const feats = map.queryRenderedFeatures(e.point, { layers: hitLayers() });
  const tip = $('#hover-tip');
  if (state.hoverSid !== null && (!feats.length || feats[0].layer.id !== 'net-hit' || feats[0].id !== state.hoverSid)) {
    map.setFeatureState({ source: 'netascore', id: state.hoverSid }, { hover: false });
    state.hoverSid = null;
  }
  if (!feats.length) { map.getCanvas().style.cursor = ''; tip.classList.add('hidden'); return; }
  map.getCanvas().style.cursor = 'pointer';
  const f = feats[0];
  let html = '';
  if (f.layer.id === 'net-hit') {
    state.hoverSid = f.id;
    map.setFeatureState({ source: 'netascore', id: f.id }, { hover: true });
    const v = state.mode === 'bike' ? f.properties._bike : f.properties._walk;
    html = `<b>${esc(f.properties._name || 'Unnamed street')}</b><span style="color:${scoreColor(v)}">● ${v == null ? 'n/a' : Number(v).toFixed(2)}</span>`;
  } else if (f.layer.id === 'pois-circle') {
    html = `<b>${esc(f.properties.ic)} ${esc(f.properties.label)}</b><span class="muted">${esc(f.properties.lbl)}</span>`;
  } else if (f.layer.id === 'pack-buildings') {
    const b = cityData.byId.get(f.properties.id);
    const p = b ? b.properties : f.properties;
    html = `<b>${esc(p.ic || '🏢')} ${esc(p.lbl || 'Building')}</b><span class="muted">${esc(p.n || p.a || '')}</span>`;
  } else {
    html = '<b>🏢 Building</b><span class="muted">click for details</span>';
  }
  tip.innerHTML = html;
  tip.style.transform = `translate(${e.originalEvent.clientX + 14}px, ${e.originalEvent.clientY + 14}px)`;
  tip.classList.remove('hidden');
}

function onClick(e) {
  const feats = map.queryRenderedFeatures(e.point, { layers: hitLayers() });
  const { lng, lat } = e.lngLat;
  if (!feats.length) { panel.closePanel(); clearSelection(); return; }
  const f = feats[0];
  if (f.layer.id === 'pois-circle') { const pf = cityData.byId.get(f.properties.id); if (pf) { clearSelection(); panel.showPoi(pf); } return; }
  if (f.layer.id === 'net-hit') { selectSegment(f.id, e.lngLat); return; }
  if (f.layer.id === 'pack-buildings') {
    const b = cityData.byId.get(f.properties.id);
    if (b) { selectBuilding(b); panel.showBuilding(b, { lngLat: e.lngLat }); }
    return;
  }
  // OpenFreeMap building outside downloaded city data → live lookup
  clearSelection();
  panel.showLiveBuilding(lng, lat);
}

function onContext(e) {
  const { lng, lat } = e.lngLat;
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 6 })
    .setLngLat(e.lngLat)
    .setHTML(`<div style="display:flex;flex-direction:column;gap:6px;min-width:190px">
      <button class="btn" data-a="explore">🎮 Explore in 3D here</button>
      <button class="btn ghost" data-a="what">📍 What's here?</button>
      <button class="btn ghost" data-a="copy">📋 Copy coordinates</button></div>`)
    .addTo(map);
  const el = popup.getElement();
  el.querySelector('[data-a=explore]').onclick = () => { popup.remove(); onExplore && onExplore({ lng, lat }); };
  el.querySelector('[data-a=what]').onclick = () => { popup.remove(); clearSelection(); panel.showPlace(lng, lat); };
  el.querySelector('[data-a=copy]').onclick = () => { navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`); popup.remove(); toast('Coordinates copied', 'ok'); };
}

function clearSelection() {
  if (map.getSource('selected')) map.getSource('selected').setData({ type: 'FeatureCollection', features: [] });
  if (map.getSource('selected-building')) map.getSource('selected-building').setData({ type: 'FeatureCollection', features: [] });
}

function selectBuilding(b) {
  clearSelection();
  const p = mapProps(b);
  map.getSource('selected-building').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: b.geometry, properties: { top: p.top, base: p.base } }] });
}

export function selectSegment(sid, lngLat) {
  const f = state.bySid.get(sid);
  if (!f) return;
  clearSelection();
  map.getSource('selected').setData({ type: 'FeatureCollection', features: [f] });
  panel.showSegment(f, lngLat);
}

// ------------------------------------------------------------------ city layers (buildings, labels, POIs)
function mapProps(f) {
  const p = f.properties;
  const top = p.h || 6;
  return { top, base: p.mh || 0 };
}

const HS_COLORS = { t: '#51cf66', l: '#94d82d', g: '#4dabf7', e: '#ffa94d' };

function refreshCityLayers() {
  if (!map || !map.getSource('pack-buildings')) return;
  const feats = [];
  const labels = [];
  for (const f of cityData.layer('buildings')) {
    const p = f.properties;
    const { top, base } = mapProps(f);
    const style = facadeStyle(p);
    feats.push({ type: 'Feature', geometry: f.geometry, properties: {
      id: f.id, top, base, g: p.g || 'unknown', hs: p.hs || 'e',
      mc: facadeColor({ ...p, st: style }), tc: GROUP_COLORS[p.g] || GROUP_COLORS.unknown, hc: HS_COLORS[p.hs] || '#adb5bd'
    } });
    if (p.n || (p.cf && p.cf !== 'unknown')) {
      labels.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p.centroid }, properties: { label: p.n ? `${p.n}\n${p.lbl}` : p.lbl } });
    }
  }
  map.getSource('pack-buildings').setData({ type: 'FeatureCollection', features: feats });
  map.getSource('pack-labels').setData({ type: 'FeatureCollection', features: labels });
  const pois = cityData.layer('pois').map(f => ({ type: 'Feature', geometry: f.geometry, properties: { id: f.id, label: f.properties.n || '', lbl: f.properties.lbl, ic: f.properties.ic, col: f.properties.col || GROUP_COLORS[f.properties.g] || '#868e96' } }));
  map.getSource('pois').setData({ type: 'FeatureCollection', features: pois });
  renderTypeLegend();
  updateOfmBuildingVisibility();
}

function updateOfmBuildingVisibility() {
  if (!map || !map.getLayer('building-ofm')) return;
  const bb = cityData.bbox;
  const c = map.getCenter();
  const insidePack = bb && cityData.layer('buildings').length && c.lng > bb[0] - 0.004 && c.lng < bb[2] + 0.004 && c.lat > bb[1] - 0.003 && c.lat < bb[3] + 0.003;
  map.setLayoutProperty('building-ofm', 'visibility', settings.get('mapBuildings') && !insidePack ? 'visible' : 'none');
}

function applyBuildingColors() {
  if (!map || !map.getLayer('pack-buildings')) return;
  const mode = settings.get('mapBuildingColors');
  map.setPaintProperty('pack-buildings', 'fill-extrusion-color', ['get', mode === 'type' ? 'tc' : mode === 'source' ? 'hc' : 'mc']);
  if (mode === 'height') map.setPaintProperty('pack-buildings', 'fill-extrusion-color', ['interpolate', ['linear'], ['get', 'top'], 0, '#2b8a3e', 8, '#94d82d', 16, '#fcc419', 28, '#f76707', 45, '#c92a2a']);
  $('#sel-bcolors').value = mode;
  renderTypeLegend();
}

function renderTypeLegend() {
  const el = $('#type-legend');
  if (!el) return;
  const mode = settings.get('mapBuildingColors');
  if (mode === 'source') {
    el.innerHTML = [['t', 'Height from OSM tag'], ['l', 'From floor count'], ['g', 'Measured (GeoDanmark)'], ['e', 'Estimated']].map(([k, l]) => `<span><i style="background:${HS_COLORS[k]}"></i>${l}</span>`).join('');
    return;
  }
  const counts = new Map();
  for (const f of cityData.layer('buildings')) counts.set(f.properties.g || 'unknown', (counts.get(f.properties.g || 'unknown') || 0) + 1);
  const NAMES = { residential: 'Homes', commercial: 'Shops & offices', industrial: 'Industry', education: 'Education', health: 'Health', religious: 'Religion', transport: 'Transport', civic: 'Public', sports: 'Sport', minor: 'Garages & sheds', agricultural: 'Farm', utility: 'Utility', culture: 'Culture', food: 'Food & drink', shop: 'Shops', services: 'Services', unknown: 'Unknown type', other: 'Other', leisure: 'Leisure', finance: 'Finance', government: 'Government', emergency: 'Emergency', tourism: 'Tourism', accommodation: 'Hotels', religion: 'Religion', sport: 'Sport' };
  el.innerHTML = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => `<span><i style="background:${GROUP_COLORS[g] || '#adb5bd'}"></i>${esc(NAMES[g] || g)} <small class="muted">${n}</small></span>`).join('')
    + (mode !== 'type' ? '<span style="grid-column:1/-1" class="muted">Switch “Building colours” to “By type” to colour the map like this.</span>' : '');
}

function applyBasemap() {
  if (!map || !map.getLayer('satellite')) return;
  const b = settings.get('mapBasemap');
  const vis = (ids, on) => ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  vis(BASEMAP_LAYERS.satellite, b !== 'streets');
  vis(BASEMAP_LAYERS.vector, b === 'streets');
  vis(BASEMAP_LAYERS.hybridRoads, b === 'hybrid');
  vis(BASEMAP_LAYERS.streetLabels, b !== 'satellite');
  map.setPaintProperty('place-labels', 'text-color', b === 'streets' ? '#3a3a44' : '#ffffff');
  map.setPaintProperty('place-labels', 'text-halo-color', b === 'streets' ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.65)');
  $$('#basemap-switch .seg').forEach(btn => btn.classList.toggle('active', btn.dataset.basemap === b));
}

function applyToggles() {
  if (!map || !map.getLayer('pack-buildings')) return;
  const s = settings.get();
  const vis = (id, on) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  vis('pack-buildings', s.mapBuildings); vis('pack-building-sel', s.mapBuildings);
  ['net-casing', 'net-line', 'net-commented', 'net-hit'].forEach(id => vis(id, s.mapNetascore));
  vis('pois-circle', s.mapPois); vis('pois-label', s.mapPois);
  vis('pack-labels', s.mapLabels);
  vis('hillshade', s.mapHillshade);
  map.setTerrain(s.mapTerrainExag > 0 ? { source: 'dem', exaggeration: s.mapTerrainExag } : null);
  $('#tg-buildings').checked = s.mapBuildings; $('#tg-netascore').checked = s.mapNetascore; $('#tg-pois').checked = s.mapPois;
  $('#tg-labels').checked = s.mapLabels; $('#tg-pins').checked = s.mapPins; $('#tg-hillshade').checked = s.mapHillshade;
  $('#exag').value = s.mapTerrainExag; $('#exag-val').textContent = `${Number(s.mapTerrainExag).toFixed(1)}×`;
  renderPins();
  updateOfmBuildingVisibility();
}

function applyNetworkStyle() {
  map.setPaintProperty('net-line', 'line-color', colorExpr());
  const flt = networkFilter();
  for (const id of ['net-casing', 'net-line', 'net-hit']) map.setFilter(id, flt);
}

// ------------------------------------------------------------------ NetAScore dataset
async function ingest(res, { fit = false } = {}) {
  if (!res) return;
  const fc = JSON.parse(res.geojson);
  fc.demo = res.meta.demo;
  fc.metadata = { source: res.meta.source };
  state.meta = res.meta;
  state.bySid.clear();
  for (const f of fc.features) state.bySid.set(f.properties._sid, f);
  map.getSource('netascore').setData(fc);
  cityData.setNetAScore(fc);
  renderDatasetInfo();
  updateCommentedLayer();
  const banner = $('#demo-banner');
  banner.classList.toggle('hidden', !res.meta.demo);
  if (res.meta.demo) banner.innerHTML = 'NetAScore demo data — street scores are illustrative. Import a NetAScore GeoPackage or use <b>Fetch OSM (approx.)</b>. <button class="btn ghost" id="banner-x">✕</button>';
  const bx = $('#banner-x'); if (bx) bx.onclick = () => banner.classList.add('hidden');
  if (fit) {
    const [w, s, e, n] = res.meta.bbox;
    const c = map.getCenter();
    if (!(c.lng > w && c.lng < e && c.lat > s && c.lat < n)) map.fitBounds([[w, s], [e, n]], { padding: 60, pitch: AARHUS.pitch, duration: 1800 });
  }
}

function renderDatasetInfo() {
  const m = state.meta;
  if (!m) return;
  const src = m.source === 'osm-lite' ? '<span class="tag warn">OSM-lite · approximate</span>' : m.demo ? '<span class="tag warn">demo</span>' : '<span class="tag ok">NetAScore</span>';
  $('#dataset-info').innerHTML = `<div class="ds-name" title="${esc(m.file)}">${esc(m.fileName)} ${src}</div>
    <div class="ds-grid"><span>Segments</span><b>${m.count.toLocaleString('da-DK')}</b>
      <span>Ø bike</span><b style="color:${scoreColor(m.meanBike)}">${fmt(m.meanBike)}</b><span>Ø walk</span><b style="color:${scoreColor(m.meanWalk)}">${fmt(m.meanWalk)}</b>
      ${m.layer ? `<span>Layer</span><b>${esc(m.layer)}</b>` : ''}${m.sourceCrs ? `<span>Source CRS</span><b>${esc(m.sourceCrs)}</b>` : ''}</div>`;
}

export async function runDatasetAction(fn, msg, opts) {
  try {
    loading(true, msg);
    const res = await fn();
    if (res) { await ingest(res, opts); toast(`Loaded ${res.meta.count.toLocaleString('da-DK')} street segments`, 'ok'); }
  } catch (e) { toast(cleanError(e), 'error'); } finally { loading(false); }
}

// ------------------------------------------------------------------ comments / pins
export async function refreshComments() {
  state.comments = await api.listComments();
  $('#fb-count').textContent = state.comments.length;
  renderPins();
  updateCommentedLayer();
  renderRecent();
  document.dispatchEvent(new CustomEvent('comments-changed', { detail: state.comments }));
}
export function getComments() { return state.comments; }

function updateCommentedLayer() {
  if (!map || !map.getLayer('net-commented')) return;
  map.setFilter('net-commented', ['in', ['get', '_wid'], ['literal', [...new Set(state.comments.map(c => c.osm_way_id))]]]);
}

function renderPins() {
  state.markers.forEach(m => m.remove());
  state.markers = [];
  if (!settings.get('mapPins') || !map) return;
  const byTarget = new Map();
  for (const c of state.comments) {
    if (c.lng == null || c.lat == null) continue;
    if (!byTarget.has(c.osm_way_id)) byTarget.set(c.osm_way_id, []);
    byTarget.get(c.osm_way_id).push(c);
  }
  for (const [id, list] of byTarget) {
    const latest = list[0];
    const cat = CATEGORIES[latest.category] || CATEGORIES.other;
    const el = document.createElement('button');
    el.className = 'pin';
    el.style.setProperty('--pin', cat.color);
    el.title = `${list.length} comment${list.length > 1 ? 's' : ''} · ${latest.street_name || id}`;
    el.innerHTML = `<span class="pin-icon">${cat.icon}</span>${list.length > 1 ? `<span class="pin-badge">${list.length}</span>` : ''}`;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); openComment(latest); });
    state.markers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([latest.lng, latest.lat]).addTo(map));
  }
}

export function openComment(c) {
  const ll = { lng: c.lng, lat: c.lat };
  if (c.target_type === 'building') {
    const b = cityData.byId.get(c.osm_way_id);
    if (b) { selectBuilding(b); panel.showBuilding(b, { lngLat: ll }); return; }
  } else if (c.target_type === 'poi') {
    const p = cityData.byId.get(c.osm_way_id);
    if (p) { panel.showPoi(p); return; }
  } else {
    const f = [...state.bySid.values()].find(x => x.properties._wid === c.osm_way_id);
    if (f) { selectSegment(f.properties._sid, ll); return; }
    const r = cityData.byId.get('w' + c.osm_way_id) || cityData.byId.get(c.osm_way_id);
    if (r) { panel.showRoad(r, ll); return; }
  }
  panel.showPlace(c.lng, c.lat);
}

function renderRecent() {
  const ul = $('#fb-recent');
  if (!state.comments.length) { ul.innerHTML = '<li class="muted">No feedback yet — click a street or building to add some.</li>'; return; }
  ul.innerHTML = state.comments.slice(0, 40).map((c, i) => {
    const cat = CATEGORIES[c.category] || CATEGORIES.other;
    return `<li data-i="${i}"><span class="dot" style="background:${cat.color}"></span><div><b>${esc(c.street_name || c.osm_way_id)}</b><small>${esc(cat.label)} · ${esc(c.target_type || 'street')} · ${esc(fmtDate(c.created_at))}</small></div></li>`;
  }).join('');
  $$('li[data-i]', ul).forEach(li => li.addEventListener('click', () => {
    const c = state.comments[Number(li.dataset.i)];
    if (c.lng != null) map.flyTo({ center: [c.lng, c.lat], zoom: 17.5, pitch: 55 });
    openComment(c);
  }));
}

// ------------------------------------------------------------------ navigation
export function flyTo(lng, lat, zoom = 17.6) { map.flyTo({ center: [lng, lat], zoom, pitch: 58, duration: 1600, essential: true }); }

function wireControls() {
  $$('#controls .segmented .seg[data-mode]').forEach(b => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    $$('#controls .seg[data-mode]').forEach(x => x.classList.toggle('active', x.dataset.mode === state.mode));
    if (map.getLayer('net-line')) applyNetworkStyle();
    document.dispatchEvent(new CustomEvent('score-mode', { detail: state.mode }));
  }));
  $('#min-score').addEventListener('input', (e) => { state.minScore = Number(e.target.value); $('#min-score-val').textContent = state.minScore.toFixed(2); applyNetworkStyle(); });
  $('#hide-unscored').addEventListener('change', (e) => { state.hideUnscored = e.target.checked; applyNetworkStyle(); });
  $$('#basemap-switch .seg').forEach(b => b.addEventListener('click', () => settings.set({ mapBasemap: b.dataset.basemap })));
  $('#sel-bcolors').addEventListener('change', (e) => settings.set({ mapBuildingColors: e.target.value }));
  const bind = (id, key) => $(id).addEventListener('change', (e) => settings.set({ [key]: e.target.checked }));
  bind('#tg-buildings', 'mapBuildings'); bind('#tg-netascore', 'mapNetascore'); bind('#tg-pois', 'mapPois'); bind('#tg-labels', 'mapLabels'); bind('#tg-pins', 'mapPins'); bind('#tg-hillshade', 'mapHillshade');
  $('#exag').addEventListener('input', (e) => settings.set({ mapTerrainExag: Number(e.target.value) }));
  $('#btn-home').addEventListener('click', () => map.flyTo({ ...AARHUS, duration: 2000 }));
  $('#btn-topdown').addEventListener('click', () => { state.topDown = !state.topDown; map.easeTo({ pitch: state.topDown ? 0 : AARHUS.pitch, bearing: state.topDown ? 0 : AARHUS.bearing, duration: 900 }); });
  $('#btn-explore-here').addEventListener('click', () => { const c = map.getCenter(); onExplore && onExplore({ lng: c.lng, lat: c.lat, heading: map.getBearing() }); });
  $('#btn-open').addEventListener('click', () => runDatasetAction(api.pickDataset, 'Opening file…', { fit: true }));
  $('#btn-reset').addEventListener('click', () => runDatasetAction(api.resetDataset, 'Loading bundled dataset…', { fit: true }));
  $('#btn-osm').addEventListener('click', () => runDatasetAction(api.fetchOsmDataset, 'Contacting OpenStreetMap… (1–3 minutes)', { fit: true }));
  $('#btn-export-csv').addEventListener('click', () => doExport('csv'));
  $('#btn-export-geojson').addEventListener('click', () => doExport('geojson'));
}

export async function doExport(fmtName) {
  try { const r = await api.exportComments(fmtName); if (r) toast(`Exported ${r.count} comment(s) to ${r.file}`, 'ok'); } catch (e) { toast(cleanError(e), 'error'); }
}

export function onPanelClosed() { clearSelection(); }
