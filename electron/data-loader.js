'use strict';
/**
 * Loads NetAScore output (GeoJSON or GeoPackage) and normalises it for the 3D frontend.
 *
 * NetAScore writes one index per profile and direction, e.g.
 *   index_bike_ft, index_bike_tf, index_walk_ft, index_walk_tf   (0 = poor … 1 = excellent)
 * plus indicator columns (bicycle_infrastructure_ft, road_category, max_speed_ft, gradient_ft, …).
 *
 * The loader adds a few private, underscore-prefixed fields that the renderer relies on:
 *   _sid   sequential numeric id (used for feature-state / selection)
 *   _wid   OSM way id as string (comments are keyed by this)
 *   _name  display name
 *   _bike  combined bikeability 0..1 (mean of both directions) or null
 *   _walk  combined walkability 0..1 or null
 */
const fs = require('fs');
const path = require('path');
const { readGeoPackage } = require('./gpkg');

const ID_FIELDS = ['osm_id', 'osm_way_id', 'way_id', 'osmid', '@id', 'id'];
const NAME_FIELDS = ['name', 'street_name', 'road_name', 'name:da'];

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Find the combined index for a profile, e.g. "bike" -> mean(index_bike_ft, index_bike_tf). */
function profileIndex(props, profile) {
  const direct = num(props[`index_${profile}`]);
  if (direct !== null) return clamp01(direct);
  const ft = num(props[`index_${profile}_ft`]);
  const tf = num(props[`index_${profile}_tf`]);
  if (ft !== null && tf !== null) return clamp01((ft + tf) / 2);
  if (ft !== null) return clamp01(ft);
  if (tf !== null) return clamp01(tf);
  // Fallbacks for custom profile names (e.g. "index_cycling_ft")
  const alt = profile === 'bike' ? /^index_(bike|bicycle|cycling|cycle)/i : /^index_(walk|walking|foot|pedestrian)/i;
  const vals = Object.keys(props).filter(k => alt.test(k) && !/robust|explan/i.test(k)).map(k => num(props[k])).filter(v => v !== null);
  if (vals.length) return clamp01(vals.reduce((a, b) => a + b, 0) / vals.length);
  return null;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v > 1.0001 && v <= 100 ? v / 100 : v));

function wayId(props, fallback) {
  for (const f of ID_FIELDS) {
    const v = props[f];
    if (v !== null && v !== undefined && v !== '') return String(v).replace(/^way\//, '');
  }
  return `seg-${fallback}`;
}

function normalise(fc) {
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error('File is not a GeoJSON FeatureCollection.');
  }
  const out = [];
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const stats = { bike: { n: 0, sum: 0 }, walk: { n: 0, sum: 0 } };
  const keys = new Set();
  let sid = 0;

  for (const f of fc.features) {
    if (!f || !f.geometry) continue;
    const t = f.geometry.type;
    if (t !== 'LineString' && t !== 'MultiLineString') continue;
    const p = { ...(f.properties || {}) };
    Object.keys(p).forEach(k => keys.add(k));
    p._sid = ++sid;
    p._wid = wayId(p, sid);
    p._name = NAME_FIELDS.map(k => p[k]).find(v => v) || null;
    p._bike = profileIndex(p, 'bike');
    p._walk = profileIndex(p, 'walk');
    if (p._bike !== null) { stats.bike.n++; stats.bike.sum += p._bike; }
    if (p._walk !== null) { stats.walk.n++; stats.walk.sum += p._walk; }

    const lines = t === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const line of lines) for (const c of line) {
      if (c[0] < bbox[0]) bbox[0] = c[0];
      if (c[1] < bbox[1]) bbox[1] = c[1];
      if (c[0] > bbox[2]) bbox[2] = c[0];
      if (c[1] > bbox[3]) bbox[3] = c[1];
    }
    out.push({ type: 'Feature', id: p._sid, geometry: f.geometry, properties: p });
  }
  if (!out.length) throw new Error('No LineString street segments found in the file.');
  if (Math.abs(bbox[0]) > 180 || Math.abs(bbox[1]) > 90) {
    throw new Error('Coordinates are not in WGS84 (EPSG:4326). Export the NetAScore result as GeoJSON in EPSG:4326 or use the GeoPackage directly.');
  }
  return {
    geojson: { type: 'FeatureCollection', features: out },
    meta: {
      count: out.length,
      bbox,
      fields: [...keys].sort(),
      meanBike: stats.bike.n ? stats.bike.sum / stats.bike.n : null,
      meanWalk: stats.walk.n ? stats.walk.sum / stats.walk.n : null,
      scoredBike: stats.bike.n,
      scoredWalk: stats.walk.n,
      demo: Boolean(fc.demo || (fc.metadata && fc.metadata.demo)),
      source: (fc.metadata && fc.metadata.source) || null
    }
  };
}

/** Load any supported file and return { geojson, meta }. */
function loadDataset(file) {
  const ext = path.extname(file).toLowerCase();
  let fc; let extra = {};
  if (ext === '.gpkg') {
    const r = readGeoPackage(file);
    fc = r.geojson;
    extra = { layer: r.layer, layers: r.layers, sourceCrs: r.sourceCrs };
  } else if (ext === '.geojson' || ext === '.json') {
    fc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const crs = fc.crs && fc.crs.properties && fc.crs.properties.name;
    if (crs && !/4326|CRS84/i.test(crs)) {
      throw new Error(`GeoJSON is in ${crs}. Please export it as EPSG:4326, or load the GeoPackage instead (it is reprojected automatically).`);
    }
  } else {
    throw new Error(`Unsupported file type "${ext}". Use .geojson, .json or .gpkg.`);
  }
  const res = normalise(fc);
  res.meta = { ...res.meta, ...extra, file, fileName: path.basename(file), format: ext.slice(1) };
  return res;
}

module.exports = { loadDataset, normalise, profileIndex };
