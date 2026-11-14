// Physically based materials with procedural detail (three.js MeshStandardMaterial + shader injection).
//  facade: bricks / plaster / concrete panels / metal ribs / glass curtain walls, window grids per floor,
//          shop fronts, frames, night-time lit windows (random per window), distance-faded to avoid moiré
//  roof:   gravel, clay tiles, metal seams, green roofs, glass
//  road:   asphalt, pavers, setts, gravel, concrete slabs, curbs, ballast, rails, zebra paint; lane markings
//          that fade at junctions; wet-road reflections; optional NetAScore colouring
//  water:  dual scrolling procedural normal maps + PBR reflections of the sky
//  foliage: wind sway, seasonal colours via instance colours
import * as THREE from 'three';
import { RAMP } from '../util.js';

export const U = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uDetail: { value: 1 },
  uWet: { value: 0 },
  uOverlay: { value: 0 },
  uWind: { value: 1 },
  uLitFrac: { value: 0.4 },               // share of windows with the light on (depends on the hour)
  uLampMap: { value: null },              // street-lamp light map (see lamps.js)
  uLampOrigin: { value: new THREE.Vector2() },
  uLampSpan: { value: 640 },
  uLampOn: { value: 0 }
};

// Street-lamp light (lamps.js): sampled per fragment, multiplied by albedo by the caller.
const LAMP_UNIFORMS = () => ({ uLampMap: U.uLampMap, uLampOrigin: U.uLampOrigin, uLampSpan: U.uLampSpan, uLampOn: U.uLampOn });
const LAMP_GLSL = /* glsl */`
uniform sampler2D uLampMap; uniform vec2 uLampOrigin; uniform float uLampSpan; uniform float uLampOn;
const float LAMP_K = 1.9;
vec3 lampLight(vec2 xz, vec3 nW, float hAbove, float wall) {
  if (uLampOn < 0.004) return vec3(0.0);
  vec2 uv = (xz - uLampOrigin) / uLampSpan;
  float edge = smoothstep(0.0, 0.06, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
  if (edge <= 0.0) return vec3(0.0);
  vec4 t = texture2D(uLampMap, uv);
  float I = t.r * t.r * 1.6;
  vec2 dir = t.gb * 2.0 - 1.0;
  float face = wall > 0.5
    ? clamp(dot(normalize(nW.xz + vec2(1e-5)), dir) + 0.12, 0.0, 1.0) * (1.0 - smoothstep(1.5, 11.0, hAbove))
    : max(nW.y, 0.0);
  return vec3(1.0, 0.79, 0.56) * (I * face * edge * uLampOn);
}`;
const LAMP_VERT_HEAD = 'varying vec3 vLW; varying vec3 vLN;';
const LAMP_VERT_MAIN = 'vLW = (modelMatrix * vec4(transformed, 1.0)).xyz; vLN = normalize(mat3(modelMatrix) * objectNormal);';

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexLin = (h) => [1, 3, 5].map(i => srgbToLin(parseInt(h.slice(i, i + 2), 16) / 255));
const v3 = (a) => `vec3(${a.map(x => x.toFixed(4)).join(',')})`;
const RAMP_GLSL = (() => {
  const stops = [];
  for (let i = 0; i < RAMP.length; i += 2) stops.push([RAMP[i], hexLin(RAMP[i + 1])]);
  let s = `vec3 scoreRamp(float t){ t = clamp(t,0.0,1.0); vec3 c = ${v3(stops[0][1])};`;
  for (let i = 1; i < stops.length; i++) s += ` c = mix(c, ${v3(stops[i][1])}, smoothstep(${stops[i - 1][0].toFixed(2)}, ${stops[i][0].toFixed(2)}, t));`;
  return s + ' return c; }';
})();

