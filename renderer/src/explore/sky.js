// Sky, sun, moon light, stars, clouds (three.js Sky), haze, rain, wetness, exposure and environment reflections.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { sunPosition, sunDirection, localHour } from './sun.js';
import { U } from './materials.js';
import { skyStats, skyRadiance, luminance } from './skymodel.js';

const SUN_I = 3.4;

// global = daylight on the ground relative to a clear sky at the same sun height (overcast ≈ 25–35 %)
const WEATHER = {
  clear:    { turb: 2.4, rayleigh: 1.1, mie: 0.004, cover: 0.12, dens: 0.35, sun: 1.0,  amb: 1.0,  global: 1.0, fog: 1.0,  rain: 0, wet: 0 },
  partly:   { turb: 3.5, rayleigh: 1.4, mie: 0.005, cover: 0.45, dens: 0.55, sun: 0.85, amb: 1.05, global: 0.85, fog: 1.15, rain: 0, wet: 0 },
  overcast: { turb: 9,   rayleigh: 2.2, mie: 0.010, cover: 0.93, dens: 0.92, sun: 0.1,  amb: 0.6,  global: 0.3,  fog: 2.0,  rain: 0, wet: 0.15 },
  fog:      { turb: 12,  rayleigh: 3.0, mie: 0.025, cover: 0.75, dens: 0.8,  sun: 0.15, amb: 0.7,  global: 0.32, fog: 5.5,  rain: 0, wet: 0.25 },
  rain:     { turb: 10,  rayleigh: 2.6, mie: 0.012, cover: 0.97, dens: 0.97, sun: 0.06, amb: 0.6,  global: 0.27, fog: 2.6,  rain: 1, wet: 1 }
};

/** Share of windows lit at a local hour (evening peak, few after midnight). */
export function litFraction(h) {
  const pts = [[0, 0.2], [1, 0.12], [4, 0.06], [6, 0.2], [8, 0.3], [16, 0.32], [18, 0.46], [22, 0.4], [23.5, 0.26], [24, 0.2]];
  for (let i = 1; i < pts.length; i++) if (h <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * ((h - a) / (b - a)); }
  return 0.2;
}
export const WEATHER_ORDER = ['clear', 'partly', 'overcast', 'fog', 'rain'];
export const WEATHER_ICON = { clear: '☀️', partly: '⛅', overcast: '☁️', fog: '🌫️', rain: '🌧️' };

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/** Sky.js renders thick cloud decks far brighter than the light they cast; a gain lets us render overcast skies
 *  at the brightness that actually lights the scene (what you see is what lights the streets). */
function patchSkyGain(sky) {
  const m = sky.material;
  m.uniforms.skyGain = { value: 1 };
  m.uniforms.uTwilight = { value: 0 };
  const fs = m.fragmentShader;
  m.fragmentShader = fs.replace('uniform float showSunDisc;', 'uniform float showSunDisc;\nuniform float skyGain;\nuniform float uTwilight;')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', TWILIGHT_GLSL + '\ngl_FragColor = vec4( texColor * skyGain, 1.0 );');
  if (m.fragmentShader === fs || !/texColor \* skyGain/.test(m.fragmentShader)) console.warn('Sky.js changed: sky patch not applied');
}
// Blue hour: Sky.js turns black once the sun is ~2° below the horizon. Add the twilight sky (deep blue overhead,
// an orange band towards the set sun) until the end of nautical twilight. Mirrored in skymodel.js.
const TWILIGHT_GLSL = `
if (uTwilight > 0.0) {
  float twUp = max(direction.y, 0.0);
  float twToward = max(0.0, dot(normalize(direction.xz + vec2(1e-5)), normalize(vSunDirection.xz + vec2(1e-5))));
  float twHzn = exp(-twUp * 6.0);
  texColor += uTwilight * (vec3(0.012, 0.022, 0.055) * (0.6 + 0.4 * twHzn) + vec3(0.16, 0.07, 0.03) * twToward * twToward * twToward * twHzn);
}`;
export const twilightAmount = (sinA) => smooth(-0.22, -0.035, sinA) * (1 - smooth(-0.035, 0.03, sinA));

const FOG_DIRS = [-0.7, -0.35, 0, 0.35, 0.7];
const tmpV = new THREE.Vector3();

