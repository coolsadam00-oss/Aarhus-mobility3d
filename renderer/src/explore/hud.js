// Heads-up display: speed + limit, current street with NetAScore, elevation & slope, compass, time/weather,
// crosshair target info, key hints and a rotating minimap.
import { esc, scoreColor } from '../util.js';
import { MODES } from './player.js';
import { WEATHER_ICON } from './sky.js';

export class Hud {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-tl">
        <div class="hud-card"><div class="hud-speed"><b id="h-speed">0</b><span class="unit">km/h</span><div id="h-limit" class="limit hidden">50</div><span class="mode" id="h-mode"></span></div></div>
        <div class="hud-card" id="h-street-card"><div class="hud-street"><div style="flex:1"><b id="h-street">–</b><small id="h-street-sub"></small></div></div>
          <div class="hud-scores"><div><span>🚲 Bikeability <b id="h-bike-v"></b></span><div class="bar"><i id="h-bike"></i></div></div><div><span>🚶 Walkability <b id="h-walk-v"></b></span><div class="bar"><i id="h-walk"></i></div></div></div>
          <small class="muted" id="h-src"></small></div>
        <div class="hud-card hud-env"><span id="h-ele"></span><span id="h-slope"></span><span id="h-coord"></span></div>
      </div>
      <div class="hud-compass"><div class="strip" id="h-compass"></div></div>
      <div class="hud-tr"><div class="hud-card hud-env"><span id="h-time"></span><span id="h-weather"></span><span id="h-fps" class="fps"></span></div></div>
      <div class="crosshair" id="h-cross"></div>
      <div class="target-tip hidden" id="h-target"></div>
      <div class="hud-bl" id="h-keys"></div>
      <div class="minimap" id="h-mini"><canvas width="460" height="460"></canvas></div>`;
    root.appendChild(this.el);
    this.$ = (id) => this.el.querySelector('#' + id);
    this.mini = this.$('h-mini').querySelector('canvas');
    this.ctx2d = this.mini.getContext('2d');
    this.compass = this.$('h-compass');
    const marks = [];
    for (let d = -360; d <= 720; d += 15) {
      const n = ((d % 360) + 360) % 360;
      const lab = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[n];
      marks.push(`<span class="${lab ? 'card' : ''} ${n === 0 ? 'n' : ''}" style="left:${(d + 360) * 4}px">${lab || (n % 30 === 0 ? n : '·')}</span>`);
    }
    this.compass.innerHTML = marks.join('');
    this.lastKeysMode = null;
  }

  setVisible(hud, minimap) {
    this.el.querySelector('.hud-tl').style.display = hud ? '' : 'none';
    this.el.querySelector('.hud-tr').style.display = hud ? '' : 'none';
    this.el.querySelector('.hud-compass').style.display = hud ? '' : 'none';
    this.$('h-keys').style.display = hud ? '' : 'none';
    this.$('h-mini').style.display = minimap ? '' : 'none';
  }

  update(st) {
    const p = st.player;
    this.$('h-speed').textContent = Math.round(p.speedKmh);
    this.$('h-mode').textContent = `${MODES[p.mode].icon} ${MODES[p.mode].label}${p.thirdPerson ? ' · 3rd person' : ''}`;
    const road = st.road;
    const lim = this.$('h-limit');
    if (road && road.feature.properties.ms && (p.mode === 'drive' || p.mode === 'bike')) {
      lim.classList.remove('hidden');
      lim.textContent = road.feature.properties.ms;
      lim.classList.toggle('over', p.mode === 'drive' && p.speedKmh > road.feature.properties.ms + 3);
    } else lim.classList.add('hidden');
    if (road) {
      const rp = road.feature.properties;
      this.$('h-street').textContent = rp.n || rp.lbl;
      const bits = [rp.n ? rp.lbl : '', rp.sf ? rp.sf.replace(/_/g, ' ') : '', rp.cwl === 'track' || rp.cwr === 'track' ? 'cycle track' : (rp.cwl === 'lane' || rp.cwr === 'lane' ? 'cycle lane' : ''), rp.ow ? 'one-way' : ''].filter(Boolean);
      this.$('h-street-sub').textContent = bits.join(' · ');
      const sc = st.score || {};
      const set = (id, v) => { this.$(id).style.width = `${v == null ? 0 : Math.round(v * 100)}%`; this.$(id).style.background = scoreColor(v); this.$(id + '-v').textContent = v == null ? 'n/a' : v.toFixed(2); };
      set('h-bike', sc.bike); set('h-walk', sc.walk);
      this.$('h-src').textContent = sc.src === 'lite' ? 'approximate (NetAScore-lite from OSM tags)' : sc.src === 'netascore' ? 'NetAScore dataset' : '';
      this.$('h-street-card').style.opacity = '1';
    } else {
      this.$('h-street').textContent = p.mode === 'fly' ? `Altitude ${Math.round(p.altitude)} m` : 'Off street';
      this.$('h-street-sub').textContent = st.area || '';
      this.$('h-street-card').style.opacity = '0.75';
    }
    this.$('h-ele').textContent = `⛰️ ${st.elevation.toFixed(1)} m`;
    this.$('h-slope').textContent = p.mode === 'fly' ? '' : `📐 ${(p.grade * 100).toFixed(1)} %`;
    this.$('h-coord').textContent = `${st.lat.toFixed(5)}, ${st.lng.toFixed(5)}`;
    this.compass.style.left = `${180 - (p.heading + 360) * 4}px`;
    this.$('h-time').textContent = `🕒 ${st.timeText}`;
    this.$('h-weather').textContent = `${WEATHER_ICON[st.weather] || ''} ${st.season}`;
    this.$('h-fps').textContent = st.showFps ? `${st.fps} fps · ${st.chunks} chunks` : '';
    if (this.lastKeysMode !== p.mode) {
      this.lastKeysMode = p.mode;
      const k = {
        walk: '<kbd>W A S D</kbd> walk · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump',
        bike: '<kbd>W</kbd> pedal · <kbd>S</kbd> brake · <kbd>A D</kbd> steer · <kbd>Shift</kbd> sprint',
        drive: '<kbd>W</kbd> gas · <kbd>S</kbd> brake/reverse · <kbd>A D</kbd> steer · <kbd>Space</kbd> handbrake',
        fly: '<kbd>W A S D</kbd> fly · <kbd>Space</kbd>/<kbd>Q</kbd> up/down · <kbd>Shift</kbd> fast'
      }[p.mode];
      this.$('h-keys').innerHTML = `${k}<br><kbd>1</kbd>–<kbd>4</kbd> mode · <kbd>C</kbd> camera · <kbd>E</kbd>/click inspect · <kbd>F</kbd> feedback · <kbd>L</kbd> labels · <kbd>N</kbd> scores · <kbd>T</kbd> time · <kbd>Y</kbd> weather · <kbd>Esc</kbd> menu`;
    }
  }

  setTarget(t) {
    const el = this.$('h-target');
    if (!t) { el.classList.add('hidden'); return; }
    el.innerHTML = `<b>${esc(t.icon || '')} ${esc(t.title)}</b><small>${esc(t.sub || '')}</small>`;
    el.classList.remove('hidden');
  }

  /** Rotating minimap around the player (heading up). */
  drawMinimap(st, data, chunks) {
    const ctx = this.ctx2d, W = this.mini.width;
    const p = st.player;
    const scale = W / 2 / 220; // 220 m radius
    ctx.save();
    ctx.fillStyle = '#1d2430';
    ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    ctx.rotate(-p.yaw);
    const X = (e) => (e - p.e) * scale, Y = (n) => -(n - p.n) * scale;
    // buildings
    ctx.fillStyle = '#5b6372';
    for (const ch of chunks.values()) {
      const cx = (ch.i + 0.5) * 250, cy = (ch.j + 0.5) * 250;
      if (Math.hypot(cx - p.e, cy - p.n) > 420 || !ch.buildRefs) continue;
      for (const f of ch.buildRefs) {
        for (const poly of f._loc) {
          const r = poly[0];
          ctx.beginPath();
          r.forEach((q, i) => (i ? ctx.lineTo(X(q[0]), Y(q[1])) : ctx.moveTo(X(q[0]), Y(q[1]))));
          ctx.fill();
        }
      }
    }
    // streets coloured by score when the overlay is on, else by rank
    const overlay = st.netOverlay;
    for (const ch of chunks.values()) {
      const bin = data.get(ch.i, ch.j);
      if (!bin) continue;
      const cx = (ch.i + 0.5) * 250, cy = (ch.j + 0.5) * 250;
      if (Math.hypot(cx - p.e, cy - p.n) > 420) continue;
      for (const run of bin.roadRuns) {
        const f = run.f, rp = f.properties;
        const w = Math.max(1.2, (rp.w || 4) * scale);
        if (overlay !== 'off') { const sc = st.scoreFor(f) || {}; ctx.strokeStyle = scoreColor(overlay === 'bike' ? sc.bike : sc.walk); }
        else ctx.strokeStyle = rp.rk >= 6 ? '#f1e3a0' : rp.rk >= 3 ? '#e4e8ee' : '#9aa5b5';
        ctx.lineWidth = w;
        ctx.beginPath();
        for (let i = run.i0; i <= run.i1; i++) { const q = f._pts[i]; i === run.i0 ? ctx.moveTo(X(q[0]), Y(q[1])) : ctx.lineTo(X(q[0]), Y(q[1])); }
        ctx.stroke();
      }
    }
    ctx.restore();
    // player arrow (always up)
    ctx.fillStyle = '#ffd43b';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, W / 2 - 16); ctx.lineTo(W / 2 + 11, W / 2 + 12); ctx.lineTo(W / 2, W / 2 + 6); ctx.lineTo(W / 2 - 11, W / 2 + 12); ctx.closePath(); ctx.fill(); ctx.stroke();
    // north marker on the rim
    const a = -p.yaw - Math.PI / 2;
    ctx.fillStyle = '#ff6b6b'; ctx.font = 'bold 22px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', W / 2 + Math.cos(a) * (W / 2 - 18), W / 2 + Math.sin(a) * (W / 2 - 18));
  }
}
