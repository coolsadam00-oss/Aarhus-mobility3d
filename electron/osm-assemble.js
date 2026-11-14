'use strict';
/**
 * Overpass JSON → GeoJSON features.
 *  - nodes            → Point
 *  - ways             → LineString, or Polygon when closed and area-like
 *  - multipolygons    → Polygon / MultiPolygon, rings stitched from member ways (outer/inner)
 *  - "out center"     → Point at the element centre
 * Feature ids are "n123", "w123", "r123" (OSM type initial + id).
 */
const { ringSignedArea, pointInRing } = require('../shared/geo');

const R7 = (v) => Math.round(v * 1e7) / 1e7;
const key = (c) => c[0] + ',' + c[1];

const AREA_KEYS = new Set(['building', 'building:part', 'landuse', 'amenity', 'shop', 'tourism', 'historic', 'office', 'craft',
  'healthcare', 'place', 'power', 'aeroway', 'water', 'area:highway', 'military', 'boundary']);
const NATURAL_LINEAR = new Set(['tree_row', 'coastline', 'cliff', 'ridge', 'arete', 'valley', 'gully', 'earth_bank']);
const LEISURE_LINEAR = new Set(['track', 'slipway']);
const MAN_MADE_LINEAR = new Set(['pier', 'breakwater', 'groyne', 'embankment', 'dyke', 'pipeline', 'cutline', 'quay']);
const WATERWAY_AREA = new Set(['riverbank', 'dock', 'boatyard', 'dam']);

/** Is a closed way with these tags an area (polygon) rather than a closed line? */
function isAreaTags(tags) {
  if (!tags) return false;
  if (tags.area === 'yes') return true;
  if (tags.area === 'no') return false;
  for (const k of Object.keys(tags)) {
    if (AREA_KEYS.has(k)) return true;
  }
  if (tags.natural && !NATURAL_LINEAR.has(tags.natural)) return true;
  if (tags.leisure && !LEISURE_LINEAR.has(tags.leisure)) return true;
  if (tags.man_made && !MAN_MADE_LINEAR.has(tags.man_made)) return true;
  if (tags.waterway && WATERWAY_AREA.has(tags.waterway)) return true;
  if (tags.railway === 'platform' || tags.public_transport === 'platform') return false;
  return false;
}

function wayCoords(el) {
  if (!Array.isArray(el.geometry)) return [];
  const out = [];
  for (const g of el.geometry) {
    if (!g || typeof g.lon !== 'number') continue;
    const c = [R7(g.lon), R7(g.lat)];
    if (out.length && out[out.length - 1][0] === c[0] && out[out.length - 1][1] === c[1]) continue;
    out.push(c);
  }
  return out;
}

function isClosed(c) { return c.length >= 4 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]; }

function orient(ring, ccw) {
  const a = ringSignedArea(ring);
  if ((a > 0) !== ccw) return ring.slice().reverse();
  return ring;
}

/**
 * Stitch open/closed way segments into closed rings.
 * Uses an endpoint map so large relations (forests, lakes) stay fast.
 */
function stitchRings(segments) {
  const rings = [];
  const open = [];
  for (const s of segments) {
    if (!s || s.length < 2) continue;
    if (isClosed(s)) rings.push(s.slice());
    else open.push(s.slice());
  }
  const used = new Array(open.length).fill(false);
  const ends = new Map();
  const addEnd = (k, i) => { let a = ends.get(k); if (!a) { a = []; ends.set(k, a); } a.push(i); };
  open.forEach((s, i) => { addEnd(key(s[0]), i); addEnd(key(s[s.length - 1]), i); });

  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let cur = open[i];
    let guard = 0;
    while (!isClosed(cur) && guard++ < 100000) {
      const endK = key(cur[cur.length - 1]);
      const cands = ends.get(endK) || [];
      const j = cands.find(idx => !used[idx]);
      if (j === undefined) break;
      used[j] = true;
      let s = open[j];
      if (key(s[0]) !== endK) s = s.slice().reverse();
      cur = cur.concat(s.slice(1));
    }
    if (isClosed(cur)) rings.push(cur);
  }
  return rings.filter(r => r.length >= 4);
}

/** Build a Polygon / MultiPolygon geometry from a multipolygon relation with member geometries. */
function relationGeometry(el) {
  if (!Array.isArray(el.members)) return null;
  const outerSegs = [], innerSegs = [];
  for (const m of el.members) {
    if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
    const c = wayCoords(m);
    if (c.length < 2) continue;
    if (m.role === 'inner') innerSegs.push(c); else outerSegs.push(c);
  }
  const outers = stitchRings(outerSegs).map(r => orient(r, true));
  const inners = stitchRings(innerSegs).map(r => orient(r, false));
  if (!outers.length) return null;
  const polys = outers.map(o => [o]);
  for (const inner of inners) {
    const p = inner[0];
    const host = polys.find(poly => pointInRing(p, poly[0]));
    if (host) host.push(inner);
  }
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

/**
 * Convert one Overpass element to a GeoJSON feature (or null).
 * @param {object} el
 * @param {object} [opt] { forceArea: bool, forceLine: bool }
 */
function elementToFeature(el, opt = {}) {
  const tags = el.tags || {};
  const id = el.type[0] + el.id;
  let geometry = null;
  if (el.type === 'node') {
    if (typeof el.lon !== 'number') return null;
    geometry = { type: 'Point', coordinates: [R7(el.lon), R7(el.lat)] };
  } else if (el.center && !el.geometry && !el.members) {
    geometry = { type: 'Point', coordinates: [R7(el.center.lon), R7(el.center.lat)] };
  } else if (el.type === 'way') {
    const c = wayCoords(el);
    if (c.length < 2) return null;
    const closed = isClosed(c);
    const area = !opt.forceLine && closed && (opt.forceArea || isAreaTags(tags));
    geometry = area ? { type: 'Polygon', coordinates: [orient(c, true)] } : { type: 'LineString', coordinates: c };
  } else if (el.type === 'relation') {
    const t = tags.type;
    if (t && t !== 'multipolygon' && t !== 'boundary') return null;
    geometry = relationGeometry(el);
  }
  if (!geometry) return null;
  const f = { type: 'Feature', id, geometry, properties: { id, tags } };
  if (el.type === 'way' && Array.isArray(el.nodes)) f.nodes = el.nodes;
  return f;
}

/** Merge several Overpass responses, de-duplicating elements by type+id. */
function mergeElements(responses) {
  const seen = new Map();
  for (const r of responses) {
    for (const el of (r && r.elements) || []) {
      const k = el.type + el.id;
      if (!seen.has(k)) seen.set(k, el);
    }
  }
  return [...seen.values()];
}

module.exports = { elementToFeature, stitchRings, relationGeometry, isAreaTags, mergeElements, wayCoords, isClosed, orient };
