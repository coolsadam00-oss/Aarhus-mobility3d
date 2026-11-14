'use strict';
/**
 * Small, dependency-free geodesy / polygon helpers shared by the main process (Node, CommonJS)
 * and the renderer (bundled by esbuild). All coordinates are [lng, lat] in WGS84 unless noted.
 */

const DEG = Math.PI / 180;
const R_EARTH = 6371008.8;
// WGS84 ellipsoid: metres per degree of latitude / longitude at latitude phi (exact to < 1 cm per km)
const WGS84_A = 6378137, WGS84_E2 = 0.00669437999014;
function mPerDegLat(lat) { const p = lat * DEG; return 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p); }
function mPerDegLng(lat) { const p = lat * DEG; return (Math.PI / 180) * WGS84_A * Math.cos(p) / Math.sqrt(1 - WGS84_E2 * Math.sin(p) ** 2); }
const M_PER_DEG_LAT = mPerDegLat(56.16); // Aarhus

function haversine(a, b) {
  const dLat = (b[1] - a[1]) * DEG;
  const dLng = (b[0] - a[0]) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Local metric frame (east = +x, north = -z, i.e. three.js convention with y up).
 * Uses the cosine of the actual latitude for x so distances stay accurate over ~20 km.
 */
function makeFrame(lng0, lat0) {
  const ky = mPerDegLat(lat0);
  return {
    lng0, lat0,
    toLocal(lng, lat) {
      return [(lng - lng0) * mPerDegLng(lat), -(lat - lat0) * ky];
    },
    toLngLat(x, z) {
      const lat = lat0 - z / ky;
      return [lng0 + x / mPerDegLng(lat), lat];
    },
    metersPerDegLng: mPerDegLng(lat0),
    metersPerDegLat: ky
  };
}

/** Signed area of a ring in lng/lat degrees² (positive = counter-clockwise). */
function ringSignedArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    s += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return s / 2;
}

/** Area of a ring in m² (planar approximation around its first vertex). */
function ringAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat0 = ring[0][1];
  const kx = mPerDegLng(lat0), ky = mPerDegLat(lat0);
  let s = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0] * kx, yi = ring[i][1] * ky;
    const xj = ring[j][0] * kx, yj = ring[j][1] * ky;
    s += xj * yi - xi * yj;
  }
  return Math.abs(s / 2);
}

function polygonAreaM2(rings) {
  if (!rings || !rings.length) return 0;
  let a = ringAreaM2(rings[0]);
  for (let i = 1; i < rings.length; i++) a -= ringAreaM2(rings[i]);
  return Math.max(0, a);
}

function geometryAreaM2(geom) {
  if (!geom) return 0;
  if (geom.type === 'Polygon') return polygonAreaM2(geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.reduce((s, p) => s + polygonAreaM2(p), 0);
  return 0;
}

/** Area-weighted centroid of a ring ([lng, lat]); falls back to vertex mean for degenerate rings. */
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  const ox = ring[0][0], oy = ring[0][1];
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const x0 = ring[j][0] - ox, y0 = ring[j][1] - oy, x1 = ring[i][0] - ox, y1 = ring[i][1] - oy;
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-18) {
    let sx = 0, sy = 0;
    for (const p of ring) { sx += p[0]; sy += p[1]; }
    return [sx / ring.length, sy / ring.length];
  }
  return [ox + cx / (3 * a), oy + cy / (3 * a)];
}

function geometryCentroid(geom) {
  if (!geom) return null;
  switch (geom.type) {
    case 'Point': return geom.coordinates;
    case 'LineString': return geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    case 'MultiLineString': return geom.coordinates[0][Math.floor(geom.coordinates[0].length / 2)];
    case 'Polygon': return ringCentroid(geom.coordinates[0]);
    case 'MultiPolygon': {
      let best = null, bestA = -1;
      for (const p of geom.coordinates) { const a = ringAreaM2(p[0]); if (a > bestA) { bestA = a; best = p; } }
      return best ? ringCentroid(best[0]) : null;
    }
    default: return null;
  }
}

/** Point-in-ring (ray casting). */
function pointInRing(pt, ring) {
  let inside = false;
  const x = pt[0], y = pt[1];
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function pointInPolygon(pt, rings) {
  if (!pointInRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(pt, rings[i])) return false;
  return true;
}

function pointInGeometry(pt, geom) {
  if (!geom) return false;
  if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(p => pointInPolygon(pt, p));
  return false;
}

function bboxOfCoords(coords, bb = [Infinity, Infinity, -Infinity, -Infinity]) {
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < bb[0]) bb[0] = c[0];
      if (c[1] < bb[1]) bb[1] = c[1];
      if (c[0] > bb[2]) bb[2] = c[0];
      if (c[1] > bb[3]) bb[3] = c[1];
    } else for (const x of c) walk(x);
  };
  walk(coords);
  return bb;
}

function bboxOfGeometry(geom) { return geom ? bboxOfCoords(geom.coordinates) : null; }

function bboxIntersects(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }

function bboxAreaKm2(bb) {
  const w = haversine([bb[0], (bb[1] + bb[3]) / 2], [bb[2], (bb[1] + bb[3]) / 2]);
  const h = haversine([bb[0], bb[1]], [bb[0], bb[3]]);
  return (w * h) / 1e6;
}

/** Distance (m) from point p to segment a-b, all in a local metric frame [x, y]. */
function distPointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Simple uniform grid spatial index over bboxes (lng/lat). Cell size in degrees.
 * insert(item, bbox) / query(bbox) -> unique items.
 */
class GridIndex {
  constructor(cellDeg = 0.002) { this.cell = cellDeg; this.map = new Map(); }
  _key(i, j) { return i * 1000003 + j; }
  insert(item, bb) {
    const c = this.cell;
    const i0 = Math.floor(bb[0] / c), i1 = Math.floor(bb[2] / c);
    const j0 = Math.floor(bb[1] / c), j1 = Math.floor(bb[3] / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this._key(i, j);
      let arr = this.map.get(k);
      if (!arr) { arr = []; this.map.set(k, arr); }
      arr.push(item);
    }
  }
  query(bb) {
    const c = this.cell, out = new Set();
    const i0 = Math.floor(bb[0] / c), i1 = Math.floor(bb[2] / c);
    const j0 = Math.floor(bb[1] / c), j1 = Math.floor(bb[3] / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = this.map.get(this._key(i, j));
      if (arr) for (const it of arr) out.add(it);
    }
    return out;
  }
  queryPoint(pt) { return this.query([pt[0], pt[1], pt[0], pt[1]]); }
}

/** Normalise text for search: lowercase, strip accents, map Danish letters to ASCII digraphs too. */
function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  DEG, R_EARTH, M_PER_DEG_LAT, mPerDegLat, mPerDegLng,
  haversine, makeFrame,
  ringSignedArea, ringAreaM2, polygonAreaM2, geometryAreaM2,
  ringCentroid, geometryCentroid,
  pointInRing, pointInPolygon, pointInGeometry,
  bboxOfCoords, bboxOfGeometry, bboxIntersects, bboxAreaKm2,
  distPointSegment, GridIndex, normText
};
