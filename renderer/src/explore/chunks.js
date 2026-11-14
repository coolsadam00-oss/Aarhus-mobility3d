// Streaming world: 250 m chunks around the camera with distance-based detail.
//  ground   – terrain mesh (GeoDanmark grid / AWS tiles) with aerial imagery or stylised land use (async)
//  build    – buildings with procedural facades & roofs (time-sliced, nearest first)
//  detail   – streets, sidewalks, cycle tracks, crossings, rails, water, hedges, trees, furniture (near chunks only)
import * as THREE from 'three';
import geo from '../../../shared/geo.js';
import cls from '../../../shared/classify.js';
import { CHUNK, key } from './worlddata.js';
import { Acc, WALL_ATTRS, ROOF_ATTRS, addBuilding, orientRings, inflateRing } from './builders/buildings.js';
import { ROAD_ATTRS, SURF, densify, measures, miters, addRibbon, addSideStrip, addZebra, addWaterPolygon, buildTerrain, SIMPLE_ATTRS, slicePolyline, keepIntervals } from './builders/roads.js';
import { footprintMetrics, heights, facadeColor, roofColor, facadeStyle, STYLE_INDEX } from '../appearance.js';
import { terrainMaterial } from './materials.js';
import { Imagery, paintStylised, stylisedUv } from './imagery.js';
import { buildTrees } from './vegetation.js';
import { buildProps, kindToProp } from './props.js';
import { lampHead } from './lamps.js';
import { hexToRgb01 } from '../util.js';

const { pointInRing } = geo;
const lin = (hex) => hexToRgb01(hex).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const SURFACE_OF = { asphalt: SURF.asphalt, paved: SURF.asphalt, concrete: SURF.asphalt, 'concrete:plates': SURF.slabs, chipseal: SURF.asphalt,
  paving_stones: SURF.pavers, 'paving_stones:30': SURF.pavers, sett: SURF.sett, cobblestone: SURF.sett, unhewn_cobblestone: SURF.sett, granite: SURF.sett,
  gravel: SURF.gravel, fine_gravel: SURF.gravel, compacted: SURF.gravel, unpaved: SURF.gravel, ground: SURF.gravel, dirt: SURF.gravel, earth: SURF.gravel, grass: SURF.gravel, sand: SURF.gravel, wood: SURF.slabs };

function toGeometry(t, attrs) {
  const g = new THREE.BufferGeometry();
  for (const [k, size] of attrs) g.setAttribute(k, new THREE.BufferAttribute(t[k], size));
  g.setIndex(new THREE.BufferAttribute(t.index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function disposeObj(o) {
  o.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material && c.material.userData && c.material.userData.perChunk) {
      if (c.material.map && !c.material.userData.sharedMap) c.material.map.dispose();
      c.material.dispose();
    }
  });
}

export class ChunkManager {
  constructor(ctx) {
    this.ctx = ctx;  // { scene, data:WorldData, hf, settings, mats, renderer, colliders, city }
    this.chunks = new Map();
    this.groundJobs = 0;
    this.imagery = new Imagery(ctx.settings.get('customImagery'));
    this.stats = { buildings: 0, chunks: 0, pending: 0 };
    this.version = 0;
  }

  hAt(e, n) { const [lng, lat] = this.ctx.data.toLngLat(e, n); return this.ctx.hf.heightAt(lng, lat); }

  chunkBboxLL(ix, iy) {
    const d = this.ctx.data;
    const [w, s] = d.toLngLat(ix * CHUNK, iy * CHUNK);
    const [e, n] = d.toLngLat((ix + 1) * CHUNK, (iy + 1) * CHUNK);
    return [w, s, e, n];
  }

