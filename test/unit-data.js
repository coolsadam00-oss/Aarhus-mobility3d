'use strict';
/**
 * Unit tests for the city-data pipeline: tag parsing, classification, multipolygon assembly,
 * pack conversion (context inference, addresses, GeoDanmark height matching), geo helpers.
 *   npm run test:unit   (runs under Electron-as-Node)
 */
const assert = require('assert');
const path = require('path');
const tags = require('../shared/tags');
const cls = require('../shared/classify');
const geo = require('../shared/geo');
const { elementToFeature, stitchRings, isAreaTags } = require('../electron/osm-assemble');
const conv = require('../electron/citypack-convert');
const { tileBbox } = require('../electron/citypack');
const { readLayer, readManifest } = require('../electron/citypack-io');
const { dedupeBuildings } = require('../shared/dedupe');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✔', name); };

test('tag parsing: lengths, levels, colours, speeds', () => {
  assert.strictEqual(tags.parseLength('12'), 12);
  assert.strictEqual(tags.parseLength('12,5 m'), 12.5);
  assert(Math.abs(tags.parseLength("40'") - 12.192) < 1e-6);
  assert(Math.abs(tags.parseLength('10 ft') - 3.048) < 1e-6);
  assert.strictEqual(tags.parseLength('abc'), null);
  assert.strictEqual(tags.parseLevels('4'), 4);
  assert.strictEqual(tags.parseLevels('2.5'), 2.5);
  assert.strictEqual(tags.parseColour('#ABC'), '#aabbcc');
  assert.strictEqual(tags.parseColour('Dark Grey'), '#555555');
  assert.strictEqual(tags.parseColour('nonsense'), null);
  assert.strictEqual(tags.parseMaxspeed('DK:urban'), 50);
  assert.strictEqual(tags.parseMaxspeed('30 mph'), 48);
  assert.strictEqual(tags.parseMaxspeed('walk'), 7);
});

test('tag formatting & grouping', () => {
  assert.strictEqual(tags.humanizeKey('building:levels'), 'Floors (above ground)');
  assert.strictEqual(tags.humanizeValue('height', '23'), '23 m');
  assert.strictEqual(tags.humanizeValue('maxspeed', '50'), '50 km/h');
  assert.strictEqual(tags.humanizeValue('surface', 'paving_stones'), 'Paving stones');
  assert.strictEqual(tags.formatAddress({ 'addr:street': 'Søndergade', 'addr:housenumber': '12', 'addr:postcode': '8000', 'addr:city': 'Aarhus C' }), 'Søndergade 12, 8000 Aarhus C');
  const g = tags.groupTags({ name: 'X', 'addr:street': 'Y', height: '10', website: 'https://x.dk', foo: 'bar' });
  assert.deepStrictEqual(g.map(x => x.id), ['identity', 'address', 'building', 'contact', 'other']);
  assert.strictEqual(tags.safeUrl('www.aarhus.dk'), 'https://www.aarhus.dk/');
  assert.strictEqual(tags.safeUrl('javascript:alert(1)'), null);
  assert.deepStrictEqual(tags.parseWikipedia('da:Aarhus Rådhus'), { lang: 'da', title: 'Aarhus Rådhus' });
});

