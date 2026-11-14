// Unit tests for the pure 3D builders and astronomy (run with plain Node: `node test/unit-render.mjs`).
import assert from 'node:assert/strict';
import { sunPosition, dateAtLocalHour, seasonOf } from '../renderer/src/explore/sun.js';
import { Acc, WALL_ATTRS, ROOF_ATTRS, addBuilding, orientRings, inflateRing } from '../renderer/src/explore/builders/buildings.js';
import { ROAD_ATTRS, densify, measures, miters, addRibbon, addZebra, addWaterPolygon, buildTerrain, SIMPLE_ATTRS, slicePolyline, keepIntervals } from '../renderer/src/explore/builders/roads.js';
import { footprintMetrics, decideRoof, heights, facadeColor, roofColor, convexHull } from '../renderer/src/appearance.js';
import { Colliders } from '../renderer/src/explore/physics.js';
import { LampField, lampHead, SIZE as LAMP_SIZE, SPAN as LAMP_SPAN } from '../renderer/src/explore/lamps.js';
import { litFraction } from '../renderer/src/explore/sky.js';
import { U } from '../renderer/src/explore/materials.js';
import { skyStats, skyRadiance, luminance } from '../renderer/src/explore/skymodel.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('✔', name); };
const deg = (r) => (r * 180) / Math.PI;

