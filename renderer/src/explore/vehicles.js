// Procedural vehicle and people models: player car (clear-coat paint, glass, rotating wheels, lights),
// player bicycle + rider, and instancing-friendly merged models for traffic (cars, cyclists, pedestrians, light rail).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Tag a part as a light: 0 none, 1 head/front light, 2 tail/rear light (glows at night, see traffic.js). */
function glow(geo, v) {
  const a = new Float32Array(geo.attributes.position.count).fill(v);
  geo.setAttribute('aGlow', new THREE.BufferAttribute(a, 1));
  return geo;
}
/** Keep position/normal/color, add aGlow = 0 where missing, so parts merge cleanly. */
function clean(p) {
  const g = p.index ? p.toNonIndexed() : p;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'aGlow'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.aGlow) glow(g, 0);
  return g;
}

function colorize(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

/** Side profile of a modern hatchback (x along length, y up), metres. */
function carProfile() {
  const s = new THREE.Shape();
  s.moveTo(-2.15, 0.32); s.lineTo(-2.2, 0.62); s.quadraticCurveTo(-2.18, 0.9, -1.98, 0.98);
  s.lineTo(-1.62, 1.05); s.quadraticCurveTo(-1.25, 1.44, -0.75, 1.46); s.lineTo(0.35, 1.45);
  s.quadraticCurveTo(0.85, 1.42, 1.25, 1.02); s.lineTo(1.95, 0.9); s.quadraticCurveTo(2.2, 0.82, 2.2, 0.58);
  s.lineTo(2.15, 0.32); s.lineTo(-2.15, 0.32);
  return s;
}
function windowProfile() {
  const s = new THREE.Shape();
  s.moveTo(-1.55, 1.07); s.quadraticCurveTo(-1.2, 1.39, -0.75, 1.4); s.lineTo(0.33, 1.39); s.quadraticCurveTo(0.78, 1.36, 1.15, 1.05); s.lineTo(-1.55, 1.07);
  return s;
}

function carParts() {
  const W = 1.78;
  const body = new THREE.ExtrudeGeometry(carProfile(), { depth: W, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10 });
  body.translate(0, 0, -W / 2);
  const glass = new THREE.ExtrudeGeometry(windowProfile(), { depth: W + 0.04, bevelEnabled: false, curveSegments: 8 });
  glass.translate(0, 0.012, -(W + 0.04) / 2);
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 20).rotateX(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 12).rotateX(Math.PI / 2);
  const head = new THREE.BoxGeometry(0.06, 0.12, 0.42);
  const tail = new THREE.BoxGeometry(0.06, 0.1, 0.38);
  return { W, body, glass, wheel, rim, head, tail };
}

/** Player car: returns { group, wheels:[Mesh], setNight(n), setBrake(b) }. Forward = +x. */
export function makePlayerCar(paint = 0x1f4e79) {
  const P = carParts();
  const g = new THREE.Group();
  const paintMat = new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.3, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b1117, metalness: 0.2, roughness: 0.04, transmission: 0, opacity: 0.92, transparent: true });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.25 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xfff3d6, emissiveIntensity: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.3 });
  const body = new THREE.Mesh(P.body, paintMat); body.castShadow = true; body.receiveShadow = true;
  const glass = new THREE.Mesh(P.glass, glassMat);
  g.add(body, glass);
  const wheels = [];
  for (const [x, z] of [[1.35, 0.78], [1.35, -0.78], [-1.35, 0.78], [-1.35, -0.78]]) {
    const w = new THREE.Group();
    const t = new THREE.Mesh(P.wheel, tyreMat), r = new THREE.Mesh(P.rim, rimMat);
    t.castShadow = true;
    w.add(t, r);
    w.position.set(x, 0.33, z);
    g.add(w);
    wheels.push(w);
  }
  for (const z of [0.55, -0.55]) {
    const h = new THREE.Mesh(P.head, headMat); h.position.set(2.2, 0.72, z); g.add(h);
    const t = new THREE.Mesh(P.tail, tailMat); t.position.set(-2.2, 0.8, z); g.add(t);
  }
  const lamp = new THREE.SpotLight(0xfff1d0, 0, 60, 0.42, 0.5, 1.4);
  lamp.position.set(2.3, 0.75, 0);
  lamp.target.position.set(12, -0.6, 0);
  g.add(lamp, lamp.target);
  // simple dashboard for the cockpit camera
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 1.6), new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.8 }));
  dash.position.set(0.85, 0.98, 0);
  g.add(dash);
  const wheelS = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 24), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
  wheelS.rotation.y = Math.PI / 2; wheelS.rotation.z = -0.35;
  wheelS.position.set(0.55, 1.04, 0.37);
  g.add(wheelS);
  return {
    group: g, wheels, steeringWheel: wheelS,
    setNight(n) { headMat.emissiveIntensity = 0.2 + n * 4; lamp.intensity = n * 60; },
    setBrake(b) { tailMat.emissiveIntensity = b ? 3.5 : 0.3; }
  };
}