test('building classification: tagged, function, name, context, unknown', () => {
  const a = cls.classifyBuilding({ building: 'apartments' });
  assert.strictEqual(a.label, 'Apartments'); assert.strictEqual(a.labelDa, 'Etageboliger'); assert.strictEqual(a.confidence, 'tagged');
  const u = cls.classifyBuilding({ building: 'yes', amenity: 'university', name: 'Aarhus Universitet' });
  assert.strictEqual(u.label, 'University'); assert.strictEqual(u.confidence, 'tagged');
  const mixed = cls.classifyBuilding({ building: 'apartments', shop: 'bakery' });
  assert.strictEqual(mixed.label, 'Apartments'); assert.deepStrictEqual(mixed.also, ['Bakery']);
  const st = cls.classifyBuilding({ building: 'train_station', name: 'Aarhus H' });
  assert.strictEqual(st.label, 'Train station');
  const church = cls.classifyBuilding({ building: 'yes', name: 'Vor Frue Kirke' });
  assert.strictEqual(church.kind, 'church'); assert.strictEqual(church.confidence, 'name');
  const notChurch = cls.classifyBuilding({ building: 'yes', name: 'Kirkens Korshær' });
  assert.strictEqual(notChurch.confidence, 'unknown');
  const school = cls.classifyBuilding({ building: 'yes', name: 'Aarhus Katedralskole' });
  assert.strictEqual(school.kind, 'school');
  const ctx = cls.classifyBuilding({ building: 'yes' }, { kind: 'amenity=university', name: 'Aarhus Universitet' });
  assert.strictEqual(ctx.label, 'University building'); assert.strictEqual(ctx.confidence, 'context'); assert(/Aarhus Universitet/.test(ctx.note));
  const unk = cls.classifyBuilding({ building: 'yes' });
  assert.strictEqual(unk.confidence, 'unknown'); assert.strictEqual(unk.label, 'Building');
  const part = cls.classifyBuilding({ 'building:part': 'yes', height: '40' });
  assert(part.part);
  const odd = cls.classifyBuilding({ building: 'weird_value' });
  assert.strictEqual(odd.label, 'Weird value');
});

test('POI and road classification', () => {
  assert.strictEqual(cls.classifyPoi({ amenity: 'cafe' }).labelDa, 'Café');
  assert.strictEqual(cls.classifyPoi({ shop: 'bicycle' }).label, 'Bicycle shop');
  assert.strictEqual(cls.classifyPoi({ railway: 'tram_stop' }).labelDa, 'Letbanestation');
  assert.strictEqual(cls.classifyPoi({ foo: 'bar' }).key, 'place');
  assert.strictEqual(cls.roadInfo('cycleway').labelDa, 'Cykelsti');
  assert.strictEqual(cls.roadWidth({ highway: 'residential' }), 5.5);
  assert.strictEqual(cls.roadWidth({ highway: 'primary', lanes: '4' }), 13);
  assert.strictEqual(cls.roadWidth({ highway: 'residential', width: '7,5' }), 7.5);
  const n = Object.keys(cls.BUILDINGS).length + Object.keys(cls.POIS).length + Object.keys(cls.ROADS).length + Object.keys(cls.LANDUSE).length;
  console.log(`   dictionary: ${n} classified kinds (EN + DA)`);
  assert(n > 400);
  for (const [k, v] of Object.entries(cls.POIS)) assert(v.length === 4 && v[0] && v[1] && v[2] && v[3], 'bad POI entry ' + k);
  for (const [k, v] of Object.entries(cls.BUILDINGS)) assert(v.length === 7 && cls.FACADE_PALETTES[v[4]], 'bad building entry ' + k);
});

test('multipolygon stitching with reversed segments and an inner ring', () => {
  const outer = [[[0, 0], [1, 0]], [[1, 1], [1, 0]], [[1, 1], [0, 1], [0, 0]]];
  const rings = stitchRings(outer);
  assert.strictEqual(rings.length, 1);
  assert.strictEqual(rings[0].length, 5);
  const rel = {
    type: 'relation', id: 9, tags: { type: 'multipolygon', building: 'yes' },
    members: [
      { type: 'way', role: 'outer', geometry: [{ lon: 0, lat: 0 }, { lon: 0.001, lat: 0 }] },
      { type: 'way', role: 'outer', geometry: [{ lon: 0.001, lat: 0.001 }, { lon: 0.001, lat: 0 }] },
      { type: 'way', role: 'outer', geometry: [{ lon: 0.001, lat: 0.001 }, { lon: 0, lat: 0.001 }, { lon: 0, lat: 0 }] },
      { type: 'way', role: 'inner', geometry: [{ lon: 0.0003, lat: 0.0003 }, { lon: 0.0006, lat: 0.0003 }, { lon: 0.0006, lat: 0.0006 }, { lon: 0.0003, lat: 0.0003 }] }
    ]
  };
  const f = elementToFeature(rel);
  assert.strictEqual(f.geometry.type, 'Polygon');
  assert.strictEqual(f.geometry.coordinates.length, 2);
  assert(geo.ringSignedArea(f.geometry.coordinates[0]) > 0, 'outer must be CCW');
  assert(geo.ringSignedArea(f.geometry.coordinates[1]) < 0, 'inner must be CW');
  assert.strictEqual(f.id, 'r9');
});

