// Pure geometry builders for streets, paths, sidewalks, curbs, crossings, rails, barriers, water and terrain.
// Coordinates: local metres, x = east, y = up, z = south. Polylines are given as [east, north] pairs.
import earcut from 'earcut';
import { Acc } from './buildings.js';

export const ROAD_ATTRS = [['position', 3], ['normal', 3], ['uv', 2], ['aRd', 4], ['aSc', 2], ['aRid', 1]];
export const SIMPLE_ATTRS = [['position', 3], ['normal', 3], ['uv', 2]];
export const SURF = { asphalt: 0, pavers: 1, sett: 2, gravel: 3, slabs: 4, cycle: 5, curb: 6, ballast: 7, rail: 8, paint: 9, deck: 10 };

/** Densify a polyline so no segment is longer than maxLen metres. Keeps original vertex flags. */
export function densify(pts, maxLen = 5, flags = null) {
  const out = [], outFlags = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const a = pts[i - 1], b = pts[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.floor(d / maxLen);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        outFlags.push(0);
      }
    }
    out.push(pts[i]);
    outFlags.push(flags ? flags[i] : 0);
  }
  return { pts: out, flags: outFlags };
}

/** Cumulative distances and per-point distance to the nearest flagged point (junction). */
export function measures(pts, flags) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const junc = new Array(pts.length).fill(1e6);
  const js = [];
  flags.forEach((f, i) => { if (f) js.push(cum[i]); });
  if (js.length) for (let i = 0; i < pts.length; i++) { let m = 1e6; for (const s of js) m = Math.min(m, Math.abs(cum[i] - s)); junc[i] = m; }
  return { cum, junc };
}

/** Part of a polyline between distances a and b along it (exact end points); cum restarts at 0. */
export function slicePolyline(pts, cum, a, b) {
  const at = (s) => {
    let k = 1;
    while (k < cum.length - 1 && cum[k] < s) k++;
    const t = Math.max(0, Math.min(1, (s - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1)));
    return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t];
  };
  const out = [at(a)], oc = [0];
  for (let i = 0; i < pts.length; i++) if (cum[i] > a + 0.05 && cum[i] < b - 0.05) { out.push(pts[i]); oc.push(cum[i] - a); }
  out.push(at(b)); oc.push(b - a);
  return { pts: out, cum: oc };
}

/** [0, total] minus the gaps → the intervals that remain (longer than minLen). */
export function keepIntervals(total, gaps, minLen = 0.8) {
  const g = gaps.map(([a, b]) => [Math.max(0, a), Math.min(total, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out = [];
  let s = 0;
  for (const [a, b] of g) { if (a - s >= minLen) out.push([s, a]); s = Math.max(s, b); }
  if (total - s >= minLen) out.push([s, total]);
  return out;
}

/** Left-pointing miter vectors (unit-ish, scaled so that offsets keep constant width) for each point. */
export function miters(pts) {
  const n = pts.length;
  const out = [];
  const segN = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dy) || 1;
    segN.push([-dy / l, dx / l]); // left normal
  }
  for (let i = 0; i < n; i++) {
    const a = segN[Math.max(0, i - 1)], b = segN[Math.min(n - 2, i)];
    let mx = a[0] + b[0], my = a[1] + b[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { out.push(b.slice()); continue; }
    mx /= ml; my /= ml;
    const cos = mx * b[0] + my * b[1];
    const scale = Math.min(2.5, 1 / Math.max(0.4, cos));
    out.push([mx * scale, my * scale]);
  }
  return out;
}

/**
 * Add a ribbon (road, sidewalk, cycle track, rail …) along a polyline.
 * @param {Acc} acc
 * @param {object} o { pts, mit, cum, junc, ys(i, side, e, n)->y, width, offset, surface, mark, scores, rid, vOffset }
 */
export function addRibbon(acc, o) {
  const { pts, mit, cum, junc, width, offset = 0, surface = 0, mark = 0, scores = [-1, -1], rid = -1 } = o;
  const hw = width / 2;
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], m = mit[i];
    const le = [p[0] + m[0] * (offset + hw), p[1] + m[1] * (offset + hw)];
    const re = [p[0] + m[0] * (offset - hw), p[1] + m[1] * (offset - hw)];
    L.push([le[0], o.ys(i, 1, le[0], le[1]), -le[1]]);
    R.push([re[0], o.ys(i, -1, re[0], re[1]), -re[1]]);
  }
  const base = acc.count;
  for (let i = 0; i < pts.length; i++) {
    const f = sub3(i < pts.length - 1 ? mid3(L[i + 1], R[i + 1]) : mid3(L[i], R[i]), i > 0 ? mid3(L[i - 1], R[i - 1]) : mid3(L[i], R[i]));
    const s = sub3(L[i], R[i]);
    let n = normalize3(cross3(s, f));
    if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
    if (!Number.isFinite(n[0])) n = [0, 1, 0];
    const v = cum[i] + (o.vOffset || 0);
    acc.v(...R[i], ...n, -hw, v, width, mark, surface, junc[i], scores[0], scores[1], rid);
    acc.v(...L[i], ...n, hw, v, width, mark, surface, junc[i], scores[0], scores[1], rid);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const r0 = base + i * 2, l0 = r0 + 1, r1 = r0 + 2, l1 = r0 + 3;
    acc.tri(r0, r1, l1);
    acc.tri(r0, l1, l0);
  }
  return { L, R };
}

