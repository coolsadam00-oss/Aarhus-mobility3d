// "⚙️ Settings" window — every visual element and information layer can be switched on and off here.
import { $, $$, esc, modal, toast } from '../util.js';
import * as settings from '../settings.js';

const api = window.mobility;
const SCHEMA = [
  { h: 'Graphics' },
  { k: 'quality', type: 'select', label: 'Quality preset', hint: 'Sets resolution, shadows, view distance and density', options: Object.entries(settings.QUALITY).map(([v, q]) => [v, q.label]) },
  { k: 'pixelRatio', type: 'range', label: 'Render resolution', min: 0.5, max: 2, step: 0.05, unit: '×' },
  { k: 'viewDistance', type: 'range', label: 'View distance', min: 500, max: 4000, step: 100, unit: 'm' },
  { k: 'shadows', type: 'bool', label: 'Sun shadows', hint: 'Buildings and trees cast real-time shadows' },
  { k: 'ao', type: 'bool', label: 'Ambient occlusion', hint: 'Soft contact shadows (needs a strong GPU)' },
  { k: 'bloom', type: 'bool', label: 'Glow / bloom', hint: 'Street lamps, windows and sun glare' },
  { k: 'fog', type: 'bool', label: 'Atmospheric haze' },
  { k: 'clouds', type: 'bool', label: 'Clouds' },
  { k: 'imagery', type: 'bool', label: 'Aerial photo on the ground', hint: 'Off = stylised ground (works offline)' },
  { k: 'windows', type: 'bool', label: 'Facade details', hint: 'Windows, bricks, shop fronts, night lights' },
  { k: 'roofs', type: 'bool', label: 'Pitched roofs', hint: 'Gabled / hipped / pyramid roofs (tagged or estimated)' },
  { h: 'City life & world' },
  { k: 'trees', type: 'bool', label: 'Trees', hint: 'Surveyed trees + parks and woods' },
  { k: 'treeDensity', type: 'range', label: 'Park tree density', min: 0, max: 2, step: 0.1, unit: '×' },
  { k: 'furniture', type: 'bool', label: 'Street furniture', hint: 'Lamps, traffic lights, benches, bus stops, bike racks …' },
  { k: 'autoLamps', type: 'bool', label: 'Add typical street lamps', hint: 'Illustrative lamps along lit streets, only in gaps between mapped lamps' },
  { k: 'streetLights', type: 'bool', label: 'Street lighting at night', hint: 'Lamps light the streets, sidewalks and facades around them after dusk' },
  { k: 'traffic', type: 'bool', label: 'Traffic (cars, cyclists, pedestrians, light rail)' },
  { k: 'trafficDensity', type: 'range', label: 'Traffic density', min: 0.2, max: 3, step: 0.1, unit: '×' },
  { k: 'timeMode', type: 'select', label: 'Time of day', options: [['real', 'Real time (Aarhus clock)'], ['manual', 'Manual']] },
  { k: 'timeOfDay', type: 'range', label: 'Manual time', min: 0, max: 24, step: 0.25, unit: 'h' },
  { k: 'season', type: 'select', label: 'Season', options: [['auto', 'Automatic (today)'], ['spring', 'Spring'], ['summer', 'Summer'], ['autumn', 'Autumn'], ['winter', 'Winter']] },
  { k: 'weather', type: 'select', label: 'Weather', options: [['clear', '☀️ Clear'], ['partly', '⛅ Partly cloudy'], ['overcast', '☁️ Overcast'], ['fog', '🌫️ Fog'], ['rain', '🌧️ Rain']] },
  { h: 'Information in 3D' },
  { k: 'labelsBuildings', type: 'bool', label: 'Building labels', hint: 'Names of notable buildings' },
  { k: 'labelTypes', type: 'bool', label: 'Show what buildings are', hint: '“Apartments”, “University building”, “Train station” …' },
  { k: 'labelsPoi', type: 'bool', label: 'Place labels', hint: 'Shops, cafés, stops, schools …' },
  { k: 'labelsStreets', type: 'bool', label: 'Street name labels' },
  { k: 'netOverlay', type: 'select', label: 'NetAScore colours on streets', options: [['off', 'Off (realistic asphalt)'], ['bike', '🚲 Bikeability'], ['walk', '🚶 Walkability']] },
  { k: 'pins3d', type: 'bool', label: 'Feedback pins' },
  { k: 'minimap', type: 'bool', label: 'Minimap' },
  { k: 'hud', type: 'bool', label: 'HUD (speed, street, scores)' },
  { k: 'showFps', type: 'bool', label: 'Show FPS' },
  { h: 'Controls' },
  { k: 'startMode', type: 'select', label: 'Start mode', options: [['walk', '🚶 Walk'], ['bike', '🚲 Bike'], ['drive', '🚗 Drive'], ['fly', '🚁 Fly']] },
  { k: 'fov', type: 'range', label: 'Field of view', min: 50, max: 100, step: 1, unit: '°' },
  { k: 'mouseSensitivity', type: 'range', label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, unit: '×' },
  { k: 'invertY', type: 'bool', label: 'Invert mouse Y' },
  { k: 'headBob', type: 'bool', label: 'Head bobbing when walking' },
  { h: 'Data & privacy' },
  { k: 'onlineLookups', type: 'bool', label: 'Online lookups', hint: 'Search, addresses, Wikipedia photos, live building info. Off = nothing is sent anywhere.' },
  { k: 'customImagery', type: 'text', label: 'Custom aerial imagery', hint: 'Optional XYZ URL with {z}/{x}/{y}, e.g. Danish orthophotos with your own Dataforsyningen token. Restart the 3D view after changing.' }
];