export const GLSL_LIB = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.0,0.0)), u.x), mix(hash12(i+vec2(0.0,1.0)), hash12(i+vec2(1.0,1.0)), u.x), u.y); }
float fbm3(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; } return s; }
float aastep(float t, float v){ float w = max(fwidth(v), 1e-4) * 0.75; return smoothstep(t - w, t + w, v); }
float boxAA(vec2 p, vec2 lo, vec2 hi){ return aastep(lo.x, p.x) * (1.0 - aastep(hi.x, p.x)) * aastep(lo.y, p.y) * (1.0 - aastep(hi.y, p.y)); }
${RAMP_GLSL}
`;

function inject(mat, { uniforms = {}, vertHead = '', vertMain = '', fragHead = '', afterColor = '', afterRough = '', afterMetal = '', afterEmissive = '', key }) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertHead}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertMain}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_LIB}\n${fragHead}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${afterColor}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${afterRough}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${afterMetal}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${afterEmissive}`);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// ------------------------------------------------------------------ facades
export function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0 });
  return inject(m, {
    key: 'facade-v5',
    uniforms: { uNight: U.uNight, uDetail: U.uDetail, uLitFrac: U.uLitFrac, ...LAMP_UNIFORMS() },
    vertHead: 'attribute vec4 aB; varying vec4 vB; varying vec2 vW; ' + LAMP_VERT_HEAD,
    vertMain: 'vB = aB; vW = uv; ' + LAMP_VERT_MAIN,
    fragHead: 'uniform float uNight; uniform float uDetail; uniform float uLitFrac; varying vec4 vB; varying vec2 vW; varying vec3 vLW; varying vec3 vLN; float gWin = 0.0; float gLit = 0.0; vec3 gLitCol = vec3(1.0, 0.76, 0.5);' + LAMP_GLSL,
    afterColor: /* glsl */`
    {
      float levelH = max(vB.x, 2.4);
      // the building seed arrives as an interpolated vertex attribute with ~1e-7 noise; hash-based choices
      // (lit window, colour, curtains) amplify that noise and flip per pixel when a hash sits near a threshold
      // (stippled windows). Snap it back to the exact value set on the CPU: (seed % 997) / 997.
      float seed = floor(vB.y * 997.0 + 0.5) / 997.0;
      float style = vB.z;
      float wallTop = vB.w;
      vec2 w = vW;
      float fw = max(fwidth(w.x), fwidth(w.y));
      float detail = (1.0 - smoothstep(0.10, 0.45, fw)) * uDetail;
      vec3 base = diffuseColor.rgb;
      bool isGlass = abs(style - 2.0) < 0.5;
      bool isPlain = style > 7.5;
      // --- wall material texture
      if (style < 0.5 || abs(style - 5.0) < 0.5 || abs(style - 6.0) < 0.5) {
        vec2 bp = w / vec2(0.24, 0.075);
        bp.x += mod(floor(bp.y), 2.0) * 0.5;
        vec2 f = fract(bp);
        float near = (1.0 - smoothstep(0.015, 0.05, fw)) * uDetail;
        float mortar = 1.0 - boxAA(f, vec2(0.04, 0.12), vec2(0.96, 0.88));
        base *= mix(1.0, 0.86 + 0.28 * hash12(floor(bp) + seed * 17.0), near * 0.8);
        base = mix(base, base * 0.55 + vec3(0.18), mortar * near * 0.6);
        base *= 0.92 + 0.12 * vnoise(w * vec2(0.35, 0.9) + seed);
      } else if (abs(style - 1.0) < 0.5 || abs(style - 7.0) < 0.5) {
        base *= 0.93 + 0.1 * fbm3(w * 1.7 + seed * 3.0);
        base *= mix(1.0, 0.82, (1.0 - smoothstep(0.0, 0.55, w.y)) * 0.6);
      } else if (abs(style - 3.0) < 0.5) {
        vec2 pp = fract(w / vec2(3.0, levelH));
        float seam = 1.0 - boxAA(pp, vec2(0.006, 0.01), vec2(0.994, 0.99));
        base *= (1.0 - seam * 0.3 * detail) * (0.92 + 0.12 * vnoise(w * 0.8 + seed));
      } else if (abs(style - 4.0) < 0.5) {
        base *= 0.9 + 0.1 * sin(w.x * 6.2832 / 0.22);
        base *= 0.95 + 0.08 * vnoise(w * vec2(0.2, 1.5) + seed);
      }
      // --- windows
      float colW = isGlass ? 1.5 : (2.3 + fract(seed * 7.13) * 0.9);
      float floorIdx = floor(w.y / levelH);
      float fy = fract(w.y / levelH);
      float colIdx = floor(w.x / colW);
      float fx = fract(w.x / colW);
      float isGround = 1.0 - step(0.5, floorIdx);
      float hasWin = isPlain ? 0.0 : step(w.y, wallTop - 0.65) * step(0.55, w.y);
      vec2 lo = vec2(0.22, 0.30), hi = vec2(0.78, 0.84);
      if (isGlass) { lo = vec2(0.03, 0.05); hi = vec2(0.97, 0.97); }
      else if (abs(style - 7.0) < 0.5 && isGround > 0.5) { lo = vec2(0.05, 0.07); hi = vec2(0.95, 0.88); }
      else if (abs(style - 5.0) < 0.5) { lo = vec2(0.33, 0.20); hi = vec2(0.67, 0.90); }
      else if (abs(style - 4.0) < 0.5) { lo = vec2(0.08, 0.64); hi = vec2(0.92, 0.84); }
      else if (abs(style - 6.0) < 0.5) { lo = vec2(0.25, 0.32); hi = vec2(0.75, 0.80); }
      float cellRnd = hash12(vec2(colIdx, floorIdx) + seed * 13.7);
      // small houses / historic: skip some columns (doors, piers)
      if ((abs(style - 6.0) < 0.5 || abs(style - 5.0) < 0.5) && cellRnd < 0.18) hasWin *= 0.0;
      float win = boxAA(vec2(fx, fy), lo, hi) * hasWin;
      float frame = clamp(boxAA(vec2(fx, fy), lo - vec2(0.035, 0.04), hi + vec2(0.035, 0.04)) - win, 0.0, 1.0) * hasWin;
      float sill = clamp(boxAA(vec2(fx, fy), vec2(lo.x - 0.04, lo.y - 0.07), vec2(hi.x + 0.04, lo.y - 0.03)), 0.0, 1.0) * hasWin * (isGlass ? 0.0 : 1.0);
      vec3 glass = mix(vec3(0.020, 0.028, 0.036), vec3(0.075, 0.09, 0.105), cellRnd);
      if (isGlass) glass = mix(vec3(0.05, 0.075, 0.09), vec3(0.11, 0.14, 0.16), cellRnd);
      vec3 frameCol = isGlass ? vec3(0.08) : vec3(0.78, 0.77, 0.73);
      vec3 detailed = mix(base, frameCol, frame * 0.85);
      detailed = mix(detailed, base * 0.75 + vec3(0.12), sill * 0.6);
      detailed = mix(detailed, glass, win);
      float avgWin = (hi.x - lo.x) * (hi.y - lo.y) * hasWin;
      vec3 far = mix(base, glass, avgWin * 0.75);
      diffuseColor.rgb = mix(far, detailed, detail);
      gWin = mix(avgWin * 0.6, win, detail);
      // lit windows: share depends on the hour; warm incandescent, neutral LED or the blue of a screen; curtains dim some
      float lit = step(1.0 - uLitFrac, hash12(vec2(colIdx * 1.7, floorIdx * 3.1) + seed));
      float tone = hash12(vec2(colIdx * 3.3 + 0.5, floorIdx * 1.9) + seed * 5.0);
      vec3 litCol = tone < 0.6 ? vec3(1.0, 0.66, 0.36) : (tone < 0.88 ? vec3(1.0, 0.84, 0.64) : vec3(0.55, 0.66, 1.0) * 0.55);
      float amt = 0.4 + 0.75 * fract(tone * 7.31);
      // inside the window: ceiling light (brighter at the top), drawn curtains on some
      vec2 wq = clamp((vec2(fx, fy) - lo) / max(hi - lo, vec2(1e-3)), 0.0, 1.0);
      amt *= 0.7 + 0.45 * wq.y;
      float curt = fract(tone * 13.7);
      if (curt < 0.3) amt *= mix(1.0, 0.35, smoothstep(0.62, 0.7, abs(wq.x - 0.5) * 2.0 + 0.3));
      if (isGround > 0.5 && abs(style - 7.0) < 0.5) { lit = step(0.25, cellRnd); amt = 1.25; litCol = vec3(1.0, 0.9, 0.76); } // shop windows
      gLitCol = mix(vec3(1.0, 0.76, 0.5), litCol, detail);
      gLit = mix(avgWin * uLitFrac * 0.7, win * lit * amt, detail) * hasWin;
      // plinth / ground contact darkening
      diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 0.7, w.y));
    }`,
    // glass is a smooth dielectric: it shows sky reflections through Fresnel, not a metallic sheen
    afterRough: 'roughnessFactor = mix(roughnessFactor, 0.06, gWin);',
    afterMetal: 'metalnessFactor = mix(metalnessFactor, 0.0, gWin);',
    afterEmissive: 'totalEmissiveRadiance += gLit * gLitCol * 0.95 * uNight; totalEmissiveRadiance += diffuseColor.rgb * lampLight(vLW.xz, normalize(vLN), vW.y, 1.0) * LAMP_K;'
  });
}