export class SkySystem {
  constructor(renderer, scene, lat, lng) {
    this.renderer = renderer;
    this.scene = scene;
    this.lat = lat; this.lng = lng;
    this.sky = new Sky();
    this.sky.scale.setScalar(1000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.sky.material.depthWrite = false;
    scene.add(this.sky);
    patchSkyGain(this.sky);
    this.uniforms = this.sky.material.uniforms;
    this.uniforms.cloudScale.value = 0.00018;
    this.uniforms.cloudSpeed.value = 0.00003;
    this.uniforms.cloudElevation.value = 0.55;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x9db4e6, 0.0);
    scene.add(this.moon, this.moon.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4f0, 0x5b5547, 0.8);
    scene.add(this.hemi);

    // environment (reflections) from a copy of the sky
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    // the reflection/ambient copy of the sky has no sun disc: the disc (radiance ~6·10⁴) would light every
    // surface a second time on top of the DirectionalLight and wash facades out
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    patchSkyGain(this.envSky);
    this.envScene.add(this.envSky);
    this.envRT = null;
    this.lastEnvKey = '';
    this.lastEnvAt = 0;

    this._makeStars();
    this._makeRain();
    this.state = { altitude: 0.5, azimuth: 3, day: 1, night: 0, weather: 'clear', sunColor: new THREE.Color(), fogColor: new THREE.Color() };
    this.wet = 0;
  }

