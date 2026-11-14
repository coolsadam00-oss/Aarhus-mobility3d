// Prepares city-pack data for the 3D world: local metric coordinates, chunk binning, junctions,
// crossings, building-part relations (OSM Simple 3D Buildings) and the street graph used by traffic.
import geo from '../../../shared/geo.js';
import cls from '../../../shared/classify.js';

const { makeFrame, bboxOfGeometry, pointInGeometry } = geo;
export const CHUNK = 250;

export const key = (ix, iy) => `${ix},${iy}`;

export class WorldData {
  constructor(cityData) {
    this.city = cityData;
    const bb = cityData.bbox || [10.18, 56.14, 10.22, 56.17];
    this.frame = makeFrame((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2);
    this.bins = new Map();
    this.nodeDeg = new Map();
    this.crossings = new Map();
    this.graph = null;
    this.bin();
  }

  toLocal(lng, lat) { return this.frame.toLocal(lng, lat).map((v, i) => (i === 1 ? -v : v)); } // → [east, north]
  toLngLat(e, n) { return this.frame.toLngLat(e, -n); }

  _bin(ix, iy) {
    const k = key(ix, iy);
    let b = this.bins.get(k);
    if (!b) { b = { buildings: [], roadRuns: [], railRuns: [], waterRuns: [], barrierRuns: [], trees: [], furniture: [], water: [], landuse: [], labels: [] }; this.bins.set(k, b); }
    return b;
  }
  cell(e, n) { return [Math.floor(e / CHUNK), Math.floor(n / CHUNK)]; }
  get(ix, iy) { return this.bins.get(key(ix, iy)); }

  localRing(ring) { return ring.map(p => this.toLocal(p[0], p[1])); }

  bin() {
    const city = this.city;
    // ---- buildings (+ part relations)
    const parts = [];
    for (const f of city.layer('buildings')) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      f._loc = polys.map(rings => rings.map(r => this.localRing(r)));
      const c = this.toLocal(...f.properties.centroid);
      f._c = c;
      if (f.properties.part) parts.push(f);
      const [ix, iy] = this.cell(c[0], c[1]);
      this._bin(ix, iy).buildings.push(f);
    }
    // an outline with building:part inside is not drawn (the parts describe it in 3D)
    for (const p of parts) {
      const pt = p.properties.centroid;
      for (const o of city.buildingIndex.queryPoint(pt)) {
        if (o === p || o.properties.part) continue;
        if (pointInGeometry(pt, o.geometry)) { o._hasParts = true; break; }
      }
    }
    // ---- node degrees (junctions), the motor streets meeting at each node, and crossings
    this.nodeMotor = new Map();
    for (const f of city.layer('roads')) {
      const p = f.properties, nd = p.nd;
      if (!nd) continue;
      const info = cls.roadInfo(p.k);
      const motor = info.motor && (p.rk ?? info.rank) >= 3 && !p.tu && !p.br;
      const w = p.w || info.width;
      const seen = new Set();
      for (const id of nd) {
        if (seen.has(id)) continue;
        seen.add(id);
        this.nodeDeg.set(id, (this.nodeDeg.get(id) || 0) + 1);
        if (motor) { let a = this.nodeMotor.get(id); if (!a) { a = []; this.nodeMotor.set(id, a); } a.push({ f, w }); }
      }
    }
    for (const f of city.layer('furniture')) {
      if (f.properties.k !== 'highway=crossing') continue;
      const t = f.properties.t || {};
      const zebra = t.crossing === 'zebra' || t.crossing_ref === 'zebra' || t['crossing:markings'] === 'zebra' || t.crossing === 'marked' || t.crossing === 'uncontrolled';
      const signals = t.crossing === 'traffic_signals' || t.crossing === 'traffic_signals;marked';
      const id = Number(String(f.id).replace(/^n/, ''));
      this.crossings.set(id, { zebra, signals });
    }
    // ---- line features → per-chunk runs of consecutive segments
    const runs = (f, list) => {
      const c = f.geometry.coordinates;
      const pts = c.map(p => this.toLocal(p[0], p[1]));
      f._pts = pts;
      let cur = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        const [ix, iy] = this.cell(mx, my);
        if (cur && cur.ix === ix && cur.iy === iy) cur.i1 = i + 1;
        else { cur = { f, i0: i, i1: i + 1, ix, iy }; this._bin(ix, iy)[list].push(cur); }
      }
    };
    for (const f of city.layer('roads')) { if (!f.properties.tu && !f.properties.cov && f.geometry.type === 'LineString') runs(f, 'roadRuns'); }
    for (const f of city.layer('railways')) {
      const k = f.properties.k;
      if (f.geometry.type !== 'LineString' || f.properties.tu || !['rail', 'light_rail', 'tram', 'narrow_gauge', 'preserved'].includes(k)) continue;
      runs(f, 'railRuns');
    }
    for (const f of city.layer('waterways')) if (f.geometry.type === 'LineString') runs(f, 'waterRuns');
    for (const f of city.layer('barriers')) if (f.geometry.type === 'LineString') runs(f, 'barrierRuns');
    // ---- points
    for (const f of city.layer('trees')) {
      const c = this.toLocal(...f.geometry.coordinates);
      f._c = c;
      const [ix, iy] = this.cell(c[0], c[1]);
      this._bin(ix, iy).trees.push(f);
    }
    for (const f of city.layer('furniture')) {
      if (f.geometry.type !== 'Point') continue;
      const c = this.toLocal(...f.geometry.coordinates);
      f._c = c;
      const [ix, iy] = this.cell(c[0], c[1]);
      this._bin(ix, iy).furniture.push(f);
    }
    // ---- polygons overlapping chunks (water, landuse)
    const polyBins = (f, list) => {
      const bb = bboxOfGeometry(f.geometry);
      const [x0, y0] = this.toLocal(bb[0], bb[1]), [x1, y1] = this.toLocal(bb[2], bb[3]);
      const [i0, j0] = this.cell(x0, y0), [i1, j1] = this.cell(x1, y1);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return; // huge areas (e.g. whole municipality landuse) are skipped
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this._bin(i, j)[list].push(f);
    };
    for (const f of city.layer('water')) polyBins(f, 'water');
    for (const f of [...city.layer('landuse'), ...city.layer('roadAreas')]) polyBins(f, 'landuse');
    // ---- labels
    for (const f of city.layer('buildings')) {
      const p = f.properties;
      const notable = p.n || (p.cf && p.cf !== 'unknown' && p.g !== 'minor');
      if (!notable || (p.part && !p.n)) continue;
      const [ix, iy] = this.cell(f._c[0], f._c[1]);
      this._bin(ix, iy).labels.push({ kind: 'building', f, e: f._c[0], n: f._c[1], text: p.n || p.lbl, sub: p.n ? p.lbl : (p.a || ''), icon: p.ic || '🏢', named: !!p.n, typeOnly: !p.n, h: p.h || 6 });
    }
    for (const f of city.layer('pois')) {
      const p = f.properties;
      if (!p.n) continue;
      const c = this.toLocal(...f.geometry.coordinates);
      const [ix, iy] = this.cell(c[0], c[1]);
      this._bin(ix, iy).labels.push({ kind: 'poi', f, e: c[0], n: c[1], text: p.n, sub: p.lbl, icon: p.ic || '📍', named: true, h: 0 });
    }
    const streetSeen = new Set();
    for (const f of city.layer('roads')) {
      const p = f.properties;
      if (!p.n || !f._pts || f._pts.length < 2 || p.rk < 2) continue;
      const mid = f._pts[Math.floor(f._pts.length / 2)];
      const k = p.n + '|' + Math.round(mid[0] / 120) + ',' + Math.round(mid[1] / 120);
      if (streetSeen.has(k)) continue;
      streetSeen.add(k);
      const [ix, iy] = this.cell(mid[0], mid[1]);
      this._bin(ix, iy).labels.push({ kind: 'street', f, e: mid[0], n: mid[1], text: p.n, sub: '', icon: '', named: true, h: 0 });
    }
  }

  isJunction(id) { return (this.nodeDeg.get(id) || 0) >= 2; }
  /** Widest other motor street crossing road `f` at node `id` (0 if none): sidewalks of f stop at its curb. */
  crossWidth(id, f) { let w = 0; for (const o of this.nodeMotor.get(id) || []) if (o.f !== f && o.w > w) w = o.w; return w; }

  /** Street graph for traffic agents: nodes = OSM node ids, edges with polyline geometry. */
  buildGraph() {
    if (this.graph) return this.graph;
    const nodes = new Map(); // id -> {e, n, edges: []}
    const edges = [];
    const addNode = (id, p) => { let nd = nodes.get(id); if (!nd) { nd = { id, e: p[0], n: p[1], edges: [] }; nodes.set(id, nd); } return nd; };
    for (const f of this.city.layer('roads')) {
      const p = f.properties;
      if (!f._pts || !p.nd || p.nd.length !== f._pts.length) continue;
      const info = cls.roadInfo(p.k);
      const car = info.motor && !['track', 'service', 'busway', 'bus_guideway', 'construction', 'proposed'].includes(p.k);
      const bike = !['footway', 'pedestrian', 'steps', 'motorway', 'motorway_link', 'trunk', 'corridor'].includes(p.k) || p.cw || (p.t && (p.t.bicycle === 'yes' || p.t.bicycle === 'designated'));
      const foot = !['motorway', 'motorway_link', 'trunk', 'trunk_link', 'cycleway'].includes(p.k) || (p.t && p.t.foot === 'designated');
      // split at junctions
      let start = 0;
      for (let i = 1; i < p.nd.length; i++) {
        if (i === p.nd.length - 1 || this.isJunction(p.nd[i])) {
          const pts = f._pts.slice(start, i + 1);
          let len = 0;
          for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
          if (len > 1) {
            const a = addNode(p.nd[start], f._pts[start]), b = addNode(p.nd[i], f._pts[i]);
            const e = { a, b, pts, len, f, car, bike, foot, oneway: p.ow || 0, speed: (p.ms || (info.rank >= 6 ? 50 : info.rank >= 3 ? 40 : 15)) / 3.6, width: p.w || info.width, rail: false };
            edges.push(e); a.edges.push(e); b.edges.push(e);
          }
          start = i;
        }
      }
    }
    for (const f of this.city.layer('railways')) {
      const p = f.properties;
      if (!f._pts || !p.nd || p.nd.length !== f._pts.length || !['light_rail', 'tram'].includes(p.k) || p.tu) continue;
      let len = 0;
      for (let k = 1; k < f._pts.length; k++) len += Math.hypot(f._pts[k][0] - f._pts[k - 1][0], f._pts[k][1] - f._pts[k - 1][1]);
      const a = addNode('r' + p.nd[0], f._pts[0]), b = addNode('r' + p.nd[p.nd.length - 1], f._pts[f._pts.length - 1]);
      const e = { a, b, pts: f._pts, len, f, car: false, bike: false, foot: false, oneway: 0, speed: 12, width: 3, rail: true };
      edges.push(e); a.edges.push(e); b.edges.push(e);
    }
    // join rail nodes that share coordinates (light-rail ways are split at stops)
    const byPos = new Map();
    for (const nd of nodes.values()) {
      if (!String(nd.id).startsWith('r')) continue;
      const k = Math.round(nd.e * 2) + ',' + Math.round(nd.n * 2);
      const other = byPos.get(k);
      if (other && other !== nd) { for (const e of nd.edges) { if (e.a === nd) e.a = other; if (e.b === nd) e.b = other; other.edges.push(e); } nd.edges = []; }
      else byPos.set(k, nd);
    }
    this.graph = { nodes, edges };
    return this.graph;
  }
}
