// Shared information panel for buildings, streets, places and points, used by the map and the 3D explorer.
import geo from '../../shared/geo.js';
import tagsLib from '../../shared/tags.js';
import { $, $$, esc, fmt, fmtLen, fmtDate, scoreColor, scoreLabel, CATEGORIES, toast, cleanError } from './util.js';
import { cityData } from './citydata.js';
import { heightfield } from './heightfield.js';
import * as settings from './settings.js';

const api = window.mobility;
const { geometryAreaM2, geometryCentroid, haversine } = geo;
const { groupTags, safeUrl, formatAddress } = tagsLib;

let hooks = { onExplore: null, onCommentsChanged: null, onClose: null, getMode: () => 'bike' };
let current = null; // { type, id, name, lng, lat, feature }

export function initPanel(h) {
  hooks = { ...hooks, ...h };
  $('#panel-close').addEventListener('click', closePanel);
}
export function currentTarget() { return current; }
export function isOpen() { return !$('#panel').classList.contains('hidden'); }
export function closePanel() {
  const was = current;
  current = null;
  $('#panel').classList.add('hidden');
  if (was && hooks.onClose) hooks.onClose(was);
}
function open(html) {
  $('#panel-body').innerHTML = html;
  $('#panel').classList.remove('hidden');
  $('#panel').scrollTop = 0;
}

// ------------------------------------------------------------------ shared pieces
const CONF_TEXT = { tagged: 'Tagged in OSM', name: 'Inferred from name', context: 'Inferred from area', unknown: 'Type not mapped' };
const HEIGHT_SRC = { t: 'OSM height tag', l: 'from floor count (OSM)', g: 'measured roof edge (GeoDanmark 2016)', e: 'estimated from type' };

function osmUrl(id) {
  const m = /^([nwr])(\d+)$/.exec(String(id || ''));
  if (!m) return null;
  return `https://www.openstreetmap.org/${{ n: 'node', w: 'way', r: 'relation' }[m[1]]}/${m[2]}`;
}

function header({ icon, title, label, labelDa, conf, note, meta }) {
  return `<div class="panel-head">
    <h2>${esc(title)}</h2>
    <div class="kind-line"><div class="kind-ic">${esc(icon || '📍')}</div>
      <div><b>${esc(label || '')}</b><small>${esc(labelDa || '')}</small></div>
      ${conf ? `<span class="conf ${esc(conf)}" title="${esc(note || '')}">${esc(CONF_TEXT[conf] || conf)}</span>` : ''}</div>
    ${note ? `<p class="note">ℹ️ ${esc(note)}</p>` : ''}
    ${meta ? `<div class="meta">${meta}</div>` : ''}
  </div>`;
}

function facts(items) {
  const rows = items.filter(i => i && i.value !== null && i.value !== undefined && i.value !== '');
  if (!rows.length) return '';
  return `<section class="block"><h3>Key facts</h3><div class="facts">${rows.map(i => `<div class="fact"><span>${esc(i.label)}</span><b>${esc(i.value)}</b>${i.small ? `<small>${esc(i.small)}</small>` : ''}</div>`).join('')}</div></section>`;
}

function tagSection(tags, title = 'All OpenStreetMap information') {
  const groups = groupTags(tags || {});
  if (!groups.length) return '';
  return `<details class="block" ${Object.keys(tags).length <= 12 ? 'open' : ''}><summary>${esc(title)} (${Object.keys(tags).length} tags)</summary>
    ${groups.map(g => `<div class="taggroup"><h4>${esc(g.label)}</h4><table class="kv small">${g.rows.map(r => {
      const url = /^(website|url|contact:website|contact:facebook|contact:instagram)$/.test(r.key) ? safeUrl(r.raw) : null;
      const val = url ? `<a href="#" data-url="${esc(url)}">${esc(r.value)}</a>` : esc(r.value);
      return `<tr><th title="${esc(r.key)}">${esc(r.label)}<br><code>${esc(r.key)}</code></th><td>${val}</td></tr>`;
    }).join('')}</table></div>`).join('')}</details>`;
}

