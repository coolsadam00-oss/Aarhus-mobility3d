// Illustrative city life: cars, cyclists, pedestrians and light-rail trams moving along the real street and
// rail network (right-hand traffic, one-way streets respected, simple car following, stopping for the player).
import * as THREE from 'three';
import { trafficCarGeometry, cyclistGeometry, pedestrianGeometry, tramGeometry } from './vehicles.js';
import { U } from './materials.js';

const CAR_COLORS = ['#e9ecef', '#1c1f23', '#5c636a', '#adb5bd', '#1f4e79', '#8b1e1e', '#2b5d34', '#c9c2b0', '#3c4a5c', '#f2f2f2', '#6d2a3a', '#0f2a44'];
const CLOTH = ['#2b3a4a', '#6d2a3a', '#2f4f3a', '#3a3a3a', '#7a5c3a', '#1f3b5c', '#5a4a6a', '#a04a3a', '#d4a537', '#e8e8e8'];

function pointAt(edge, d) {
  const c = edge.cum;
  let i = 1;
  while (i < c.length - 1 && c[i] < d) i++;
  const t = Math.max(0, Math.min(1, (d - c[i - 1]) / ((c[i] - c[i - 1]) || 1)));
  const a = edge.pts[i - 1], b = edge.pts[i];
  return { e: a[0] + (b[0] - a[0]) * t, n: a[1] + (b[1] - a[1]) * t, de: b[0] - a[0], dn: b[1] - a[1] };
}