// ------------------------------------------------------------------ roofs
export function roofMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
  return inject(m, {
    key: 'roof-v2',
    uniforms: { uDetail: U.uDetail, uWet: U.uWet },
    vertHead: 'attribute float aRf; varying float vRf; varying vec2 vR;',
    vertMain: 'vRf = aRf; vR = uv;',
    fragHead: 'uniform float uDetail; uniform float uWet; varying float vRf; varying vec2 vR; float gRough = 0.9; float gMetal = 0.0;',
    afterColor: /* glsl */`
    {
      vec2 r = vR;
      float fw = max(fwidth(r.x), fwidth(r.y));
      float detail = (1.0 - smoothstep(0.05, 0.3, fw)) * uDetail;
      vec3 c = diffuseColor.rgb;
      if (vRf < 0.5) {            // flat: gravel / membrane
        c *= 0.82 + 0.3 * fbm3(r * 1.3) ;
        c *= 0.9 + 0.12 * hash12(floor(r * 9.0));
        gRough = 0.95;
      } else if (vRf < 1.5) {     // clay / concrete tiles: rows up the slope
        float row = fract(r.y / 0.32);
        vec2 tp = vec2(r.x / 0.27 + mod(floor(r.y / 0.32), 2.0) * 0.5, r.y / 0.32);
        float groove = 1.0 - aastep(0.12, row);
        float joint = 1.0 - boxAA(fract(tp), vec2(0.04, 0.0), vec2(0.96, 1.0));
        c *= mix(1.0, 0.86 + 0.24 * hash12(floor(tp)), detail);
        c *= 1.0 - (groove * 0.35 + joint * 0.15) * detail;
        c *= 0.92 + 0.1 * vnoise(r * 0.6);
        gRough = 0.8;
      } else if (vRf < 2.5) {     // metal standing seam
        float seam = 1.0 - aastep(0.04, fract(r.x / 0.5));
        c *= 1.0 - seam * 0.25 * detail; c *= 0.95 + 0.06 * vnoise(r * vec2(0.2, 2.0));
        gRough = 0.45; gMetal = 0.6;
      } else if (vRf < 3.5) {     // green roof
        c *= 0.75 + 0.5 * fbm3(r * 2.1);
        gRough = 1.0;
      } else {                    // glass
        float mull = 1.0 - boxAA(fract(r / vec2(1.2, 1.6)), vec2(0.03), vec2(0.97));
        c = mix(vec3(0.06, 0.08, 0.09), vec3(0.2), mull);
        gRough = mix(0.08, 0.5, mull); gMetal = 0.3;
      }
      c *= mix(1.0, 0.6, uWet);
      gRough = mix(gRough, 0.2, uWet * 0.8);
      diffuseColor.rgb = c;
    }`,
    afterRough: 'roughnessFactor = gRough;',
    afterMetal: 'metalnessFactor = gMetal;'
  });
}

