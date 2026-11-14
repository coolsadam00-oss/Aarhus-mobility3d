#!/usr/bin/env node
'use strict';
/**
 * Builds the bundled offline "starter pack" for Aarhus 8000 from GeoDanmark (FOT) data
 * published as KML in the MIT-licensed CityPulse 3D map repository:
 *   https://github.com/CityPulse/CityPulse-3D-Map/tree/master/3dmap-master/data/kml/8k
 *
 *   node scripts/build-starter.js <dir-with-buildings.kml-roads.kml-trees.kml-water.kml> [outDir]
 *
 * Outputs (in the app's city-pack format):
 *   buildings.json  7 000+ footprints, wall height = measured roof-edge elevation − modelled ground
 *   roads.json      road/path centrelines           trees.json  surveyed individual trees
 *   water.json      ponds / lakes                    dem.bin     5 m terrain model (int16 decimetres, DVR90)
 *   dem_conf.bin    distance (m) to the nearest ground sample, used to blend with global DEM tiles
 */
const fs = require('fs');
const path = require('path');
const { writePack } = require('../electron/citypack-io');
const { ringSignedArea, haversine, mPerDegLat, mPerDegLng } = require('../shared/geo');
const { hashString } = require('../shared/classify');

const inDir = process.argv[2];
const outDir = process.argv[3] || path.join(__dirname, '..', 'data', 'starter');
if (!inDir) { console.error('Usage: node scripts/build-starter.js <kml dir> [outDir]'); process.exit(1); }

// ------------------------------------------------------------------ KML parsing (simple, format-specific)
function parseKml(file) {
  const s = fs.readFileSync(file, 'latin1'); // the files mix encodings; numbers and ids are ASCII
  const pms = s.split('<Placemark>').slice(1);
  return pms.map(pm => {
    const data = {};
    for (const m of pm.matchAll(/<SimpleData name="([^"]+)">([^<]*)<\/SimpleData>/g)) data[m[1]] = m[2];
    const outer = [...pm.matchAll(/<outerBoundaryIs>[\s\S]*?<coordinates>([^<]*)<\/coordinates>/g)].map(m => m[1]);
    const inner = [...pm.matchAll(/<innerBoundaryIs>[\s\S]*?<coordinates>([^<]*)<\/coordinates>/g)].map(m => m[1]);
    const line = [...pm.matchAll(/<LineString>[\s\S]*?<coordinates>([^<]*)<\/coordinates>/g)].map(m => m[1]);
    const point = [...pm.matchAll(/<Point>[\s\S]*?<coordinates>([^<]*)<\/coordinates>/g)].map(m => m[1]);
    const parse = (txt) => txt.trim().split(/\s+/).map(p => p.split(',').map(Number)).filter(c => c.length >= 2 && Number.isFinite(c[0]));
    return { data, outer: outer.map(parse), inner: inner.map(parse), line: line.map(parse), point: point.map(parse) };
  });
}

const R7 = (v) => Math.round(v * 1e7) / 1e7;
const t0 = Date.now();
const B = parseKml(path.join(inDir, 'buildings.kml'));
const RD = parseKml(path.join(inDir, 'roads.kml'));
const T = parseKml(path.join(inDir, 'trees.kml'));
const W = fs.existsSync(path.join(inDir, 'water.kml')) ? parseKml(path.join(inDir, 'water.kml')) : [];
console.log(`parsed ${B.length} buildings, ${RD.length} roads, ${T.length} trees, ${W.length} water in ${Date.now() - t0} ms`);

// ------------------------------------------------------------------ extent
let bb = [Infinity, Infinity, -Infinity, -Infinity];
const ext = (c) => { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); };
for (const f of [...B, ...RD, ...T, ...W]) for (const r of [...f.outer, ...f.line, ...f.point]) for (const c of r) ext(c);
const lat0 = (bb[1] + bb[3]) / 2;
const mLng = mPerDegLng(lat0), mLat = mPerDegLat(lat0);
const MARGIN = 150; // m
const RES = 5;      // m
// Grid is linear in degrees: cell (i, j) centre = (west + i*dLng, north - j*dLat). The renderer uses the same mapping.
const west = bb[0] - MARGIN / mLng, north = bb[3] + MARGIN / mLat;
const NX = Math.ceil(((bb[2] - bb[0]) * mLng + 2 * MARGIN) / RES) + 1;
const NY = Math.ceil(((bb[3] - bb[1]) * mLat + 2 * MARGIN) / RES) + 1;
const dLng = RES / mLng, dLat = RES / mLat;
const dem = { bbox: [west, north - (NY - 1) * dLat, west + (NX - 1) * dLng, north], res: RES, nx: NX, ny: NY };
const cellOf = (lng, lat) => [Math.round((lng - west) / dLng), Math.round((north - lat) / dLat)];
console.log(`DEM grid ${NX} x ${NY} @ ${RES} m`);

