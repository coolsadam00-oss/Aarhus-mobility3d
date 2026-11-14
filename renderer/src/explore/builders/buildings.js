// Pure geometry builder for buildings (no three.js dependency → unit-testable in Node).
// Coordinates: local metres, x = east, y = up, z = south (= -north). Input rings are (east, north) pairs.
import earcut from 'earcut';

export class Acc {
  constructor(attrs) { this.attrs = attrs; this.data = {}; for (const [k] of attrs) this.data[k] = []; this.index = []; this.count = 0; }
  // push one vertex: values per attribute in declared order
  v(...vals) {
    let i = 0;
    for (const [k, size] of this.attrs) { const d = this.data[k]; for (let s = 0; s < size; s++) d.push(vals[i++]); }
    return this.count++;
  }
  tri(a, b, c) { this.index.push(a, b, c); }
  toTyped() {
    const out = { index: this.count > 65535 ? new Uint32Array(this.index) : new Uint16Array(this.index), count: this.count };
    for (const [k] of this.attrs) out[k] = new Float32Array(this.data[k]);
    return out;
  }
}

export const WALL_ATTRS = [['position', 3], ['normal', 3], ['uv', 2], ['color', 3], ['aB', 4], ['aBid', 1]];
export const ROOF_ATTRS = [['position', 3], ['normal', 3], ['uv', 2], ['color', 3], ['aRf', 1], ['aBid', 1]];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function openRing(r) {
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) return r.slice(0, -1);
  return r;
}

/** Add a planar, upward-facing triangle (3D points) to the roof accumulator with per-face normal. */
function roofTri(acc, p0, p1, p2, uvs, col, type, bid) {
  let n = norm(cross(sub(p1, p0), sub(p2, p0)));
  if (n[1] < 0) { [p1, p2] = [p2, p1]; uvs = [uvs[0], uvs[2], uvs[1]]; n = [-n[0], -n[1], -n[2]]; }
  const a = acc.v(...p0, ...n, ...uvs[0], ...col, type, bid);
  const b = acc.v(...p1, ...n, ...uvs[1], ...col, type, bid);
  const c = acc.v(...p2, ...n, ...uvs[2], ...col, type, bid);
  acc.tri(a, b, c);
}

/** Vertical wall quad between 2D points a,b (east,north) from y0 to y1 with outward normal. */
function wallQuad(acc, a, b, y0a, y1a, y0b, y1b, u0, u1, ground, attr, col, bid, flip = false) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let n = [dy / len, 0, dx / len];
  if (flip) n = [-n[0], 0, -n[2]];
  const A0 = acc.v(a[0], y0a, -a[1], ...n, u0, y0a - ground, ...col, ...attr, bid);
  const B0 = acc.v(b[0], y0b, -b[1], ...n, u1, y0b - ground, ...col, ...attr, bid);
  const B1 = acc.v(b[0], y1b, -b[1], ...n, u1, y1b - ground, ...col, ...attr, bid);
  const A1 = acc.v(a[0], y1a, -a[1], ...n, u0, y1a - ground, ...col, ...attr, bid);
  if (!flip) { acc.tri(A0, B0, B1); acc.tri(A0, B1, A1); } else { acc.tri(A0, B1, B0); acc.tri(A0, A1, B1); }
}

/** Triangle wall (gable end) a,b at yBase, apex c at yApex. */
function gableTri(acc, a, b, c, yBase, yApex, ground, attr, col, bid) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const n = [dy / len, 0, dx / len];
  const uc = ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / len;
  const A = acc.v(a[0], yBase, -a[1], ...n, 0, yBase - ground, ...col, ...attr, bid);
  const B = acc.v(b[0], yBase, -b[1], ...n, len, yBase - ground, ...col, ...attr, bid);
  const C = acc.v(c[0], yApex, -c[1], ...n, uc, yApex - ground, ...col, ...attr, bid);
  // orientation: ensure front face points along n (A→B→C must be CCW seen from outside)
  const p0 = [a[0], yBase, -a[1]], p1 = [b[0], yBase, -b[1]], p2 = [c[0], yApex, -c[1]];
  const fn = cross(sub(p1, p0), sub(p2, p0));
  if (fn[0] * n[0] + fn[2] * n[2] >= 0) acc.tri(A, B, C); else acc.tri(A, C, B);
}

/**
 * Build one building into the wall/roof accumulators.
 * @param {object} b { rings:[[[e,n]...]...], yBottom, ground, wallTop, roof:{shape,height}, rect, facade:[r,g,b], roofCol:[r,g,b],
 *                     style, levelH, seed01, roofType, bid, roofOnly, overhang }
 */