test('way area detection (roundabout stays a line, building becomes polygon)', () => {
  const ring = [{ lon: 0, lat: 0 }, { lon: 0.001, lat: 0 }, { lon: 0.001, lat: 0.001 }, { lon: 0, lat: 0 }];
  assert.strictEqual(elementToFeature({ type: 'way', id: 1, tags: { highway: 'primary', junction: 'roundabout' }, geometry: ring }).geometry.type, 'LineString');
  assert.strictEqual(elementToFeature({ type: 'way', id: 2, tags: { building: 'yes' }, geometry: ring }).geometry.type, 'Polygon');
  assert.strictEqual(isAreaTags({ natural: 'tree_row' }), false);
  assert.strictEqual(isAreaTags({ leisure: 'park' }), true);
  assert.strictEqual(elementToFeature({ type: 'node', id: 3, lat: 56, lon: 10, tags: {} }).geometry.type, 'Point');
  assert.strictEqual(elementToFeature({ type: 'way', id: 4, center: { lat: 56, lon: 10 }, tags: { shop: 'x' } }).geometry.type, 'Point');
});

function sq(x, y, s, id, t) {
  return { type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] }, properties: { id, tags: t } };
}

test('pack conversion: context inference, assigned addresses, measured heights', () => {
  const campus = sq(10.20, 56.16, 0.002, 'w100', { amenity: 'university', name: 'Aarhus Universitet' });
  const resid = sq(10.19, 56.16, 0.02, 'w101', { landuse: 'residential' });
  const b1 = sq(10.2005, 56.1605, 0.0002, 'w1', { building: 'yes' });
  const b2 = sq(10.195, 56.165, 0.0002, 'w2', { building: 'yes' });
  const b3 = sq(10.196, 56.166, 0.0002, 'w3', { building: 'apartments', 'building:levels': '5' });
  const b4 = sq(10.197, 56.167, 0.0002, 'w4', { building: 'office', height: '31 m', 'roof:shape': 'flat', 'building:colour': 'white' });
  const addr = { type: 'Feature', id: 'n9', geometry: { type: 'Point', coordinates: [10.1951, 56.1651] }, properties: { id: 'n9', s: 'Testvej', hn: '7', pc: '8000', c: 'Aarhus C' } };
  const fot = [{ type: 'Feature', id: 'fot:1', geometry: b2.geometry, properties: { id: 'fot:1', h: 17.3 } }];
  const areas = conv.convertAreas([campus, resid]);
  assert.strictEqual(areas.context.length, 2);
  const r = conv.convertBuildings([b1, b2, b3, b4], { areas: areas.context.map(f => ({ ...f, properties: { ...f.properties, tags: f.properties.t } })), addresses: [addr], fot });
  const by = Object.fromEntries(r.features.map(f => [f.id, f.properties]));
  assert.strictEqual(by.w1.lbl, 'University building'); assert.strictEqual(by.w1.cf, 'context'); assert.strictEqual(by.w1.ctxn, 'Aarhus Universitet');
  assert.strictEqual(by.w2.lbl, 'Residential building'); assert.strictEqual(by.w2.a, 'Testvej 7, 8000 Aarhus C');
  assert.strictEqual(by.w2.hs, 'g'); assert.strictEqual(by.w2.h, 17.3);
  assert.strictEqual(by.w3.hs, 'l'); assert.strictEqual(by.w3.h, 15.6);
  assert.strictEqual(by.w4.hs, 't'); assert.strictEqual(by.w4.h, 31); assert.strictEqual(by.w4.ht, 1); assert.strictEqual(by.w4.c, '#f2f0ea');
  assert.strictEqual(r.stats.measured, 1);
});

