// Street furniture as instanced meshes: lamps, traffic lights, benches, bus stops, bike racks, bins, post boxes,
// hydrants, bollards, flagpoles, advertising columns, cabinets. Lamp heads and signal lights glow at night.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from './materials.js';

function painted(geo, hex) {
  const g = geo.toNonIndexed();
  const c = new THREE.Color(hex);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}
const box = (w, h, d, x, y, z, col) => painted(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col);
const cyl = (rt, rb, h, x, y, z, col, seg = 8) => painted(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z), col);

let defs = null;
function makeDefs() {
  const POLE = '#5d6166', DARK = '#2f3337';
  const d = {
    lamp: { body: mergeGeometries([cyl(0.06, 0.09, 6, 0, 3, 0, POLE), box(1.3, 0.08, 0.08, 0.6, 6.0, 0, POLE)]), glow: new THREE.BoxGeometry(0.55, 0.12, 0.26).translate(1.15, 5.92, 0), glowColor: 0xffd59a },
    signal: { body: mergeGeometries([cyl(0.06, 0.07, 3.3, 0, 1.65, 0, DARK), box(0.32, 0.95, 0.28, 0, 3.0, 0, '#1d1f21')]), glow: mergeGeometries([new THREE.SphereGeometry(0.09, 8, 6).translate(0, 3.28, 0.15), new THREE.SphereGeometry(0.09, 8, 6).translate(0, 2.74, 0.15)]), glowColor: 0xff3b2f },
    bench: { body: mergeGeometries([box(1.8, 0.06, 0.45, 0, 0.45, 0, '#7b5a3a'), box(1.8, 0.4, 0.06, 0, 0.7, -0.2, '#7b5a3a'), box(0.06, 0.45, 0.4, -0.8, 0.22, 0, DARK), box(0.06, 0.45, 0.4, 0.8, 0.22, 0, DARK)]) },
    busstop: { body: mergeGeometries([cyl(0.05, 0.05, 2.8, 0, 1.4, 0, POLE), box(0.5, 0.5, 0.04, 0, 2.6, 0, '#f2c200'), box(0.36, 0.5, 0.03, 0, 2.05, 0, '#ffffff')]) },
    shelter: { body: mergeGeometries([box(3.2, 0.08, 1.5, 0, 2.5, 0, '#4a5258'), box(3.2, 2.4, 0.04, 0, 1.25, -0.72, '#9fb4c0'), box(0.04, 2.4, 1.4, -1.58, 1.25, 0, '#9fb4c0'), box(1.6, 0.06, 0.4, 0, 0.5, -0.5, '#6c7378')]) },
    bike: { body: mergeGeometries([0, 1, 2, 3, 4].map(i => painted(new THREE.TorusGeometry(0.38, 0.025, 6, 16, Math.PI).translate(i * 0.75 - 1.5, 0.05, 0), '#8e959b'))) },
    bin: { body: mergeGeometries([cyl(0.22, 0.2, 0.85, 0, 0.42, 0, '#2f4f3a', 10), cyl(0.05, 0.05, 0.4, 0, 0.2, 0, DARK)]) },
    postbox: { body: mergeGeometries([box(0.42, 0.62, 0.32, 0, 0.95, 0, '#c8102e'), cyl(0.04, 0.04, 0.65, 0, 0.33, 0, DARK)]) },
    hydrant: { body: mergeGeometries([cyl(0.12, 0.14, 0.7, 0, 0.35, 0, '#b3261e'), new THREE.SphereGeometry(0.12, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.7, 0).toNonIndexed()].map((g, i) => (i ? painted(g, '#b3261e') : g))) },
    bollard: { body: cyl(0.07, 0.08, 0.9, 0, 0.45, 0, '#3a3e42') },
    flag: { body: cyl(0.04, 0.07, 10, 0, 5, 0, '#e9ecef') },
    column: { body: mergeGeometries([cyl(0.6, 0.6, 3.0, 0, 1.5, 0, '#d9d4c7', 16), cyl(0.68, 0.68, 0.25, 0, 3.1, 0, '#2f6f4f', 16)]) },
    cabinet: { body: box(0.8, 1.2, 0.35, 0, 0.6, 0, '#7d8a7f') },
    charger: { body: mergeGeometries([box(0.35, 1.5, 0.25, 0, 0.75, 0, '#e6e6e6'), box(0.3, 0.3, 0.02, 0, 1.2, 0.13, '#1c7ed6')]) },
    generic: { body: box(0.5, 1.0, 0.5, 0, 0.5, 0, '#8a8f95') }
  };
  d.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
  d.glowMats = {};
  return d;
}

export function kindToProp(k, t = {}) {
  switch (k) {
    case 'highway=street_lamp': return 'lamp';
    case 'highway=traffic_signals': return 'signal';
    case 'amenity=bench': case 'leisure=picnic_table': return 'bench';
    case 'highway=bus_stop': return t.shelter === 'yes' ? 'shelter' : 'busstop';
    case 'amenity=shelter': return 'shelter';
    case 'amenity=bicycle_parking': return 'bike';
    case 'amenity=waste_basket': case 'amenity=recycling': return 'bin';
    case 'amenity=post_box': case 'amenity=parcel_locker': return 'postbox';
    case 'emergency=fire_hydrant': return 'hydrant';
    case 'barrier=bollard': return 'bollard';
    case 'man_made=flagpole': return 'flag';
    case 'man_made=street_cabinet': return 'cabinet';
    case 'amenity=charging_station': return 'charger';
    default:
      if (k && k.startsWith('advertising=')) return t.advertising === 'column' ? 'column' : 'generic';
      if (k === 'highway=crossing' || k === 'highway=give_way' || k === 'highway=stop' || k === 'railway=level_crossing') return null;
      return 'generic';
  }
}

function glowMat(color) {
  if (!defs.glowMats[color]) {
    const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(color), emissiveIntensity: 0.0, roughness: 0.3 });
    m.onBeforeCompile = (s) => {
      s.uniforms.uNight = U.uNight;
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = emissive * (0.15 + 5.0 * uNight);');
    };
    m.customProgramCacheKey = () => 'glow-' + color;
    defs.glowMats[color] = m;
  }
  return defs.glowMats[color];
}

/**
 * @param {Array<{type:string,x:number,y:number,z:number,rot:number}>} items
 * @returns {THREE.Group}
 */
export function buildProps(items) {
  if (!defs) defs = makeDefs();
  const group = new THREE.Group();
  group.name = 'props';
  const byType = new Map();
  for (const it of items) { if (!defs[it.type]) continue; if (!byType.has(it.type)) byType.set(it.type, []); byType.get(it.type).push(it); }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (const [type, list] of byType) {
    const d = defs[type];
    const body = new THREE.InstancedMesh(d.body, defs.mat, list.length);
    body.castShadow = true;
    let glow = null;
    if (d.glow) glow = new THREE.InstancedMesh(d.glow, glowMat(d.glowColor), list.length);
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, it.rot || 0);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, one);
      body.setMatrixAt(i, m);
      if (glow) glow.setMatrixAt(i, m);
    });
    body.instanceMatrix.needsUpdate = true;
    body.computeBoundingSphere();
    body.userData.props = list;
    group.add(body);
    if (glow) { glow.instanceMatrix.needsUpdate = true; glow.computeBoundingSphere(); group.add(glow); }
  }
  return group;
}