// ------------------------------------------------------------------ roads & paved surfaces
export function roadMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  return inject(m, {
    key: 'road-v4',
    uniforms: { uWet: U.uWet, uOverlay: U.uOverlay, uDetail: U.uDetail, ...LAMP_UNIFORMS() },
    vertHead: 'attribute vec4 aRd; attribute vec2 aSc; varying vec4 vRd; varying vec2 vSc; varying vec2 vRU; ' + LAMP_VERT_HEAD,
    vertMain: 'vRd = aRd; vSc = aSc; vRU = uv; ' + LAMP_VERT_MAIN,
    fragHead: 'uniform float uWet; uniform float uOverlay; uniform float uDetail; varying vec4 vRd; varying vec2 vSc; varying vec2 vRU; varying vec3 vLW; varying vec3 vLN; float gRough = 0.85; float gMetal = 0.0; vec3 gOverlay = vec3(0.0);' + LAMP_GLSL,
    afterColor: /* glsl */`
    {
      float w = vRd.x, hw = w * 0.5, ms = vRd.y, surf = vRd.z, jd = vRd.w;
      float u = vRU.x, v = vRU.y;
      float fw = max(fwidth(u), fwidth(v));
      float detail = (1.0 - smoothstep(0.04, 0.25, fw)) * uDetail;
      float n1 = fbm3(vec2(u, v) * 1.7);
      float n2 = vnoise(vec2(u, v) * 19.0);
      vec3 c;
      if (surf < 0.5 || abs(surf - 5.0) < 0.5) {
        c = vec3(0.074, 0.075, 0.079) * (0.8 + 0.45 * n1) + 0.014 * n2;
        c *= 1.0 - 0.14 * smoothstep(0.62, 0.9, vnoise(vec2(u * 0.35, v * 0.045)));
        c += 0.03 * smoothstep(0.86, 0.97, vnoise(vec2(u * 0.9, v * 0.11))); // repaired patches
        if (abs(surf - 5.0) < 0.5) c *= vec3(1.06, 1.0, 0.97);
      } else if (abs(surf - 1.0) < 0.5) {
        vec2 p = vec2(v, u) / vec2(0.20, 0.10); p.x += mod(floor(p.y), 2.0) * 0.5;
        float joint = 1.0 - boxAA(fract(p), vec2(0.05, 0.09), vec2(0.95, 0.91));
        c = mix(vec3(0.22, 0.205, 0.19), vec3(0.32, 0.30, 0.28), hash12(floor(p)));
        c = mix(c, vec3(0.06), joint * 0.7 * detail);
        gRough = 0.8;
      } else if (abs(surf - 2.0) < 0.5) {
        vec2 p = vec2(v, u) / 0.13; p.x += mod(floor(p.y), 2.0) * 0.37;
        float joint = 1.0 - boxAA(fract(p), vec2(0.1), vec2(0.9));
        c = mix(vec3(0.13, 0.13, 0.135), vec3(0.24, 0.23, 0.22), hash12(floor(p)));
        c = mix(c, vec3(0.04), joint * 0.8 * detail);
        gRough = 0.7;
      } else if (abs(surf - 3.0) < 0.5) {
        c = vec3(0.30, 0.26, 0.20) * (0.72 + 0.55 * n2) * (0.9 + 0.2 * n1);
        gRough = 1.0;
      } else if (abs(surf - 4.0) < 0.5) {
        vec2 cell = vec2(v, u) / 0.625;
        float joint = 1.0 - boxAA(fract(cell), vec2(0.02), vec2(0.98));
        c = vec3(0.34, 0.335, 0.32) * (0.88 + 0.16 * hash12(floor(cell))) * (0.9 + 0.15 * n1);
        c = mix(c, vec3(0.15), joint * 0.55 * detail);
        gRough = 0.9;
      } else if (abs(surf - 6.0) < 0.5) {
        c = vec3(0.36, 0.36, 0.35) * (0.85 + 0.25 * n2);
        gRough = 0.75;
      } else if (abs(surf - 7.0) < 0.5) {
        c = vec3(0.17, 0.155, 0.14) * (0.65 + 0.7 * n2);
        gRough = 1.0;
      } else if (abs(surf - 8.0) < 0.5) {
        c = vec3(0.42, 0.42, 0.44); gRough = 0.3; gMetal = 0.9;
      } else if (abs(surf - 9.0) < 0.5) {
        c = vec3(0.72, 0.72, 0.70) * (0.85 + 0.15 * n2); gRough = 0.6;
      } else {
        c = vec3(0.30, 0.30, 0.29) * (0.85 + 0.2 * n1);
      }
      // lane markings (bit flags: 1 centre dashed, 2 centre double solid, 4 edge lines, 8 cycle lanes)
      float cd = mod(ms, 2.0), cs = mod(floor(ms / 2.0), 2.0), ed = mod(floor(ms / 4.0), 2.0), cy = mod(floor(ms / 8.0), 2.0);
      float mk = 0.0;
      if (cd > 0.5) mk = max(mk, (1.0 - aastep(0.06, abs(u))) * (1.0 - aastep(0.333, fract(v / 9.0))));
      if (cs > 0.5) mk = max(mk, 1.0 - aastep(0.05, abs(abs(u) - 0.12)));
      if (ed > 0.5) mk = max(mk, 1.0 - aastep(0.06, abs(abs(u) - (hw - 0.3))));
      if (cy > 0.5) mk = max(mk, 1.0 - aastep(0.15, abs(abs(u) - (hw - 1.8))));
      mk *= smoothstep(3.0, 7.0, jd) * (0.75 + 0.25 * n2);
      c = mix(c, vec3(0.62, 0.62, 0.6), mk);
      if (uOverlay > 0.5 && surf < 7.5) {
        float s = uOverlay < 1.5 ? vSc.x : vSc.y;
        vec3 oc = s < -0.5 ? vec3(0.1) : scoreRamp(s) * 0.8;
        c = mix(c, oc, 0.85);
        gOverlay = s < -0.5 ? vec3(0.0) : oc;
      }
      c *= mix(1.0, 0.5, uWet);
      gRough = mix(gRough, 0.12, uWet * (surf < 6.5 ? 1.0 : 0.3));
      diffuseColor.rgb = c;
    }`,
    afterRough: 'roughnessFactor = gRough;',
    afterMetal: 'metalnessFactor = gMetal;',
    // lamp light: diffuse on the surface, plus a glossy streak on wet streets
    // + a faint glow of the NetAScore colours so they stay readable in shade and at night
    afterEmissive: '{ vec3 L = lampLight(vLW.xz, vec3(0.0, 1.0, 0.0), 0.0, 0.0); totalEmissiveRadiance += L * (diffuseColor.rgb * LAMP_K + 0.09 * uWet) + gOverlay * 0.06; }'
  });
}

