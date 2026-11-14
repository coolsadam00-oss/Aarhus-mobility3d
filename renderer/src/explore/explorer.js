// 3D explorer: renderer, post-processing, streaming world, player modes, traffic, HUD, labels, inspect & feedback.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import geo from '../../../shared/geo.js';
import cls from '../../../shared/classify.js';
import { cityData } from '../citydata.js';
import { heightfield } from '../heightfield.js';
import * as settings from '../settings.js';
import * as panel from '../infopanel.js';
import { esc, toast, CATEGORIES, scoreColor } from '../util.js';
import { U, facadeMaterial, roofMaterial, roadMaterial, waterMaterial } from './materials.js';
import { WorldData, CHUNK, key } from './worlddata.js';
import { ChunkManager } from './chunks.js';
import { Colliders } from './physics.js';
import { SkySystem, WEATHER_ORDER } from './sky.js';
import { Player, MODES } from './player.js';
import { Traffic } from './traffic.js';
import { Hud } from './hud.js';
import { Labels } from './labels.js';
import { LampField } from './lamps.js';
import { installBvh } from './bvh.js';

installBvh();
import { dateAtLocalHour, localHour, seasonOf } from './sun.js';

const QUALITY_SHADOW_RANGE = { low: 120, medium: 160, high: 220, ultra: 280 };

