'use strict';
/**
 * Minimal OGC GeoPackage reader.
 * A GeoPackage is an SQLite file, so we open it with the built-in node:sqlite (read-only),
 * decode the GeoPackage binary geometry header and the WKB payload ourselves,
 * and reproject to WGS84 with proj4 using the CRS definition stored in the file.
 */
const { DatabaseSync } = require('node:sqlite');
const proj4 = require('proj4');

// Fallback definitions for CRSs commonly used for Danish NetAScore runs,
// used when the WKT stored in gpkg_spatial_ref_sys cannot be parsed by proj4.
const KNOWN_CRS = {
  4326: '+proj=longlat +datum=WGS84 +no_defs',
  3857: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs',
  25832: '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  25833: '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
  32632: '+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs',
  32633: '+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs',
  3044: '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +axis=neu +no_defs',
  4258: '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs'
};

// ---------------------------------------------------------------- WKB parsing
class WkbReader {
  constructor(buf, offset) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = offset;
    this.le = true;
  }
  u8() { return this.view.getUint8(this.pos++); }
  u32() { const v = this.view.getUint32(this.pos, this.le); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos, this.le); this.pos += 8; return v; }

  geometry() {
    this.le = this.u8() === 1;
    let type = this.u32();
    let hasZ = false, hasM = false;
    // EWKB flags
    if (type & 0x80000000) hasZ = true;
    if (type & 0x40000000) hasM = true;
    if (type & 0x20000000) { this.u32(); } // EWKB SRID, ignore
    type &= 0x0fffffff;
    // ISO WKB dimension offsets
    if (type >= 3000) { hasZ = true; hasM = true; type -= 3000; }
    else if (type >= 2000) { hasM = true; type -= 2000; }
    else if (type >= 1000) { hasZ = true; type -= 1000; }
    const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);

    const point = () => {
      const c = [this.f64(), this.f64()];
      if (hasZ) c.push(this.f64());
      if (hasM) this.f64();
      return c;
    };
    const ring = () => { const n = this.u32(); const out = new Array(n); for (let i = 0; i < n; i++) out[i] = point(); return out; };
    const multi = () => { const n = this.u32(); const out = []; for (let i = 0; i < n; i++) out.push(this.geometry()); return out; };
    void dims;

    switch (type) {
      case 1: return { type: 'Point', coordinates: point() };
      case 2: return { type: 'LineString', coordinates: ring() };
      case 3: { const n = this.u32(); const rings = []; for (let i = 0; i < n; i++) rings.push(ring()); return { type: 'Polygon', coordinates: rings }; }
      case 4: return { type: 'MultiPoint', coordinates: multi().map(g => g.coordinates) };
      case 5: return { type: 'MultiLineString', coordinates: multi().map(g => g.coordinates) };
      case 6: return { type: 'MultiPolygon', coordinates: multi().map(g => g.coordinates) };
      case 7: return { type: 'GeometryCollection', geometries: multi() };
      default: throw new Error(`Unsupported WKB geometry type ${type}`);
    }
  }
}

/** Decode a GeoPackage geometry BLOB ("GP" header + WKB). */
function decodeGpkgGeometry(blob) {
  if (!blob || blob.length < 8) return null;
  if (blob[0] !== 0x47 || blob[1] !== 0x50) {
    // Not a GP blob — some writers store plain WKB
    return new WkbReader(blob, 0).geometry();
  }
  const flags = blob[3];
  const empty = (flags >> 4) & 1;
  if (empty) return null;
  const envelopeCode = (flags >> 1) & 0x07;
  const envelopeBytes = [0, 32, 48, 48, 64][envelopeCode];
  if (envelopeBytes === undefined) throw new Error('Invalid GeoPackage envelope code');
  return new WkbReader(blob, 8 + envelopeBytes).geometry();
}

