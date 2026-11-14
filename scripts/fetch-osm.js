#!/usr/bin/env node
'use strict';
/**
 * Build-time alternative to the in-app "Fetch OSM" button: downloads the Aarhus street
 * network from Overpass and writes approximate (NetAScore-lite) scores to
 * data/aarhus_osm_lite.geojson. Rename it to data/aarhus_netascore.geojson to bundle it
 * as the default dataset (the UI will label it "OSM-lite · approximate").
 *
 *   npm run fetch-osm
 */
const fs = require('fs');
const path = require('path');
const { fetchAarhusOsmLite } = require('../electron/osm-fetch');

(async () => {
  const out = path.join(__dirname, '..', 'data', 'aarhus_osm_lite.geojson');
  const fc = await fetchAarhusOsmLite({ onProgress: (m) => console.log('·', m) });
  fs.writeFileSync(out, JSON.stringify(fc));
  console.log(`✔ ${fc.features.length} ways → ${out}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