function links({ id, lng, lat, tags }) {
  const L = [];
  const o = osmUrl(id);
  if (o) L.push(['🗺️ OpenStreetMap', o]);
  if (o && /^w\d+$/.test(id)) L.push(['✏️ Edit in OSM', `https://www.openstreetmap.org/edit?way=${id.slice(1)}`]);
  L.push(['📷 Street View', `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}`]);
  L.push(['🧭 Google Maps', `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`]);
  L.push(['🛰️ Mapillary photos', `https://www.mapillary.com/app/?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&z=18`]);
  const site = tags && safeUrl(tags.website || tags['contact:website'] || tags.url);
  if (site) L.push(['🌐 Website', site]);
  return `<section class="block"><h3>Look it up</h3><div class="links">${L.map(([t, u]) => `<button class="btn ghost" data-url="${esc(u)}">${esc(t)}</button>`).join('')}
    <button class="btn" data-explore="${lng},${lat}">🎮 Explore in 3D here</button></div></section>`;
}

function wikiPlaceholder(tags) {
  if (!tags || !(tags.wikipedia || tags.wikidata)) return '';
  return `<section class="block" id="wiki-block"><h3>Wikipedia & Wikidata</h3><div class="muted">${settings.get('onlineLookups') ? 'Looking up…' : 'Online lookups are switched off in Settings → Privacy.'}</div></section>`;
}

async function fillWiki(tags, token) {
  const el = $('#wiki-block');
  if (!el || !settings.get('onlineLookups')) return;
  try {
    const w = await api.wiki(tags);
    if (token !== renderToken) return;
    if (!w || (!w.extract && !w.image && !w.facts.length)) { el.querySelector('.muted').textContent = 'No Wikipedia information found (or offline).'; return; }
    el.innerHTML = `<h3>Wikipedia & Wikidata</h3><div class="wiki">
      ${w.image ? `<img src="${esc(w.image)}" alt="${esc(w.title || '')}" loading="lazy" referrerpolicy="no-referrer" />` : ''}
      ${w.title ? `<b>${esc(w.title)}</b>` : ''}
      ${w.extract ? `<p>${esc(w.extract)}</p>` : ''}
      ${w.facts.length ? `<table class="kv small">${w.facts.map(f => `<tr><th>${esc(f.label)}</th><td>${f.url ? `<a href="#" data-url="${esc(f.url)}">${esc(f.value)}</a>` : esc(f.value)}</td></tr>`).join('')}</table>` : ''}
      <div class="src">${w.url ? `<a href="#" data-url="${esc(w.url)}">Wikipedia (${esc(w.lang || '')})</a> · text CC BY-SA` : ''}${w.imagePage ? ` · <a href="#" data-url="${esc(w.imagePage)}">image author & licence</a>` : ''}${w.wikidata ? ` · <a href="#" data-url="https://www.wikidata.org/wiki/${esc(w.wikidata)}">${esc(w.wikidata)}</a>` : ''}</div>
    </div>`;
    bindCommon(el);
  } catch (e) { el.querySelector('.muted') && (el.querySelector('.muted').textContent = 'Lookup failed: ' + cleanError(e)); }
}