export class Explorer {
  constructor(root) {
    this.root = root;
    this.active = false;
    this.dataVersion = 0;
    this.keys = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.frameTimes = [];
    this.frameNo = 0;      // rendered frames (diagnostics / tests)
    this.simTime = 0;      // simulated seconds (frames are clamped to 0.1 s)
    this.timers = { hud: 0, mini: 0, target: 0, pins: 0 };
    this.target = null;

    // ---- renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false; // the composer renders several passes; count the whole frame
    this.renderer.domElement.tabIndex = 0;
    // GPU reset (driver update, sleep): keep the context restorable and rebuild GPU-only resources afterwards
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; toast('Graphics were reset – restoring the 3D view…', 'info', 4000); });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      if (this.sky) { this.sky.lastEnvKey = ''; this.sky.lastEnvAt = 0; }
      this._buildComposer();
      if (this.lamps) this.lamps.tex.needsUpdate = true;
    });
    root.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.12, 4000);
    this.mats = { facade: facadeMaterial(), roof: roofMaterial(), road: roadMaterial(), water: waterMaterial(), barrier: facadeMaterial() };
    this.sea = this._makeSea();
    this.scene.add(this.sea);

    const c = cityData.bbox ? [(cityData.bbox[0] + cityData.bbox[2]) / 2, (cityData.bbox[1] + cityData.bbox[3]) / 2] : [10.2039, 56.1555];
    this.sky = new SkySystem(this.renderer, this.scene, c[1], c[0]);
    this.colliders = new Colliders();
    this.lamps = new LampField();
    this.player = new Player({
      scene: this.scene, camera: this.camera, settings, colliders: this.colliders,
      hAt: (e, n) => this.hAt(e, n), deckAt: (e, n) => this.deckAt(e, n)
    });
    this.hud = new Hud(root);
    this.labels = new Labels(root, this.scene, this.camera);
    this._buildOverlays();
    this._bindInput();
    this._buildComposer();
    this.pins = new THREE.Group();
    this.scene.add(this.pins);
    this.raycaster = new THREE.Raycaster();
    settings.onChange((ch) => this.applySettings(ch));
    document.addEventListener('comments-changed', () => { this.timers.pins = 0; });
    window.addEventListener('resize', () => this.resize());
    this.loop = this.loop.bind(this);
    window.__am3dExplorer = this; // diagnostics handle (devtools / end-to-end tests)
  }

  // ------------------------------------------------------------------ world
  hAt(e, n) {
    if (!this.data) return 0;
    const [lng, lat] = this.data.toLngLat(e, n);
    return heightfield.heightAt(lng, lat);
  }

  /** Deck height of a bridge under (e, n), or null. Mirrors the deck profile used when drawing bridges. */
  deckAt(e, n) {
    if (!this.data) return null;
    const [lng, lat] = this.data.toLngLat(e, n);
    const r = cityData.roadNear(lng, lat, 7, (f) => f.properties.br === 1);
    if (!r) return null;
    const f = r.feature;
    if (!f._pts || r.dist > (f.properties.w || 5) / 2 + 0.6) return null;
    if (!f._cum) { f._cum = [0]; for (let i = 1; i < f._pts.length; i++) f._cum.push(f._cum[i - 1] + Math.hypot(f._pts[i][0] - f._pts[i - 1][0], f._pts[i][1] - f._pts[i - 1][1])); }
    if (!f._bh) f._bh = [this.hAt(...f._pts[0]), this.hAt(...f._pts[f._pts.length - 1])];
    const i = r.segment;
    const a = f._pts[i - 1], b = f._pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((e - a[0]) * dx + (n - a[1]) * dy) / l2));
    const L = f._cum[f._cum.length - 1] || 1;
    const sAbs = f._cum[i - 1] + t * Math.sqrt(l2);
    const line = f._bh[0] + (f._bh[1] - f._bh[0]) * (sAbs / L);
    const taper = Math.pow(Math.max(0, Math.sin(Math.PI * sAbs / L)), 0.6);
    return Math.max(line, this.hAt(e, n) + Math.min(4.5, 0.12 * L) * taper) + 0.25 + 0.06 + (f.properties.rk || 4) * 0.008;
  }

  _makeSea() {
    const m = waterMaterial();
    m.normalMap = m.normalMap.clone();
    m.normalMap.wrapS = m.normalMap.wrapT = THREE.RepeatWrapping;
    m.normalMap.repeat.set(220, 220);
    m.normalMap.needsUpdate = true;
    const g = new THREE.PlaneGeometry(12000, 12000, 1, 1).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = 0.0;
    mesh.receiveShadow = true;
    mesh.userData.kind = 'water';
    return mesh;
  }

  buildWorld() {
    if (this.chunks) this.chunks.rebuildAll();
    if (this.traffic) this.traffic.dispose();
    this.data = new WorldData(cityData);
    const self = this;
    this.chunks = new ChunkManager({
      scene: this.scene, data: this.data, hf: heightfield, settings, mats: this.mats, renderer: this.renderer, colliders: this.colliders, city: cityData,
      lamps: this.lamps, season: () => self.season()
    });
    this.traffic = new Traffic({ scene: this.scene, data: this.data, hAt: (e, n) => this.hAt(e, n), settings, player: this.player });
    this.dataVersion = cityData.loadedAt;
  }

  season() { const s = settings.get('season'); return s === 'auto' ? seasonOf(new Date()) : s; }
  now() { return settings.get('timeMode') === 'manual' ? dateAtLocalHour(settings.get('timeOfDay')) : new Date(); }

  // ------------------------------------------------------------------ enter / exit
  async enter(at) {
    this.active = true;
    document.body.classList.add('explore');
    // keys must reach the 3D view, not a search box that still has focus
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
    this.renderer.domElement.focus({ preventScroll: true });
    this.resize();
    if (!this.data || this.dataVersion !== cityData.loadedAt) this.buildWorld();
    this.placeAt(at.lng, at.lat, at.heading);
    this.player.setMode(settings.get('startMode'));
    this.player.place(this.player.e, this.player.n, this.player.yaw);
    this.applySettings(settings.get(), true);
    this.showLoading(true);
    this.pauseEl.classList.remove('hidden');
    this.last = performance.now();
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  exit() {
    this.active = false;
    document.body.classList.remove('explore');
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.keys.clear();
  }

  onDataChanged() {
    if (this.active) { this.buildWorld(); const p = this.player; this.player.place(p.e, p.n, p.yaw); this.timers.pins = 0; }
  }
  onPanelClosed() {
    this.highlight(null);
    // give the keyboard back to the 3D view (a comment box inside the closed panel may still hold focus)
    if (this.active) {
      const a = document.activeElement;
      if (a && a !== document.body && a.blur) a.blur();
      this.renderer.domElement.focus({ preventScroll: true });
    }
  }

  /** Put the player on the nearest street (sidewalk when walking) facing along it. */
  placeAt(lng, lat, headingDeg) {
    let [e, n] = this.data.toLocal(lng, lat);
    let yaw = headingDeg != null ? (headingDeg * Math.PI) / 180 : this.player.yaw;
    const mode = this.player.mode;
    const road = cityData.roadNear(lng, lat, 90, (f) => !f.properties.tu && !f.properties.br && (f.properties.rk || 0) >= 1);
    if (road) {
      const f = road.feature;
      const c = f.geometry.coordinates;
      const a = this.data.toLocal(...c[road.segment - 1]), b = this.data.toLocal(...c[road.segment]);
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((e - a[0]) * dx + (n - a[1]) * dy) / (l * l)));
      e = a[0] + dx * t; n = a[1] + dy * t;
      let ry = Math.atan2(dx / l, dy / l);
      if (headingDeg != null && Math.cos(ry - yaw) < 0) ry += Math.PI;
      yaw = ry;
      const info = cls.roadInfo(f.properties.k);
      const w = f.properties.w || info.width;
      // walkers start on a sidewalk, vehicles in the right-hand lane; take the first spot clear of buildings
      const sw = w / 2 + 1.0, lane = Math.min(w / 4, 1.8);
      const offs = mode === 'walk' ? (info.motor ? [sw, -sw, 0] : [0]) : mode === 'drive' ? [lane, -lane, 0] : mode === 'bike' ? [Math.max(0.8, w / 2 - 0.8), -Math.max(0.8, w / 2 - 0.8), 0] : [0];
      const rad = mode === 'drive' ? 1.2 : 0.5;
      let pick = offs.find(o => this.colliders.free(e + (dy / l) * o, n + (-dx / l) * o, rad));
      if (pick === undefined) pick = offs[0];
      if (pick < 0 && mode !== 'walk') yaw += Math.PI; // left side of the street → drive the other way, keep right
      e += (dy / l) * pick; n += (-dx / l) * pick;
    }
    this.player.place(e, n, yaw);
    if (this.player.mode === 'fly') this.player.y = this.hAt(e, n) + 80;
    // the buildings here may still be loading: look at the spot again once they are in
    const ch = this.chunks && this.chunks.chunks.get(key(Math.floor(e / CHUNK), Math.floor(n / CHUNK)));
    this.recheckPlace = !ch || !ch.built ? { lng, lat, headingDeg } : null;
  }

  teleport(lng, lat) {
    if (!this.data) return;
    this.placeAt(lng, lat, null);
    this.showLoading(true);
    toast('Teleported', 'ok', 1500);
  }

  // ------------------------------------------------------------------ settings
  applySettings(ch, force = false) {
    const s = settings.get();
    if (force || 'pixelRatio' in ch) { this.renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * s.pixelRatio)); this.resize(); }
    if (force || 'shadows' in ch || 'quality' in ch) {
      const q = settings.QUALITY[s.quality] || settings.QUALITY.medium;
      this.renderer.shadowMap.enabled = s.shadows;
      this.sky.setShadows(s.shadows, q.shadowSize, QUALITY_SHADOW_RANGE[s.quality] || 160);
      this.scene.traverse(o => { if (o.material && o.material.needsUpdate !== undefined && 'shadows' in ch) o.material.needsUpdate = true; });
    }
    if (force || 'viewDistance' in ch) { this.camera.far = s.viewDistance * 1.6 + 1200; this.camera.updateProjectionMatrix(); }
    if (force || 'ao' in ch || 'bloom' in ch || 'quality' in ch) this._buildComposer();
    if (force || 'windows' in ch) U.uDetail.value = s.windows ? 1 : 0;
    if (force || 'netOverlay' in ch) U.uOverlay.value = s.netOverlay === 'bike' ? 1 : s.netOverlay === 'walk' ? 2 : 0;
    if (force || 'hud' in ch || 'minimap' in ch) this.hud.setVisible(s.hud, s.minimap);
    if (!force && this.chunks) {
      if ('imagery' in ch || 'customImagery' in ch) { this.chunks.imagery = new (this.chunks.imagery.constructor)(s.customImagery); this.chunks.rebuildGround(); }
      if (['roofs', 'trees', 'treeDensity', 'furniture', 'autoLamps', 'season'].some(k => k in ch)) this.chunks.rebuildContent();
      if ('quality' in ch) this.chunks.rebuildGround();
    }
    if ('labelsBuildings' in ch || 'labelsPoi' in ch || 'labelsStreets' in ch || 'labelTypes' in ch) this.labels.timer = 0;
    this._syncModebar();
  }

  _buildComposer() {
    const s = settings.get();
    const w = Math.max(2, this.root.clientWidth), h = Math.max(2, this.root.clientHeight);
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    const pr = this.renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: s.quality === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = null;
    if (s.ao) {
      const ao = new GTAOPass(this.scene, this.camera, w, h);
      ao.updateGtaoMaterial({ radius: 0.6, distanceFallOff: 1.0, thickness: 1.5, scale: 1.1 });
      this.composer.addPass(ao);
      this.ao = ao;
    }
    // bloom only for genuinely bright things (sun, lamp heads, glints); strength/threshold follow day & night
    this.bloom = s.bloom ? new UnrealBloomPass(new THREE.Vector2(w, h), 0.15, 0.22, 2.0) : null;
    if (this.bloom) this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(w, h);
  }

  resize() {
    const w = Math.max(2, this.root.clientWidth), h = Math.max(2, this.root.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  // ------------------------------------------------------------------ overlays (pause menu, mode bar, loading)
  _buildOverlays() {
    const root = this.root;
    this.pauseEl = document.createElement('div');
    this.pauseEl.className = 'pause hidden';
    this.pauseEl.innerHTML = `<div class="card">
      <h2>🎮 Explore Aarhus in 3D</h2>
      <p class="muted">Click the view to look around with the mouse. <kbd>Esc</kbd> brings you back here.</p>
      <div class="btn-row">${Object.entries(MODES).map(([k, m]) => `<button class="btn ghost" data-mode="${k}">${m.icon} ${m.label}</button>`).join('')}</div>
      <div class="btn-row"><button class="btn primary" data-act="resume">▶ Start / continue</button></div>
      <div class="btn-row"><button class="btn ghost" data-act="settings">⚙️ Settings</button><button class="btn ghost" data-act="help">❔ Controls</button><button class="btn ghost" data-act="map">🗺️ Back to map</button></div>
      <p class="muted" style="font-size:11.5px;margin-bottom:0">Buildings, streets and places come from the active city data (📦 Data). Look at something and press <kbd>E</kbd> to see what it is.</p></div>`;
    root.appendChild(this.pauseEl);
    this.pauseEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && b.dataset.mode) { this.player.setMode(b.dataset.mode); this.player.place(this.player.e, this.player.n, this.player.yaw); this._syncModebar(); return; }
      const act = b && b.dataset.act;
      if (act === 'settings') { document.querySelector('#btn-settings').click(); return; }
      if (act === 'help') { document.querySelector('#btn-help').click(); return; }
      if (act === 'map') { document.querySelector('#topbar .views .seg[data-view=map]').click(); return; }
      this.lock();
    });

    this.modebar = document.createElement('div');
    this.modebar.className = 'modebar hud-modebar';
    this.modebar.innerHTML = `${Object.entries(MODES).map(([k, m], i) => `<button data-mode="${k}" title="${m.label} (${i + 1})">${m.icon} ${m.label}</button>`).join('')}
      <span class="sep"></span><button data-act="cam" title="Camera (C)">🎥</button><button data-act="time" title="+1 hour (T)">🕒</button>
      <button data-act="weather" title="Weather (Y)">🌦️</button><button data-act="overlay" title="NetAScore colours (N)">🚦</button><button data-act="labels" title="Labels (L)">🏷️</button><button data-act="shot" title="Screenshot (F12)">📷</button>`;
    root.appendChild(this.modebar);
    this.modebar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.mode) { this.player.setMode(b.dataset.mode); this.player.place(this.player.e, this.player.n, this.player.yaw); }
      const a = b.dataset.act;
      if (a === 'cam') this.player.toggleCamera();
      if (a === 'time') this.shiftTime(1);
      if (a === 'weather') this.cycleWeather();
      if (a === 'overlay') this.cycleOverlay();
      if (a === 'labels') this.toggleLabels();
      if (a === 'shot') window.__am3dScreenshot && window.__am3dScreenshot();
      this._syncModebar();
    });

    this.loadingEl = document.createElement('div');
    this.loadingEl.className = 'explore-loading hidden';
    root.appendChild(this.loadingEl);
  }

  _syncModebar() {
    if (!this.modebar) return;
    this.modebar.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === this.player.mode));
    this.pauseEl.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === this.player.mode));
  }

  showLoading(on) {
    this.loadingWanted = on;
    if (on) this.loadingSince = performance.now();
    this.loadingEl.classList.toggle('hidden', !on);
  }

  lock() {
    const el = this.renderer.domElement;
    try {
      const p = el.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => {});
    } catch { /* pointer lock unavailable – keyboard still works */ }
    this.pauseEl.classList.add('hidden');
    el.focus();
  }

  // ------------------------------------------------------------------ input
  _bindInput() {
    const el = this.renderer.domElement;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked && this.active && !panel.isOpen()) this.pauseEl.classList.remove('hidden');
      if (this.locked) this.pauseEl.classList.add('hidden');
    });
    document.addEventListener('mousemove', (e) => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } else if (this.dragging) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    el.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (this.locked) { if (e.button === 0) this.inspect(); return; }
      if (e.button === 2) { this.dragging = true; return; }
      this.lock();
    });
    document.addEventListener('mouseup', () => { this.dragging = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    const typing = (e) => e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    window.addEventListener('keydown', (e) => {
      if (!this.active || typing(e) || document.querySelector('.modal-backdrop')) return;
      if (e.ctrlKey && /Digit[12]|KeyD|KeyF|Comma/.test(e.code)) return; // app shortcuts
      this.keys.add(e.code);
      if (/^(Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Tab)$/.test(e.code)) e.preventDefault();
      if (e.repeat) return;
      const map = { Digit1: 'walk', Digit2: 'bike', Digit3: 'drive', Digit4: 'fly', Numpad1: 'walk', Numpad2: 'bike', Numpad3: 'drive', Numpad4: 'fly' };
      if (map[e.code]) { this.player.setMode(map[e.code]); this.player.place(this.player.e, this.player.n, this.player.yaw); this._syncModebar(); }
      if (e.code === 'KeyC') this.player.toggleCamera();
      if (e.code === 'KeyE') this.inspect();
      if (e.code === 'KeyF') this.feedback();
      if (e.code === 'KeyL') this.toggleLabels();
      if (e.code === 'KeyN') this.cycleOverlay();
      if (e.code === 'KeyT') this.shiftTime(e.shiftKey ? -1 : 1);
      if (e.code === 'KeyY') this.cycleWeather();
      if (e.code === 'KeyM') settings.set({ minimap: !settings.get('minimap') });
      if (e.code === 'KeyH') settings.set({ hud: !settings.get('hud') });
      if (e.code === 'KeyR') { this.placeAt(...this.data.toLngLat(this.player.e, this.player.n), null); toast('Back on the street', 'ok', 1200); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  readGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const g = pads && [...pads].find(p => p && p.connected);
    if (!g) return null;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const b = (i) => !!(g.buttons[i] && g.buttons[i].pressed);
    const pad = { lx: dz(g.axes[0] || 0), ly: dz(g.axes[1] || 0), rx: dz(g.axes[2] || 0), ry: dz(g.axes[3] || 0), lt: g.buttons[6] ? g.buttons[6].value : 0, rt: g.buttons[7] ? g.buttons[7].value : 0, a: b(0), boost: b(10) || b(4) };
    // d-pad left/right cycles modes
    const now = performance.now();
    if ((b(14) || b(15)) && (!this.padModeAt || now - this.padModeAt > 400)) {
      this.padModeAt = now;
      const order = Object.keys(MODES);
      const i = (order.indexOf(this.player.mode) + (b(15) ? 1 : order.length - 1)) % order.length;
      this.player.setMode(order[i]); this.player.place(this.player.e, this.player.n, this.player.yaw); this._syncModebar();
    }
    if (b(3) && (!this.padInspectAt || now - this.padInspectAt > 500)) { this.padInspectAt = now; this.inspect(); }
    return pad;
  }

  shiftTime(h) {
    const cur = settings.get('timeMode') === 'manual' ? settings.get('timeOfDay') : localHour();
    settings.set({ timeMode: 'manual', timeOfDay: ((Math.round(cur * 4) / 4 + h) % 24 + 24) % 24 });
    toast(`🕒 ${this.timeText()}`, 'info', 1200);
  }
  cycleWeather() {
    const i = WEATHER_ORDER.indexOf(settings.get('weather'));
    const w = WEATHER_ORDER[(i + 1) % WEATHER_ORDER.length];
    settings.set({ weather: w });
    toast(`Weather: ${w}`, 'info', 1200);
  }
  cycleOverlay() {
    const order = ['off', 'bike', 'walk'];
    const v = order[(order.indexOf(settings.get('netOverlay')) + 1) % order.length];
    settings.set({ netOverlay: v });
    toast(v === 'off' ? 'NetAScore colours off' : `NetAScore colours: ${v === 'bike' ? '🚲 bikeability' : '🚶 walkability'}`, 'info', 1500);
  }
  toggleLabels() {
    const on = !(settings.get('labelsBuildings') || settings.get('labelsPoi'));
    settings.set({ labelsBuildings: on, labelsPoi: on });
    toast(on ? 'Labels on' : 'Labels off', 'info', 1000);
  }
  timeText() { const h = settings.get('timeMode') === 'manual' ? settings.get('timeOfDay') : localHour(); const hh = Math.floor(h) % 24, mm = Math.round((h - Math.floor(h)) * 60) % 60; return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${settings.get('timeMode') === 'manual' ? '' : ' (live)'}`; }

  // ------------------------------------------------------------------ picking, inspect & feedback
  pickables() {
    const out = [];
    for (const ch of this.chunks.chunks.values()) {
      if (ch.buildGroup) out.push(...ch.buildGroup.children);
      if (ch.detailGroup) for (const c of ch.detailGroup.children) { if (c.isGroup) out.push(...c.children.filter(x => x.isInstancedMesh)); else out.push(c); }
      if (ch.ground) out.push(ch.ground);
    }
    out.push(...this.pins.children);
    return out;
  }

  raycastCenter(far = 400) {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = far;
    const hits = this.raycaster.intersectObjects(this.pickables(), false);
    for (const h of hits) {
      if (h.object.isSprite) return { type: 'pin', comment: h.object.userData.comment, point: h.point };
      const r = this.chunks.resolveHit(h);
      if (r) return { ...r, point: h.point, distance: h.distance };
    }
    return null;
  }

  describe(t) {
    if (!t) return null;
    if (t.type === 'building') { const p = t.f.properties; return { icon: p.ic || '🏢', title: p.n || p.lbl, sub: `${p.n ? p.lbl + ' · ' : ''}${p.a || ''}${p.h ? ` · ${Math.round(p.h)} m` : ''}  —  E: info · F: feedback` }; }
    if (t.type === 'road') { const p = t.f.properties; const sc = cityData.scoreForRoad(t.f) || {}; return { icon: '🛣️', title: p.n || p.lbl, sub: `${p.n ? p.lbl + ' · ' : ''}🚲 ${sc.bike == null ? 'n/a' : sc.bike.toFixed(2)} · 🚶 ${sc.walk == null ? 'n/a' : sc.walk.toFixed(2)}  —  E: info · F: feedback` }; }
    if (t.type === 'tree') { const it = t.item || {}; const sp = it.ref && it.ref.properties.sp; return { icon: it.conifer ? '🌲' : '🌳', title: sp ? `Tree: ${sp}` : (it.ref ? 'Tree (mapped)' : 'Tree (park planting, illustrative)'), sub: it.h ? `${Math.round(it.h)} m` : '' }; }
    if (t.type === 'prop') { const it = t.item || {}; const k = it.ref ? it.ref.properties.k : 'highway=street_lamp'; const info = cls.poiInfo(k) || { label: it.type, icon: '📍' }; return { icon: info.icon, title: info.label, sub: it.auto ? 'illustrative placement (OSM has no lamp here)' : 'from OpenStreetMap' }; }
    if (t.type === 'pin') { const c = t.comment; const cat = CATEGORIES[c.category] || CATEGORIES.other; return { icon: cat.icon, title: cat.label, sub: (c.body || '').slice(0, 80) }; }
    if (t.type === 'water') return { icon: '💧', title: 'Water', sub: '' };
    return null;
  }

  inspect() {
    const t = this.raycastCenter();
    if (!t) return;
    const [lng, lat] = this.data.toLngLat(t.point.x, -t.point.z);
    const ll = { lng, lat };
    if (document.pointerLockElement) document.exitPointerLock();
    this.highlight(t);
    if (t.type === 'building') panel.showBuilding(t.f, { lngLat: ll });
    else if (t.type === 'road') panel.showRoad(t.f, ll);
    else if (t.type === 'pin') this.openComment(t.comment);
    else if (t.type === 'prop' && t.item && t.item.ref) { const f = t.item.ref; panel.showPoi({ ...f, properties: { ...f.properties, ...cls.classifyPoi(f.properties.t || {}), lbl: (cls.poiInfo(f.properties.k) || {}).label || f.properties.k, ic: (cls.poiInfo(f.properties.k) || {}).icon, t: f.properties.t || {} } }); }
    else panel.showPlace(lng, lat);
  }

  feedback() {
    let t = this.raycastCenter(120);
    if (!t || (t.type !== 'building' && t.type !== 'road')) {
      const [lng, lat] = this.data.toLngLat(this.player.e, this.player.n);
      const r = cityData.roadNear(lng, lat, 30);
      if (r) t = { type: 'road', f: r.feature, point: new THREE.Vector3(this.player.e, this.player.y, -this.player.n) };
    }
    if (document.pointerLockElement) document.exitPointerLock();
    if (!t) { const [lng, lat] = this.data.toLngLat(this.player.e, this.player.n); panel.showPlace(lng, lat); }
    else {
      const [lng, lat] = this.data.toLngLat(t.point.x, -t.point.z);
      if (t.type === 'building') panel.showBuilding(t.f, { lngLat: { lng, lat } }); else panel.showRoad(t.f, { lng, lat });
    }
    setTimeout(() => { const ta = document.querySelector('#fb-form textarea'); if (ta) { ta.scrollIntoView({ block: 'center' }); ta.focus(); } }, 60);
  }

  openComment(c) {
    if (c.target_type === 'building') { const b = cityData.byId.get(c.osm_way_id); if (b) return panel.showBuilding(b, { lngLat: { lng: c.lng, lat: c.lat } }); }
    if (c.target_type === 'poi') { const p = cityData.byId.get(c.osm_way_id); if (p) return panel.showPoi(p); }
    const r = cityData.byId.get('w' + c.osm_way_id) || cityData.byId.get(c.osm_way_id);
    if (r && r.properties.k) return panel.showRoad(r, { lng: c.lng, lat: c.lat });
    return panel.showPlace(c.lng, c.lat);
  }

  highlight(t) {
    if (this.hl) { this.scene.remove(this.hl); this.hl.geometry.dispose(); this.hl = null; }
    if (!t || t.type !== 'building' || !t.f._loc) return;
    const pts = [];
    const top = (t.f._top || t.point.y) + 0.3, bottom = (t.f._ground || t.point.y - 10);
    for (const poly of t.f._loc) {
      const r = poly[0];
      for (let i = 0; i < r.length - 1; i++) {
        const a = r[i], b = r[i + 1];
        pts.push(a[0], top, -a[1], b[0], top, -b[1], a[0], bottom, -a[1], a[0], top, -a[1]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.hl = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x4dabf7, transparent: true, opacity: 0.9, depthTest: false }));
    this.hl.renderOrder = 20;
    this.scene.add(this.hl);
  }

  // ------------------------------------------------------------------ feedback pins (sprites)
  refreshPins() {
    for (const c of [...this.pins.children]) { this.pins.remove(c); c.material.dispose(); }
    if (!settings.get('pins3d')) return;
    const comments = (window.__am3d && window.__am3d.comments) || [];
    const seen = new Set();
    for (const c of comments) {
      if (c.lng == null || seen.has(c.osm_way_id)) continue;
      seen.add(c.osm_way_id);
      const cat = CATEGORIES[c.category] || CATEGORIES.other;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pinTexture(cat), depthTest: true, transparent: true }));
      const [e, n] = this.data.toLocal(c.lng, c.lat);
      const b = c.target_type === 'building' ? cityData.byId.get(c.osm_way_id) : null;
      const y = (b && b._top) ? b._top + 3 : this.hAt(e, n) + 3.2;
      sp.position.set(e, y, -n);
      sp.scale.set(2.2, 2.9, 1);
      sp.userData.comment = c;
      this.pins.add(sp);
    }
  }

  // ------------------------------------------------------------------ main loop
  loop(t) {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.active) return;
    if (this.contextLost) return;
    const dt = Math.min(0.1, Math.max(0.001, (t - this.last) / 1000));
    this.last = t;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    this.renderer.info.reset();
    U.uTime.value += dt;
    this.frameNo++;
    this.simTime += dt;
    const s = settings.get();
    const pad = this.readGamepad();
    const inp = { keys: this.keys, mouseDX: this.mouseDX, mouseDY: this.mouseDY, pad };
    this.mouseDX = 0; this.mouseDY = 0;
    const p = this.player;
    p.update(dt, inp);
    this.chunks.update(p.e, p.n, Math.max(0, p.altitude), p.mode === 'fly' ? 10 : 7);
    if (this.recheckPlace) {
      const ch = this.chunks.chunks.get(key(Math.floor(p.e / CHUNK), Math.floor(p.n / CHUNK)));
      if (ch && ch.built) {
        const r = this.recheckPlace;
        this.recheckPlace = null;
        // only if a building appeared *around* the player (not merely next to them while walking along a facade)
        if (p.mode !== 'fly' && this.colliders.insideAny(p.e, p.n)) this.placeAt(r.lng, r.lat, r.headingDeg);
      }
    }
    if (this.loadingWanted) {
      // hide once every area within ~380 m has terrain + buildings (far areas keep streaming in behind the scenes)
      const near = [...this.chunks.chunks.values()].filter(ch => Math.hypot((ch.i + 0.5) * CHUNK - p.e, (ch.j + 0.5) * CHUNK - p.n) < 380);
      const ready = near.filter(ch => ch.groundLod >= 0 && ch.built).length;
      this.loadingEl.innerHTML = `Building Aarhus around you… ${ready}/${near.length} areas<br><small class="muted">terrain, aerial photos, buildings, streets, trees</small>`;
      if ((near.length && ready === near.length) || t - this.loadingSince > 25000) this.showLoading(false);
    }
    // world positioning of the sea and night lights
    this.sea.position.set(Math.round(this.camera.position.x / 100) * 100, 0, Math.round(this.camera.position.z / 100) * 100);
    this.sea.material.normalMap.offset.set(this.sea.position.x / 12000 * 220, -this.sea.position.z / 12000 * 220);
    this.sky.groundY = this.hAt(p.e, p.n);
    this.sky.update(this.now(), s, this.camera, dt);
    const night = U.uNight.value;
    U.uLampOn.value = s.streetLights ? night : 0;
    this.lamps.update(this.camera.position.x, this.camera.position.z, U.uLampOn.value);
    // ambient occlusion only darkens ambient light; at night most light comes from lamps and windows
    if (this.ao) this.ao.blendIntensity = 1 - 0.7 * night;
    if (this.bloom) {
      // threshold is in scene-linear units before exposure: keep the sky itself out of the bloom
      this.bloom.threshold = this.sky.bloomThreshold;
      this.bloom.strength = 0.1 + 0.16 * night;
    }
    p.car.setNight(night);
    this.traffic.update(dt, p.e, p.n);
    // HUD at 10 Hz, minimap at 6 Hz, crosshair target at 8 Hz
    this.timers.hud -= dt; this.timers.mini -= dt; this.timers.target -= dt; this.timers.pins -= dt;
    if (this.timers.pins <= 0) { this.timers.pins = 5; this.refreshPins(); }
    const [lng, lat] = this.data.toLngLat(p.e, p.n);
    if (this.timers.hud <= 0) {
      this.timers.hud = 0.1;
      const road = p.mode === 'fly' && p.altitude > 8 ? null : cityData.roadNear(lng, lat, p.mode === 'walk' ? 14 : 9);
      const fps = Math.round(this.frameTimes.length / this.frameTimes.reduce((a, b) => a + b, 0));
      this.hudState = { player: p, road, score: road ? cityData.scoreForRoad(road.feature) : null, elevation: this.hAt(p.e, p.n), lat, lng, timeText: this.timeText(), weather: s.weather, season: this.season(), fps, showFps: s.showFps, chunks: this.chunks.chunks.size, netOverlay: s.netOverlay, scoreFor: (f) => cityData.scoreForRoad(f) };
      this.hud.update(this.hudState);
    }
    if (this.timers.mini <= 0 && s.minimap && this.hudState) { this.timers.mini = 0.16; this.hud.drawMinimap(this.hudState, this.data, this.chunks.chunks); }
    if (this.timers.target <= 0) { this.timers.target = 0.125; this.target = this.raycastCenter(250); this.hud.setTarget(this.locked || !panel.isOpen() ? this.describe(this.target) : null); }
    const occluders = [];
    for (const ch of this.chunks.chunks.values()) if (ch.buildGroup && Math.hypot((ch.i + 0.5) * CHUNK - p.e, (ch.j + 0.5) * CHUNK - p.n) < 600) occluders.push(...ch.buildGroup.children);
    this.composer.render(dt);
    this.labels.update(dt, this.chunks.chunks, s, occluders);
  }

  screenshot() {
    this.composer.render(0);
    return this.renderer.domElement.toDataURL('image/png');
  }
}

const pinTex = new Map();
function pinTexture(cat) {
  if (pinTex.has(cat.color)) return pinTex.get(cat.color);
  const c = document.createElement('canvas'); c.width = 96; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = cat.color; g.strokeStyle = '#ffffff'; g.lineWidth = 6;
  g.beginPath(); g.arc(48, 46, 38, Math.PI, 0); g.quadraticCurveTo(86, 80, 48, 122); g.quadraticCurveTo(10, 80, 10, 46); g.closePath(); g.fill(); g.stroke();
  g.font = '40px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(cat.icon, 48, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  pinTex.set(cat.color, t);
  return t;
}
export { scoreColor, esc };