export function addBuilding(walls, roofs, b) {
  const outer = openRing(b.rings[0]);
  if (outer.length < 3) return;
  const holes = b.rings.slice(1).map(openRing).filter(r => r.length >= 3);
  const attr = [b.levelH, b.seed01, b.style, b.wallTop - b.ground];
  const shape = b.roof ? b.roof.shape : 'flat';
  const rh = b.roof ? b.roof.height : 0;

  // ---------- walls (outer + courtyards). Taller flat-roofed buildings get a 0.55 m parapet: the facade
  // continues up to the parapet top and an inward-facing strip closes it from the roof side.
  const parapet = !b.roofOnly && shape === 'flat' && b.wallTop - b.ground > 7 && outer.length <= 40 ? 0.55 : 0;
  if (!b.roofOnly) {
    for (const ring of [outer, ...holes]) {
      let u = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 0.05) continue;
        wallQuad(walls, a, c, b.yBottom, b.wallTop + parapet, b.yBottom, b.wallTop + parapet, u, u + len, b.ground, attr, b.facade, b.bid);
        u += len;
      }
    }
  }

  // ---------- roofs
  const top = b.wallTop;
  const rc = b.roofCol;
  const rt = b.roofType;
  if ((shape === 'gabled' || shape === 'hipped' || shape === 'skillion') && b.rect && rh > 0.3) {
    const { cx, cy, angle, length: L, width: W } = b.rect;
    const ov = b.overhang ?? 0.3;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const P = (u, v) => [cx + u * ca - v * sa, cy + u * sa + v * ca];      // rect-local → (east, north)
    const P3 = (u, v, y) => { const q = P(u, v); return [q[0], y, -q[1]]; };
    const hl = L / 2, hw = W / 2;
    const slope = Math.hypot(hw, rh);
    if (shape === 'skillion') {
      const y0 = top, y1 = top + rh;
      const q = [P3(-hl - ov, -hw - ov, y0 - 0.15), P3(hl + ov, -hw - ov, y0 - 0.15), P3(hl + ov, hw, y1), P3(-hl - ov, hw, y1)];
      const sl = Math.hypot(W + ov, rh);
      roofTri(roofs, q[0], q[1], q[2], [[0, 0], [L + 2 * ov, 0], [L + 2 * ov, sl]], rc, rt, b.bid);
      roofTri(roofs, q[0], q[2], q[3], [[0, 0], [L + 2 * ov, sl], [0, sl]], rc, rt, b.bid);
      if (!b.roofOnly) {
        // high side wall strip and the two right-triangle side walls (all edges in CCW rect order)
        wallQuad(walls, P(hl, hw), P(-hl, hw), top, y1, top, y1, 0, L, b.ground, attr, b.facade, b.bid);
        gableTri(walls, P(-hl, hw), P(-hl, -hw), P(-hl, hw), top, y1, b.ground, attr, b.facade, b.bid);
        gableTri(walls, P(hl, -hw), P(hl, hw), P(hl, hw), top, y1, b.ground, attr, b.facade, b.bid);
      }
      return;
    }
    const ridgeY = top + rh;
    const eaveY = top - rh * ov / hw; // the roof plane continues past the wall line, so the eave sits lower
    const rL = shape === 'hipped' ? Math.max(0, hl - hw) : hl + ov;
    // two long slopes
    for (const s of [-1, 1]) {
      const e0 = P3(-hl - ov, s * (hw + ov), eaveY), e1 = P3(hl + ov, s * (hw + ov), eaveY);
      const r0 = P3(-rL, 0, ridgeY), r1 = P3(rL, 0, ridgeY);
      const uvE0 = [-hl - ov, 0], uvE1 = [hl + ov, 0], uvR0 = [-rL, slope + ov], uvR1 = [rL, slope + ov];
      roofTri(roofs, e0, e1, r1, [uvE0, uvE1, uvR1], rc, rt, b.bid);
      roofTri(roofs, e0, r1, r0, [uvE0, uvR1, uvR0], rc, rt, b.bid);
    }
    if (shape === 'hipped') {
      for (const s of [-1, 1]) {
        const e0 = P3(s * (hl + ov), -hw - ov, eaveY), e1 = P3(s * (hl + ov), hw + ov, eaveY), r = P3(s * rL, 0, ridgeY);
        roofTri(roofs, e0, e1, r, [[-hw - ov, 0], [hw + ov, 0], [0, Math.hypot(hl - rL + ov, rh)]], rc, rt, b.bid);
      }
    } else if (!b.roofOnly) {
      // gable end walls (in the facade material, so they get bricks and attic windows)
      gableTri(walls, P(-hl, hw), P(-hl, -hw), P(-hl, 0), top, ridgeY, b.ground, attr, b.facade, b.bid);
      gableTri(walls, P(hl, -hw), P(hl, hw), P(hl, 0), top, ridgeY, b.ground, attr, b.facade, b.bid);
    }
    return;
  }

  if ((shape === 'pyramidal' || shape === 'dome') && rh > 0.3) {
    // apex above the area centroid
    let ax = 0, ay = 0;
    for (const p of outer) { ax += p[0]; ay += p[1]; }
    ax /= outer.length; ay /= outer.length;
    if (shape === 'pyramidal') {
      for (let i = 0; i < outer.length; i++) {
        const a = outer[i], c = outer[(i + 1) % outer.length];
        const el = Math.hypot(c[0] - a[0], c[1] - a[1]);
        roofTri(roofs, [a[0], top, -a[1]], [c[0], top, -c[1]], [ax, top + rh, -ay], [[0, 0], [el, 0], [el / 2, rh]], rc, rt, b.bid);
      }
      return;
    }
    const N = 7;
    let prev = outer.map(p => [p[0], top, -p[1]]);
    for (let k = 1; k <= N; k++) {
      const phi = (k / N) * Math.PI / 2;
      const s = Math.cos(phi), y = top + rh * Math.sin(phi);
      const ring = outer.map(p => [ax + (p[0] - ax) * s, y, -(ay + (p[1] - ay) * s)]);
      for (let i = 0; i < outer.length; i++) {
        const j = (i + 1) % outer.length;
        roofTri(roofs, prev[i], prev[j], ring[j], [[i, k - 1], [i + 1, k - 1], [i + 1, k]], rc, rt, b.bid);
        if (k < N) roofTri(roofs, prev[i], ring[j], ring[i], [[i, k - 1], [i + 1, k], [i, k]], rc, rt, b.bid);
      }
      prev = ring;
    }
    return;
  }

  // flat roof (with courtyards as holes)
  const flat = [];
  const holeIdx = [];
  for (const p of outer) flat.push(p[0], p[1]);
  for (const h of holes) { holeIdx.push(flat.length / 2); for (const p of h) flat.push(p[0], p[1]); }
  const tris = earcut(flat, holeIdx.length ? holeIdx : undefined, 2);
  const y = top + 0.02;
  for (let i = 0; i < tris.length; i += 3) {
    const p = [tris[i], tris[i + 1], tris[i + 2]].map(k => [flat[k * 2], flat[k * 2 + 1]]);
    roofTri(roofs, [p[0][0], y, -p[0][1]], [p[1][0], y, -p[1][1]], [p[2][0], y, -p[2][1]], [[p[0][0], p[0][1]], [p[1][0], p[1][1]], [p[2][0], p[2][1]]], rc, rt, b.bid);
  }
  // inner face of the parapet (visible from the roof / from above)
  if (parapet) {
    let u = 0;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], c = outer[(i + 1) % outer.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.05) continue;
      wallQuad(walls, a, c, top, top + parapet, top, top + parapet, u, u + len, b.ground, attr, b.facade, b.bid, true);
      u += len;
    }
  }
}