/** Vertical strip (curb face, rail side, bridge side) between two 3D polylines (top & bottom), facing `side`. */
export function addSideStrip(acc, top, bottom, o) {
  const base = acc.count;
  const { surface = SURF.curb, width = 0.2, rid = -1, scores = [-1, -1] } = o;
  for (let i = 0; i < top.length; i++) {
    const a = top[Math.min(top.length - 1, i + 1)], b = top[Math.max(0, i - 1)];
    const f = [a[0] - b[0], 0, a[2] - b[2]];
    let n = normalize3([f[2] * o.side, 0, -f[0] * o.side]);
    if (!Number.isFinite(n[0])) n = [0, 0, 1];
    const v = o.cum[i];
    acc.v(...bottom[i], ...n, -width / 2, v, width, 0, surface, 1e6, scores[0], scores[1], rid);
    acc.v(...top[i], ...n, width / 2, v, width, 0, surface, 1e6, scores[0], scores[1], rid);
  }
  for (let i = 0; i < top.length - 1; i++) {
    const b0 = base + i * 2, t0 = b0 + 1, b1 = b0 + 2, t1 = b0 + 3;
    // front face towards n: choose winding by side
    if (o.side > 0) { acc.tri(b0, t1, b1); acc.tri(b0, t0, t1); } else { acc.tri(b0, b1, t1); acc.tri(b0, t1, t0); }
  }
}

/** Zebra crossing stripes centred at point p (east,north) across a road with direction dir (unit, east/north). */
export function addZebra(acc, p, dir, width, y, rid = -1) {
  const left = [-dir[1], dir[0]];
  const along = 1.5; // half length of each stripe along the road (3 m crossing)
  const n = [0, 1, 0];
  for (let off = -width / 2 + 0.55; off <= width / 2 - 0.3; off += 1.0) {
    const c = [p[0] + left[0] * off, p[1] + left[1] * off];
    const q = (a, b) => [c[0] + dir[0] * a + left[0] * b, y, -(c[1] + dir[1] * a + left[1] * b)];
    const i0 = acc.v(...q(-along, -0.25), ...n, -0.25, 0, 0.5, 0, SURF.paint, 1e6, -1, -1, rid);
    const i1 = acc.v(...q(along, -0.25), ...n, -0.25, 3, 0.5, 0, SURF.paint, 1e6, -1, -1, rid);
    const i2 = acc.v(...q(along, 0.25), ...n, 0.25, 3, 0.5, 0, SURF.paint, 1e6, -1, -1, rid);
    const i3 = acc.v(...q(-along, 0.25), ...n, 0.25, 0, 0.5, 0, SURF.paint, 1e6, -1, -1, rid);
    // ensure upward winding
    const a = q(-along, -0.25), b = q(along, -0.25), cc = q(along, 0.25);
    const up = cross3(sub3(b, a), sub3(cc, a))[1] > 0;
    if (up) { acc.tri(i0, i1, i2); acc.tri(i0, i2, i3); } else { acc.tri(i0, i2, i1); acc.tri(i0, i3, i2); }
  }
}

