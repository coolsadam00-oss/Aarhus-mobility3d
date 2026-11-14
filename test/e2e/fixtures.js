'use strict';
/**
 * Test fixtures for the end-to-end run (never shipped in the app):
 *  - a fake Overpass API answering the app's queries with OSM-like elements derived from the real
 *    GeoDanmark geometry of Aarhus 8000 plus deterministic synthetic tags (types, names, sidewalks …)
 *  - Terrarium elevation tiles rendered from the GeoDanmark 5 m terrain grid (sea to the east)
 *  - synthetic "aerial photo" tiles rasterised from the same buildings, roads and trees
 */
const fs = require('fs');
const path = require('path');
const { readLayer, readManifest } = require('../../electron/citypack-io');
const { GridIndex, bboxOfGeometry, geometryCentroid, haversine } = require('../../shared/geo');

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function buildFixtures(starterDir) {
  const r = rng(42);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const B = readLayer(starterDir, 'buildings'), R = readLayer(starterDir, 'roads'), T = readLayer(starterDir, 'trees'), W = readLayer(starterDir, 'water');
  const els = { buildings: [], roads: [], railways: [], areas: [], pois: [], furniture: [], addresses: [] };
  let nodeSeq = 3e9;
  const nid = (v) => (v < 0 ? 2e9 - v : v);
  const geom = (coords) => coords.map(c => ({ lat: c[1], lon: c[0] }));

  // roads with realistic class mix, names and Danish street layout tags
  const roadNames = ['Søndergade', 'Park Allé', 'Vestergade', 'Nørregade', 'Frederiks Allé', 'Jægergårdsgade', 'Mejlgade', 'Skolegade', 'Klostergade', 'Fredensgade', 'Ryesgade', 'Banegårdsgade', 'Marselis Boulevard', 'Ny Munkegade', 'Nørrebrogade', 'Vesterbrogade', 'Thorvaldsensgade', 'Valdemarsgade', 'Silkeborgvej', 'Viborgvej'];
  R.forEach((f, i) => {
    const p = f.properties;
    const isPath = p.k === 'path';
    let tags;
    if (isPath) tags = { highway: pick(['footway', 'footway', 'cycleway', 'path']), surface: pick(['asphalt', 'paving_stones', 'compacted']) };
    else {
      const hw = r() < 0.08 ? 'secondary' : r() < 0.15 ? 'tertiary' : r() < 0.05 ? 'primary' : r() < 0.1 ? 'service' : 'residential';
      tags = { highway: hw, name: pick(roadNames), surface: r() < 0.9 ? 'asphalt' : 'sett', maxspeed: hw === 'residential' ? (r() < 0.5 ? '30' : '50') : '50', lit: 'yes' };
      if (hw === 'secondary' || hw === 'primary') { tags['cycleway:both'] = 'track'; tags.sidewalk = 'both'; tags.lanes = hw === 'primary' ? '4' : '2'; }
      else if (hw !== 'service') tags.sidewalk = r() < 0.75 ? 'both' : 'separate';
      if (r() < 0.06) tags.oneway = 'yes';
    }
    els.roads.push({ type: 'way', id: 400000000 + i, nodes: p.nd.map(nid), geometry: geom(f.geometry.coordinates), tags });
  });

  // buildings: types by size, some levels, names and roof shapes
  const nameList = ['Aarhus Katedralskole', 'Vor Frue Kirke', 'Kulturhuset', 'Hotel Royal', 'Kollegiet Testbo', 'Rådhuset (test)', 'Bispetorv Hus', 'Dokk1 (test)', 'Sankt Pauls Kirke', 'Klinik Nord'];
  B.forEach((f, i) => {
    const p = f.properties;
    const ring = f.geometry.coordinates[0];
    const lat = ring[0][1], kx = 62134, ky = 111345;
    let a = 0; for (let k = 0, n = ring.length, j = n - 1; k < n; j = k++) a += (ring[j][0] * kx) * (ring[k][1] * ky) - (ring[k][0] * kx) * (ring[j][1] * ky);
    const area = Math.abs(a / 2);
    void lat;
    let type;
    if (area < 45) type = pick(['garage', 'shed', 'yes']);
    else if (area < 220) type = pick(['house', 'yes', 'yes', 'apartments', 'semidetached_house']);
    else type = pick(['apartments', 'apartments', 'apartments', 'yes', 'commercial', 'office', 'retail', 'school']);
    const tags = { building: type };
    if (r() < 0.55 && p.h > 3) tags['building:levels'] = String(Math.max(1, Math.round(p.h / 3.1)));
    if (r() < 0.04) tags.name = pick(nameList);
    if (type === 'house' && r() < 0.5) tags['roof:shape'] = 'gabled';
    if (r() < 0.05) tags['roof:colour'] = pick(['red', 'grey', 'black']);
    if (r() < 0.03) { tags.wikidata = 'Q' + (1000 + i); }
    els.buildings.push({ type: 'way', id: 500000000 + i, geometry: geom(ring), tags });
  });

  // areas: real ponds, plus a university campus, a park and a residential zone for context inference
  W.forEach((f, i) => els.areas.push({ type: 'way', id: 600000000 + i, geometry: geom(f.geometry.coordinates[0]), tags: { natural: 'water', name: 'Testsø ' + i } }));
  const rect = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
  els.areas.push({ type: 'way', id: 600001000, geometry: geom(rect(10.199, 56.158, 10.206, 56.162)), tags: { amenity: 'university', name: 'Aarhus Universitet (test campus)' } });
  els.areas.push({ type: 'way', id: 600001001, geometry: geom(rect(10.195, 56.145, 10.200, 56.148)), tags: { leisure: 'park', name: 'Testparken' } });
  els.areas.push({ type: 'way', id: 600001002, geometry: geom(rect(10.178, 56.14, 10.217, 56.171)), tags: { landuse: 'residential' } });

  // POIs & furniture
  const poiKinds = [['amenity', 'cafe'], ['amenity', 'restaurant'], ['shop', 'bakery'], ['shop', 'supermarket'], ['shop', 'clothes'], ['amenity', 'pharmacy'], ['shop', 'bicycle'], ['amenity', 'bank']];
  for (let i = 0; i < 160; i++) {
    const b = B[Math.floor(r() * B.length)];
    const c = geometryCentroid(b.geometry);
    const [k, v] = pick(poiKinds);
    els.pois.push({ type: 'node', id: 700000000 + i, lat: c[1], lon: c[0], tags: { [k]: v, name: `${v.replace(/_/g, ' ')} ${i}`, opening_hours: 'Mo-Fr 08:00-18:00' } });
  }
  els.pois.push({ type: 'node', id: 700009999, lat: 56.15034, lon: 10.20424, tags: { railway: 'station', public_transport: 'station', name: 'Aarhus H', operator: 'DSB' } });
  T.forEach((f, i) => els.furniture.push({ type: 'node', id: 800000000 + i, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], tags: { natural: 'tree', leaf_type: r() < 0.15 ? 'needleleaved' : 'broadleaved' } }));
  // zebra crossings on junction nodes of some named streets, bus stops, benches
  const deg = new Map();
  for (const w of els.roads) for (const id of w.nodes) deg.set(id, (deg.get(id) || 0) + 1);
  let cz = 0;
  for (const w of els.roads) {
    if (!w.tags.name || cz > 120) continue;
    const k = Math.floor(w.nodes.length / 2);
    if (r() < 0.25 && w.geometry.length > 2) { els.furniture.push({ type: 'node', id: w.nodes[k], lat: w.geometry[k].lat, lon: w.geometry[k].lon, tags: { highway: 'crossing', crossing: 'uncontrolled', 'crossing:markings': 'zebra' } }); cz++; }
    if (r() < 0.08) { const g = w.geometry[0]; els.furniture.push({ type: 'node', id: nodeSeq++, lat: g.lat + 0.00003, lon: g.lon, tags: { highway: 'bus_stop', name: w.tags.name + ' (bus)', shelter: r() < 0.5 ? 'yes' : 'no' } }); }
    if (r() < 0.1) { const g = w.geometry[Math.max(0, k - 1)]; els.furniture.push({ type: 'node', id: nodeSeq++, lat: g.lat, lon: g.lon + 0.00004, tags: { amenity: 'bench' } }); }
  }
  // addresses at building centroids
  const roadIdx = new GridIndex(0.002);
  for (const w of els.roads) if (w.tags.name) { const bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const g of w.geometry) { bb[0] = Math.min(bb[0], g.lon); bb[1] = Math.min(bb[1], g.lat); bb[2] = Math.max(bb[2], g.lon); bb[3] = Math.max(bb[3], g.lat); } roadIdx.insert(w, bb); }
  const num = new Map();
  B.forEach((b, i) => {
    if (r() > 0.7) return;
    const c = geometryCentroid(b.geometry);
    let best = null, bd = Infinity;
    for (const w of roadIdx.query([c[0] - 0.001, c[1] - 0.0006, c[0] + 0.001, c[1] + 0.0006])) for (const g of w.geometry) { const d = haversine(c, [g.lon, g.lat]); if (d < bd) { bd = d; best = w; } }
    if (!best) return;
    const n = (num.get(best.tags.name) || 0) + 1 + Math.floor(r() * 2);
    num.set(best.tags.name, n);
    els.addresses.push({ type: 'node', id: 900000000 + i, lat: c[1], lon: c[0], tags: { 'addr:street': best.tags.name, 'addr:housenumber': String(n), 'addr:postcode': '8000', 'addr:city': 'Aarhus C' } });
  });
  return els;
}