  // ------------------------------------------------------------------ scheduling
  update(camE, camN, camY, budgetMs = 7) {
    const s = this.ctx.settings.get();
    const vd = s.viewDistance;
    const detailR = Math.min(700, vd);
    const altBoost = Math.max(0, camY - 60) * 1.5; // when flying high, see further
    const R = Math.ceil((vd + altBoost) / CHUNK) + 1;
    const [ci, cj] = [Math.floor(camE / CHUNK), Math.floor(camN / CHUNK)];
    const want = [];
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
      const cx = (i + 0.5) * CHUNK, cy = (j + 0.5) * CHUNK;
      const d = Math.max(0, Math.hypot(cx - camE, cy - camN) - CHUNK * 0.7);
      if (d > vd + altBoost) continue;
      let lod = d < 260 ? 0 : d < 700 ? 1 : 2;
      const ex = this.chunks.get(key(i, j));
      if (ex && ex.groundLod >= 0 && Math.abs(lod - ex.groundLod) === 1) {
        // hysteresis: only switch detail level when clearly past the boundary
        if (ex.groundLod === 0 && d < 320) lod = 0;
        else if (ex.groundLod === 1 && ((lod === 0 && d > 200) || (lod === 2 && d < 760))) lod = 1;
        else if (ex.groundLod === 2 && d > 640) lod = 2;
      }
      want.push({ i, j, d, lod, detail: d < detailR });
    }
    want.sort((a, b) => a.d - b.d);
    const keep = new Set();
    for (const w of want) {
      const k = key(w.i, w.j);
      keep.add(k);
      let ch = this.chunks.get(k);
      if (!ch) {
        ch = { k, i: w.i, j: w.j, group: new THREE.Group(), groundLod: -1, groundBusy: false, built: false, detail: false, buildRefs: [], roadRefs: [], labels: [], colliderIds: [] };
        ch.group.name = 'chunk ' + k;
        this.ctx.scene.add(ch.group);
        this.chunks.set(k, ch);
      }
      ch.want = w;
    }
    // unload far chunks (with hysteresis) and far detail
    for (const [k, ch] of this.chunks) {
      const cx = (ch.i + 0.5) * CHUNK, cy = (ch.j + 0.5) * CHUNK;
      const d = Math.hypot(cx - camE, cy - camN) - CHUNK * 0.7;
      if (!keep.has(k) && d > vd + altBoost + CHUNK * 1.2 && !ch.groundBusy) this.disposeChunk(ch);
      else if (ch.detail && d > detailR + 250) this.dropDetail(ch);
    }
    // ground jobs (async, up to 4 in flight)
    for (const w of want) {
      if (this.groundJobs >= 4) break;
      const ch = this.chunks.get(key(w.i, w.j));
      if (!ch.groundBusy && (ch.groundLod === -1 || ch.groundLod !== w.lod)) {
        this.buildGround(ch, w.lod);
      }
    }
    // synchronous content builds within the time budget
    const t0 = performance.now();
    let pending = 0;
    for (const w of want) {
      const ch = this.chunks.get(key(w.i, w.j));
      if (ch.groundLod === -1) { pending++; continue; } // wait for terrain heights first
      if (!ch.built) { if (performance.now() - t0 < budgetMs) this.buildBuildings(ch); else pending++; }
      if (w.detail && !ch.detail) { if (performance.now() - t0 < budgetMs) this.buildDetail(ch); else pending++; }
    }
    this.stats.pending = pending;
    this.stats.chunks = this.chunks.size;
    return pending;
  }

  disposeChunk(ch) {
    this.ctx.colliders.removeChunk(ch.k);
    if (this.ctx.lamps) this.ctx.lamps.remove(ch.k);
    this.ctx.scene.remove(ch.group);
    disposeObj(ch.group);
    this.chunks.delete(ch.k);
    this.version++;
  }

  dropDetail(ch) {
    if (ch.detailGroup) { ch.group.remove(ch.detailGroup); disposeObj(ch.detailGroup); ch.detailGroup = null; }
    ch.detail = false;
    ch.roadRefs = [];
    if (this.ctx.lamps) this.ctx.lamps.remove(ch.k);
  }

  rebuildAll() { for (const ch of [...this.chunks.values()]) this.disposeChunk(ch); }
  rebuildContent() {
    for (const ch of this.chunks.values()) {
      if (ch.buildGroup) { ch.group.remove(ch.buildGroup); disposeObj(ch.buildGroup); ch.buildGroup = null; }
      this.dropDetail(ch);
      this.ctx.colliders.removeChunk(ch.k);
      ch.built = false; ch.labels = [];
    }
    this.version++;
  }
  rebuildGround() { for (const ch of this.chunks.values()) ch.groundLod = -2; }

  // ------------------------------------------------------------------ ground
  async buildGround(ch, lod) {
    ch.groundBusy = true;
    this.groundJobs++;
    try {
      const bb = this.chunkBboxLL(ch.i, ch.j);
      const s = this.ctx.settings.get();
      await this.ctx.hf.ensure(bb);
      const zMax = Math.min(19, ({ low: 17, medium: 18, high: 18, ultra: 19 })[s.quality] || 18);
      const zoom = lod === 0 ? zMax : lod === 1 ? Math.min(zMax, 17) : 16;
      const size = lod === 0 ? (zMax >= 19 ? 2048 : 1024) : lod === 1 ? 512 : 256;
      let info = s.imagery ? await this.imagery.compose(bb, zoom, size) : null;
      let uvFn;
      if (info) uvFn = (e, n) => { const [lng, lat] = this.ctx.data.toLngLat(e, n); return Imagery.uv(info, lng, lat); };
      else {
        const bin = this.ctx.data.get(ch.i, ch.j) || {};
        info = paintStylised(bb, lod === 0 ? 512 : 256, { landuse: bin.landuse, water: bin.water, buildings: bin.buildings, roadAreas: [] });
        uvFn = (e, n) => { const [lng, lat] = this.ctx.data.toLngLat(e, n); return stylisedUv(info, lng, lat); };
      }
      if (!this.chunks.has(ch.k)) return; // disposed while loading
      const seg = Math.max(8, Math.round((s.terrainSeg || 40) / (lod === 0 ? 1 : lod === 1 ? 2 : 4)));
      const acc = buildTerrain({ x0: ch.i * CHUNK, n0: ch.j * CHUNK, size: CHUNK, seg, hAt: (e, n) => this.hAt(e, n), uvAt: uvFn, skirt: 4 });
      const g = toGeometry(acc.toTyped(), SIMPLE_ATTRS);
      const tex = new THREE.CanvasTexture(info.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.ctx.renderer.capabilities.getMaxAnisotropy();
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const mat = terrainMaterial(tex);
      mat.userData.perChunk = true;
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      mesh.userData.kind = 'ground';
      if (ch.ground) { ch.group.remove(ch.ground); disposeObj(ch.ground); }
      ch.ground = mesh;
      ch.group.add(mesh);
      ch.groundLod = lod;
      ch.imagery = !info.stylised;
      this.version++;
    } catch (e) {
      console.warn('ground build failed', ch.k, e);
      ch.groundLod = lod; // don't retry endlessly
    } finally {
      ch.groundBusy = false;
      this.groundJobs--;
    }
  }

  // ------------------------------------------------------------------ buildings
  buildBuildings(ch) {
    ch.built = true;
    const bin = this.ctx.data.get(ch.i, ch.j);
    if (!bin || !bin.buildings.length) return;
    const s = this.ctx.settings.get();
    const walls = new Acc(WALL_ATTRS), roofs = new Acc(ROOF_ATTRS);
    const refs = [];
    const colliders = [];
    for (const f of bin.buildings) {
      if (f._hasParts) continue;
      const p = f.properties;
      const bid = refs.length;
      refs.push(f);
      for (const poly of f._loc) {
        const rings = orientRings(poly.map(r => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r)));
        if (rings[0].length < 3) continue;
        const m = footprintMetrics(rings[0]);
        if (m.area < 2) continue;
        const hts = heights(p, m);
        let roof = hts.roof;
        if (!s.roofs && roof.shape !== 'flat') roof = { shape: 'flat', height: 0, tagged: roof.tagged };
        // ground under the footprint
        const outer = rings[0];
        const stepI = Math.max(1, Math.floor(outer.length / 24));
        let gmin = Infinity, gsum = 0, gn = 0;
        for (let i = 0; i < outer.length; i += stepI) { const h = this.hAt(outer[i][0], outer[i][1]); gmin = Math.min(gmin, h); gsum += h; gn++; }
        const gmean = gsum / gn;
        const minH = hts.minH || 0;
        const wallTop = gmean + Math.max(minH + 0.8, hts.wallH);
        const yBottom = minH > 0.5 ? gmean + minH : gmin - 0.8;
        const style = facadeStyle(p);
        const levels = p.lv ? Math.max(1, p.lv - (p.t && p.t['building:min_level'] ? Number(p.t['building:min_level']) || 0 : 0)) : Math.max(1, Math.round((hts.wallH - minH) / 3.1));
        const levelH = Math.max(2.4, Math.min(6, (hts.wallH - minH) / levels));
        const rm = String(p.rm || '');
        const roofType = roof.shape === 'flat'
          ? (/grass|plant|green/.test(rm) ? 3 : /glass/.test(rm) || p.k === 'greenhouse' ? 4 : 0)
          : (/metal|copper|zinc|tin|steel/.test(rm) ? 2 : /glass/.test(rm) || p.k === 'greenhouse' || p.k === 'conservatory' ? 4 : 1);
        const roofOnly = p.k === 'roof' || p.k === 'carport';
        // a 0.5–5 cm building-specific outward offset: overlapping footprints (block outline + houses, two
        // versions of one building) no longer draw walls in exactly the same plane, which flickers
        const inflate = 0.005 + 0.045 * (((p.seed || 0) % 997) / 997);
        addBuilding(walls, roofs, {
          rings: rings.map(r => inflateRing(r, inflate)), yBottom, ground: gmean, wallTop, roof, rect: m.rect, facade: lin(facadeColor({ ...p, st: style })), roofCol: lin(roofColor(p, roof.shape)),
          style: STYLE_INDEX[style] ?? 0, levelH, seed01: ((p.seed || 0) % 997) / 997, roofType, bid, roofOnly, overhang: roof.shape === 'flat' ? 0 : (style === 'house' ? 0.45 : 0.3)
        });
        f._top = wallTop + (roof.shape === 'flat' ? 0 : roof.height);
        f._ground = gmean;
        if (!roofOnly && yBottom < gmean + 2.2) colliders.push(rings[0]);
        this.stats.buildings++;
      }
    }
    const grp = new THREE.Group();
    grp.name = 'buildings';
    if (walls.count) {
      const mesh = new THREE.Mesh(toGeometry(walls.toTyped(), WALL_ATTRS), this.ctx.mats.facade);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { kind: 'building', chunk: ch };
      grp.add(mesh);
    }
    if (roofs.count) {
      const mesh = new THREE.Mesh(toGeometry(roofs.toTyped(), ROOF_ATTRS), this.ctx.mats.roof);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { kind: 'building', chunk: ch };
      grp.add(mesh);
    }
    ch.buildRefs = refs;
    ch.buildGroup = grp;
    ch.group.add(grp);
    this.ctx.colliders.addChunk(ch.k, colliders);
    // labels for this chunk
    ch.labels = (bin.labels || []).map(l => {
      const y = l.kind === 'building' ? (l.f._top || (this.hAt(l.e, l.n) + (l.h || 6))) + 2.5 : this.hAt(l.e, l.n) + (l.kind === 'street' ? 3.2 : 4.5);
      return { ...l, x: l.e, y, z: -l.n };
    });
    this.version++;
  }

  // ------------------------------------------------------------------ streets, rails, water, vegetation, furniture
  buildDetail(ch) {
    ch.detail = true;
    const bin = this.ctx.data.get(ch.i, ch.j);
    if (!bin) return;
    const s = this.ctx.settings.get();
    const data = this.ctx.data;
    const grp = new THREE.Group();
    grp.name = 'detail';
    const roads = new Acc(ROAD_ATTRS);
    const refs = [];
    const lampSpots = [];
    // mapped street lamps here and in the neighbouring chunks: illustrative lamps only fill the gaps between them
    const osmLamps = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const nb = this.ctx.data.get(ch.i + di, ch.j + dj);
      if (nb) for (const f of nb.furniture) if (f.properties.k === 'highway=street_lamp') osmLamps.push(f._c);
    }
    const nearOsmLamp = (e, n) => osmLamps.some(q => (q[0] - e) ** 2 + (q[1] - n) ** 2 < 18 * 18);

    // ---- streets & paths (lower rank first so main roads draw on top at junctions)
    const runs = [...bin.roadRuns].sort((a, b) => (a.f.properties.rk || 0) - (b.f.properties.rk || 0));
    for (const run of runs) {
      const f = run.f, p = f.properties;
      if (!f._cum) { f._cum = [0]; for (let i = 1; i < f._pts.length; i++) f._cum.push(f._cum[i - 1] + Math.hypot(f._pts[i][0] - f._pts[i - 1][0], f._pts[i][1] - f._pts[i - 1][1])); }
      const rid = refs.length;
      refs.push(f);
      const sub = f._pts.slice(run.i0, run.i1 + 1);
      const ndSub = p.nd ? p.nd.slice(run.i0, run.i1 + 1) : null;
      const flags = ndSub ? ndSub.map(id => (data.isJunction(id) ? (id || 1) : 0)) : sub.map(() => 0); // junction node ids
      const dz = densify(sub, 4.5, flags);
      const { cum, junc } = measures(dz.pts, dz.flags);
      const mit = miters(dz.pts);
      const info = cls.roadInfo(p.k);
      const rank = p.rk ?? info.rank;
      const w = Math.max(1.2, p.w || info.width);
      const lift = 0.06 + rank * 0.008;
      const vOff = f._cum[run.i0];
      // bridge deck profile over the whole way
      let ys;
      if (p.br) {
        if (!f._bh) f._bh = [this.hAt(...f._pts[0]), this.hAt(...f._pts[f._pts.length - 1])];
        const L = f._cum[f._cum.length - 1] || 1;
        const clearance = Math.min(4.5, 0.12 * L);
        ys = (i, side, e, n, l = lift) => {
          const sAbs = vOff + cum[i];
          const line = f._bh[0] + (f._bh[1] - f._bh[0]) * (sAbs / L);
          const taper = Math.pow(Math.max(0, Math.sin(Math.PI * sAbs / L)), 0.6);
          return Math.max(line, this.hAt(e, n) + clearance * taper) + 0.25 + l;
        };
      } else ys = (i, side, e, n, l = lift) => this.hAt(e, n) + l;
      const sc = this.ctx.city.scoreForRoad(f) || {};
      const scores = [sc.bike ?? -1, sc.walk ?? -1];
      let surface = p.sf ? (SURFACE_OF[p.sf] ?? SURF.asphalt) : (p.k === 'pedestrian' || p.k === 'living_street' ? SURF.pavers : (p.k === 'footway' && p.fw === 'sidewalk') ? SURF.slabs : (p.k === 'track' ? SURF.gravel : (p.k === 'cycleway' ? SURF.cycle : SURF.asphalt)));
      if (p.k === 'steps') surface = SURF.slabs;
      let mark = 0;
      if (info.motor && rank >= 6) { mark += p.ow ? 0 : ((p.ln || 2) >= 4 ? 2 : 1); mark += 4; }
      if (p.cwl === 'lane' || p.cwr === 'lane') mark += 8;
      const main = addRibbon(roads, { pts: dz.pts, mit, cum, junc, width: w, surface, mark, scores, rid, vOffset: vOff, ys: (i, sd, e, n) => ys(i, sd, e, n) });
      // bridge sides
      if (p.br) {
        const down = (arr) => arr.map(q => [q[0], q[1] - 0.9, q[2]]);
        addSideStrip(roads, main.L, down(main.L), { side: 1, cum, surface: SURF.deck, rid });
        addSideStrip(roads, main.R, down(main.R), { side: -1, cum, surface: SURF.deck, rid });
        const up = (arr) => arr.map(q => [q[0], q[1] + 1.0, q[2]]);
        addSideStrip(roads, up(main.L), main.L, { side: -1, cum, surface: SURF.deck, rid });
        addSideStrip(roads, up(main.R), main.R, { side: 1, cum, surface: SURF.deck, rid });
      }
      // cycle tracks & sidewalks (Danish layout: road | curb | cycle track | curb | sidewalk). They stop at the curb
      // line of every other motor street that crosses (they used to run straight across junctions).
      const motorStreet = info.motor && rank >= 3 && !['service', 'track', 'living_street'].includes(p.k);
      const assume = motorStreet && !p.src; // no tag → typical Aarhus street has sidewalks
      const gaps = [];
      if (!p.br) dz.flags.forEach((id, i) => { const wo = id ? data.crossWidth(id, f) : 0; if (wo > 0) gaps.push([cum[i] - (wo / 2 + 0.4), cum[i] + (wo / 2 + 0.4)]); });
      const pieces = p.br || !gaps.length
        ? [{ pts: dz.pts, mit, cum, junc, vOffset: vOff, ysAt: ys, whole: true }]
        : keepIntervals(cum[cum.length - 1], gaps).map(([a, b]) => {
          const sp = slicePolyline(dz.pts, cum, a, b);
          return { pts: sp.pts, mit: miters(sp.pts), cum: sp.cum, junc: sp.pts.map(() => 1e6), vOffset: vOff + a, ysAt: (i, sd, e, n, l) => ys(0, sd, e, n, l) };
        });
      const edgeOf = (pc, o) => pc.pts.map((q, k) => { const e = q[0] + pc.mit[k][0] * o, n = q[1] + pc.mit[k][1] * o; return [e, pc.ysAt(k, 0, e, n, lift), -n]; });
      for (const side of [1, -1]) {
        const sw = side > 0 ? p.swl : p.swr;
        const cw = side > 0 ? p.cwl : p.cwr;
        const track = cw === 'track', tw = 2.0, swW = 2.0;
        const hasSw = (sw === 'yes' || sw === 'both' || (sw == null && (assume || (p.src && motorStreet)))) && !['separate', 'no', 'none'].includes(sw);
        for (const pc of pieces) {
          let inner = pc.whole ? (side > 0 ? main.L : main.R) : edgeOf(pc, side * w / 2);
          let o = w / 2;
          if (track) {
            const r = addRibbon(roads, { pts: pc.pts, mit: pc.mit, cum: pc.cum, junc: pc.junc, width: tw, offset: side * (o + tw / 2), surface: SURF.cycle, mark: 0, scores, rid, vOffset: pc.vOffset, ys: (i, sd, e, n) => pc.ysAt(i, sd, e, n, lift + 0.07) });
            addSideStrip(roads, side > 0 ? r.R : r.L, inner, { side, cum: pc.cum, surface: SURF.curb, rid });
            inner = side > 0 ? r.L : r.R;
            o += tw;
          }
          if (hasSw) {
            const r = addRibbon(roads, { pts: pc.pts, mit: pc.mit, cum: pc.cum, junc: pc.junc, width: swW, offset: side * (o + swW / 2), surface: SURF.slabs, mark: 0, scores, rid, vOffset: pc.vOffset, ys: (i, sd, e, n) => pc.ysAt(i, sd, e, n, lift + 0.13) });
            addSideStrip(roads, side > 0 ? r.R : r.L, inner, { side, cum: pc.cum, surface: SURF.curb, rid });
          }
        }
        const off = w / 2 + (track ? tw : 0) + (hasSw ? swW : 0);
        // illustrative lamps along lit streets, only where no mapped lamp stands within 18 m
        if (s.autoLamps && motorStreet && p.lit !== 0 && !p.br) {
          for (let d = (side > 0 ? 6 : 22) - (vOff % 32); d < cum[cum.length - 1]; d += 32) {
            if (d < 0) continue;
            let k = 1; while (k < cum.length - 1 && cum[k] < d) k++;
            const t = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
            const pe = dz.pts[k - 1][0] + (dz.pts[k][0] - dz.pts[k - 1][0]) * t, pn = dz.pts[k - 1][1] + (dz.pts[k][1] - dz.pts[k - 1][1]) * t;
            const m = mit[k];
            const le = pe + m[0] * side * (off + 0.4), ln = pn + m[1] * side * (off + 0.4);
            // arm (+x of the lamp model) points back towards the road centre: rotY maps +x to (cos θ east, sin θ north)
            const rot = Math.atan2(-side * m[1], -side * m[0]);
            if (gaps.some(([g0, g1]) => d > g0 - 1.5 && d < g1 + 1.5)) continue; // not in the middle of a crossing street
            if (nearOsmLamp(le, ln) || this.ctx.colliders.insideAny(le, ln)) continue;
            lampSpots.push({ type: 'lamp', x: le, y: this.hAt(le, ln), z: -ln, rot, auto: true });
          }
        }
      }
      // zebra crossings at tagged crossing nodes
      if (ndSub && info.motor) {
        ndSub.forEach((id, k) => {
          const c = data.crossings.get(id);
          if (!c || !c.zebra) return;
          const a = sub[Math.max(0, k - 1)], b = sub[Math.min(sub.length - 1, k + 1)];
          const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const dir = [(b[0] - a[0]) / dl, (b[1] - a[1]) / dl];
          const pt = sub[k];
          addZebra(roads, pt, dir, w, ys(0, 0, pt[0], pt[1]) + 0.012, rid);
        });
      }
    }

    // ---- railways (ballast, sleepers bed, rails)
    for (const run of bin.railRuns) {
      const f = run.f, p = f.properties;
      if (!f._cum) { f._cum = [0]; for (let i = 1; i < f._pts.length; i++) f._cum.push(f._cum[i - 1] + Math.hypot(f._pts[i][0] - f._pts[i - 1][0], f._pts[i][1] - f._pts[i - 1][1])); }
      const sub = f._pts.slice(run.i0, run.i1 + 1);
      const dz = densify(sub, 5);
      const { cum, junc } = measures(dz.pts, dz.flags);
      const mit = miters(dz.pts);
      const street = p.k === 'tram';
      const ys = (i, side, e, n, l) => this.hAt(e, n) + l;
      if (!street) addRibbon(roads, { pts: dz.pts, mit, cum, junc, width: 3.2, surface: p.k === 'light_rail' ? SURF.slabs : SURF.ballast, rid: -1, ys: (i, sd, e, n) => ys(i, sd, e, n, 0.1) });
      for (const g of [-0.7175, 0.7175]) {
        const top = addRibbon(roads, { pts: dz.pts, mit, cum, junc, width: 0.08, offset: g, surface: SURF.rail, rid: -1, ys: (i, sd, e, n) => ys(i, sd, e, n, street ? 0.13 : 0.3) });
        if (!street) {
          addSideStrip(roads, top.L, top.L.map(q => [q[0], q[1] - 0.16, q[2]]), { side: 1, cum, surface: SURF.rail });
          addSideStrip(roads, top.R, top.R.map(q => [q[0], q[1] - 0.16, q[2]]), { side: -1, cum, surface: SURF.rail });
        }
      }
    }

    if (roads.count) {
      const mesh = new THREE.Mesh(toGeometry(roads.toTyped(), ROAD_ATTRS), this.ctx.mats.road);
      mesh.receiveShadow = true;
      mesh.userData = { kind: 'road', chunk: ch };
      grp.add(mesh);
    }
    ch.roadRefs = refs;

    // ---- water: polygons whose centroid lies in this chunk, plus waterway ribbons
    const water = new Acc(SIMPLE_ATTRS);
    for (const f of bin.water) {
      const c = f._wc || (f._wc = data.toLocal(...geo.geometryCentroid(f.geometry)));
      if (Math.floor(c[0] / CHUNK) !== ch.i || Math.floor(c[1] / CHUNK) !== ch.j) continue;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        const rings = poly.map(r => data.localRing(r));
        let level = f.properties.z;
        if (level === undefined || level === null) {
          let mn = Infinity;
          const r0 = rings[0];
          const st = Math.max(1, Math.floor(r0.length / 32));
          for (let i = 0; i < r0.length; i += st) mn = Math.min(mn, this.hAt(r0[i][0], r0[i][1]));
          level = mn;
        }
        addWaterPolygon(water, rings, level + 0.05);
      }
    }
    if (water.count) {
      const mesh = new THREE.Mesh(toGeometry(water.toTyped(), SIMPLE_ATTRS), this.ctx.mats.water);
      mesh.receiveShadow = true;
      mesh.userData = { kind: 'water', chunk: ch };
      grp.add(mesh);
    }
    const ww = new Acc(ROAD_ATTRS);
    for (const run of bin.waterRuns) {
      const f = run.f;
      const sub = f._pts.slice(run.i0, run.i1 + 1);
      const dz = densify(sub, 5);
      const { cum, junc } = measures(dz.pts, dz.flags);
      addRibbon(ww, { pts: dz.pts, mit: miters(dz.pts), cum, junc, width: f.properties.w || 3, rid: -1, ys: (i, sd, e, n) => this.hAt(e, n) - 0.25 });
    }
    if (ww.count) {
      const t = ww.toTyped();
      const g = toGeometry(t, ROAD_ATTRS);
      const mesh = new THREE.Mesh(g, this.ctx.mats.water);
      mesh.userData = { kind: 'water', chunk: ch };
      grp.add(mesh);
    }

    // ---- barriers (hedges, walls, fences)
    const bar = new Acc(WALL_ATTRS);
    for (const run of bin.barrierRuns) {
      const p = run.f.properties;
      const sub = run.f._pts.slice(run.i0, run.i1 + 1);
      const width = p.k === 'hedge' ? 0.9 : p.k === 'fence' || p.k === 'guard_rail' ? 0.06 : 0.3;
      const col = lin(p.k === 'hedge' ? '#3e5c2c' : p.k === 'fence' ? '#5a5c5e' : p.k === 'guard_rail' ? '#9a9fa3' : '#8c4a35');
      const mit = miters(sub);
      const h = p.h || 1.4;
      for (const sd of [1, -1]) {
        for (let i = 0; i < sub.length - 1; i++) {
          const a = [sub[i][0] + mit[i][0] * sd * width / 2, sub[i][1] + mit[i][1] * sd * width / 2];
          const b = [sub[i + 1][0] + mit[i + 1][0] * sd * width / 2, sub[i + 1][1] + mit[i + 1][1] * sd * width / 2];
          const ya = this.hAt(a[0], a[1]), yb = this.hAt(b[0], b[1]);
          const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
          const n = sd > 0 ? [-dy / l, 0, -dx / l] : [dy / l, 0, dx / l];
          const attr = [3, 0.5, 8, h];
          const A0 = bar.v(a[0], ya - 0.2, -a[1], ...n, 0, 0, ...col, ...attr, -1), B0 = bar.v(b[0], yb - 0.2, -b[1], ...n, l, 0, ...col, ...attr, -1);
          const B1 = bar.v(b[0], yb + h, -b[1], ...n, l, h, ...col, ...attr, -1), A1 = bar.v(a[0], ya + h, -a[1], ...n, 0, h, ...col, ...attr, -1);
          if (sd > 0) { bar.tri(A0, B1, B0); bar.tri(A0, A1, B1); } else { bar.tri(A0, B0, B1); bar.tri(A0, B1, A1); }
        }
      }
    }
    if (bar.count) {
      const mesh = new THREE.Mesh(toGeometry(bar.toTyped(), WALL_ATTRS), this.ctx.mats.barrier);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { kind: 'barrier', chunk: ch };
      grp.add(mesh);
    }

    // ---- trees: surveyed / mapped trees + trees scattered in woods and parks
    if (s.trees) {
      const list = [];
      for (const f of bin.trees) {
        const [e, n] = f._c;
        list.push({ x: e, y: this.hAt(e, n), z: -n, h: f.properties.h, conifer: f.properties.lt === 'needleleaved', seed: (Number(String(f.id).replace(/\D/g, '').slice(-6)) || 1) % 10007, ref: f });
      }
      const dens = { 'natural=wood': 1 / 40, 'landuse=forest': 1 / 40, 'leisure=park': 1 / 260, 'leisure=garden': 1 / 300, 'landuse=cemetery': 1 / 220, 'leisure=nature_reserve': 1 / 80, 'natural=scrub': 1 / 160, 'landuse=recreation_ground': 1 / 500, 'landuse=village_green': 1 / 400 };
      const blockers = this.ctx.colliders.ringsNear(ch.i * CHUNK + CHUNK / 2, ch.j * CHUNK + CHUNK / 2, CHUNK);
      for (const f of bin.landuse) {
        const dk = dens[f.properties.k];
        if (!dk || s.treeDensity <= 0) continue;
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        const loc = f._locPoly || (f._locPoly = polys.map(rs => rs.map(r => data.localRing(r))));
        const spacing = Math.sqrt(1 / (dk * s.treeDensity));
        const conifer = f.properties.t && f.properties.t.leaf_type === 'needleleaved';
        let seed = (ch.i * 73856093) ^ (ch.j * 19349663);
        const rand = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) % 100000) / 100000; };
        for (let e = ch.i * CHUNK + spacing / 2; e < (ch.i + 1) * CHUNK; e += spacing) {
          for (let n = ch.j * CHUNK + spacing / 2; n < (ch.j + 1) * CHUNK; n += spacing) {
            const pe = e + (rand() - 0.5) * spacing * 0.9, pn = n + (rand() - 0.5) * spacing * 0.9;
            if (!loc.some(rs => pointInRing([pe, pn], rs[0]) && !rs.slice(1).some(h => pointInRing([pe, pn], h)))) continue;
            if (blockers.some(r => pointInRing([pe, pn], r))) continue;
            if (this.ctx.city.roadNear(...data.toLngLat(pe, pn), 3.5)) continue;
            list.push({ x: pe, y: this.hAt(pe, pn), z: -pn, conifer: conifer || (f.properties.k === 'landuse=forest' && rand() < 0.35), seed: Math.floor(rand() * 10007) });
            if (list.length > 1500) break;
          }
        }
      }
      if (list.length) { const t = buildTrees(list, this.ctx.season()); t.userData = { kind: 'trees', chunk: ch }; grp.add(t); }
    }

    // ---- street furniture (and the lamps that light the streets at night, even when furniture models are hidden)
    {
      const items = [...lampSpots];
      for (const f of bin.furniture) {
        const t = kindToProp(f.properties.k, f.properties.t);
        if (!t || (!s.furniture && t !== 'lamp')) continue;
        const [e, n] = f._c;
        let rot = ((Number(String(f.id).replace(/\D/g, '').slice(-4)) || 0) % 360) * Math.PI / 180;
        const near = this.ctx.city.roadNear(...data.toLngLat(e, n), 20);
        if (near) {
          const c = near.feature.geometry.coordinates, sgi = near.segment;
          const a = data.toLocal(...c[sgi - 1]), b = data.toLocal(...c[sgi]);
          rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
          if (t === 'lamp' || t === 'signal') {
            // turn the arm towards the road
            const cross = (b[0] - a[0]) * (n - a[1]) - (b[1] - a[1]) * (e - a[0]);
            rot += cross > 0 ? -Math.PI / 2 : Math.PI / 2;
          }
        }
        items.push({ type: t, x: e, y: this.hAt(e, n), z: -n, rot, ref: f });
      }
      if (s.furniture && items.length) {
        const pg = buildProps(items);
        pg.userData = { kind: 'props', chunk: ch };
        grp.add(pg);
      }
      // street lighting at night (lamps.js light map)
      if (this.ctx.lamps) this.ctx.lamps.set(ch.k, items.filter(i => i.type === 'lamp').map(lampHead));
    }
    ch.detailGroup = grp;
    ch.group.add(grp);
    this.version++;
  }

  /** Which building / road does a raycast hit refer to? */
  resolveHit(hit) {
    const o = hit.object;
    const ud = o.userData || {};
    const ch = ud.chunk || (o.parent && o.parent.userData && o.parent.userData.chunk);
    if (!ch) return null;
    if (ud.kind === 'building' && hit.face) {
      const bid = o.geometry.attributes.aBid.getX(hit.face.a);
      const f = ch.buildRefs[Math.round(bid)];
      return f ? { type: 'building', f } : null;
    }
    if (ud.kind === 'road' && hit.face) {
      const rid = Math.round(o.geometry.attributes.aRid.getX(hit.face.a));
      const f = ch.roadRefs[rid];
      return f ? { type: 'road', f } : null;
    }
    if (o.parent && o.parent.userData && o.parent.userData.kind === 'trees' && hit.instanceId !== undefined) {
      const it = o.userData.treeItems && o.userData.treeItems[hit.instanceId];
      return { type: 'tree', item: it };
    }
    if (o.userData.props && hit.instanceId !== undefined) {
      const it = o.userData.props[hit.instanceId];
      return { type: 'prop', item: it };
    }
    if (ud.kind === 'water') return { type: 'water' };
    if (ud.kind === 'ground') return { type: 'ground' };
    return null;
  }
}
