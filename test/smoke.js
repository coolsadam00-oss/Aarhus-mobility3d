'use strict';
/**
 * Smoke tests for the non-GUI layers: GeoPackage decoding + reprojection, dataset
 * normalisation, SQLite comment store, CSV/GeoJSON export and NetAScore-lite scoring.
 *   npm test
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync: Database } = require('node:sqlite');
const proj4 = require('proj4');

const { loadDataset } = require('../electron/data-loader');
const { openDatabase } = require('../electron/db');
const { toCsv, toGeoJson } = require('../electron/export');
const { scoreWay } = require('../electron/osm-fetch');
const { KNOWN_CRS } = require('../electron/gpkg');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'am3d-'));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✔', name); };

// ---------- build a NetAScore-like GeoPackage in EPSG:25832
function wkbLineString(coords) {
  const b = Buffer.alloc(1 + 4 + 4 + coords.length * 16);
  b.writeUInt8(1, 0); b.writeUInt32LE(2, 1); b.writeUInt32LE(coords.length, 5);
  coords.forEach((c, i) => { b.writeDoubleLE(c[0], 9 + i * 16); b.writeDoubleLE(c[1], 17 + i * 16); });
  return b;
}
function gpkgBlob(wkb, srsId) {
  const h = Buffer.alloc(8 + 32);
  h.write('GP', 0, 'ascii'); h.writeUInt8(0, 2); h.writeUInt8(0b00000011, 3); // LE header, envelope [minx,maxx,miny,maxy]
  h.writeInt32LE(srsId, 4);
  return Buffer.concat([h, wkb]);
}
const toUtm = proj4('WGS84', KNOWN_CRS[25832]);
const lineWgs = [[10.2050, 56.1512], [10.2066, 56.1540], [10.2074, 56.1553]];
const lineUtm = lineWgs.map(c => toUtm.forward(c));

const gpkgFile = path.join(tmp, 'netascore_test.gpkg');
{
  const g = new Database(gpkgFile);
  g.exec(`
    CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT, srs_id INTEGER PRIMARY KEY, organization TEXT, organization_coordsys_id INTEGER, definition TEXT, description TEXT);
    CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT, identifier TEXT, description TEXT, last_change TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, srs_id INTEGER);
    CREATE TABLE gpkg_geometry_columns (table_name TEXT, column_name TEXT, geometry_type_name TEXT, srs_id INTEGER, z INTEGER, m INTEGER);
    CREATE TABLE edge (fid INTEGER PRIMARY KEY, geom BLOB, edge_id INTEGER, osm_id INTEGER, name TEXT,
      index_bike_ft REAL, index_bike_tf REAL, index_walk_ft REAL, index_walk_tf REAL, bicycle_infrastructure_ft TEXT, max_speed_ft INTEGER, gradient_ft INTEGER);
    CREATE TABLE node (fid INTEGER PRIMARY KEY, geom BLOB);
  `);
  g.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)').run('ETRS89 / UTM zone 32N', 25832, 'EPSG', 25832, 'undefined', '');
  g.exec("INSERT INTO gpkg_contents (table_name, data_type, srs_id) VALUES ('node','features',25832),('edge','features',25832)");
  g.exec("INSERT INTO gpkg_geometry_columns VALUES ('node','geom','POINT',25832,0,0),('edge','geom','LINESTRING',25832,0,0)");
  const ins = g.prepare('INSERT INTO edge (geom, edge_id, osm_id, name, index_bike_ft, index_bike_tf, index_walk_ft, index_walk_tf, bicycle_infrastructure_ft, max_speed_ft, gradient_ft) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  ins.run(gpkgBlob(wkbLineString(lineUtm), 25832), 1, 23453451, 'Søndergade', 0.4, 0.5, 0.95, 0.97, 'no', 0, 1);
  ins.run(gpkgBlob(wkbLineString(lineUtm.slice(0, 2)), 25832), 2, 999, 'Park Allé', null, null, 0.6, null, 'bicycle_way', 50, 0);
  g.close();
}

test('GeoPackage edge layer is read and reprojected from EPSG:25832', () => {
  const { geojson, meta } = loadDataset(gpkgFile);
  assert.strictEqual(meta.layer, 'edge');
  assert.strictEqual(meta.count, 2);
  const c = geojson.features[0].geometry.coordinates[0];
  assert(Math.abs(c[0] - 10.2050) < 1e-6 && Math.abs(c[1] - 56.1512) < 1e-6, `bad reprojection ${c}`);
  const p = geojson.features[0].properties;
  assert.strictEqual(p._wid, '23453451');
  assert.strictEqual(p._name, 'Søndergade');
  assert(Math.abs(p._bike - 0.45) < 1e-9);
  assert(Math.abs(p._walk - 0.96) < 1e-9);
  const p2 = geojson.features[1].properties;
  assert.strictEqual(p2._bike, null);
  assert.strictEqual(p2._walk, 0.6);
});

test('Bundled demo GeoJSON loads', () => {
  const { meta } = loadDataset(path.join(__dirname, '..', 'data', 'aarhus_demo.geojson'));
  assert(meta.demo && meta.count > 10);
  assert(meta.bbox[0] > 10 && meta.bbox[3] < 57);
});

test('Projected GeoJSON is rejected with a helpful message', () => {
  const f = path.join(tmp, 'utm.geojson');
  fs.writeFileSync(f, JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::25832' } }, features: [] }));
  assert.throws(() => loadDataset(f), /EPSG:4326/);
});

test('SQLite comment store persists across re-open', () => {
  const file = path.join(tmp, 'feedback.sqlite');
  let db = openDatabase(file);
  const c = db.addComment({ osm_way_id: '23453451', category: 'poor_pavement', body: 'Huller i belægningen, "farligt"', severity: 4, mode: 'bike', lng: 10.2, lat: 56.15, street_name: 'Søndergade' });
  assert(c.id > 0 && c.created_at);
  assert.throws(() => db.addComment({ osm_way_id: '1', category: 'nope', body: 'x' }), /category/);
  assert.throws(() => db.addComment({ osm_way_id: '1', category: 'other', body: '   ' }), /required/);
  db.setSetting('dataset_path', 'C:\\x.gpkg');
  db.close();
  db = openDatabase(file);
  assert.strictEqual(db.listComments('23453451').length, 1);
  assert.strictEqual(db.getSetting('dataset_path'), 'C:\\x.gpkg');
  const rows = db.listComments();
  const csv = toCsv([...rows, { id: 9, osm_way_id: '1', category: 'other', body: '=HYPERLINK("x")' }]);
  assert(csv.includes('"Huller i belægningen, ""farligt"""'));
  assert(csv.includes("'=HYPERLINK"), 'formula injection not neutralised');
  const gj = JSON.parse(toGeoJson(rows));
  assert.deepStrictEqual(gj.features[0].geometry.coordinates, [10.2, 56.15]);
  assert(db.deleteComment(c.id));
  assert.strictEqual(db.listComments().length, 0);
  db.close();
});

test('NetAScore-lite scoring ranks infrastructure sensibly', () => {
  const track = scoreWay({ highway: 'secondary', 'cycleway:both': 'track', maxspeed: '50', surface: 'asphalt', sidewalk: 'both' });
  const bare = scoreWay({ highway: 'primary', maxspeed: '70', sidewalk: 'no' });
  const ped = scoreWay({ highway: 'pedestrian', surface: 'paving_stones' });
  const motor = scoreWay({ highway: 'trunk', maxspeed: '80' });
  assert(track.index_bike > bare.index_bike + 0.3, `${track.index_bike} vs ${bare.index_bike}`);
  assert(ped.index_walk > 0.9);
  assert.strictEqual(ped.index_bike, null, 'bikes not allowed on pedestrian street by default');
  assert.strictEqual(motor.index_bike, null);
  console.log(`   track bike=${track.index_bike} walk=${track.index_walk} | bare primary bike=${bare.index_bike} walk=${bare.index_walk} | pedestrian walk=${ped.index_walk}`);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} tests passed`);