// ---------------------------------------------------------------- reprojection
function mapCoords(geom, fn) {
  if (!geom) return geom;
  const walk = (c) => (typeof c[0] === 'number' ? fn(c) : c.map(walk));
  if (geom.type === 'GeometryCollection') return { type: geom.type, geometries: geom.geometries.map(g => mapCoords(g, fn)) };
  return { type: geom.type, coordinates: walk(geom.coordinates) };
}

function buildTransformer(srs) {
  if (!srs || srs.srs_id === 4326 || srs.organization_coordsys_id === 4326) return null;
  const code = srs.organization_coordsys_id;
  let def = null;
  if (srs.definition && srs.definition !== 'undefined') {
    try { proj4(srs.definition, 'WGS84', [0, 0]); def = srs.definition; } catch { def = null; }
  }
  if (!def && KNOWN_CRS[code]) def = KNOWN_CRS[code];
  if (!def) throw new Error(`Cannot reproject from CRS ${srs.organization || ''}:${code} — please export the NetAScore result as EPSG:4326 GeoJSON.`);
  if (def === KNOWN_CRS[4326]) return null;
  const converter = proj4(def, 'WGS84');
  const isGeographic = /^\+proj=longlat/.test(def) || /^GEOGCS|^GEOGCRS/.test(def);
  if (isGeographic) return null;
  return (c) => {
    const [x, y] = converter.forward([c[0], c[1]]);
    return c.length > 2 ? [round(x, 7), round(y, 7), c[2]] : [round(x, 7), round(y, 7)];
  };
}
const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

// ---------------------------------------------------------------- table reading
/**
 * Read a feature table from a GeoPackage as a GeoJSON FeatureCollection (EPSG:4326).
 * If no layer is given, the NetAScore "edge" layer is preferred.
 */
function readGeoPackage(file, { layer } = {}) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const layers = db.prepare(`
      SELECT c.table_name AS table_name, g.column_name AS geom_col, g.srs_id AS srs_id, g.geometry_type_name AS gtype
      FROM gpkg_contents c JOIN gpkg_geometry_columns g ON g.table_name = c.table_name
      WHERE c.data_type = 'features'`).all();
    if (!layers.length) throw new Error('No feature layers found in GeoPackage.');

    let chosen = layer ? layers.find(l => l.table_name === layer) : null;
    if (!chosen) {
      chosen = layers.find(l => /^edges?$/i.test(l.table_name))
        || layers.find(l => /edge/i.test(l.table_name))
        || layers.find(l => /LINE/i.test(l.gtype))
        || layers[0];
    }
    const srs = db.prepare('SELECT * FROM gpkg_spatial_ref_sys WHERE srs_id = ?').get(chosen.srs_id);
    const transform = buildTransformer(srs);

    const table = chosen.table_name.replace(/"/g, '""');
    const gcol = chosen.geom_col;
    const rows = db.prepare(`SELECT * FROM "${table}"`).iterate();
    const features = [];
    for (const row of rows) {
      const blob = row[gcol];
      let geometry = null;
      try { geometry = decodeGpkgGeometry(blob); } catch { geometry = null; }
      if (!geometry) continue;
      if (transform) geometry = mapCoords(geometry, transform);
      const properties = {};
      for (const [k, v] of Object.entries(row)) {
        if (k === gcol) continue;
        properties[k] = (typeof v === 'bigint') ? Number(v) : (v instanceof Uint8Array ? null : v);
      }
      features.push({ type: 'Feature', geometry, properties });
    }
    return {
      geojson: { type: 'FeatureCollection', features },
      layer: chosen.table_name,
      layers: layers.map(l => l.table_name),
      sourceCrs: srs ? `${srs.organization || 'EPSG'}:${srs.organization_coordsys_id}` : 'unknown'
    };
  } finally {
    db.close();
  }
}

module.exports = { readGeoPackage, decodeGpkgGeometry, buildTransformer, KNOWN_CRS };