function inBbox(el, bb) {
  const [s, w, n, e] = bb;
  const pts = el.geometry ? el.geometry : el.center ? [el.center] : [{ lat: el.lat, lon: el.lon }];
  return pts.some(p => p && p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e);
}

function layerOf(q) {
  if (q.includes('around:')) return 'around';
  if (q.includes('way["building"]')) return 'buildings';
  if (q.includes('addr:housenumber')) return 'addresses';
  if (q.includes('street_lamp')) return 'furniture';
  if (q.includes('way["railway"~')) return 'railways';
  if (q.includes('way["landuse"]')) return 'areas';
  if (q.includes('node["shop"]')) return 'pois';
  if (q.includes('way["highway"]')) return 'roads';
  return null;
}

function answer(els, query, stats) {
  const layer = layerOf(query);
  const m = query.match(/\((-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)\)/);
  let out = [];
  if (layer === 'around') {
    const a = query.match(/around:(\d+),(-?\d+\.\d+),(-?\d+\.\d+)/);
    const lat = Number(a[2]), lon = Number(a[3]);
    out = els.buildings.filter(b => b.geometry.some(g => haversine([lon, lat], [g.lon, g.lat]) < 60)).map(b => ({ ...b, nodes: undefined }));
  } else if (layer && m) {
    const bb = m.slice(1).map(Number);
    out = els[layer].filter(el => inBbox(el, bb));
    if (/out tags center/.test(query)) out = out.map(el => el.type === 'node' ? el : { type: el.type, id: el.id, tags: el.tags, center: el.geometry[Math.floor(el.geometry.length / 2)] });
  }
  if (stats) stats[layer || 'unknown'] = (stats[layer || 'unknown'] || 0) + 1;
  return { version: 0.6, generator: 'AM3D test Overpass', osm3s: { timestamp_osm_base: '2026-11-14T12:00:00Z' }, elements: out };
}