test('road conversion: sides, oneway, bridge, widths', () => {
  const line = { type: 'LineString', coordinates: [[10.2, 56.15], [10.201, 56.151]] };
  const r = conv.convertRoads([
    { type: 'Feature', id: 'w5', geometry: line, nodes: [1, 2], properties: { tags: { highway: 'secondary', name: 'Nørrebrogade', 'cycleway:both': 'track', sidewalk: 'both', oneway: 'yes', bridge: 'yes', maxspeed: '50', lanes: '2' } } },
    { type: 'Feature', id: 'w6', geometry: { type: 'Polygon', coordinates: [[[10, 56], [10.001, 56], [10.001, 56.001], [10, 56]]] }, properties: { tags: { highway: 'pedestrian', area: 'yes' } } }
  ]);
  const p = r.features[0].properties;
  assert.strictEqual(p.cwl, 'track'); assert.strictEqual(p.cwr, 'track'); assert.strictEqual(p.swl, 'yes'); assert.strictEqual(p.swr, 'yes');
  assert.strictEqual(p.ow, 1); assert.strictEqual(p.br, 1); assert.strictEqual(p.ms, 50); assert.strictEqual(p.w, 6.5); assert.deepStrictEqual(p.nd, [1, 2]);
  assert.strictEqual(r.areas.length, 1);
  assert.deepStrictEqual(conv.sideSpec({ 'sidewalk:left': 'separate', 'sidewalk:right': 'yes' }, 'sidewalk'), ['separate', 'yes']);
});

test('points: furniture vs POI, trees incl. tree rows', () => {
  const P = (id, lon, lat, t) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { id, tags: t } });
  const r = conv.convertPoints([
    P('n1', 10.2, 56.15, { highway: 'street_lamp' }),
    P('n2', 10.2, 56.15, { amenity: 'cafe', name: 'Café X' }),
    P('n3', 10.2, 56.15, { natural: 'tree', leaf_type: 'needleleaved', height: '12' }),
    P('n4', 10.2, 56.15, { highway: 'bus_stop', name: 'Park Allé' }),
    { type: 'Feature', id: 'w7', geometry: { type: 'LineString', coordinates: [[10.2, 56.15], [10.2003, 56.15]] }, properties: { id: 'w7', tags: { natural: 'tree_row' } } },
    { type: 'Feature', id: 'w8', geometry: { type: 'LineString', coordinates: [[10.2, 56.15], [10.2003, 56.15]] }, properties: { id: 'w8', tags: { barrier: 'hedge' } } }
  ]);
  assert.strictEqual(r.furniture.length, 2);
  assert.deepStrictEqual(r.pois.map(p => p.properties.lbl).sort(), ['Bus stop', 'Café']);
  assert.strictEqual(r.trees[0].properties.lt, 'needleleaved');
  assert(r.trees.length >= 3, 'tree row expanded');
  const ids = new Set(r.trees.map(t => t.id));
  assert.strictEqual(ids.size, r.trees.length, 'unique tree ids');
  assert.strictEqual(r.barriers[0].properties.h, 1.5);
});