// ------------------------------------------------------------------ ground samples (road centrelines densified + trees)
const sum = new Float64Array(NX * NY), cnt = new Uint32Array(NX * NY);
const addSample = (lng, lat, z) => {
  if (!(z > -50 && z < 300)) return;
  const [i, j] = cellOf(lng, lat);
  if (i < 0 || j < 0 || i >= NX || j >= NY) return;
  sum[j * NX + i] += z; cnt[j * NX + i]++;
};
let nSamples = 0;
for (const r of RD) for (const line of r.line) {
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1], b = line[k];
    if (!(a[2] > -50) || !(b[2] > -50)) continue;
    const d = haversine(a, b);
    const steps = Math.max(1, Math.ceil(d / 2.5));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      addSample(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
      nSamples++;
    }
  }
}
for (const t of T) for (const p of t.point) for (const c of p) { addSample(c[0], c[1], c[2]); nSamples++; }
// pond / lake shorelines are ground level too
for (const w of W) for (const ring of w.outer) for (const c of ring) { addSample(c[0], c[1], c[2]); nSamples++; }
console.log(`${nSamples} ground samples`);

// ------------------------------------------------------------------ multigrid Laplace fill of unsampled cells
function solveLevel(nx, ny, val, known, iters) {
  for (let it = 0; it < iters; it++) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (known[k]) continue;
      let s = 0, n = 0;
      if (i > 0) { s += val[k - 1]; n++; }
      if (i < nx - 1) { s += val[k + 1]; n++; }
      if (j > 0) { s += val[k - nx]; n++; }
      if (j < ny - 1) { s += val[k + nx]; n++; }
      val[k] = s / n;
    }
  }
}
function fillMultigrid(nx, ny, sumA, cntA) {
  // build pyramid
  const levels = [{ nx, ny, sum: sumA, cnt: cntA }];
  while (levels[levels.length - 1].nx > 24 && levels[levels.length - 1].ny > 24) {
    const p = levels[levels.length - 1];
    const cx = Math.ceil(p.nx / 2), cy = Math.ceil(p.ny / 2);
    const s2 = new Float64Array(cx * cy), c2 = new Uint32Array(cx * cy);
    for (let j = 0; j < p.ny; j++) for (let i = 0; i < p.nx; i++) {
      const k = j * p.nx + i, k2 = (j >> 1) * cx + (i >> 1);
      s2[k2] += p.sum[k]; c2[k2] += p.cnt[k];
    }
    levels.push({ nx: cx, ny: cy, sum: s2, cnt: c2 });
  }
  let prev = null;
  for (let L = levels.length - 1; L >= 0; L--) {
    const lv = levels[L];
    const val = new Float64Array(lv.nx * lv.ny);
    const known = new Uint8Array(lv.nx * lv.ny);
    let mean = 0, mn = 0;
    for (let k = 0; k < val.length; k++) if (lv.cnt[k]) { mean += lv.sum[k] / lv.cnt[k]; mn++; }
    mean = mn ? mean / mn : 0;
    for (let j = 0; j < lv.ny; j++) for (let i = 0; i < lv.nx; i++) {
      const k = j * lv.nx + i;
      if (lv.cnt[k]) { val[k] = lv.sum[k] / lv.cnt[k]; known[k] = 1; }
      else if (prev) val[k] = prev.val[Math.min(prev.ny - 1, j >> 1) * prev.nx + Math.min(prev.nx - 1, i >> 1)];
      else val[k] = mean;
    }
    solveLevel(lv.nx, lv.ny, val, known, L === levels.length - 1 ? 400 : 60);
    prev = { nx: lv.nx, ny: lv.ny, val };
  }
  return prev.val;
}
const t1 = Date.now();
let Z = fillMultigrid(NX, NY, sum, cnt);
// light smoothing (two 3x3 box passes) – DEM is used for terrain, so tiny road-crown noise is removed
for (let pass = 0; pass < 2; pass++) {
  const Z2 = new Float64Array(Z.length);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
      s += Z[jj * NX + ii]; n++;
    }
    Z2[j * NX + i] = s / n;
  }
  Z = Z2;
}
console.log(`DEM solved in ${Date.now() - t1} ms`);