/** Player bicycle with rider (rider hidden in first person). Forward = +x. */
export function makePlayerBike() {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a6fb0, metalness: 0.5, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
  const wheels = [];
  for (const x of [0.52, -0.52]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 28), dark);
    w.position.set(x, 0.36, 0); w.castShadow = true;
    g.add(w); wheels.push(w);
  }
  const tube = (a, b, r = 0.022) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), frameMat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true;
    g.add(m);
  };
  const V = (x, y) => new THREE.Vector3(x, y, 0);
  tube(V(-0.52, 0.36), V(-0.05, 0.36)); tube(V(-0.05, 0.36), V(0.4, 0.82)); tube(V(-0.12, 0.82), V(0.4, 0.82)); tube(V(-0.52, 0.36), V(-0.12, 0.82));
  tube(V(-0.05, 0.36), V(-0.14, 0.9)); tube(V(0.52, 0.36), V(0.42, 0.95));
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.56, 8).rotateX(Math.PI / 2), dark);
  bar.position.set(0.42, 1.0, 0); g.add(bar);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.12), dark); seat.position.set(-0.15, 0.93, 0); g.add(seat);
  const rider = makePerson(0x3b5b7a, 0xf1c9a5);
  rider.position.set(-0.08, 0.58, 0);
  rider.rotation.z = -0.25;
  g.add(rider);
  return { group: g, wheels, rider, handlebar: bar };
}

export function makePerson(cloth = 0x3a4a5a, skin = 0xe8c2a0) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.75, 4, 10), new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.85 }));
  body.position.y = 0.95; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
  head.position.y = 1.62; head.castShadow = true;
  g.add(body, head);
  return g;
}

// ------------------------------------------------------------------ instancing-friendly merged models (vertex colours)
export function trafficCarGeometry() {
  const P = carParts();
  const parts = [colorize(P.body, '#ffffff'), colorize(P.glass, '#1a2229')];
  for (const [x, z] of [[1.35, 0.78], [1.35, -0.78], [-1.35, 0.78], [-1.35, -0.78]]) parts.push(colorize(P.wheel.clone().translate(x, 0.33, z), '#141414'));
  for (const z of [0.55, -0.55]) { parts.push(glow(clean(colorize(P.head.clone().translate(2.2, 0.72, z), '#f5f0e0')), 1)); parts.push(glow(clean(colorize(P.tail.clone().translate(-2.2, 0.8, z), '#a01010')), 2)); }
  return mergeGeometries(parts.map(clean));
}

export function cyclistGeometry() {
  const parts = [];
  for (const x of [0.52, -0.52]) parts.push(colorize(new THREE.TorusGeometry(0.34, 0.03, 6, 18).translate(x, 0.36, 0), '#1a1a1a'));
  parts.push(colorize(new THREE.BoxGeometry(1.0, 0.05, 0.05).translate(0, 0.62, 0), '#9aa5b1'));
  parts.push(colorize(new THREE.CapsuleGeometry(0.18, 0.55, 3, 8).rotateZ(-0.3).translate(-0.05, 1.25, 0), '#ffffff'));
  parts.push(colorize(new THREE.SphereGeometry(0.12, 10, 8).translate(0.08, 1.78, 0), '#e6c2a0'));
  parts.push(colorize(new THREE.BoxGeometry(0.12, 0.5, 0.1).translate(0.05, 0.7, 0.1), '#2d3640'));
  // bike lights (required in Denmark after dark)
  parts.push(glow(clean(colorize(new THREE.BoxGeometry(0.05, 0.06, 0.06).translate(0.62, 0.9, 0), '#f5f0e0')), 1));
  parts.push(glow(clean(colorize(new THREE.BoxGeometry(0.04, 0.05, 0.06).translate(-0.62, 0.72, 0), '#a01010')), 2));
  return mergeGeometries(parts.map(clean));
}

export function pedestrianGeometry() {
  const parts = [
    colorize(new THREE.CapsuleGeometry(0.19, 0.72, 3, 8).translate(0, 0.95, 0), '#ffffff'),
    colorize(new THREE.SphereGeometry(0.115, 10, 8).translate(0, 1.6, 0), '#e6c2a0'),
    colorize(new THREE.CapsuleGeometry(0.07, 0.6, 2, 6).translate(0.05, 0.4, 0.09), '#2b3138'),
    colorize(new THREE.CapsuleGeometry(0.07, 0.6, 2, 6).translate(-0.05, 0.4, -0.09), '#2b3138')
  ];
  return mergeGeometries(parts.map(clean));
}

export function tramGeometry() {
  const parts = [];
  for (const [x, l] of [[0, 15], [-15.6, 15]]) {
    parts.push(colorize(new THREE.BoxGeometry(l, 2.6, 2.65).translate(x, 1.75, 0), '#f2f4f5'));
    parts.push(colorize(new THREE.BoxGeometry(l - 0.6, 0.95, 2.67).translate(x, 2.15, 0), '#1b252d'));
    parts.push(colorize(new THREE.BoxGeometry(l, 0.18, 2.66).translate(x, 1.0, 0), '#2f8fd0'));
    parts.push(colorize(new THREE.BoxGeometry(l * 0.4, 0.3, 0.5).translate(x, 3.2, 0), '#8a9096'));
  }
  for (const z of [0.9, -0.9]) {
    parts.push(glow(clean(colorize(new THREE.BoxGeometry(0.05, 0.18, 0.3).translate(7.53, 1.2, z), '#f5f0e0')), 1));
    parts.push(glow(clean(colorize(new THREE.BoxGeometry(0.05, 0.18, 0.3).translate(-23.13, 1.2, z), '#a01010')), 2));
  }
  return mergeGeometries(parts.map(clean));
}