// ------------------------------------------------------------------ tiles
function demSampler(starterDir) {
  const m = readManifest(starterDir).dem;
  const data = new Int16Array(fs.readFileSync(path.join(starterDir, m.file)).buffer.slice(0));
  const [w, s, e, n] = m.bbox;
  return (lng, lat) => {
    if (lng > 10.226) return -6; // sea east of the city (tests the sea plane)
    const fx = Math.max(0, Math.min(m.nx - 1.001, ((lng - w) / (e - w)) * (m.nx - 1)));
    const fy = Math.max(0, Math.min(m.ny - 1.001, ((n - lat) / (n - s)) * (m.ny - 1)));
    const i = Math.floor(fx), j = Math.floor(fy), ax = fx - i, ay = fy - j;
    const z = (ii, jj) => data[jj * m.nx + ii] / 10;
    return (z(i, j) * (1 - ax) + z(i + 1, j) * ax) * (1 - ay) + (z(i, j + 1) * (1 - ax) + z(i + 1, j + 1) * ax) * ay;
  };
}

const tile2lng = (x, z) => (x / 2 ** z) * 360 - 180;
const tile2lat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(Math.sinh(n)); };

function terrariumTile(sample, z, x, y) {
  const buf = Buffer.alloc(256 * 256 * 4);
  for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
    const lng = tile2lng(x + (px + 0.5) / 256, z), lat = tile2lat(y + (py + 0.5) / 256, z);
    const v = sample(lng, lat) + 32768;
    const R = Math.floor(v / 256), G = Math.floor(v) % 256, Bc = Math.floor((v - Math.floor(v)) * 256);
    const i = (py * 256 + px) * 4;
    buf[i] = Bc; buf[i + 1] = G; buf[i + 2] = R; buf[i + 3] = 255; // BGRA
  }
  return buf;
}

