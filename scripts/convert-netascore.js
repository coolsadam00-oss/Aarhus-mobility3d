#!/usr/bin/env node
'use strict';
/**
 * Convert a NetAScore GeoPackage (any projected CRS) into a compact EPSG:4326 GeoJSON
 * that can be bundled as data/aarhus_netascore.geojson.
 *
 *   npm run convert -- path/to/netascore_aarhus.gpkg [data/aarhus_netascore.geojson] [--keep-all]
 *
 * By default only fields the app displays are kept, which typically shrinks the file 3–5×.
 * Runs under Electron-as-Node so the built-in node:sqlite module of Electron is used.
 */
const fs = require('fs');
const path = require('path');
const { readGeoPackage } = require('../electron/gpkg');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const keepAll = process.argv.includes('--keep-all');
const [input, outputArg] = args;
if (!input) {
  console.error('Usage: npm run convert -- <netascore.gpkg> [output.geojson] [--keep-all]');
  process.exit(1);
}
const output = outputArg || path.join(__dirname, '..', 'data', 'aarhus_netascore.geojson');

const KEEP = /^(edge_id|osm_id|id|name|index_.*|bicycle_infrastructure.*|pedestrian_infrastructure.*|designated_route.*|road_category.*|max_speed.*|number_lanes.*|parking.*|pavement.*|width.*|gradient.*|stairs.*|crossings.*|facilities.*|buildings.*|greenness.*|water.*|noise.*|access_.*|length)$/;

const t0 = Date.now();
const { geojson, layer, sourceCrs } = readGeoPackage(input);
const round = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6] : c.map(round));
for (const f of geojson.features) {
  f.geometry.coordinates = round(f.geometry.coordinates);
  if (!keepAll) {
    f.properties = Object.fromEntries(Object.entries(f.properties).filter(([k, v]) => KEEP.test(k) && !/explanation/i.test(k) && v !== null));
  }
}
geojson.metadata = { source: 'netascore', layer, sourceCrs, converted: new Date().toISOString(), input: path.basename(input) };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(geojson));
const mb = (fs.statSync(output).size / 1048576).toFixed(1);
console.log(`✔ ${geojson.features.length} segments from layer "${layer}" (${sourceCrs}) → ${output} (${mb} MB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