test('geo helpers: frame round trip, areas, point in polygon, normText, tiling', () => {
  const fr = geo.makeFrame(10.2039, 56.1629);
  const [x, z] = fr.toLocal(10.2139, 56.1529);
  const back = fr.toLngLat(x, z);
  assert(Math.abs(back[0] - 10.2139) < 1e-9 && Math.abs(back[1] - 56.1529) < 1e-9);
  const d = Math.hypot(x, z), h = geo.haversine([10.2039, 56.1629], [10.2139, 56.1529]);
  assert(Math.abs(d - h) / h < 0.004, `local frame ${d.toFixed(1)} m vs spherical ${h.toFixed(1)} m`);
  assert(Math.abs(geo.mPerDegLat(56.16) - 111344.7) < 1 && Math.abs(geo.mPerDegLng(56.16) - 62134.8) < 1, 'WGS84 degree lengths at Aarhus');
  const a = geo.ringAreaM2([[10, 56], [10.001, 56], [10.001, 56.001], [10, 56.001], [10, 56]]);
  assert(Math.abs(a - 0.001 * geo.mPerDegLng(56) * 0.001 * geo.mPerDegLat(56)) / a < 0.001, 'area: ' + a);
  assert(geo.pointInPolygon([0.5, 0.5], [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]]]) === false);
  assert.strictEqual(geo.normText('Søndergade Å'), 'soendergade aa');
  const tiles = tileBbox([10.12, 56.11, 10.26, 56.21], 6); assert.strictEqual(tiles.length, 25); assert(Math.abs(tiles[24][2] - 10.26) < 1e-9 && Math.abs(tiles[24][3] - 56.21) < 1e-9, 'tiles cover bbox');
  assert.strictEqual(tileBbox([10.185, 56.145, 10.225, 56.165], 6).length, 1);
});

test('bundled starter pack is valid', () => {
  const dir = path.join(__dirname, '..', 'data', 'starter');
  const m = readManifest(dir);
  assert(m && m.dem && m.layers.buildings.count > 7000);
  const b = readLayer(dir, 'buildings');
  assert(b.every(f => f.properties.h > 1 && f.properties.h < 131));
  assert(b.every(f => geo.ringSignedArea(f.geometry.coordinates[0]) > 0));
  const roads = readLayer(dir, 'roads');
  const ends = new Map();
  for (const r of roads) for (const n of [r.properties.nd[0], r.properties.nd[r.properties.nd.length - 1]]) ends.set(n, (ends.get(n) || 0) + 1);
  const junctions = [...ends.values()].filter(v => v >= 3).length;
  console.log(`   starter: ${b.length} buildings, ${roads.length} roads, ${junctions} junctions`);
  assert(junctions > 300, 'road network is connected via shared end nodes');
});

test('duplicate building footprints are merged (no flickering twin walls)', () => {
  const sq = (x, y, s) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s * 0.56], [x, y + s * 0.56], [x, y]]] });
  const a = { type: 'Feature', id: 'w1', geometry: sq(10.2, 56.15, 0.0002), properties: { k: 'yes', t: { building: 'yes' } } };
  const b = { type: 'Feature', id: 'w2', geometry: sq(10.200001, 56.15, 0.0002), properties: { k: 'apartments', a: 'Mejlgade 1', n: 'Gården', t: { building: 'apartments' } } };
  const c = { type: 'Feature', id: 'w3', geometry: sq(10.2003, 56.15, 0.0002), properties: { k: 'house' } };           // neighbour, not a twin
  const d = { type: 'Feature', id: 'w4', geometry: sq(10.2, 56.15, 0.00008), properties: { k: 'shed', part: 1 } };       // small part inside
  const r = dedupeBuildings([a, b, c, d]);
  assert.deepStrictEqual(r.features.map(f => f.id), ['w2', 'w3', 'w4']);
  assert.deepStrictEqual(r.dropped, [{ id: 'w1', keptId: 'w2' }]);
  // facts only the dropped twin had are kept
  const e = { type: 'Feature', id: 'w5', geometry: sq(10.21, 56.15, 0.0002), properties: { k: 'apartments', n: 'A', lv: 4 } };
  const f = { type: 'Feature', id: 'w6', geometry: sq(10.21, 56.15, 0.0002), properties: { k: 'yes', a: 'Vestergade 9' } };
  const r2 = dedupeBuildings([e, f]);
  assert.strictEqual(r2.features.length, 1);
  assert.strictEqual(r2.features[0].properties.a, 'Vestergade 9');
  // the bundled GeoDanmark data really has such twins
  const sb = readLayer(path.join(__dirname, '..', 'data', 'starter'), 'buildings');
  const n = dedupeBuildings(sb.map(x => ({ ...x, properties: { ...x.properties } }))).dropped.length;
  console.log(`   starter pack: ${n} duplicate footprints merged at load`);
  assert(n > 0 && n < 50);
});

console.log(`\n${passed} data tests passed`);