// ------------------------------------------------------------------ terrain
export function terrainMaterial(map) {
  if (map) {
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.96, metalness: 0 });
    return inject(m, {
      key: 'terrain-img-v2', uniforms: { uWet: U.uWet, ...LAMP_UNIFORMS() },
      vertHead: LAMP_VERT_HEAD, vertMain: LAMP_VERT_MAIN,
      fragHead: 'uniform float uWet; varying vec3 vLW; varying vec3 vLN;' + LAMP_GLSL,
      afterColor: 'diffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.06)) * 1.05; diffuseColor.rgb *= mix(1.0, 0.75, uWet);',
      afterEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * lampLight(vLW.xz, vec3(0.0, 1.0, 0.0), 0.0, 0.0) * LAMP_K;'
    });
  }
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  return inject(m, {
    key: 'terrain-sty-v2',
    uniforms: { ...LAMP_UNIFORMS() },
    vertHead: 'varying vec3 vTW; ' + LAMP_VERT_HEAD,
    vertMain: 'vTW = (modelMatrix * vec4(transformed, 1.0)).xyz; ' + LAMP_VERT_MAIN,
    fragHead: 'varying vec3 vTW; varying vec3 vLW; varying vec3 vLN;' + LAMP_GLSL,
    afterColor: 'diffuseColor.rgb *= 0.8 + 0.35 * fbm3(vTW.xz * 0.25) * (0.85 + 0.15 * vnoise(vTW.xz * 3.0));',
    afterEmissive: 'totalEmissiveRadiance += diffuseColor.rgb * lampLight(vLW.xz, vec3(0.0, 1.0, 0.0), 0.0, 0.0) * LAMP_K;'
  });
}