export class Traffic {
  constructor(ctx) {
    this.ctx = ctx; // { scene, data, hAt, settings, player }
    this.agents = [];
    this.graph = ctx.data.buildGraph();
    for (const e of this.graph.edges) { e.cum = [0]; for (let i = 1; i < e.pts.length; i++) e.cum.push(e.cum[i - 1] + Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1])); }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 });
    // head- and taillights: Danish vehicles drive with lights on, by day dimly, after dark at full strength
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = U.uNight;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight; varying float vGlow;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (vGlow > 1.5) totalEmissiveRadiance += vec3(1.0, 0.04, 0.02) * mix(0.2, 2.2, uNight);
          else if (vGlow > 0.5) totalEmissiveRadiance += vec3(1.0, 0.93, 0.8) * mix(0.35, 4.0, uNight);`);
    };
    mat.customProgramCacheKey = () => 'traffic-lights-v1';
    const mk = (geo, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = true; m.count = 0; m.frustumCulled = false; ctx.scene.add(m); return m; };
    this.meshes = { car: mk(trafficCarGeometry(), 220), bike: mk(cyclistGeometry(), 140), ped: mk(pedestrianGeometry(), 220), tram: mk(tramGeometry(), 8) };
    this.edgesBy = { car: this.graph.edges.filter(e => e.car), bike: this.graph.edges.filter(e => e.bike && !e.rail), ped: this.graph.edges.filter(e => e.foot && !e.rail), tram: this.graph.edges.filter(e => e.rail) };
    this.tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), c: new THREE.Color(), up: new THREE.Vector3(0, 1, 0) };
    this.spawnTimer = 0;
  }

  dispose() { for (const m of Object.values(this.meshes)) { this.ctx.scene.remove(m); m.geometry.dispose(); } }

  targetCounts() {
    const s = this.ctx.settings.get();
    if (!s.traffic) return { car: 0, bike: 0, ped: 0, tram: 0 };
    const d = s.trafficDensity;
    return { car: Math.round(55 * d), bike: Math.round(40 * d), ped: Math.round(60 * d), tram: this.edgesBy.tram.length ? 3 : 0 };
  }

  spawn(type, pe, pn) {
    const list = this.edgesBy[type];
    if (!list.length) return false;
    for (let tries = 0; tries < 25; tries++) {
      const e = list[Math.floor(Math.random() * list.length)];
      const mid = e.pts[Math.floor(e.pts.length / 2)];
      const dist = Math.hypot(mid[0] - pe, mid[1] - pn);
      if (dist > (type === 'tram' ? 900 : 380) || dist < 25) continue;
      let dir = Math.random() < 0.5 ? 1 : -1;
      if (type === 'car' && e.oneway) dir = e.oneway;
      const speed = type === 'car' ? e.speed * (0.75 + Math.random() * 0.3) : type === 'bike' ? 4.2 + Math.random() * 1.6 : type === 'ped' ? 1.15 + Math.random() * 0.45 : 11;
      this.agents.push({ type, edge: e, dir, d: dir > 0 ? Math.random() * e.len : Math.random() * e.len, speed, v: speed, color: type === 'car' ? CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)] : CLOTH[Math.floor(Math.random() * CLOTH.length)], side: type === 'ped' ? (Math.random() < 0.5 ? 1 : -1) : 1 });
      return true;
    }
    return false;
  }

  nextEdge(a) {
    const node = a.dir > 0 ? a.edge.b : a.edge.a;
    const options = node.edges.filter(e => e !== a.edge && (a.type === 'car' ? e.car : a.type === 'bike' ? e.bike && !e.rail : a.type === 'ped' ? e.foot && !e.rail : e.rail));
    const allowed = options.filter(e => !(a.type === 'car' && e.oneway && ((e.a === node && e.oneway < 0) || (e.b === node && e.oneway > 0))));
    const pick = allowed.length ? allowed[Math.floor(Math.random() * allowed.length)] : null;
    if (!pick) { a.dir = -a.dir; return; } // dead end: turn around
    a.edge = pick;
    a.dir = pick.a === node ? 1 : -1;
    a.d = a.dir > 0 ? 0 : pick.len;
    if (a.type === 'car') a.speed = pick.speed * (0.75 + Math.random() * 0.3);
  }

  update(dt, camE, camN) {
    const want = this.targetCounts();
    const counts = { car: 0, bike: 0, ped: 0, tram: 0 };
    // despawn far agents
    this.agents = this.agents.filter(a => {
      const p = pointAt(a.edge, a.d);
      const far = Math.hypot(p.e - camE, p.n - camN) > (a.type === 'tram' ? 1300 : 520);
      if (!far) counts[a.type]++;
      return !far;
    });
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.15;
      for (const t of ['car', 'bike', 'ped', 'tram']) { let n = 0; while (counts[t] < want[t] && n++ < 4) { if (this.spawn(t, camE, camN)) counts[t]++; else break; } }
      while (this.agents.length && Object.keys(counts).some(t => counts[t] > want[t])) {
        const t = Object.keys(counts).find(k => counts[k] > want[k]);
        const i = this.agents.findIndex(a => a.type === t);
        if (i < 0) break;
        this.agents.splice(i, 1); counts[t]--;
      }
    }
    const pl = this.ctx.player;
    const { m, q, p, s, c, up } = this.tmp;
    const idx = { car: 0, bike: 0, ped: 0, tram: 0 };
    // simple following: agents on the same edge & direction keep distance
    const byEdge = new Map();
    for (const a of this.agents) { const k = a.edge; if (!byEdge.has(k)) byEdge.set(k, []); byEdge.get(k).push(a); }
    for (const a of this.agents) {
      let target = a.speed;
      const same = byEdge.get(a.edge);
      for (const o of same) {
        if (o === a || o.dir !== a.dir || o.type !== a.type || a.type === 'ped') continue;
        const gap = (o.d - a.d) * a.dir;
        const minGap = a.type === 'car' ? 9 : a.type === 'tram' ? 40 : 4;
        if (gap > 0 && gap < minGap) target = Math.min(target, Math.max(0, (gap - minGap * 0.5)) * 0.8);
      }
      const pos = pointAt(a.edge, a.d);
      if (a.type !== 'ped' && pl) {
        // stop for the player standing / driving in front
        const dl = Math.hypot(pos.de, pos.dn) || 1;
        const fe = (pos.de / dl) * a.dir, fn = (pos.dn / dl) * a.dir;
        const rx = pl.e - pos.e, rn = pl.n - pos.n;
        const ahead = rx * fe + rn * fn, lateral = Math.abs(rx * fn - rn * fe);
        if (ahead > 0 && ahead < 14 && lateral < 2.5) target = Math.min(target, Math.max(0, ahead - 6) * 0.6);
      }
      a.v += (target - a.v) * Math.min(1, dt * 2.2);
      a.d += a.v * dt * a.dir;
      if (a.d > a.edge.len || a.d < 0) { const over = a.dir > 0 ? a.d - a.edge.len : -a.d; this.nextEdge(a); a.d = a.dir > 0 ? Math.min(over, a.edge.len) : Math.max(0, a.edge.len - over); }
      const pp = pointAt(a.edge, a.d);
      const dl = Math.hypot(pp.de, pp.dn) || 1;
      const fe = (pp.de / dl) * a.dir, fn = (pp.dn / dl) * a.dir;
      // right-hand traffic: offset to the right of travel direction (right = (fn, -fe))
      const w = a.edge.width || 6;
      const off = a.type === 'car' ? Math.min(w / 4, 1.8) : a.type === 'bike' ? Math.max(0.6, w / 2 - 0.7) : a.type === 'ped' ? (w / 2 + 1.1) * a.side : 0;
      const pe = pp.e + fn * off, pn = pp.n - fe * off;
      const y = this.ctx.hAt(pe, pn) + (a.type === 'tram' ? 0.05 : 0);
      const yaw = Math.atan2(fe, fn);
      q.setFromAxisAngle(up, Math.PI / 2 - yaw);
      p.set(pe, y, -pn);
      m.compose(p, q, s);
      const mesh = this.meshes[a.type];
      const i = idx[a.type]++;
      if (i >= mesh.instanceMatrix.count) continue;
      mesh.setMatrixAt(i, m);
      c.set(a.color);
      mesh.setColorAt(i, c);
    }
    for (const [t, mesh] of Object.entries(this.meshes)) {
      mesh.count = Math.min(idx[t], mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
