// Building appearance shared by the map and the 3D explorer: footprint metrics, roof shape, colours.
// Explicit OSM tags always win (roof:shape, roof:height, building:colour, roof:colour, materials);
// otherwise documented heuristics are used and the info panel labels the result as "estimated".
import cls from '../../shared/classify.js';
import tagsLib from '../../shared/tags.js';

const { BUILDINGS, FACADE_PALETTES, ROOF_DEFAULTS } = cls;
const { MATERIAL_COLOURS, parseColour } = tagsLib;

export const STYLE_INDEX = { brick: 0, plaster: 1, glass: 2, concrete: 3, metal: 4, historic: 5, house: 6, retail: 7, plain: 8 };

/** Convex hull (monotone chain) of 2D points [[x,y],...]. */
export function convexHull(pts) {
  const p = pts.map(q => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

export function ringArea2D(r) {
  let s = 0;
  for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return s / 2;
}

/**
 * Footprint metrics in a local metric frame (x east, y north).
 * Returns area, the minimum-area bounding rectangle (centre, long-axis angle, length, width) and rectangularity.
 */
export function footprintMetrics(ring) {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const area = Math.abs(ringArea2D(pts));
  const hull = convexHull(pts);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const q of hull) {
      const u = q[0] * c + q[1] * s, v = -q[0] * s + q[1] * c;
      if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const ra = (maxU - minU) * (maxV - minV);
    if (!best || ra < best.area) {
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      best = { area: ra, ang, du: maxU - minU, dv: maxV - minV, cx: cu * c - cv * s, cy: cu * s + cv * c };
    }
  }
  if (!best) return { area, rect: null, rectangularity: 0, vertices: pts.length };
  // long axis
  const longIsU = best.du >= best.dv;
  const rect = { cx: best.cx, cy: best.cy, angle: longIsU ? best.ang : best.ang + Math.PI / 2, length: Math.max(best.du, best.dv), width: Math.min(best.du, best.dv) };
  return { area, rect, rectangularity: best.area > 0 ? area / best.area : 0, vertices: pts.length };
}

function seeded(seed, k) {
  let x = Math.imul((seed | 0) ^ (k * 0x9e3779b1), 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const SHAPE_MAP = { gabled: 'gabled', hipped: 'hipped', 'half-hipped': 'hipped', half_hipped: 'hipped', mansard: 'hipped', gambrel: 'gabled', saltbox: 'gabled',
  pyramidal: 'pyramidal', cone: 'pyramidal', skillion: 'skillion', lean_to: 'skillion', dome: 'dome', onion: 'dome', round: 'gabled', flat: 'flat', side_hipped: 'hipped' };

/**
 * Decide the roof shape and height.
 * @param {object} p building properties (pack format)
 * @param {object} m footprint metrics
 * @param {number} wallH wall height (m) above mean ground
 * @returns {{shape:string, height:number, tagged:boolean}}
 */
export function decideRoof(p, m, wallH) {
  const kind = BUILDINGS[p.k] ? p.k : 'yes';
  const def = BUILDINGS[kind][6];
  let shape = p.rs ? SHAPE_MAP[p.rs] || 'flat' : null;
  const tagged = !!shape;
  const seed = p.seed || 0;
  const rect = m.rect;
  const rectOk = rect && m.rectangularity >= 0.82 && m.vertices <= 14;
  if (!shape) {
    if (def === 'auto') {
      const small = rect && rect.width <= 16 && wallH <= 24 && m.area <= 1800;
      shape = rectOk && small ? (seeded(seed, 1) < 0.82 ? 'gabled' : 'hipped') : 'flat';
      if (m.area < 30 && wallH < 4) shape = 'flat';
    } else shape = def;
  }
  if ((shape === 'gabled' || shape === 'hipped' || shape === 'skillion') && !rectOk) shape = m.area < 300 ? 'pyramidal' : 'flat';
  if (shape === 'dome' && m.rectangularity < 0.6 && m.vertices < 5) shape = 'pyramidal';
  if (p.part && !tagged && shape !== 'flat') shape = 'flat';
  if (kind === 'roof' || kind === 'carport') shape = 'flat';
  let height = 0;
  if (shape !== 'flat') {
    if (p.rh) height = p.rh;
    else if (p.rlv) height = p.rlv * 2.6;
    else {
      const w = rect ? rect.width : Math.sqrt(m.area);
      const pitch = (p.st === 'house' || kind === 'church' || kind === 'chapel' ? 42 : 34) * Math.PI / 180;
      height = (shape === 'skillion' ? w : w / 2) * Math.tan(pitch);
      if (shape === 'dome') height = w * 0.45;
      if (shape === 'pyramidal' && (kind === 'church' || kind === 'bell_tower')) height = w * 1.6;
      height = Math.max(1.2, Math.min(height, shape === 'pyramidal' && kind !== 'yes' ? 40 : 9, wallH * 0.9 + 2));
    }
  }
  return { shape, height, tagged };
}

export function facadeColor(p) {
  if (p.c) return p.c;
  const m = p.m && MATERIAL_COLOURS[String(p.m).split(';')[0]];
  if (m) return m;
  const pal = FACADE_PALETTES[p.st] || FACADE_PALETTES.brick;
  return pal[(p.seed || 0) % pal.length];
}

export function roofColor(p, shape) {
  if (p.rc) return p.rc;
  const m = p.rm && MATERIAL_COLOURS[String(p.rm).split(';')[0]];
  if (m) return m;
  if (p.k === 'greenhouse' || p.k === 'conservatory') return '#c9d8de';
  const pal = shape === 'flat' ? ROOF_DEFAULTS.flat : ROOF_DEFAULTS.pitched;
  return pal[Math.floor((p.seed || 0) / 7) % pal.length];
}

export function facadeStyle(p) {
  let st = p.st || 'brick';
  const mat = p.m ? String(p.m) : '';
  if (/glass|mirror/.test(mat)) st = 'glass';
  else if (/metal|steel/.test(mat)) st = 'metal';
  else if (/concrete|cement/.test(mat)) st = 'concrete';
  else if (/plaster|stucco/.test(mat)) st = 'plaster';
  else if (/brick/.test(mat)) st = 'brick';
  if (p.fn && /^(shop|amenity=(restaurant|cafe|fast_food|bar|pub|bank|pharmacy|ice_cream))/.test(p.fn) && st !== 'glass') st = 'retail';
  if (p.also && p.also.length && (st === 'brick' || st === 'plaster')) st = 'retail';
  return st;
}

/** Wall height above mean ground and roof decision for a building (shared by map colours and 3D builder). */
export function heights(p, m) {
  const total = p.h || 6;
  const minH = p.mh || 0;
  let wallH, roof;
  if (p.ht) {
    // OSM "height" is the top of the roof
    roof = decideRoof(p, m, total * 0.75);
    wallH = Math.max(minH + 1, total - roof.height);
  } else {
    wallH = total;
    roof = decideRoof(p, m, wallH);
  }
  return { wallH, minH, roof };
}