// distance to nearest sample (chamfer transform, metres)
const dist = new Float32Array(NX * NY).fill(1e9);
for (let k = 0; k < dist.length; k++) if (cnt[k]) dist[k] = 0;
const D1 = RES, D2 = RES * Math.SQRT2;
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const k = j * NX + i; let d = dist[k];
  if (i > 0) d = Math.min(d, dist[k - 1] + D1);
  if (j > 0) { d = Math.min(d, dist[k - NX] + D1); if (i > 0) d = Math.min(d, dist[k - NX - 1] + D2); if (i < NX - 1) d = Math.min(d, dist[k - NX + 1] + D2); }
  dist[k] = d;
}
for (let j = NY - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
  const k = j * NX + i; let d = dist[k];
  if (i < NX - 1) d = Math.min(d, dist[k + 1] + D1);
  if (j < NY - 1) { d = Math.min(d, dist[k + NX] + D1); if (i < NX - 1) d = Math.min(d, dist[k + NX + 1] + D2); if (i > 0) d = Math.min(d, dist[k + NX - 1] + D2); }
  dist[k] = d;
}
const demData = new Int16Array(NX * NY), conf = new Uint8Array(NX * NY);
for (let k = 0; k < demData.length; k++) { demData[k] = Math.round(Z[k] * 10); conf[k] = Math.min(255, Math.round(dist[k])); }

function demAt(lng, lat) {
  const fx = (lng - west) / dLng, fy = (north - lat) / dLat;
  const i = Math.max(0, Math.min(NX - 2, Math.floor(fx))), j = Math.max(0, Math.min(NY - 2, Math.floor(fy)));
  const ax = Math.max(0, Math.min(1, fx - i)), ay = Math.max(0, Math.min(1, fy - j));
  const z = (ii, jj) => Z[jj * NX + ii];
  return (z(i, j) * (1 - ax) + z(i + 1, j) * ax) * (1 - ay) + (z(i, j + 1) * (1 - ax) + z(i + 1, j + 1) * ax) * ay;
}

