// Trees (instanced): broadleaved and needleleaved models, seasonal colours, wind sway (see foliageMaterial).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { foliageMaterial } from './materials.js';

let assets = null;

function displace(geo, amp, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 7.1 + seed) * Math.cos(y * 6.3 + seed * 1.7) * Math.sin(z * 5.9 + seed * 0.7);
    const k = 1 + n * amp;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeAssets() {
  // broadleaved crown: three lumpy blobs, unit height ≈ 1 (scaled per instance)
  const blobs = [
    displace(new THREE.IcosahedronGeometry(0.36, 2), 0.16, 1.1).translate(0, 0.62, 0),
    displace(new THREE.IcosahedronGeometry(0.28, 2), 0.18, 2.3).translate(0.17, 0.48, 0.08),
    displace(new THREE.IcosahedronGeometry(0.26, 2), 0.18, 3.7).translate(-0.15, 0.5, -0.1),
    displace(new THREE.IcosahedronGeometry(0.24, 1), 0.2, 4.1).translate(0.02, 0.84, 0.05)
  ];
  const crown = mergeGeometries(blobs.map(g => g.toNonIndexed()));
  const trunk = new THREE.CylinderGeometry(0.028, 0.045, 0.55, 7).translate(0, 0.275, 0);
  const coneA = new THREE.ConeGeometry(0.26, 0.55, 9).translate(0, 0.45, 0);
  const coneB = new THREE.ConeGeometry(0.2, 0.45, 9).translate(0, 0.72, 0);
  const coneC = new THREE.ConeGeometry(0.13, 0.32, 9).translate(0, 0.92, 0);
  const conifer = mergeGeometries([coneA, coneB, coneC].map(g => g.toNonIndexed()));
  const trunkC = new THREE.CylinderGeometry(0.022, 0.035, 0.3, 6).translate(0, 0.15, 0);
  const fol = foliageMaterial();
  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.95 });
  return { crown, trunk, conifer, trunkC, fol, bark };
}

const PALETTES = {
  spring: ['#7fae4a', '#8cc152', '#6a9e3f', '#93b85a', '#5f8f3a'],
  summer: ['#3f6b2f', '#4a7a35', '#557f3a', '#36602a', '#5b8a3c', '#476f33'],
  autumn: ['#b5651d', '#c98a2b', '#8f4a1c', '#6b7a2f', '#d4a537', '#9a5a22', '#7a8a33', '#c0702a'],
  winter: ['#5d5246', '#4f463c', '#665a4d', '#574b40']
};
const CONIFER = ['#2c4a2a', '#355a30', '#2f4f2c', '#3a5a34'];

function rnd(seed, k) { const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); }

/**
 * Build instanced trees.
 * @param {Array<{x:number,y:number,z:number,h?:number,conifer?:boolean,seed:number}>} list
 * @param {string} season spring|summer|autumn|winter
 */
export function buildTrees(list, season) {
  if (!assets) assets = makeAssets();
  const group = new THREE.Group();
  group.name = 'trees';
  const broad = list.filter(t => !t.conifer), con = list.filter(t => t.conifer);
  const pal = PALETTES[season] || PALETTES.summer;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const make = (items, crownGeo, trunkGeo, colors, crownScale) => {
    if (!items.length) return;
    const crown = new THREE.InstancedMesh(crownGeo, assets.fol, items.length);
    const trunk = new THREE.InstancedMesh(trunkGeo, assets.bark, items.length);
    crown.castShadow = trunk.castShadow = true;
    crown.receiveShadow = true;
    items.forEach((t, i) => {
      const h = t.h || (7 + rnd(t.seed, 1) * 9);
      const wscale = h * (crownScale + rnd(t.seed, 2) * 0.25);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(t.seed, 3) * Math.PI * 2);
      p.set(t.x, t.y - 0.1, t.z);
      const winterBare = season === 'winter' && !t.conifer;
      s.set(wscale * (winterBare ? 0.85 : 1), h * (winterBare ? 0.92 : 1), wscale * (winterBare ? 0.85 : 1));
      m.compose(p, q, s);
      crown.setMatrixAt(i, m);
      s.set(h * 0.9, h, h * 0.9);
      m.compose(p, q, s);
      trunk.setMatrixAt(i, m);
      col.set(colors[Math.floor(rnd(t.seed, 4) * colors.length)]);
      crown.setColorAt(i, col);
    });
    crown.instanceMatrix.needsUpdate = true;
    trunk.instanceMatrix.needsUpdate = true;
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    crown.computeBoundingSphere(); trunk.computeBoundingSphere();
    crown.userData.treeItems = items;
    group.add(crown, trunk);
  };
  make(broad, assets.crown, assets.trunk, pal, 0.62);
  make(con, assets.conifer, assets.trunkC, CONIFER, 0.55);
  return group;
}