function commentsBlock(target) {
  const catOptions = Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${c.icon} ${esc(c.label)}</option>`).join('');
  const mode = hooks.getMode ? hooks.getMode() : 'bike';
  return `<section class="block"><h3>Community feedback</h3>
    <div id="comments-list"><div class="muted">Loading…</div></div>
    <form id="fb-form" class="fb-form" autocomplete="off">
      <div class="form-row">
        <label>Category<select name="category" required>${catOptions}</select></label>
        <label>Applies to<select name="mode"><option value="both">Both</option><option value="bike"${mode === 'bike' ? ' selected' : ''}>Cycling</option><option value="walk"${mode === 'walk' ? ' selected' : ''}>Walking</option></select></label>
      </div>
      <label>Severity <span class="sev-val">3</span><input name="severity" type="range" min="1" max="5" value="3" /></label>
      <label>Comment<textarea name="body" rows="3" maxlength="4000" placeholder="${target.type === 'building' ? 'e.g. Entrance has steps only, no ramp; bike parking is always full.' : 'e.g. Cycle lane ends abruptly before the junction, cars park in it.'}" required></textarea></label>
      <label>Name (optional)<input name="author" maxlength="80" placeholder="Anonymous" /></label>
      <div class="form-foot"><small class="muted">📍 Saved locally with position & time</small><button class="btn primary" type="submit">Submit feedback</button></div>
    </form></section>`;
}

export function commentsListHtml(list) {
  if (!list.length) return '<div class="muted empty">No comments yet.</div>';
  return `<ul class="comments">${list.map(c => {
    const cat = CATEGORIES[c.category] || CATEGORIES.other;
    const mode = { bike: '🚲', walk: '🚶', both: '🚲🚶' }[c.mode] || '';
    return `<li><div class="c-head"><span class="c-cat" style="--c:${cat.color}">${cat.icon} ${esc(cat.label)}</span><span class="c-sev" title="Severity">${'●'.repeat(c.severity || 0)}${'○'.repeat(5 - (c.severity || 0))}</span></div>
      <p>${esc(c.body)}</p><div class="c-foot"><span>${mode} ${esc(c.author || 'Anonymous')} · ${esc(fmtDate(c.created_at))}</span><button class="link danger" data-del="${c.id}">Delete</button></div></li>`;
  }).join('')}</ul>`;
}

async function loadComments(target, token) {
  const list = await api.listComments(target.id);
  if (token !== renderToken) return;
  const el = $('#comments-list');
  if (!el) return;
  el.innerHTML = commentsListHtml(list);
  $$('[data-del]', el).forEach(btn => btn.addEventListener('click', async () => {
    if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Confirm delete?'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Delete'; }, 3000); return; }
    await api.deleteComment(Number(btn.dataset.del));
    hooks.onCommentsChanged && hooks.onCommentsChanged();
    loadComments(target, renderToken);
    toast('Comment deleted', 'ok');
  }));
}

function bindForm(target) {
  const form = $('#fb-form');
  if (!form) return;
  form.severity.addEventListener('input', () => { $('.sev-val', form).textContent = form.severity.value; });
  form.addEventListener('keydown', (e) => e.stopPropagation()); // don't drive the car while typing
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await api.addComment({
        target_type: target.type === 'segment' || target.type === 'road' ? 'street' : target.type,
        osm_way_id: target.id, segment_id: target.segmentId || null, street_name: target.name || null,
        category: form.category.value, mode: form.mode.value, severity: Number(form.severity.value), body: form.body.value, author: form.author.value,
        lng: target.lng, lat: target.lat
      });
      form.body.value = '';
      hooks.onCommentsChanged && hooks.onCommentsChanged();
      loadComments(target, renderToken);
      toast('Feedback saved locally', 'ok');
    } catch (err) { toast(cleanError(err), 'error'); } finally { btn.disabled = false; }
  });
}

function bindCommon(root = $('#panel-body')) {
  $$('[data-url]', root).forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); api.openExternal(el.dataset.url); }));
  $$('[data-explore]', root).forEach(el => el.addEventListener('click', () => {
    const [lng, lat] = el.dataset.explore.split(',').map(Number);
    hooks.onExplore && hooks.onExplore({ lng, lat });
  }));
}

let renderToken = 0;
function finish(target, tags) {
  current = target;
  const token = ++renderToken;
  bindCommon();
  bindForm(target);
  loadComments(target, token);
  if (tags) fillWiki(tags, token);
  return token;
}

// ------------------------------------------------------------------ buildings
export function showBuilding(f, { lngLat } = {}) {
  const p = f.properties || {};
  const tags = p.t || f.tags || {};
  const c = p.centroid || geometryCentroid(f.geometry);
  const area = geometryAreaM2(f.geometry);
  const name = p.n || tags.name || null;
  const label = p.lbl || (f.cls && f.cls.label) || 'Building';
  const pois = cityData.poisInBuilding(f).slice(0, 12);
  const lv = p.lv || (tags['building:levels'] ? Number(tags['building:levels']) : null);
  const h = p.h;
  const estFloors = h ? Math.max(1, Math.round((p.ht ? h - 2 : h) / 3)) : null;
  const year = tags.start_date || tags.construction_date || null;
  const roof = tags['roof:shape'] ? tagsLib.humanizeValue('roof:shape', tags['roof:shape']) : 'not mapped (estimated in 3D)';
  const ctx = p.ctx ? `${p.ctxn ? p.ctxn + ' – ' : ''}${(cityData.byId.get(p.ctx) || {}).lbl || p.ctx.split('=')[1].replace(/_/g, ' ')}` : null;
  const target = { type: 'building', id: f.id, name: name || p.a || label, lng: lngLat ? lngLat.lng : c[0], lat: lngLat ? lngLat.lat : c[1], feature: f };
  const metaParts = [];
  if (osmUrl(f.id)) metaParts.push(`<span>OSM ${esc(f.id)}</span>`);
  if (String(f.id).startsWith('fot:')) metaParts.push('<span class="tag info">GeoDanmark 2016</span>');
  if (p.part) metaParts.push('<span class="tag">building part</span>');
  open(`${header({ icon: p.ic || (f.cls && f.cls.icon) || '🏢', title: name || p.a || label, label, labelDa: p.lda || (f.cls && f.cls.labelDa), conf: p.cf || (f.cls && f.cls.confidence), note: p.note || (f.cls && f.cls.note), meta: metaParts.join(' · ') })}
    ${facts([
      { label: 'Address', value: p.a || formatAddress(tags) },
      { label: 'Floors', value: lv ? `${lv}${tags['roof:levels'] ? ' + ' + tags['roof:levels'] + ' in roof' : ''}` : (estFloors ? `≈ ${estFloors}` : null), small: lv ? 'OSM building:levels' : 'estimated from height' },
      { label: 'Height', value: h ? `${fmt(h, 1)} m` : null, small: HEIGHT_SRC[p.hs] || '' },
      { label: 'Footprint', value: area ? `${Math.round(area).toLocaleString('da-DK')} m²` : null, small: lv ? `≈ ${Math.round(area * lv).toLocaleString('da-DK')} m² floor area` : '' },
      { label: 'Built', value: year },
      { label: 'Roof', value: roof, small: tags['roof:material'] ? tagsLib.humanizeValue('roof:material', tags['roof:material']) : '' },
      { label: 'Facade', value: tags['building:material'] ? tagsLib.humanizeValue('building:material', tags['building:material']) : null, small: tags['building:colour'] || '' },
      { label: 'Inside area', value: ctx },
      { label: 'Architect', value: tags.architect },
      { label: 'Heritage', value: tags.heritage ? 'Listed / protected' : null }
    ])}
    ${(p.also && p.also.length) ? `<section class="block"><h3>Also used as</h3><div>${p.also.map(a => `<span class="tag">${esc(a)}</span>`).join(' ')}</div></section>` : ''}
    ${pois.length ? `<section class="block"><h3>Inside this building (${pois.length})</h3><table class="kv small">${pois.map(x => `<tr><th>${esc(x.properties.ic || '📍')} ${esc(x.properties.lbl)}</th><td><a href="#" data-poi="${esc(x.id)}">${esc(x.properties.n || '(no name)')}</a></td></tr>`).join('')}</table></section>` : ''}
    ${wikiPlaceholder(tags)}
    ${tagSection(tags)}
    ${links({ id: f.id, lng: target.lng, lat: target.lat, tags })}
    ${commentsBlock(target)}`);
  $$('[data-poi]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); const pf = cityData.byId.get(a.dataset.poi); if (pf) showPoi(pf); }));
  finish(target, tags);
}

// ------------------------------------------------------------------ points of interest
export function showPoi(f) {
  const p = f.properties;
  const tags = p.t || {};
  const [lng, lat] = f.geometry.coordinates;
  const bld = cityData.buildingAt(lng, lat);
  const target = { type: 'poi', id: f.id, name: p.n || p.lbl, lng, lat, feature: f };
  open(`${header({ icon: p.ic, title: p.n || p.lbl, label: p.lbl, labelDa: p.lda, conf: 'tagged', meta: `<span>OSM ${esc(f.id)}</span>` })}
    ${facts([
      { label: 'Address', value: formatAddress(tags) || (bld && bld.properties.a) },
      { label: 'Opening hours', value: tags.opening_hours },
      { label: 'Phone', value: tags.phone || tags['contact:phone'] },
      { label: 'Wheelchair', value: tags.wheelchair ? tagsLib.humanizeValue('wheelchair', tags.wheelchair) : null },
      { label: 'Cuisine', value: tags.cuisine ? tags.cuisine.replace(/;/g, ', ').replace(/_/g, ' ') : null },
      { label: 'Operator / brand', value: tags.brand || tags.operator },
      { label: 'In building', value: bld ? (bld.properties.n || bld.properties.lbl) : null }
    ])}
    ${(p.also && p.also.length) ? `<section class="block"><h3>Also</h3>${p.also.map(a => `<span class="tag">${esc(a)}</span>`).join(' ')}</section>` : ''}
    ${bld ? `<div class="btn-row"><button class="btn ghost" id="poi-bld">🏢 Show the building</button></div>` : ''}
    ${wikiPlaceholder(tags)}
    ${tagSection(tags)}
    ${links({ id: f.id, lng, lat, tags })}
    ${commentsBlock(target)}`);
  const b = $('#poi-bld');
  if (b) b.addEventListener('click', () => showBuilding(bld, { lngLat: { lng, lat } }));
  finish(target, tags);
}

// ------------------------------------------------------------------ city roads (OSM / GeoDanmark centrelines)
export function showRoad(f, lngLat) {
  const p = f.properties;
  const tags = p.t || {};
  const c = f.geometry.coordinates;
  const len = c.reduce((s, pt, i) => (i ? s + haversine(c[i - 1], pt) : 0), 0);
  const sc = cityData.scoreForRoad(f) || {};
  const target = { type: 'road', id: /^w\d+$/.test(f.id) ? f.id.slice(1) : f.id, name: p.n || p.lbl, lng: lngLat ? lngLat.lng : c[0][0], lat: lngLat ? lngLat.lat : c[0][1], feature: f };
  const side = (l, r) => (l || r ? `${l ? 'left: ' + tagsLib.humanizeValue('x', l) : ''}${l && r ? ' · ' : ''}${r ? 'right: ' + tagsLib.humanizeValue('x', r) : ''}` : null);
  open(`${header({ icon: '🛣️', title: p.n || p.lbl, label: p.lbl, labelDa: p.lda, conf: 'tagged', meta: `<span>${osmUrl(f.id) ? 'OSM ' + esc(f.id) : esc(f.id)}</span> · <span>${fmtLen(len)}</span>` })}
    <section class="block"><h3>Mobility quality ${sc.src === 'lite' ? '<span class="tag warn">approx. (NetAScore-lite)</span>' : '<span class="tag ok">NetAScore</span>'}</h3>
      <div class="scores">${scoreBlock('Bikeability', '🚲', sc.bike)}${scoreBlock('Walkability', '🚶', sc.walk)}</div></section>
    ${facts([
      { label: 'Speed limit', value: p.ms ? `${p.ms} km/h` : null },
      { label: 'Width', value: p.w ? `${fmt(p.w, 1)} m` : null, small: tags.width ? 'OSM width' : 'typical for this road type' },
      { label: 'Lanes', value: p.ln },
      { label: 'Surface', value: p.sf ? tagsLib.humanizeValue('surface', p.sf) : null },
      { label: 'One-way', value: p.ow ? 'Yes' : null },
      { label: 'Lighting', value: p.lit === 1 ? 'Lit' : p.lit === 0 ? 'Not lit' : null },
      { label: 'Sidewalks', value: side(p.swl, p.swr) },
      { label: 'Cycle infrastructure', value: side(p.cwl, p.cwr) || (p.k === 'cycleway' ? 'Dedicated cycle path' : null) },
      { label: 'Bridge / tunnel', value: p.br ? 'Bridge' : p.tu ? 'Tunnel' : null }
    ])}
    ${tagSection(tags, 'All street information')}
    ${links({ id: f.id, lng: target.lng, lat: target.lat, tags })}
    ${commentsBlock(target)}`);
  finish(target, tags);
}

function scoreBlock(label, icon, v, ft, tf) {
  const pct = v == null ? 0 : Math.round(v * 100);
  const dir = (ft != null || tf != null) ? `<div class="dir"><span>→ ${fmt(ft)}</span><span>← ${fmt(tf)}</span></div>` : '';
  const active = hooks.getMode && hooks.getMode() === (label === 'Bikeability' ? 'bike' : 'walk');
  return `<div class="score ${active ? 'active' : ''}"><div class="score-head"><span>${icon} ${label}</span><b style="color:${scoreColor(v)}">${v == null ? 'n/a' : Number(v).toFixed(2)}</b></div>
    <div class="bar"><i style="width:${pct}%;background:${scoreColor(v)}"></i></div><div class="score-foot"><span>${scoreLabel(v)}</span>${dir}</div></div>`;
}

// ------------------------------------------------------------------ NetAScore segments (analysis dataset)
const KNOWN_INDICATORS = [
  ['bicycle_infrastructure', 'Bicycle infrastructure'], ['pedestrian_infrastructure', 'Pedestrian infrastructure'], ['designated_route', 'Designated route'],
  ['road_category', 'Road category'], ['max_speed', 'Max speed'], ['max_speed_greatest', 'Max speed (greatest)'], ['number_lanes', 'Number of lanes'],
  ['parking', 'Parking'], ['pavement', 'Pavement'], ['width', 'Width'], ['gradient', 'Gradient class'], ['stairs', 'Stairs'], ['crossings', 'Crossings'],
  ['facilities', 'Facilities'], ['buildings', 'Buildings'], ['greenness', 'Greenness'], ['water', 'Water'], ['noise', 'Noise'], ['lit_ind', 'Street lighting'], ['width_ind', 'Width']
];
const num = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; };

export function showSegment(f, lngLat) {
  const p = f.properties;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let line = lines[0];
  for (const l of lines) if (l.length > line.length) line = l;
  const len = lines.reduce((s, l) => s + l.reduce((a, pt, i) => (i ? a + haversine(l[i - 1], pt) : 0), 0), 0);
  const isOsm = /^\d+$/.test(p._wid);
  const cityRoad = isOsm ? cityData.byId.get('w' + p._wid) : null;
  const mid = line[Math.floor(line.length / 2)];
  const target = { type: 'segment', id: p._wid, segmentId: String(p.edge_id ?? p.id ?? p._sid), name: p._name, lng: lngLat ? lngLat.lng : mid[0], lat: lngLat ? lngLat.lat : mid[1], feature: f };
  const rows = [];
  const used = new Set();
  for (const [key, label] of KNOWN_INDICATORS) {
    const variants = [key, `${key}_ft`, `${key}_tf`, `${key}_bike`, `${key}_walk`].filter(k => k in p && p[k] !== null && p[k] !== '');
    if (!variants.length) continue;
    variants.forEach(k => used.add(k));
    rows.push(`<tr><th>${esc(label)}</th><td>${variants.map(k => {
      const sfx = k === key ? '' : k.slice(key.length + 1);
      const tag = { ft: '→', tf: '←', bike: '🚲', walk: '🚶' }[sfx] || '';
      const v = p[k];
      return (p._source === 'osm-lite' && typeof v === 'number' && v >= 0 && v <= 1)
        ? `<span class="ind">${tag} <i class="mini"><i style="width:${v * 100}%;background:${scoreColor(v)}"></i></i> ${v.toFixed(2)}</span>`
        : `<span class="ind">${tag} ${esc(v)}</span>`;
    }).join('')}</td></tr>`);
  }
  const attrs = Object.entries(p).filter(([k, v]) => !k.startsWith('_') && !used.has(k) && v !== null && v !== '').map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`).join('');
  const highway = p.highway || p.road_category || p.road_category_ft || (cityRoad && cityRoad.properties.lbl) || '';
  open(`${header({ icon: '🛣️', title: p._name || (cityRoad && cityRoad.properties.n) || 'Unnamed segment', label: cityRoad ? cityRoad.properties.lbl : 'Street segment', labelDa: cityRoad ? cityRoad.properties.lda : '', conf: null,
    meta: `${highway ? `<span class="tag">${esc(highway)}</span>` : ''}<span>OSM way ${isOsm ? `<a href="#" data-url="https://www.openstreetmap.org/way/${esc(p._wid)}">${esc(p._wid)}</a>` : esc(p._wid)}</span><span>· ${fmtLen(len)}</span>` })}
    <section class="block"><h3>NetAScore</h3><div class="scores">${scoreBlock('Bikeability', '🚲', p._bike, num(p.index_bike_ft), num(p.index_bike_tf))}${scoreBlock('Walkability', '🚶', p._walk, num(p.index_walk_ft), num(p.index_walk_tf))}</div>
      ${p._source === 'osm-lite' ? '<p class="note">Approximate score computed from OSM tags (NetAScore-lite). Load official NetAScore output for analysis.</p>' : ''}</section>
    <section class="block"><h3>Elevation &amp; slope</h3><div id="profile" class="profile"><div class="muted">Sampling terrain…</div></div></section>
    ${rows.length ? `<section class="block"><h3>Indicator breakdown</h3><table class="kv">${rows.join('')}</table></section>` : ''}
    ${cityRoad ? tagSection(cityRoad.properties.t || {}, 'Street information from OpenStreetMap') : ''}
    ${attrs ? `<details class="block"><summary>All NetAScore attributes</summary><table class="kv small">${attrs}</table></details>` : ''}
    ${links({ id: isOsm ? 'w' + p._wid : '', lng: target.lng, lat: target.lat, tags: cityRoad ? cityRoad.properties.t : null })}
    ${commentsBlock(target)}`);
  const token = finish(target, null);
  renderProfile(line, p, token);
}

