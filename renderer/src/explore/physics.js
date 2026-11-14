// Building-wall collisions: spatial hash of footprint rings (east, north) with circle push-out (sliding).
//
// Terraced blocks in Aarhus share party walls, so a point pushed out of one footprint is often inside the
// neighbour. Pushing out ring-by-ring then oscillates between the two buildings. Instead:
//  * moving into a footprint is blocked (the previous position is kept),
//  * a point that is already inside (spawn, teleport, a chunk that finished loading around the player)
//    searches outward for the nearest spot that is clear of every footprint (escape()).
const CELL = 24;

function bboxOf(r) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of r) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; }
  return [a, b, c, d];
}

function insideRing(e, n, r) {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if (((yi > n) !== (yj > n)) && (e < ((xj - xi) * (n - yi)) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
}

/** Closest point on the ring's edges to (e, n): [x, y, distance]. */
function closestOnRing(e, n, r) {
  let bx = 0, by = 0, bd = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const ax = r[j][0], ay = r[j][1], dx = r[i][0] - ax, dy = r[i][1] - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - ay) * dy) / l2));
    const cx = ax + t * dx, cy = ay + t * dy, d = Math.hypot(e - cx, n - cy);
    if (d < bd) { bd = d; bx = cx; by = cy; }
  }
  return [bx, by, bd];
}

const DIRS = Array.from({ length: 24 }, (_, i) => [Math.cos((i / 24) * Math.PI * 2), Math.sin((i / 24) * Math.PI * 2)]);

export class Colliders {
  constructor() { this.grid = new Map(); this.byChunk = new Map(); }

  _cells(bb, fn) {
    const i0 = Math.floor(bb[0] / CELL), i1 = Math.floor(bb[2] / CELL), j0 = Math.floor(bb[1] / CELL), j1 = Math.floor(bb[3] / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(i * 100003 + j);
  }

  addChunk(k, rings) {
    this.removeChunk(k);
    const items = rings.filter(r => r.length >= 3).map(r => ({ r, bb: bboxOf(r) }));
    this.byChunk.set(k, items);
    for (const it of items) this._cells(it.bb, (c) => { let a = this.grid.get(c); if (!a) { a = []; this.grid.set(c, a); } a.push(it); });
  }

  removeChunk(k) {
    const items = this.byChunk.get(k);
    if (!items) return;
    for (const it of items) this._cells(it.bb, (c) => { const a = this.grid.get(c); if (a) { const i = a.indexOf(it); if (i >= 0) a.splice(i, 1); } });
    this.byChunk.delete(k);
  }

  clear() { this.grid.clear(); this.byChunk.clear(); }

  near(e, n, r) {
    const out = new Set();
    this._cells([e - r, n - r, e + r, n + r], (c) => { const a = this.grid.get(c); if (a) for (const it of a) out.add(it); });
    return out;
  }

  ringsNear(e, n, r) { return [...this.near(e, n, r)].map(it => it.r); }

  static inside(p, r) { return insideRing(p[0], p[1], r); }

  /** Footprint item containing (e, n), or null. */
  insideAny(e, n) {
    const a = this.grid.get(Math.floor(e / CELL) * 100003 + Math.floor(n / CELL));
    if (!a) return null;
    for (const it of a) {
      const bb = it.bb;
      if (e < bb[0] || e > bb[2] || n < bb[1] || n > bb[3]) continue;
      if (insideRing(e, n, it.r)) return it;
    }
    return null;
  }

  /** Distance from (e, n) to the nearest wall within `r` metres (Infinity if none). */
  clearance(e, n, r) {
    let best = Infinity;
    for (const it of this.near(e, n, r)) {
      const bb = it.bb;
      if (e < bb[0] - r || e > bb[2] + r || n < bb[1] - r || n > bb[3] + r) continue;
      const d = closestOnRing(e, n, it.r)[2];
      if (d < best) best = d;
    }
    return best;
  }

  /** True when a circle of `radius` at (e, n) touches no building. */
  free(e, n, radius) { return !this.insideAny(e, n) && this.clearance(e, n, radius + 0.5) >= radius; }

  /** Nearest free spot to (e, n): rings of 24 rays every 0.5 m, out to `maxDist`. */
  escape(e, n, radius, maxDist = 90) {
    if (this.free(e, n, radius)) return [e, n];
    for (let d = 0.5; d <= maxDist; d += 0.5) {
      for (const [ce, cn] of DIRS) {
        const pe = e + ce * d, pn = n + cn * d;
        if (this.free(pe, pn, radius)) return [pe, pn];
      }
    }
    return [e, n];
  }

  /** Farthest free point on the segment from (e0, n0) towards (e1, n1) — used to keep chase cameras out of walls. */
  clipSegment(e0, n0, e1, n1, radius) {
    for (let t = 1; t > 0; t -= 0.1) {
      const e = e0 + (e1 - e0) * t, n = n0 + (n1 - n0) * t;
      if (this.free(e, n, radius)) return [e, n];
    }
    return [e0, n0];
  }

  /**
   * Move a circle to (e, n) and push it out of nearby building walls (sliding along them).
   * With the previous position (pe, pn), a move that would end inside a footprint is refused.
   * Returns {e, n, hit}.
   */
  resolve(e, n, radius, pe, pn) {
    const hasPrev = pe !== undefined && pn !== undefined;
    if (this.insideAny(e, n)) {
      if (hasPrev && !this.insideAny(pe, pn)) return { e: pe, n: pn, hit: true };
      const p = this.escape(e, n, radius);
      return { e: p[0], n: p[1], hit: true };
    }
    let hit = false;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      for (const it of this.near(e, n, radius + 1)) {
        const bb = it.bb;
        if (e < bb[0] - radius || e > bb[2] + radius || n < bb[1] - radius || n > bb[3] + radius) continue;
        const [cx, cy, d] = closestOnRing(e, n, it.r);
        if (d < radius) {
          const k = d > 1e-6 ? radius / d : 0;
          if (k) { e = cx + (e - cx) * k; n = cy + (n - cy) * k; moved = hit = true; }
        }
      }
      if (!moved) break;
    }
    // squeezed between two buildings (gap narrower than the body): don't get pushed into one of them
    if (hit && this.insideAny(e, n)) {
      if (hasPrev && !this.insideAny(pe, pn)) return { e: pe, n: pn, hit: true };
      const p = this.escape(e, n, radius);
      return { e: p[0], n: p[1], hit: true };
    }
    return { e, n, hit };
  }
}