/** Synthetic aerial photo: grass/pavement ground, roads, roofs, tree crowns, water, sea. */
function aerialTileFactory(starterDir, els) {
  const B = readLayer(starterDir, 'buildings'), R = els.roads, T = readLayer(starterDir, 'trees');
  const bIdx = new GridIndex(0.002), rIdx = new GridIndex(0.002), tIdx = new GridIndex(0.002);
  for (const b of B) bIdx.insert(b, bboxOfGeometry(b.geometry));
  for (const w of R) { const c = w.geometry.map(g => [g.lon, g.lat]); rIdx.insert({ w, c }, [Math.min(...c.map(q => q[0])), Math.min(...c.map(q => q[1])), Math.max(...c.map(q => q[0])), Math.max(...c.map(q => q[1]))]); }
  for (const t of T) { const c = t.geometry.coordinates; tIdx.insert(c, [c[0], c[1], c[0], c[1]]); }
  return (z, x, y) => {
    const w = tile2lng(x, z), e = tile2lng(x + 1, z), n = tile2lat(y, z), s = tile2lat(y + 1, z);
    const buf = Buffer.alloc(256 * 256 * 4);
    const P = (lng, lat) => [((lng - w) / (e - w)) * 256, ((n - lat) / (n - s)) * 256];
    const mpp = ((e - w) * 62134) / 256;
    const set = (px, py, r, g, b) => { if (px < 0 || py < 0 || px >= 256 || py >= 256) return; const i = (py * 256 + px) * 4; buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255; };
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const lng = w + ((px + 0.5) / 256) * (e - w);
      const nz = Math.sin(px * 0.37 + py * 0.11) * Math.cos(py * 0.29 - px * 0.07) * 10 + ((px * 73856093 ^ py * 19349663) % 13);
      if (lng > 10.226) set(px, py, 38 + nz * 0.3, 70 + nz * 0.4, 92 + nz * 0.5);
      else set(px, py, 104 + nz, 112 + nz, 92 + nz * 0.8);
    }
    const bb = [w, s, e, n];
    for (const { w: way, c } of rIdx.query(bb)) {
      const width = (way.tags.highway === 'secondary' || way.tags.highway === 'primary' ? 9 : way.tags.highway.match(/foot|path|cycle/) ? 2.2 : 6) / mpp;
      const col = way.tags.highway.match(/foot|path/) ? [150, 146, 138] : [62, 63, 66];
      for (let k = 1; k < c.length; k++) {
        const [ax, ay] = P(...c[k - 1]), [bx, by] = P(...c[k]);
        const x0 = Math.floor(Math.min(ax, bx) - width), x1 = Math.ceil(Math.max(ax, bx) + width), y0 = Math.floor(Math.min(ay, by) - width), y1 = Math.ceil(Math.max(ay, by) + width);
        for (let py = Math.max(0, y0); py <= Math.min(255, y1); py++) for (let px = Math.max(0, x0); px <= Math.min(255, x1); px++) {
          const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
          if (Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= width / 2) set(px, py, ...col);
        }
      }
    }
    for (const b of bIdx.query(bb)) {
      const ring = b.geometry.coordinates[0].map(q => P(...q));
      const seed = b.properties.seed || 0;
      const col = seed % 3 === 0 ? [150, 70, 52] : seed % 3 === 1 ? [92, 92, 96] : [126, 122, 116];
      const ys = ring.map(q => q[1]);
      for (let py = Math.max(0, Math.floor(Math.min(...ys))); py <= Math.min(255, Math.ceil(Math.max(...ys))); py++) {
        const xs = [];
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
          const [x1, y1] = ring[j], [x2, y2] = ring[k];
          if ((y1 > py + 0.5) !== (y2 > py + 0.5)) xs.push(x1 + ((py + 0.5 - y1) * (x2 - x1)) / (y2 - y1));
        }
        xs.sort((a, b2) => a - b2);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let px = Math.max(0, Math.ceil(xs[k])); px <= Math.min(255, Math.floor(xs[k + 1])); px++) set(px, py, ...col);
      }
    }
    for (const c of tIdx.query(bb)) {
      const [cx, cy] = P(...c);
      const r = 3.2 / mpp;
      for (let py = Math.floor(cy - r); py <= cy + r; py++) for (let px = Math.floor(cx - r); px <= cx + r; px++) if (Math.hypot(px - cx, py - cy) <= r) set(px, py, 52, 84, 42);
    }
    return buf;
  };
}

module.exports = { buildFixtures, answer, layerOf, demSampler, terrariumTile, aerialTileFactory };
