// Street lighting at night. Every lamp head (OSM highway=street_lamp nodes, or illustrative lamps along lit
// streets) is splatted into a camera-centred light map: R = illuminance (point source at ~6 m, cos³ law),
// G/B = mean horizontal direction towards the lamps. Ground, street and facade shaders sample it and add
// albedo × lamp light, so pools look right on dark asphalt and pale paving alike, and only walls that face a
// lamp are lit. (Replaces the earlier additive "light pool" decals, which washed streets out.)
import * as THREE from 'three';
import { U } from './materials.js';

export const SIZE = 320;   // texels per side
export const SPAN = 640;   // metres covered (2 m per texel; pools are ~30 m wide, bilinear filtering smooths them)
const REACH = 22;          // metres of useful light around a lamp
const H2 = 7.0 * 7.0;      // mounting height² (wider, LED street optics)
const SNAP = 32;           // re-centre in 32 m steps
const PX = SPAN / SIZE;
const K = Math.ceil(REACH / PX);

// one precomputed stamp (illuminance + direction to the lamp) for a lamp at a texel centre: no per-texel maths
const STAMP = (() => {
  const n = 2 * K + 1, F = new Float32Array(n * n), FX = new Float32Array(n * n), FZ = new Float32Array(n * n);
  for (let dj = -K; dj <= K; dj++) for (let di = -K; di <= K; di++) {
    const dx = -di * PX, dz = -dj * PX, d2 = dx * dx + dz * dz;
    if (d2 >= REACH * REACH) continue;
    const q = H2 / (H2 + d2), fade = 1 - d2 / (REACH * REACH);
    const f = q * Math.sqrt(q) * fade * fade;   // cos³ falloff, faded to 0 at REACH
    const d = Math.sqrt(d2) || 1, o = (dj + K) * n + (di + K);
    F[o] = f; FX[o] = d2 ? (f * dx) / d : 0; FZ[o] = d2 ? (f * dz) / d : 0;
  }
  return { n, F, FX, FZ };
})();

export class LampField {
  constructor() {
    this.byChunk = new Map();
    this.acc = new Float32Array(SIZE * SIZE * 3);
    this.data = new Uint8Array(SIZE * SIZE * 4);
    this.tex = new THREE.DataTexture(this.data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
    U.uLampMap.value = this.tex;
    U.uLampSpan.value = SPAN;
    this.cx = Infinity; this.cz = Infinity;
    this.dirty = false;
    this.lastSplat = 0;
    this.count = 0;
  }

  /** @param {Array<{x:number,z:number,i?:number}>} lamps lamp-head positions (three.js x/z) */
  set(chunkKey, lamps) {
    if (lamps && lamps.length) this.byChunk.set(chunkKey, lamps); else if (!this.byChunk.delete(chunkKey)) return;
    this.dirty = true;
  }

  remove(chunkKey) { if (this.byChunk.delete(chunkKey)) this.dirty = true; }
  clear() { this.byChunk.clear(); this.dirty = true; }

  /** Re-splat when the camera left the central part of the map or lamps changed (throttled). Only at night. */
  update(camX, camZ, lampOn) {
    if (lampOn <= 0.004) return false;
    const now = performance.now();
    const far = Math.max(Math.abs(camX - this.cx), Math.abs(camZ - this.cz)) > SPAN * 0.2;
    if (!far && !(this.dirty && now - this.lastSplat > 900)) return false;
    this.splat(Math.round(camX / SNAP) * SNAP, Math.round(camZ / SNAP) * SNAP);
    this.lastSplat = now;
    return true;
  }

  splat(cx, cz) {
    this.cx = cx; this.cz = cz;
    const x0 = cx - SPAN / 2, z0 = cz - SPAN / 2;
    const acc = this.acc, data = this.data, { n, F, FX, FZ } = STAMP;
    acc.fill(0);
    let count = 0;
    for (const lamps of this.byChunk.values()) {
      for (const l of lamps) {
        if (l.x < x0 - REACH || l.x > x0 + SPAN + REACH || l.z < z0 - REACH || l.z > z0 + SPAN + REACH) continue;
        count++;
        const k = l.i || 1;
        const ci = Math.floor((l.x - x0) / PX), cj = Math.floor((l.z - z0) / PX);
        const j0 = Math.max(-K, -cj), j1 = Math.min(K, SIZE - 1 - cj), i0 = Math.max(-K, -ci), i1 = Math.min(K, SIZE - 1 - ci);
        for (let dj = j0; dj <= j1; dj++) {
          let so = (dj + K) * n + (i0 + K), o = ((cj + dj) * SIZE + ci + i0) * 3;
          for (let di = i0; di <= i1; di++, so++, o += 3) {
            const f = F[so];
            if (f === 0) continue;
            acc[o] += f * k; acc[o + 1] += FX[so] * k; acc[o + 2] += FZ[so] * k;
          }
        }
      }
    }
    for (let p = 0, o = 0, b = 0; p < SIZE * SIZE; p++, o += 3, b += 4) {
      const I = acc[o];
      data[b] = Math.min(255, Math.round(Math.sqrt(I / 1.6) * 255));
      if (I > 1e-4) {
        data[b + 1] = Math.round((Math.max(-1, Math.min(1, acc[o + 1] / I)) * 0.5 + 0.5) * 255);
        data[b + 2] = Math.round((Math.max(-1, Math.min(1, acc[o + 2] / I)) * 0.5 + 0.5) * 255);
      } else { data[b + 1] = 128; data[b + 2] = 128; }
      data[b + 3] = 255;
    }
    this.tex.needsUpdate = true;
    U.uLampOrigin.value.set(x0, z0);
    this.count = count;
    this.dirty = false;
  }

  dispose() { this.tex.dispose(); }
}

/** Lamp-head position for a lamp prop item (arm along the item's local +x, 1.15 m out). */
export function lampHead(it) {
  const r = it.rot || 0;
  return { x: it.x + Math.cos(r) * 1.15, z: it.z - Math.sin(r) * 1.15, i: it.auto ? 0.9 : 1 };
}