// ------------------------------------------------------------------ buildings
const ringOrient = (r, ccw) => ((ringSignedArea(r) > 0) === ccw ? r : r.slice().reverse());
const buildings = [];
let skipped = 0;
for (const b of B) {
  if (!b.outer.length) { skipped++; continue; }
  const rings = [b.outer[0], ...b.inner].map((r, i) => {
    const rr = r.map(c => [R7(c[0]), R7(c[1])]);
    if (rr.length && (rr[0][0] !== rr[rr.length - 1][0] || rr[0][1] !== rr[rr.length - 1][1])) rr.push(rr[0].slice());
    return ringOrient(rr, i === 0);
  }).filter(r => r.length >= 4);
  if (!rings.length) { skipped++; continue; }
  const zs = b.outer[0].map(c => c[2]).filter(z => z > -50 && z < 400).sort((x, y) => x - y);
  const ground = Math.min(...rings[0].map(c => demAt(c[0], c[1])));
  const groundMean = rings[0].reduce((s, c) => s + demAt(c[0], c[1]), 0) / rings[0].length;
  let h = null, hs = 'e';
  if (zs.length) {
    const roof = zs[Math.floor(zs.length / 2)];
    h = roof - groundMean;
    hs = 'g';
  }
  const type = (b.data.BYGN_TYPE || '').toLowerCase();
  const kind = /tank|silo/.test(type) ? 'storage_tank' : /drivhus/.test(type) ? 'greenhouse' : 'yes';
  if (h === null || !(h > 1.5)) { h = kind === 'yes' ? 6.6 : 4; hs = 'e'; }
  h = Math.min(h, 130);
  const id = `fot:${b.data.FOT_ID ? Math.round(Number(b.data.FOT_ID)) : buildings.length}`;
  const tags = { building: kind, source: 'GeoDanmark (FOT) via CityPulse, 2016' };
  if (b.data.FOT_ID) tags['ref:FOT'] = String(Math.round(Number(b.data.FOT_ID)));
  if (b.data.BYGN_UUID) tags['ref:bygningsid'] = b.data.BYGN_UUID;
  if (b.data.TIMEOF_CRE) tags['source:date'] = b.data.TIMEOF_CRE.replace(/\//g, '-');
  const label = kind === 'storage_tank' ? ['Storage tank / silo', 'Tank / silo', '🛢️', 'industrial'] : kind === 'greenhouse' ? ['Greenhouse', 'Drivhus', '🌱', 'agricultural'] : ['Building', 'Bygning', '🏠', 'unknown'];
  buildings.push({
    type: 'Feature', id, geometry: { type: 'Polygon', coordinates: rings },
    properties: {
      id, k: kind, lbl: label[0], lda: label[1], ic: label[2], g: label[3], cf: kind === 'yes' ? 'unknown' : 'tagged',
      st: kind === 'yes' ? 'brick' : 'plain', h: Math.round(h * 10) / 10, hs, gz: Math.round(ground * 10) / 10,
      seed: hashString(id) % 100000, src: 'geodanmark', t: tags,
      note: 'Footprint and roof height surveyed by GeoDanmark (2016). Download OSM city data for names, types and addresses.'
    }
  });
}
console.log(`${buildings.length} buildings (${skipped} skipped)`);

// ------------------------------------------------------------------ roads, trees, water
const roads = [];
let interiorNode = -1; // unique negative ids for interior vertices; real FOT node ids at line ends (junctions)
const nodeIds = (start, end, n) => {
  const a = [start];
  for (let i = 0; i < n - 2; i++) a.push(interiorNode--);
  a.push(end);
  return a;
};
for (const r of RD) for (const line of r.line) {
  const c = line.map(p => [R7(p[0]), R7(p[1])]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (c.length < 2) continue;
  const type = (r.data.VEJ_TYPE || '').toLowerCase();
  const isPath = /^sti/.test(type);
  const id = `fotr:${r.data.FOT_ID ? Math.round(Number(r.data.FOT_ID)) : roads.length}`;
  roads.push({
    type: 'Feature', id, geometry: { type: 'LineString', coordinates: c },
    properties: {
      id, k: isPath ? 'path' : 'unclassified', lbl: isPath ? 'Path' : 'Road', lda: isPath ? 'Sti' : 'Vej', rk: isPath ? 1 : 4,
      w: isPath ? 2.2 : 6.5,
      nd: nodeIds(r.data.STARTKNUDE ? Number(r.data.STARTKNUDE) : interiorNode--, r.data.SLUTKNUDE ? Number(r.data.SLUTKNUDE) : interiorNode--, c.length),
      src: 'geodanmark', t: { highway: isPath ? 'path' : 'unclassified', 'source': 'GeoDanmark (FOT) via CityPulse, 2016', 'ref:vejkode': r.data.VEJKODE || undefined }
    }
  });
}
const trees = [];
for (const t of T) for (const p of t.point) for (const c of p) {
  const id = `fott:${t.data.FOT_ID ? Math.round(Number(t.data.FOT_ID)) : trees.length}`;
  trees.push({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [R7(c[0]), R7(c[1])] }, properties: { id, lt: 'broadleaved', src: 'geodanmark' } });
}
const water = W.filter(w => w.outer.length).map((w, i) => ({
  type: 'Feature', id: `fotw:${i}`,
  geometry: { type: 'Polygon', coordinates: [ringOrient(w.outer[0].map(c => [R7(c[0]), R7(c[1])]), true)] },
  properties: { id: `fotw:${i}`, k: 'pond', n: null, z: Math.round((w.outer[0][0][2] || 0) * 10) / 10, src: 'geodanmark', t: { natural: 'water', source: 'GeoDanmark (FOT) via CityPulse, 2016' } }
}));

const manifest = {
  format: 'am3d-citypack', version: 1, id: 'starter-aarhus-8000', name: 'Aarhus 8000 – offline starter (GeoDanmark 2016)',
  source: 'geodanmark', bbox: [bb[0], bb[1], bb[2], bb[3]], created: new Date().toISOString(), osmBase: null, builtin: true,
  attribution: [
    'Contains data from GeoDanmark (Styrelsen for Dataforsyning og Infrastruktur), FOT 2016',
    'Converted from the CityPulse 3D Map project (MIT licence, © 2016 EU FP7 CityPulse Project)'
  ],
  description: 'Real building footprints with surveyed roof heights, road and path centrelines, surveyed trees and ponds for central Aarhus (postcode 8000), plus a 5 m terrain model derived from surveyed road and tree elevations. Data is from 2016: newer buildings (e.g. parts of Aarhus Ø) are missing. Download an OpenStreetMap city pack for current data with names, building types and addresses.',
  log: [{ step: 'build-starter', input: 'CityPulse-3D-Map/3dmap-master/data/kml/8k', ms: Date.now() - t0, samples: nSamples }]
};
writePack(outDir, manifest, { buildings, roads, trees, water }, { data: demData, conf, bbox: dem.bbox, nx: NX, ny: NY, res: RES, note: 'DVR90 heights interpolated from GeoDanmark road and tree elevations' });
console.log(`✔ starter pack written to ${outDir} (${(manifest.totalBytes / 1048576).toFixed(1)} MB) in ${Date.now() - t0} ms`);