async function elevationProfile(coords, maxSamples = 160) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1];
  if (!total) return null;
  const step = Math.max(total / maxSamples, 4);
  const pts = [];
  let seg = 0;
  for (let d = 0; d <= total + 1e-6; d += step) {
    while (seg < coords.length - 2 && cum[seg + 1] < d) seg++;
    const t = Math.min(1, Math.max(0, (d - cum[seg]) / ((cum[seg + 1] - cum[seg]) || 1)));
    const a = coords[seg], b = coords[seg + 1];
    pts.push({ d, lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t });
  }
  const last = coords[coords.length - 1];
  if (pts[pts.length - 1].d < total - 0.5) pts.push({ d: total, lng: last[0], lat: last[1] });
  const zs = await Promise.all(pts.map(p => heightfield.heightAtAsync(p.lng, p.lat)));
  pts.forEach((p, i) => { p.z = zs[i]; });
  const sm = pts.map((p, i) => (pts[Math.max(0, i - 1)].z + 2 * p.z + pts[Math.min(pts.length - 1, i + 1)].z) / 4);
  let gain = 0, loss = 0, maxGrade = 0;
  const span = Math.max(1, Math.round(20 / step));
  for (let i = 1; i < sm.length; i++) { const dz = sm[i] - sm[i - 1]; if (dz > 0) gain += dz; else loss -= dz; }
  for (let i = span; i < sm.length; i++) { const dd = pts[i].d - pts[i - span].d; if (dd > 0) maxGrade = Math.max(maxGrade, Math.abs((sm[i] - sm[i - span]) / dd) * 100); }
  return { points: pts, length: total, start: pts[0].z, end: pts[pts.length - 1].z, min: Math.min(...zs), max: Math.max(...zs), gain, loss, avgGrade: ((pts[pts.length - 1].z - pts[0].z) / total) * 100, maxGrade };
}

