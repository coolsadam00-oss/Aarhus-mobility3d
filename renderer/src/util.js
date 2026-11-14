// Small DOM / formatting helpers shared by all renderer modules.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '–' : Number(v).toFixed(d));
export const fmtLen = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export function fmtDate(iso, withTime = true) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return withTime ? d.toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString('da-DK', { dateStyle: 'medium' });
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// NetAScore colour ramp: 0 (poor) … 1 (excellent)
export const RAMP = [0, '#c0262d', 0.2, '#e8590c', 0.4, '#f59f00', 0.6, '#c3d83a', 0.8, '#5cb85c', 1, '#1a7f37'];
export const NULL_COLOR = '#8a8f98';
export function mixHex(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((x, i) => Math.round(x + (pb[i] - x) * t).toString(16).padStart(2, '0')).join('');
}
export function scoreColor(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return NULL_COLOR;
  for (let i = 0; i < RAMP.length - 2; i += 2) {
    if (v <= RAMP[i + 2]) return mixHex(RAMP[i + 1], RAMP[i + 3], (v - RAMP[i]) / (RAMP[i + 2] - RAMP[i]));
  }
  return RAMP[RAMP.length - 1];
}
export function scoreLabel(v) {
  if (v === null || v === undefined) return 'Not scored';
  if (v >= 0.8) return 'Excellent'; if (v >= 0.6) return 'Good'; if (v >= 0.4) return 'Fair'; if (v >= 0.2) return 'Poor'; return 'Very poor';
}
export function hexToRgb01(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

let toastTimer;
export function toast(msg, kind = 'info', ms = 4200) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
export function loading(on, msg, sub) {
  $('#loading').classList.toggle('hidden', !on);
  if (msg !== undefined) $('#loading-msg').textContent = msg;
  $('#loading-sub').textContent = sub || '';
}
export const cleanError = (e) => String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const CATEGORIES = {
  missing_bike_lane: { label: 'Missing bike lane', color: '#e8590c', icon: '🚲' },
  missing_sidewalk: { label: 'Missing / narrow sidewalk', color: '#d9480f', icon: '🚶' },
  poor_pavement: { label: 'Poor pavement', color: '#a6753c', icon: '🕳️' },
  steep_incline: { label: 'Steep incline', color: '#7048e8', icon: '⛰️' },
  safety_hazard: { label: 'Safety hazard', color: '#e03131', icon: '⚠️' },
  dangerous_crossing: { label: 'Dangerous crossing', color: '#c2255c', icon: '🚸' },
  poor_lighting: { label: 'Poor lighting', color: '#495057', icon: '💡' },
  traffic_speed: { label: 'Traffic too fast', color: '#f08c00', icon: '🏎️' },
  positive: { label: 'Positive / works well', color: '#2f9e44', icon: '👍' },
  other: { label: 'Other', color: '#1c7ed6', icon: '💬' }
};

export function modal({ title, tabs, onClose, wide }) {
  const root = $('#modal-root');
  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  back.innerHTML = `<div class="modal" role="dialog" aria-label="${esc(title)}" style="${wide ? 'width:min(1180px,96vw)' : ''}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
    ${tabs ? `<div class="modal-tabs">${tabs.map((t, i) => `<button data-tab="${t.id}" class="${i === 0 ? 'active' : ''}">${esc(t.label)}</button>`).join('')}</div>` : ''}
    <div class="modal-body"></div></div>`;
  root.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('[data-close]', back).addEventListener('click', close);
  const body = $('.modal-body', back);
  return { el: back, body, close, tabs: tabs ? $$('[data-tab]', back) : [] };
}
