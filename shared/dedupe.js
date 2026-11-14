'use strict';
// Near-duplicate building footprints (two versions of one building in GeoDanmark FOT, or a building mapped twice
// in OSM) draw coplanar walls that flicker ("z-fighting") in 3D and on the map. Keep the better-described twin,
// and give it any facts only the other one had.
const geo = require('./geo.js');

function infoScore(p) {
  return (p.n ? 4 : 0) + (p.a ? 2 : 0) + (p.lv ? 1 : 0) + (p.hs === 'g' || p.hs === 't' ? 2 : 0)
    + (p.k && p.k !== 'yes' && p.k !== 'building' ? 1 : 0) + Object.keys(p.t || {}).length * 0.01;
}

/**
 * @param {Array<object>} features GeoJSON building features (Polygon / MultiPolygon, WGS84)
 * @param {{maxDist?:number, maxAreaRatio?:number}} [opt]
 * @returns {{features:Array<object>, dropped:Array<{id:string, keptId:string}>}}
 */
function dedupeBuildings(features, opt = {}) {
  const maxDist = opt.maxDist ?? 1.0;          // metres between centroids
  const maxRatio = opt.maxAreaRatio ?? 1.25;   // larger / smaller area
  const cells = new Map();
  const info = new Map();
  const dropped = [];
  const gone = new Set();
  for (const f of features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const p = f.properties || {};
    const c = geo.geometryCentroid(g), a = geo.geometryAreaM2(g);
    if (!(a > 0)) continue;
    const kx = geo.mPerDegLng(c[1]), ky = geo.mPerDegLat(c[1]);
    const cx = Math.floor((c[0] * kx) / 4), cy = Math.floor((c[1] * ky) / 4);
    const me = { f, c, a, kx, ky, part: !!p.part };
    info.set(f, me);
    let twin = null;
    for (let i = -1; i <= 1 && !twin; i++) for (let j = -1; j <= 1 && !twin; j++) {
      const list = cells.get(`${cx + i}:${cy + j}`);
      if (!list) continue;
      for (const o of list) {
        if (gone.has(o.f) || o.part !== me.part) continue;
        const d = Math.hypot((o.c[0] - c[0]) * kx, (o.c[1] - c[1]) * ky);
        const r = Math.max(o.a, a) / Math.min(o.a, a);
        if (d <= maxDist && r <= maxRatio) { twin = o; break; }
      }
    }
    if (!twin) {
      const k = `${cx}:${cy}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(me);
      continue;
    }
    // keep the better-described one, merge missing properties into it
    const keepNew = infoScore(p) > infoScore(twin.f.properties || {});
    const keep = keepNew ? me : twin, drop = keepNew ? twin : me;
    const kp = keep.f.properties, dp = drop.f.properties || {};
    for (const [k, v] of Object.entries(dp)) if (kp[k] === undefined || kp[k] === null || kp[k] === '') kp[k] = v;
    if (dp.t && kp.t && dp.t !== kp.t) for (const [k, v] of Object.entries(dp.t)) if (kp.t[k] === undefined) kp.t[k] = v;
    gone.add(drop.f);
    dropped.push({ id: String(drop.f.id ?? dp.id), keptId: String(keep.f.id ?? kp.id) });
    if (keepNew) {
      const k = `${cx}:${cy}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(me);
    }
  }
  return { features: gone.size ? features.filter(f => !gone.has(f)) : features, dropped };
}

module.exports = { dedupeBuildings, infoScore };