// ------------------------------------------------------------------ water
function makeWaterNormals(size = 256) {
  const h = new Float32Array(size * size);
  const rnd = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const octave = (freq, amp) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * freq, fy = (y / size) * freq;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const w = (a) => ((a % freq) + freq) % freq;
      const g = (ix, iy) => rnd(w(ix), w(iy));
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      h[y * size + x] += amp * ((g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy);
    }
  };
  octave(8, 1); octave(16, 0.5); octave(32, 0.25); octave(64, 0.12);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
    let nx = (l - r) * 2.2, ny = (d - u) * 2.2, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * size + x) * 4;
    data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
let waterNormals = null;

export function waterMaterial() {
  if (!waterNormals) waterNormals = makeWaterNormals();
  const m = new THREE.MeshStandardMaterial({ color: 0x0e2733, roughness: 0.05, metalness: 0.0, normalMap: waterNormals, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2, transparent: true, opacity: 0.94 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 n1 = texture2D(normalMap, vNormalMapUv * 1.0 + uTime * vec2(0.010, 0.006)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, vNormalMapUv * 0.37 - uTime * vec2(0.006, -0.009)).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(vec3(n1.xy + n2.xy, n1.z * n2.z));
          mapN.xy *= normalScale;
          normal = normalize(tbn * mapN);
        #endif`);
  };
  m.customProgramCacheKey = () => 'water-v2';
  return m;
}

// ------------------------------------------------------------------ vegetation
export function foliageMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  return inject(m, {
    key: 'foliage-v2',
    uniforms: { uTime: U.uTime, uWind: U.uWind },
    vertHead: 'uniform float uTime; uniform float uWind; varying float vFh;',
    vertMain: /* glsl */`
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
        float ph = ip.x * 0.21 + ip.z * 0.17;
        float sway = (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25) * 0.05 * uWind;
        transformed.x += sway * max(0.0, transformed.y);
        transformed.z += sway * 0.6 * max(0.0, transformed.y);
      #endif
      vFh = transformed.y;`,
    fragHead: 'varying float vFh;',
    afterColor: 'diffuseColor.rgb *= 0.72 + 0.35 * clamp(vFh, 0.0, 1.0);'
  });
}

export function emissiveMaterial(color, intensity = 3) {
  const m = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: new THREE.Color(color), emissiveIntensity: 0.0, roughness: 0.4 });
  m.userData.nightIntensity = intensity;
  return m;
}