export function openSettings() {
  const m = modal({ title: 'Settings', wide: true });
  const render = () => {
    const s = settings.get();
    m.body.innerHTML = `<div class="settings-grid">${SCHEMA.map(row => {
      if (row.h) return `<h3>${esc(row.h)}</h3>`;
      const v = s[row.k];
      let control = '';
      if (row.type === 'bool') control = `<label class="switch"><input type="checkbox" data-k="${row.k}" ${v ? 'checked' : ''}><span></span></label>`;
      if (row.type === 'range') control = `<input type="range" data-k="${row.k}" min="${row.min}" max="${row.max}" step="${row.step}" value="${v}"><span class="val" data-v="${row.k}">${fmtVal(v, row)}</span>`;
      if (row.type === 'select') control = `<select data-k="${row.k}">${row.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(v) === String(ov) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
      if (row.type === 'text') control = `<input class="input" style="width:100%" data-k="${row.k}" value="${esc(v || '')}" placeholder="https://…/{z}/{x}/{y}.jpg">`;
      return `<div class="setting" ${row.type === 'text' ? 'style="grid-column:1/-1;flex-direction:column;align-items:stretch"' : ''}><label>${esc(row.label)}${row.hint ? `<small>${esc(row.hint)}</small>` : ''}</label>${control}</div>`;
    }).join('')}</div>
    <div class="btn-row" style="margin-top:16px"><button class="btn ghost" id="set-reset">↺ Reset all settings to defaults</button></div>`;
    $$('[data-k]', m.body).forEach(el => {
      const row = SCHEMA.find(r => r.k === el.dataset.k);
      const evt = row.type === 'range' ? 'input' : 'change';
      el.addEventListener(evt, () => {
        let v = row.type === 'bool' ? el.checked : row.type === 'range' ? Number(el.value) : el.value;
        if (row.k === 'quality') { settings.applyQuality(v); render(); return; }
        if (row.k === 'customImagery' && v && !/^https:\/\/.*\{z\}/.test(v)) { toast('Imagery URL must start with https:// and contain {z}, {x}, {y}', 'warn'); return; }
        settings.set({ [row.k]: v });
        const out = $(`[data-v="${row.k}"]`, m.body); if (out) out.textContent = fmtVal(v, row);
      });
      if (row.type === 'text') el.addEventListener('keydown', e => e.stopPropagation());
    });
    $('#set-reset', m.body).onclick = () => { settings.set({ ...settings.DEFAULTS }); render(); toast('Settings reset', 'ok'); };
  };
  render();
}

function fmtVal(v, row) {
  if (row.k === 'timeOfDay') { const h = Math.floor(v) % 24, mm = Math.round((v - Math.floor(v)) * 60); return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
  if (row.unit === 'm') return `${v} m`;
  if (row.unit === '°') return `${v}°`;
  return `${Number(v).toFixed(row.step < 0.1 ? 2 : 1)}${row.unit || ''}`;
}

export function openHelp() {
  const m = modal({ title: 'Controls & shortcuts', wide: true });
  m.body.innerHTML = `<div class="help-grid">
    <div><h3>🎮 3D explore – moving</h3><table>
      <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows</td><td>Walk · pedal & steer · drive & steer · fly</td></tr>
      <tr><td>Mouse</td><td>Look around (click the 3D view first)</td></tr>
      <tr><td><kbd>Shift</kbd></td><td>Run · sprint · boost · fly faster</td></tr>
      <tr><td><kbd>Space</kbd></td><td>Jump · handbrake · fly up</td></tr>
      <tr><td><kbd>Ctrl</kbd> / <kbd>Q</kbd></td><td>Fly down</td></tr>
      <tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></td><td>Walk · Bike · Drive · Fly</td></tr>
      <tr><td><kbd>C</kbd></td><td>Camera: first person ↔ third person / cockpit ↔ chase</td></tr>
      <tr><td><kbd>R</kbd></td><td>Back on the street (nearest road, facing along it)</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Release the mouse / pause · close the info panel</td></tr>
      <tr><td>Gamepad</td><td>Left stick move/steer, right stick look, RT/LT throttle/brake</td></tr></table></div>
    <div><h3>🔍 3D explore – information</h3><table>
      <tr><td><kbd>E</kbd> or left click</td><td>Inspect what you look at (building type, address, height, Wikipedia …)</td></tr>
      <tr><td><kbd>F</kbd></td><td>Leave feedback about the street / building in front of you</td></tr>
      <tr><td><kbd>L</kbd></td><td>Labels on/off (what is what)</td></tr>
      <tr><td><kbd>N</kbd></td><td>NetAScore street colours: off → bike → walk</td></tr>
      <tr><td><kbd>T</kbd> / <kbd>Shift</kbd>+<kbd>T</kbd></td><td>Time +1 h / −1 h</td></tr>
      <tr><td><kbd>Y</kbd></td><td>Cycle weather</td></tr>
      <tr><td><kbd>M</kbd></td><td>Minimap on/off</td></tr>
      <tr><td><kbd>H</kbd></td><td>Hide/show HUD</td></tr>
      <tr><td><kbd>F12</kbd></td><td>Save screenshot</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>F</kbd></td><td>Search & teleport</td></tr></table></div>
    <div><h3>🗺️ Map view</h3><table>
      <tr><td>Left click</td><td>Building / street / place information</td></tr>
      <tr><td>Right click</td><td>Explore in 3D here · What's here? · Copy coordinates</td></tr>
      <tr><td>Ctrl + drag</td><td>Rotate & tilt</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>1</kbd> / <kbd>Ctrl</kbd>+<kbd>2</kbd></td><td>Map / 3D explore</td></tr>
      <tr><td><kbd>Ctrl</kbd>+<kbd>D</kbd></td><td>City data & downloads</td></tr></table></div>
    <div><h3>ℹ️ How precise is it?</h3><p class="muted" style="margin:0">Every building shows where its information comes from: <b>Tagged in OSM</b> (stated by mappers), <b>Inferred from name / area</b> (e.g. a building inside the university campus), or <b>Type not mapped</b>. Heights show their source (OSM tag, floor count, GeoDanmark roof survey or estimate). Roof shapes are drawn from OSM when tagged, otherwise estimated. Street lamps added in gaps between mapped lamps, sidewalks on untagged streets, and traffic are illustrative. Daylight, sky, haze and twilight follow the real sun position for Aarhus at the chosen time.</p></div>
  </div>`;
}