  _makeStars() {
    const n = 2600, pos = new Float32Array(n * 3), mag = new Float32Array(n);
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      pos[i * 3] = rr * Math.cos(th); pos[i * 3 + 1] = Math.abs(u); pos[i * 3 + 2] = rr * Math.sin(th);
      mag[i] = Math.pow(r(), 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: 'attribute float aMag; varying float vM; void main(){ vM = aMag; vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + position * 900.0, 1.0); p.z = p.w; gl_Position = p; gl_PointSize = 1.0 + aMag * 2.2; }',
      fragmentShader: 'uniform float uAlpha; varying float vM; void main(){ vec2 c = gl_PointCoord - 0.5; float d = 1.0 - smoothstep(0.2, 0.5, length(c)); gl_FragColor = vec4(vec3(0.9, 0.93, 1.0), d * uAlpha * (0.35 + 0.65 * vM)); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.scene.add(this.stars);
  }

  _makeRain() {
    const n = 5000;
    const seed = new Float32Array(n * 2 * 3), end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random(), b = Math.random(), c = Math.random();
      for (let k = 0; k < 2; k++) { seed.set([a, b, c], (i * 2 + k) * 3); end[i * 2 + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uI: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec3 aSeed; attribute float aEnd; uniform float uTime; varying float vA;
        void main(){
          vec3 box = vec3(36.0, 26.0, 36.0);
          vec3 p = aSeed * box;
          p.y -= uTime * (8.5 + aSeed.x * 2.0);
          p.x += uTime * 0.8;
          p = mod(p - cameraPosition + box * 0.5, box) - box * 0.5 + cameraPosition;
          p += vec3(0.05, -0.55, 0.0) * aEnd;
          vA = 1.0 - aEnd * 0.6;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: 'uniform float uI; varying float vA; void main(){ gl_FragColor = vec4(0.72, 0.76, 0.82, 0.28 * uI * vA); }',
      transparent: true, depthWrite: false
    });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  /**
   * @param {Date} date
   * @param {object} s settings
   * @param {THREE.Camera} camera
   */
  update(date, s, camera, dt) {
    const w = WEATHER[s.weather] || WEATHER.clear;
    const { altitude, azimuth } = sunPosition(date, this.lat, this.lng);
    const dir = sunDirection(altitude, azimuth);
    const sinA = Math.sin(altitude);
    const day = smooth(-0.06, 0.22, sinA);
    const night = 1 - smooth(-0.11, 0.02, sinA);
    this.state = { ...this.state, altitude, azimuth, day, night, weather: s.weather };

    const u = this.uniforms;
    u.sunPosition.value.set(dir[0], dir[1], dir[2]);
    u.turbidity.value = w.turb;
    u.rayleigh.value = lerp(w.rayleigh, 0.4, night);
    u.mieCoefficient.value = w.mie;
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = s.clouds ? w.cover : 0;
    u.cloudDensity.value = w.dens;
    u.time.value += dt;
    u.showSunDisc.value = w.cover > 0.9 ? 0 : 1;
    u.uTwilight.value = twilightAmount(sinA) * (1 - 0.7 * w.cover);

    // sun, moon & hemisphere lights
    const low = smooth(0.0, 0.45, sinA);
    this.state.sunColor.setRGB(1.0, lerp(0.62, 0.96, low), lerp(0.36, 0.9, low));
    this.sun.color.copy(this.state.sunColor);
    this.sun.intensity = SUN_I * smooth(-0.02, 0.12, sinA) * w.sun;
    const target = camera.position;
    this.sun.position.set(target.x + dir[0] * 600, target.y + Math.max(0.05, dir[1]) * 600, target.z + dir[2] * 600);
    this.sun.target.position.copy(target);
    this.moon.intensity = 0.22 * night * (1 - w.cover * 0.7);
    this.moon.position.set(target.x - 300, target.y + 500, target.z + 200);
    this.moon.target.position.copy(target);
    // the sky's image-based light (scene.environment) is the main ambient by day; the hemisphere light adds
    // ground bounce by day and carries the moonlit / city-glow ambient at night (when the sky map is black)
    this.hemi.intensity = (0.1 + 0.06 * day) * w.amb + 0.08 * night;
    this.hemi.color.setRGB(lerp(0.2, 0.74, day), lerp(0.21, 0.83, day), lerp(0.3, 0.94, day));
    if (w.cover > 0.8) this.hemi.color.lerp(new THREE.Color(0.75, 0.77, 0.8), day * 0.6);
    this.hemi.groundColor.setRGB(lerp(0.05, 0.36, day), lerp(0.045, 0.33, day), lerp(0.045, 0.28, day));

    // calibrate against the sky model (skymodel.js): ambient strength, sky gain, haze colour, metered exposure
    const skyP = { turbidity: w.turb, rayleigh: u.rayleigh.value, mie: w.mie, g: 0.82, cover: s.clouds ? w.cover : 0, dens: w.dens, twilight: u.uTwilight.value };
    const statKey = `${Math.round(altitude * 240)}|${Math.round(azimuth * 40)}|${s.weather}|${s.clouds}`;
    if (statKey !== this.statKey) {
      this.statKey = statKey;
      this.skyNow = skyStats(skyP, dir);
      const cw = WEATHER.clear;
      this.skyClear = skyStats({ turbidity: cw.turb, rayleigh: lerp(cw.rayleigh, 0.4, night), mie: cw.mie, g: 0.82, cover: 0, dens: 0, twilight: twilightAmount(sinA) }, dir);
    }
    const sunH = (this.sun.intensity * Math.max(0, sinA)) / Math.PI;           // sun on a level white surface
    const hemiH = (this.hemi.intensity * 0.5 * (luminance(this.hemi.color.toArray()) + luminance(this.hemi.groundColor.toArray()))) / Math.PI;
    const ambClear = 0.3 * this.skyClear.up * (1 - 0.4 * smooth(0.2, 0.8, sinA));
    const globalClear = (SUN_I * smooth(-0.02, 0.12, sinA) * Math.max(0, sinA)) / Math.PI + ambClear;
    const amb = s.weather === 'clear' ? ambClear : Math.max(0.35 * ambClear, w.global * globalClear - sunH - hemiH);
    this.ambient = amb;
    // under a thick cloud deck the visible sky IS the light source: render it at the ambient level
    const heavy = smooth(0.5, 0.9, skyP.cover);
    this.skyGain = lerp(1, Math.min(1, amb / Math.max(1e-4, this.skyNow.up)), heavy);
    u.skyGain.value = this.skyGain;
    const envSeen = (this.envUp ?? this.skyNow.up) * (this.envGain ?? this.skyGain);
    this.scene.environmentIntensity = Math.min(2, amb / Math.max(1e-4, envSeen));
    const G = sunH + amb + hemiH + (this.moon.intensity * 0.6) / Math.PI;
    this.exposure = Math.max(0.22, Math.min(lerp(1.0, 3.2, day), 0.33 / Math.max(1e-4, G)));
    this.renderer.toneMappingExposure = this.exposure;

    // haze = the sky's own colour near the horizon in the direction you look (log-average across the view)
    camera.getWorldDirection(tmpV);
    const yaw0 = Math.atan2(tmpV.x, tmpV.z), ce = Math.cos(0.05), se = Math.sin(0.05);
    const lg = [0, 0, 0], L = [0, 0, 0];
    for (const off of FOG_DIRS) {
      skyRadiance(skyP, dir, [Math.sin(yaw0 + off) * ce, se, Math.cos(yaw0 + off) * ce], L);
      for (let i = 0; i < 3; i++) lg[i] += Math.log(L[i] * this.skyGain + 1e-5) / FOG_DIRS.length;
    }
    let fr = Math.exp(lg[0]), fg = Math.exp(lg[1]), fb = Math.exp(lg[2]);
    const cap = 1.4 * this.skyNow.up * this.skyGain + 0.02, fl = luminance([fr, fg, fb]);
    if (fl > cap) { fr *= cap / fl; fg *= cap / fl; fb *= cap / fl; }
    const fc = this.state.fogColor.setRGB(Math.max(fr, 0.011), Math.max(fg, 0.012), Math.max(fb, 0.018));
    // bloom must not catch the sky itself
    this.bloomThreshold = Math.max(1.25 / this.exposure, luminance(fc.toArray()) * 1.6, this.skyNow.up * this.skyGain * 1.8);
    if (s.fog) {
      if (!this.scene.fog) this.scene.fog = new THREE.FogExp2(fc.getHex(), 0.0005);
      this.scene.fog.color.copy(fc);
      const alt = camera.position.y - (this.groundY || 0);
      this.scene.fog.density = (w.fog * (1 - 0.45 * smooth(60, 600, alt))) / Math.max(400, s.viewDistance);
    } else this.scene.fog = null;

    // stars, rain, wetness, night lights
    // stars only once it is properly dark (nautical dusk); city light hides the faint ones
    this.starMat.uniforms.uAlpha.value = smooth(-0.1, -0.21, sinA) * (1 - w.cover) * 0.7;
    this.rain.visible = w.rain > 0;
    this.rainMat.uniforms.uI.value = w.rain;
    this.wet += ((w.wet) - this.wet) * Math.min(1, dt * (w.wet > this.wet ? 0.5 : 0.05));
    U.uWet.value = this.wet;
    U.uNight.value = Math.max(night, w.cover > 0.9 ? smooth(0.25, 0.05, sinA) * 0.6 : 0);
    U.uWind.value = s.weather === 'rain' ? 2.2 : s.weather === 'overcast' ? 1.4 : 1;
    U.uLitFrac.value = litFraction(localHour(date));

    // shadows follow the camera
    if (this.sun.castShadow) {
      const cam = this.sun.shadow.camera;
      const r = this.shadowRange || 160;
      if (cam.right !== r) { cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 1600; cam.updateProjectionMatrix(); }
      // snap to shadow texels to avoid shimmering
      const texel = (2 * r) / this.sun.shadow.mapSize.x;
      this.sun.target.position.x = Math.round(target.x / texel) * texel;
      this.sun.target.position.z = Math.round(target.z / texel) * texel;
      this.sun.position.set(this.sun.target.position.x + dir[0] * 600, this.sun.target.position.y + Math.max(0.05, dir[1]) * 600, this.sun.target.position.z + dir[2] * 600);
    }

    // refresh reflections when the sky changed noticeably
    const envKey = `${Math.round(altitude * 90)}|${Math.round(azimuth * 30)}|${s.weather}|${s.clouds}`;
    const now = performance.now();
    if (envKey !== this.lastEnvKey && now - this.lastEnvAt > 1500) {
      this.lastEnvKey = envKey;
      this.lastEnvAt = now;
      const eu = this.envSky.material.uniforms;
      for (const k of Object.keys(u)) { const v = u[k].value; if (v && v.isVector3) eu[k].value.copy(v); else eu[k].value = v; }
      eu.showSunDisc.value = 0;
      this.envUp = this.skyNow.up;
      this.envGain = this.skyGain;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
  }

  setShadows(enabled, size, range) {
    this.sun.castShadow = enabled;
    this.shadowRange = range;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }
}