function checkMesh(t, attrs, name) {
  const n = t.count;
  assert(n > 0, `${name}: no vertices`);
  for (const [k, size] of attrs) assert.equal(t[k].length, n * size, `${name}: attribute ${k} length`);
  for (let i = 0; i < t.index.length; i++) assert(t.index[i] < n, `${name}: index out of range`);
  for (const v of t.position) assert(Number.isFinite(v), `${name}: NaN position`);
  for (const v of t.normal) assert(Number.isFinite(v), `${name}: NaN normal`);
}
/** geometric face normal of triangle k */
function faceNormal(t, k) {
  const p = (i) => [t.position[i * 3], t.position[i * 3 + 1], t.position[i * 3 + 2]];
  const a = p(t.index[k * 3]), b = p(t.index[k * 3 + 1]), c = p(t.index[k * 3 + 2]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

test('sun position matches known values for Aarhus', () => {
  // Summer solstice, solar noon ≈ 11:19 UTC → altitude = 90 − 56.16 + 23.44 ≈ 57.3°, azimuth ≈ 180°
  const s = sunPosition(new Date(Date.UTC(2026, 5, 21, 11, 19)), 56.16, 10.2);
  assert(Math.abs(deg(s.altitude) - 57.28) < 0.3, `altitude ${deg(s.altitude)}`);
  assert(Math.abs(deg(s.azimuth) - 180) < 2, `azimuth ${deg(s.azimuth)}`);
  // Winter solstice noon: 90 − 56.16 − 23.44 ≈ 10.4°
  const w = sunPosition(new Date(Date.UTC(2026, 11, 21, 11, 10)), 56.16, 10.2);
  assert(Math.abs(deg(w.altitude) - 10.4) < 0.4, `winter altitude ${deg(w.altitude)}`);
  // Morning sun is in the east, evening sun in the west
  assert(deg(sunPosition(new Date(Date.UTC(2026, 5, 21, 5, 0)), 56.16, 10.2).azimuth) < 90);
  assert(deg(sunPosition(new Date(Date.UTC(2026, 5, 21, 18, 0)), 56.16, 10.2).azimuth) > 270);
  // Midnight in winter: well below the horizon
  assert(deg(sunPosition(new Date(Date.UTC(2026, 11, 21, 23, 0)), 56.16, 10.2).altitude) < -40);
});

test('Copenhagen local time handling incl. summer time', () => {
  const summer = dateAtLocalHour(12, new Date(Date.UTC(2026, 6, 1, 8)));
  assert.equal(summer.toISOString(), '2026-07-01T10:00:00.000Z'); // CEST = UTC+2
  const winter = dateAtLocalHour(12, new Date(Date.UTC(2026, 0, 15, 8)));
  assert.equal(winter.toISOString(), '2026-01-15T11:00:00.000Z'); // CET = UTC+1
  assert.equal(seasonOf(new Date(Date.UTC(2026, 10, 14))), 'autumn');
});

test('footprint metrics: minimum rectangle of a rotated rectangle', () => {
  const a = 0.5, c = Math.cos(a), s = Math.sin(a);
  const R = (x, y) => [x * c - y * s + 100, x * s + y * c + 50];
  const ring = [R(-10, -4), R(10, -4), R(10, 4), R(-10, 4)];
  const m = footprintMetrics(ring);
  assert(Math.abs(m.area - 160) < 1e-6);
  assert(Math.abs(m.rect.length - 20) < 1e-6 && Math.abs(m.rect.width - 8) < 1e-6, JSON.stringify(m.rect));
  assert(Math.abs(m.rectangularity - 1) < 1e-6);
  assert(Math.abs(Math.sin(m.rect.angle - a)) < 1e-6, 'long axis direction');
  assert.equal(convexHull([[0, 0], [1, 0], [0.5, 0.2], [1, 1], [0, 1]]).length, 4);
});

test('roof decisions: tags win, heuristics are conservative', () => {
  const rect = footprintMetrics([[0, 0], [12, 0], [12, 8], [0, 8]]);
  const tagged = decideRoof({ k: 'yes', rs: 'hipped', seed: 1 }, rect, 6);
  assert.equal(tagged.shape, 'hipped'); assert(tagged.tagged);
  assert.equal(decideRoof({ k: 'house', seed: 2, st: 'house' }, rect, 5).shape, 'gabled');
  assert.equal(decideRoof({ k: 'office', seed: 2 }, rect, 20).shape, 'flat');
  const lshape = footprintMetrics([[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]]);
  assert.equal(decideRoof({ k: 'house', seed: 2 }, lshape, 5).shape, 'flat', 'L-shape cannot get a gable');
  const r = decideRoof({ k: 'house', seed: 2, st: 'house' }, rect, 5);
  assert(r.height > 2 && r.height < 5, 'gable height for an 8 m wide house: ' + r.height);
  // OSM height includes the roof: wall height = height − roof height
  const h = heights({ k: 'house', h: 9, ht: 1, st: 'house', seed: 2 }, rect);
  assert(Math.abs(h.wallH + h.roof.height - 9) < 1e-9);
  assert.match(facadeColor({ st: 'brick', seed: 3 }), /^#[0-9a-f]{6}$/);
  assert.equal(facadeColor({ c: '#123456' }), '#123456');
  assert.match(roofColor({ seed: 9 }, 'gabled'), /^#[0-9a-f]{6}$/);
});

function buildOne(shape, rings, extra = {}) {
  const walls = new Acc(WALL_ATTRS), roofs = new Acc(ROOF_ATTRS);
  const m = footprintMetrics(orientRings(rings)[0]);
  addBuilding(walls, roofs, { rings: orientRings(rings), yBottom: -1, ground: 0, wallTop: 10, roof: { shape, height: shape === 'flat' ? 0 : 4 }, rect: m.rect,
    facade: [0.5, 0.3, 0.2], roofCol: [0.4, 0.1, 0.1], style: 0, levelH: 3, seed01: 0.3, roofType: shape === 'flat' ? 0 : 1, bid: 7, ...extra });
  return { walls: walls.toTyped(), roofs: roofs.toTyped() };
}

test('building walls: outward normals, consistent winding, per-floor UVs', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const { walls } = buildOne('flat', [sq]);
  checkMesh(walls, WALL_ATTRS, 'walls');
  const tris = walls.index.length / 3;
  for (let k = 0; k < tris; k++) {
    const fn = faceNormal(walls, k);
    const i = walls.index[k * 3];
    const n = [walls.normal[i * 3], walls.normal[i * 3 + 1], walls.normal[i * 3 + 2]];
    assert(fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] > 0, `wall triangle ${k} winding disagrees with its normal`);
    // exterior walls (they reach down to yBottom = −1) must point outward, away from the centre (5, −5 in x/z)
    const ys = [0, 1, 2].map(q => walls.position[walls.index[k * 3 + q] * 3 + 1]);
    if (Math.min(...ys) < -0.5) {
      const px = walls.position[i * 3], pz = walls.position[i * 3 + 2];
      assert((px - 5) * n[0] + (pz + 5) * n[2] >= -1e-6, 'exterior wall normal points inward');
    }
  }
  // v coordinate is height above ground, u runs along the walls (perimeter 40 m)
  const vs = [], us = [];
  for (let i = 0; i < walls.count; i++) { us.push(walls.uv[i * 2]); vs.push(walls.uv[i * 2 + 1]); }
  assert.equal(Math.max(...us), 40); assert.equal(Math.min(...vs), -1);
  assert(walls.aBid.every(b => b === 7));
});

test('roofs face up for every shape; gables add wall triangles', () => {
  const rect = [[0, 0], [14, 0], [14, 8], [0, 8]];
  for (const shape of ['flat', 'gabled', 'hipped', 'pyramidal', 'skillion', 'dome']) {
    const { walls, roofs } = buildOne(shape, [rect]);
    checkMesh(roofs, ROOF_ATTRS, shape);
    const tris = roofs.index.length / 3;
    let maxY = 0;
    for (let k = 0; k < tris; k++) assert(faceNormal(roofs, k)[1] > -1e-9, `${shape} roof triangle ${k} faces down`);
    for (let i = 0; i < roofs.count; i++) maxY = Math.max(maxY, roofs.position[i * 3 + 1]);
    if (shape !== 'flat') assert(Math.abs(maxY - 14) < 1e-6, `${shape} ridge/apex at wall top + roof height (got ${maxY})`);
    if (shape === 'gabled') assert(walls.count >= 16 + 6, 'gable end triangles present: ' + walls.count);
  }
});

test('courtyard holes: flat roof leaves the courtyard open', () => {
  const outer = [[0, 0], [30, 0], [30, 30], [0, 30]], hole = [[10, 10], [10, 20], [20, 20], [20, 10]];
  const { roofs } = buildOne('flat', [outer, hole]);
  let area = 0;
  for (let k = 0; k < roofs.index.length / 3; k++) { const f = faceNormal(roofs, k); area += Math.hypot(f[0], f[1], f[2]) / 2; }
  assert(Math.abs(area - (900 - 100)) < 1e-6, 'roof area excludes the courtyard: ' + area);
});

test('road ribbons: constant width through bends, junction distances, upward faces', () => {
  const pts = [[0, 0], [20, 0], [20, 20]];
  const d = densify(pts, 5, [1, 0, 0]);
  assert(d.pts.length > 3 && d.flags[0] === 1);
  const { cum, junc } = measures(d.pts, d.flags);
  assert.equal(junc[0], 0); assert.equal(cum[cum.length - 1], 40);
  const mit = miters(d.pts);
  const acc = new Acc(ROAD_ATTRS);
  const r = addRibbon(acc, { pts: d.pts, mit, cum, junc, width: 6, surface: 0, mark: 5, scores: [0.5, 0.7], rid: 3, ys: () => 0.1 });
  const t = acc.toTyped();
  checkMesh(t, ROAD_ATTRS, 'road');
  for (let i = 0; i < r.L.length; i++) {
    const w = Math.hypot(r.L[i][0] - r.R[i][0], r.L[i][2] - r.R[i][2]);
    const k = i === 0 || i === r.L.length - 1 ? 1 : 1;
    assert(w >= 6 - 1e-6 && w <= 6 * 1.5 * k, `ribbon width at ${i}: ${w}`);
  }
  for (let k = 0; k < t.index.length / 3; k++) assert(faceNormal(t, k)[1] > 0, 'road triangle faces down');
  assert(t.aSc.every((v, i) => Math.abs(v - (i % 2 ? 0.7 : 0.5)) < 1e-6));
  const z = new Acc(ROAD_ATTRS);
  addZebra(z, [0, 0], [1, 0], 8, 0.2);
  const zt = z.toTyped();
  assert(zt.count >= 4 * 6, 'zebra stripes across an 8 m road');
  for (let k = 0; k < zt.index.length / 3; k++) assert(faceNormal(zt, k)[1] > 0);
});

test('water polygons and terrain grids face up', () => {
  const w = new Acc(SIMPLE_ATTRS);
  addWaterPolygon(w, [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]], 1.2); // clockwise input
  const wt = w.toTyped();
  for (let k = 0; k < wt.index.length / 3; k++) assert(faceNormal(wt, k)[1] > 0, 'water faces down');
  const acc = buildTerrain({ x0: 0, n0: 0, size: 100, seg: 10, hAt: (e, n) => e * 0.1 + n * 0.05, uvAt: (e, n) => [e / 100, n / 100] });
  const tt = acc.toTyped();
  checkMesh(tt, SIMPLE_ATTRS, 'terrain');
  for (let k = 0; k < 200; k++) assert(faceNormal(tt, k)[1] > 0, 'terrain faces down');
  // analytic normal of the plane y = 0.1 e + 0.05 n with z = -n: (-0.1, 1, -0.05) normalised
  const nx = tt.normal[0], ny = tt.normal[1], nz = tt.normal[2];
  const L = Math.hypot(0.1, 1, 0.05);
  assert(Math.abs(nx + 0.1 / L) < 1e-6 && Math.abs(ny - 1 / L) < 1e-6 && Math.abs(nz - 0.05 / L) < 1e-6, `terrain normal ${nx},${ny},${nz}`);
});

test('collisions: terraced row with shared walls – escape, blocking, sliding', () => {
  // three houses in a row sharing party walls (east 0..30, north 0..10), like Aarhus terraces
  const c = new Colliders();
  c.addChunk('a', [[[0, 0], [10, 0], [10, 10], [0, 10]], [[10, 0], [20, 0], [20, 10], [10, 10]], [[20, 0], [30, 0], [30, 10], [20, 10]]]);
  // spawned inside the middle house: must end up outside every house, clear of the walls, near the middle
  const r = c.resolve(15, 5, 0.4);
  assert(r.hit && !c.insideAny(r.e, r.n), `still inside at ${r.e},${r.n}`);
  assert(c.clearance(r.e, r.n, 2) >= 0.4 - 1e-9, 'escaped spot touches a wall');
  assert(Math.hypot(r.e - 15, r.n - 5) < 6.5, 'escape went the long way round');
  const [pe, pn] = c.escape(15, 5, 0.4);
  assert(Math.abs(pn - 5) > 5 - 1e-9, 'escape should leave through the long side');
  // walking north into the wall from outside: blocked at the radius, never inside
  let e = 15, n = -2;
  for (let i = 0; i < 200; i++) { const q = c.resolve(e, n + 0.05, 0.4, e, n); e = q.e; n = q.n; }
  assert(!c.insideAny(e, n) && n <= -0.4 + 1e-6, `walked into the house: n=${n}`);
  // a big step (fast car) straight into the house is refused
  const big = c.resolve(15, 4, 0.9, 15, -3);
  assert.deepEqual([big.e, big.n, big.hit], [15, -3, true]);
  // sliding: diagonal push along the wall keeps the tangential motion
  e = 5; n = -0.4;
  for (let i = 0; i < 100; i++) { const q = c.resolve(e + 0.05, n + 0.05, 0.4, e, n); e = q.e; n = q.n; }
  assert(e > 9.5 && Math.abs(n + 0.4) < 1e-6, `no slide: ${e},${n}`);
  // narrow gap between two buildings (0.5 m wide) for a 0.4 m body: never pushed into a building
  const g = new Colliders();
  g.addChunk('b', [[[0, 0], [10, 0], [10, 10], [0, 10]], [[10.5, 0], [20, 0], [20, 10], [10.5, 10]]]);
  const q = g.resolve(10.25, 5, 0.4, 10.25, -1);
  assert(!g.insideAny(q.e, q.n));
  // chase camera clipping stops short of the wall
  const [ce, cn] = c.clipSegment(15, -6, 15, 3, 0.3);
  assert(!c.insideAny(ce, cn) && cn < -0.3 + 1e-9);
});

test('street-lamp light map: intensity falls off, direction points at the lamp', () => {
  const f = new LampField();
  f.set('c', [{ x: 0, z: 0 }]);
  f.splat(0, 0);
  const SIZE = LAMP_SIZE, px = LAMP_SPAN / SIZE;
  const at = (x, z) => { const i = Math.floor((x + 320) / px), j = Math.floor((z + 320) / px); const o = (j * SIZE + i) * 4; return [f.data[o], f.data[o + 1], f.data[o + 2]]; };
  const I = (x, z) => (at(x, z)[0] / 255) ** 2 * 1.6;
  assert(I(0.3, 0.3) > 0.85, 'bright under the lamp');
  assert(I(6, 0) < I(2, 0) && I(12, 0) < I(6, 0) && I(26, 0) === 0, 'falloff with distance and a finite reach');
  assert(Math.abs(I(6, 0) / I(0.3, 0.3) - Math.pow(7 ** 2 / (7 ** 2 + 36), 1.5) * (1 - 36 / 484) ** 2) < 0.08, 'cos³ law');
  assert(at(8, 0)[1] < 20 && Math.abs(at(8, 0)[2] - 128) < 16, 'direction at +x points back to -x');
  assert(at(0, -8)[2] > 235, 'direction at -z points to +z');
  assert(U.uLampOrigin.value.x === -320 && U.uLampOrigin.value.y === -320);
  // lamp head sits at the end of the arm (+x of the model, rotated about y like three.js)
  const h = lampHead({ x: 10, z: -20, rot: Math.PI / 2 });
  assert(Math.abs(h.x - 10) < 1e-9 && Math.abs(h.z - (-21.15)) < 1e-9);
  f.remove('c'); assert(f.dirty);
});

test('lit windows follow the hour (evening peak, few at night)', () => {
  assert(litFraction(19) > 0.4 && litFraction(3) < 0.1 && litFraction(12) < litFraction(19));
  for (let h = 0; h <= 24; h += 0.25) { const v = litFraction(h); assert(v > 0 && v < 0.5, `h=${h}`); }
});

test('sky model (CPU copy of Sky.js) explains the lighting calibration', () => {
  const sunAt = (deg) => { const a = (deg * Math.PI) / 180; return [0, Math.sin(a), Math.cos(a)]; }; // sun due south
  const clear = { turbidity: 2.4, rayleigh: 1.1, mie: 0.004, g: 0.82, cover: 0, dens: 0 };
  const rain = { turbidity: 10, rayleigh: 2.6, mie: 0.012, g: 0.82, cover: 0.97, dens: 0.97 };
  const c13 = skyStats(clear, sunAt(13)), c57 = skyStats(clear, sunAt(57)), r13 = skyStats(rain, sunAt(13));
  assert(c57.up > c13.up * 2, 'a high sun lights the sky more');
  assert(r13.up > c13.up * 3, 'Sky.js draws a thick cloud deck several times brighter than a clear sky (hence skyGain)');
  assert(skyStats(clear, sunAt(-20)).up < 0.01, 'night sky is dark');
  // looking away from a low sun the horizon is blue-ish, towards it far brighter and warmer
  const away = skyRadiance(clear, sunAt(13), [0, 0.05, -1]), toward = skyRadiance(clear, sunAt(13), [0, 0.05, 1]);
  assert(away[2] > away[0] && luminance(toward) > 5 * luminance(away));
});

test('sidewalks stop at crossing streets: interval cutting and exact polyline slices', () => {
  // a 100 m street with crossing streets at 0 m (width 8) and 60 m (width 12)
  const keep = keepIntervals(100, [[-4.4, 4.4], [60 - 6.4, 60 + 6.4]]);
  assert.deepEqual(keep.map(([a, b]) => [Number(a.toFixed(1)), Number(b.toFixed(1))]), [[4.4, 53.6], [66.4, 100]]);
  assert.deepEqual(keepIntervals(10, [[0, 9.5]]), [], 'slivers shorter than 0.8 m are dropped');
  // an L-shaped polyline, sliced across its corner, keeps the corner and exact ends
  const pts = [[0, 0], [10, 0], [10, 10]];
  const cum = [0, 10, 20];
  const sp = slicePolyline(pts, cum, 4, 13);
  assert.deepEqual(sp.pts, [[4, 0], [10, 0], [10, 3]]);
  assert.deepEqual(sp.cum, [0, 6, 9]);
});

test('building-specific wall offset: outward for the outline, into the courtyard for holes, mitred corners', () => {
  const [outer, hole] = orientRings([[[0, 0], [10, 0], [10, 10], [0, 10]], [[3, 3], [7, 3], [7, 7], [3, 7]]]);
  const o = inflateRing(outer, 0.02), h = inflateRing(hole, 0.02);
  const near = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  assert(o.some(p => near(p, [-0.02, -0.02])) && o.some(p => near(p, [10.02, 10.02])), 'outline grows by 2 cm on every side');
  assert(h.some(p => near(p, [3.02, 3.02])) && h.some(p => near(p, [6.98, 6.98])), 'courtyard shrinks (walls move into it)');
  // two buildings with the same wall get different offsets → no shared plane
  const a = inflateRing(outer, 0.006), b = inflateRing(outer, 0.03);
  assert(Math.abs(a[0][1] - b[0][1]) > 0.02);
});

console.log(`\n${passed} render tests passed`);