/** Ensure (east,north) ring orientation: outer CCW, holes CW. */
/**
 * Move every edge of a ring outward by d metres (mitred corners). Rings must be oriented as by orientRings
 * (outer counter-clockwise, holes clockwise) so "outward" is always away from the building's mass.
 * Used to give each building a tiny, building-specific offset: two buildings that overlap in the source data
 * then never draw walls in exactly the same plane (which flickers: z-fighting).
 */
export function inflateRing(r, d) {
  const n = r.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = r[(i - 1 + n) % n], c = r[i], q = r[(i + 1) % n];
    let ax = c[0] - p[0], ay = c[1] - p[1], bx = q[0] - c[0], by = q[1] - c[1];
    const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
    const n1 = [ay / la, -ax / la], n2 = [by / lb, -bx / lb]; // right-hand normals = outward
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = n2[0]; my = n2[1]; } else { mx /= ml; my /= ml; }
    const k = Math.min(2.5, 1 / Math.max(0.4, mx * n2[0] + my * n2[1]));
    out[i] = [c[0] + mx * d * k, c[1] + my * d * k];
  }
  return out;
}

export function orientRings(rings) {
  return rings.map((r, i) => {
    let s = 0;
    for (let k = 0, n = r.length, j = n - 1; k < n; j = k++) s += r[j][0] * r[k][1] - r[k][0] * r[j][1];
    const ccw = s > 0;
    return (i === 0) === ccw ? r : r.slice().reverse();
  });
}