/** Flat water polygon(s) at height y. rings in (east,north). */
export function addWaterPolygon(acc, rings, y, uvScale = 0.06) {
  const flat = [], holes = [];
  rings.forEach((r, k) => {
    const rr = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r;
    if (k > 0) holes.push(flat.length / 2);
    for (const p of rr) flat.push(p[0], p[1]);
  });
  const tris = earcut(flat, holes.length ? holes : undefined, 2);
  const base = acc.count;
  for (let i = 0; i < flat.length / 2; i++) acc.v(flat[i * 2], y, -flat[i * 2 + 1], 0, 1, 0, flat[i * 2] * uvScale, flat[i * 2 + 1] * uvScale);
  for (let i = 0; i < tris.length; i += 3) {
    const a = base + tris[i], b = base + tris[i + 1], c = base + tris[i + 2];
    // upward winding: (x, -north) plane — test with first triangle orientation
    const ax = flat[tris[i] * 2], ay = flat[tris[i] * 2 + 1], bx = flat[tris[i + 1] * 2], by = flat[tris[i + 1] * 2 + 1], cx = flat[tris[i + 2] * 2], cy = flat[tris[i + 2] * 2 + 1];
    const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) > 0; // CCW in (east,north) = upward in 3D
    if (ccw) acc.tri(a, b, c); else acc.tri(a, c, b);
  }
}

/**
 * Terrain grid for a square chunk.
 * @param {object} o { x0, n0 (south-west corner, east/north), size, seg, hAt(e,n), uvAt(e,n)->[u,v], colorAt?(e,n)->[r,g,b], skirt }
 */
export function buildTerrain(o) {
  const attrs = o.colorAt ? [...SIMPLE_ATTRS, ['color', 3]] : SIMPLE_ATTRS;
  const acc = new Acc(attrs);
  const N = o.seg;
  const step = o.size / N;
  // heights on an extended grid (one extra ring outside the chunk) so normals are exact at chunk borders
  const M = N + 3;
  const H = new Float64Array(M * M);
  for (let j = -1; j <= N + 1; j++) for (let i = -1; i <= N + 1; i++) H[(j + 1) * M + (i + 1)] = o.hAt(o.x0 + i * step, o.n0 + j * step);
  const h = (i, j) => H[(Math.min(N + 1, Math.max(-1, j)) + 1) * M + (Math.min(N + 1, Math.max(-1, i)) + 1)];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const e = o.x0 + i * step, n = o.n0 + j * step;
    // central differences (east/north) → normal in (x, y, z=-north)
    const dhde = (h(i + 1, j) - h(i - 1, j)) / (2 * step);
    const dhdn = (h(i, j + 1) - h(i, j - 1)) / (2 * step);
    const nrm = normalize3([-dhde, 1, dhdn]);
    const uv = o.uvAt(e, n);
    if (o.colorAt) acc.v(e, h(i, j), -n, ...nrm, ...uv, ...o.colorAt(e, n)); else acc.v(e, h(i, j), -n, ...nrm, ...uv);
  }
  const idx = (i, j) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1);
    // (east,north) CCW: a(sw) b(se) c(ne) d(nw) → upward
    acc.tri(a, b, c); acc.tri(a, c, d);
  }
  // skirts hide cracks between neighbouring chunks of different resolution
  if (o.skirt) {
    const edge = (list) => {
      const base = acc.count;
      for (const [i, j] of list) {
        const e = o.x0 + i * step, n = o.n0 + j * step;
        const uv = o.uvAt(e, n);
        if (o.colorAt) acc.v(e, h(i, j) - o.skirt, -n, 0, 1, 0, ...uv, ...o.colorAt(e, n)); else acc.v(e, h(i, j) - o.skirt, -n, 0, 1, 0, ...uv);
      }
      for (let k = 0; k < list.length - 1; k++) {
        const t0 = idx(...list[k]), t1 = idx(...list[k + 1]), b0 = base + k, b1 = base + k + 1;
        acc.tri(t0, b0, b1); acc.tri(t0, b1, t1);
        acc.tri(t0, b1, b0); acc.tri(t0, t1, b1); // double-sided
      }
    };
    const s = [], e = [], n = [], w = [];
    for (let i = 0; i <= N; i++) { s.push([i, 0]); n.push([i, N]); w.push([0, i]); e.push([N, i]); }
    edge(s); edge(n); edge(w); edge(e);
  }
  return acc;
}

// ------------------------------------------------------------------ tiny vector helpers
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function mid3(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize3(a) { const l = Math.hypot(a[0], a[1], a[2]); return l ? [a[0] / l, a[1] / l, a[2] / l] : [NaN, NaN, NaN]; }
export { sub3, cross3, normalize3 };