async function renderProfile(line, p, token) {
  let prof;
  try { prof = await elevationProfile(line); } catch (e) { const el = $('#profile'); if (el && token === renderToken) el.innerHTML = `<div class="muted">Elevation unavailable (${esc(e.message)})</div>`; return; }
  const el = $('#profile');
  if (!prof || !el || token !== renderToken) return;
  const W = 380, H = 130, PL = 34, PR = 8, PT = 10, PB = 22;
  const zmin = Math.floor(prof.min - 1), zmax = Math.ceil(Math.max(prof.max + 1, zmin + 6));
  const x = d => PL + (d / prof.length) * (W - PL - PR);
  const y = z => PT + (1 - (z - zmin) / (zmax - zmin)) * (H - PT - PB);
  const pts = prof.points;
  const path = pts.map((q, i) => `${i ? 'L' : 'M'}${x(q.d).toFixed(1)},${y(q.z).toFixed(1)}`).join('');
  const area = `${path}L${x(prof.length).toFixed(1)},${H - PB}L${PL},${H - PB}Z`;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const g = Math.abs((pts[i].z - pts[i - 1].z) / Math.max(1, pts[i].d - pts[i - 1].d)) * 100;
    const c = g < 2 ? '#2f9e44' : g < 4 ? '#94c11f' : g < 6 ? '#f59f00' : g < 9 ? '#e8590c' : '#c92a2a';
    segs.push(`<line x1="${x(pts[i - 1].d).toFixed(1)}" y1="${y(pts[i - 1].z).toFixed(1)}" x2="${x(pts[i].d).toFixed(1)}" y2="${y(pts[i].z).toFixed(1)}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`);
  }
  const ticks = [zmin, (zmin + zmax) / 2, zmax].map(z => `<text x="${PL - 4}" y="${y(z) + 3}" text-anchor="end">${Math.round(z)}</text><line x1="${PL}" x2="${W - PR}" y1="${y(z)}" y2="${y(z)}" class="grid"/>`).join('');
  const netGrad = p.gradient_ft ?? p.gradient ?? null;
  const src = heightfield.gridSample(line[0][0], line[0][1]);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="profile-svg" role="img" aria-label="Elevation profile">
      <defs><linearGradient id="pf" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4dabf7" stop-opacity=".45"/><stop offset="1" stop-color="#4dabf7" stop-opacity="0.03"/></linearGradient></defs>
      ${ticks}<path d="${area}" fill="url(#pf)"/>${segs.join('')}
      <text x="${PL}" y="${H - 6}">0</text><text x="${W - PR}" y="${H - 6}" text-anchor="end">${fmtLen(prof.length)}</text><text x="${PL + 2}" y="${PT - 1}" class="unit">m a.s.l.</text></svg>
    <div class="stats">
      <div><span>Start → end</span><b>${fmt(prof.start, 1)} → ${fmt(prof.end, 1)} m</b></div>
      <div><span>Min / max</span><b>${fmt(prof.min, 1)} / ${fmt(prof.max, 1)} m</b></div>
      <div><span>Gain / loss</span><b>↗ ${fmt(prof.gain, 1)} · ↘ ${fmt(prof.loss, 1)} m</b></div>
      <div><span>Avg grade</span><b>${fmt(prof.avgGrade, 1)} %</b></div>
      <div><span>Max grade (~20 m)</span><b style="color:${prof.maxGrade >= 6 ? '#ff6b6b' : prof.maxGrade >= 4 ? '#ffa94d' : 'inherit'}">${fmt(prof.maxGrade, 1)} %</b></div>
      ${netGrad !== null && netGrad !== undefined ? `<div><span>NetAScore gradient class</span><b>${esc(netGrad)}</b></div>` : ''}
      <div><span>Terrain source</span><b style="font-size:11px">${src && src.conf <= 40 ? 'GeoDanmark 5 m grid' : 'AWS terrain tiles'}</b></div>
    </div>
    <div class="grade-legend"><i style="background:#2f9e44"></i>&lt;2% <i style="background:#94c11f"></i>2–4 <i style="background:#f59f00"></i>4–6 <i style="background:#e8590c"></i>6–9 <i style="background:#c92a2a"></i>&gt;9%</div>`;
}

// ------------------------------------------------------------------ arbitrary place (reverse geocode)
export async function showPlace(lng, lat) {
  const target = { type: 'place', id: `pt:${lat.toFixed(5)},${lng.toFixed(5)}`, name: null, lng, lat };
  const road = cityData.roadNear(lng, lat, 40);
  open(`${header({ icon: '📍', title: 'Selected location', label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, labelDa: '' })}
    <section class="block" id="place-info"><h3>Address</h3><div class="muted">${settings.get('onlineLookups') ? 'Looking up…' : 'Online lookups are off.'}</div></section>
    ${road ? `<section class="block"><h3>Nearest street</h3><button class="btn ghost" id="place-road">🛣️ ${esc(road.feature.properties.n || road.feature.properties.lbl)} (${Math.round(road.dist)} m)</button></section>` : ''}
    ${links({ id: '', lng, lat, tags: null })}
    ${commentsBlock(target)}`);
  const token = finish(target, null);
  const rb = $('#place-road');
  if (rb) rb.addEventListener('click', () => showRoad(road.feature, { lng, lat }));
  if (!settings.get('onlineLookups')) return;
  try {
    const r = await api.reverse(lat, lon(lng));
    if (token !== renderToken) return;
    const el = $('#place-info');
    if (!r) { el.innerHTML = '<h3>Address</h3><div class="muted">Nothing found (or offline).</div>'; return; }
    target.name = r.name || r.display.split(',')[0];
    el.innerHTML = `<h3>Address (Nominatim)</h3><p>${esc(r.display)}</p>${r.cls ? `<span class="tag">${esc(r.cls)} = ${esc(r.type)}</span>` : ''}`;
  } catch (e) { const el = $('#place-info'); if (el) el.innerHTML = `<h3>Address</h3><div class="muted">Lookup failed: ${esc(cleanError(e))}</div>`; }
}
const lon = (v) => v;

/** Building outside the downloaded pack: live OSM lookup at the clicked point. */
export async function showLiveBuilding(lng, lat) {
  open(`${header({ icon: '🏢', title: 'Looking up building…', label: 'OpenStreetMap live lookup' })}<div class="muted">Asking OpenStreetMap for the building at this point…</div>`);
  const token = ++renderToken;
  if (!settings.get('onlineLookups')) { $('#panel-body').innerHTML = header({ icon: '🏢', title: 'Building', label: 'Online lookups are off', note: 'Download city data (📦 Data) for offline building information, or enable online lookups in Settings.' }); return; }
  try {
    const r = await api.osmBuildingAt(lat, lng);
    if (token !== renderToken) return;
    if (!r) { showPlace(lng, lat); return; }
    const p = { n: r.tags.name, lbl: r.cls.label, lda: r.cls.labelDa, ic: r.cls.icon, cf: r.cls.confidence, note: r.cls.note, t: r.tags, also: r.cls.also,
      h: tagsLib.parseLength(r.tags.height) || (r.tags['building:levels'] ? Number(r.tags['building:levels']) * 3 : null), hs: r.tags.height ? 't' : (r.tags['building:levels'] ? 'l' : null), lv: r.tags['building:levels'] ? Number(r.tags['building:levels']) : null };
    showBuilding({ id: r.id, geometry: r.geometry, properties: p }, { lngLat: { lng, lat } });
  } catch (e) { if (token === renderToken) $('#panel-body').innerHTML = header({ icon: '⚠️', title: 'Lookup failed', label: cleanError(e) }); }
}
