// Search box: instant offline search in the city pack + online OpenStreetMap (Nominatim) search on Enter.
import { $, $$, esc, debounce, cleanError } from '../util.js';
import { cityData } from '../citydata.js';
import * as settings from '../settings.js';

const api = window.mobility;
let onSelect = null;
let results = [];
let active = -1;
let lastOnline = '';

export function initSearch(cb) {
  onSelect = cb;
  const input = $('#search');
  const box = $('#search-results');
  const runLocal = debounce(() => render(input.value, null), 110);
  input.addEventListener('input', runLocal);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) render(input.value, null); });
  input.addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(results.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (e.key === 'Escape') { box.classList.add('hidden'); input.blur(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && results[active]) { choose(results[active]); return; }
      await online(input.value);
    }
  });
  document.addEventListener('mousedown', (e) => { if (!$('#search-wrap').contains(e.target)) box.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); input.focus(); input.select(); }
  });
}

function setActive(i) {
  active = i;
  $$('.sr', $('#search-results')).forEach((el, k) => el.classList.toggle('active', k === i));
  const el = $$('.sr', $('#search-results'))[i];
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function render(q, onlineResults) {
  const box = $('#search-results');
  const local = cityData.search(q, 12);
  results = [...local, ...(onlineResults || [])];
  active = -1;
  if (q.trim().length < 2) { box.classList.add('hidden'); return; }
  const parts = [];
  if (local.length) parts.push(`<div class="sr-h">In downloaded city data (offline)</div>` + local.map((r, i) => item(r, i)).join(''));
  if (onlineResults) parts.push(`<div class="sr-h">OpenStreetMap search (online)</div>` + (onlineResults.length ? onlineResults.map((r, i) => item(r, local.length + i)).join('') : '<div class="sr muted">No results</div>'));
  else parts.push(`<div class="sr-h">Press Enter to search OpenStreetMap online${settings.get('onlineLookups') ? '' : ' (online lookups are off)'}</div>`);
  if (!local.length && !onlineResults) parts.unshift('<div class="sr muted">No match in the city data.</div>');
  box.innerHTML = parts.join('');
  box.classList.remove('hidden');
  $$('.sr[data-i]', box).forEach(el => el.addEventListener('mousedown', (e) => { e.preventDefault(); choose(results[Number(el.dataset.i)]); }));
}

function item(r, i) {
  return `<div class="sr" data-i="${i}" role="option"><span class="ic">${esc(r.icon || '📍')}</span><div><b>${esc(r.label)}</b><small>${esc(r.sub || '')}</small></div></div>`;
}

async function online(q) {
  q = q.trim();
  if (q.length < 2 || q === lastOnline) return;
  if (!settings.get('onlineLookups')) { render(q, []); return; }
  lastOnline = q;
  $('#search-results').insertAdjacentHTML('beforeend', '<div class="sr muted" id="sr-wait">Searching OpenStreetMap…</div>');
  try {
    const rows = await api.search(q);
    render(q, (rows || []).map(r => ({ label: r.name, sub: r.display, icon: '🔎', kind: 'online', lng: r.lon, lat: r.lat, ref: { type: 'online', id: r.osm, cls: r.cls, type2: r.type } })));
  } catch (e) {
    render(q, []);
    $('#search-results').insertAdjacentHTML('beforeend', `<div class="sr muted">Search failed: ${esc(cleanError(e))}</div>`);
  } finally { setTimeout(() => { lastOnline = ''; }, 1500); }
}

function choose(r) {
  if (!r) return;
  $('#search-results').classList.add('hidden');
  $('#search').blur();
  onSelect && onSelect(r);
}
