// Player movement and cameras: walk, bike, drive, fly. Local frame: x east, y up, z south (north = -z).
// yaw 0 = facing north; positive yaw turns clockwise (east).
import * as THREE from 'three';
import { makePlayerCar, makePlayerBike, makePerson } from './vehicles.js';

export const MODES = {
  walk: { icon: '🚶', label: 'Walk' }, bike: { icon: '🚲', label: 'Bike' }, drive: { icon: '🚗', label: 'Drive' }, fly: { icon: '🚁', label: 'Fly' }
};

const G = 9.81;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
/** Share of an intended move (de, dn) that was actually made (ae, an) along its direction: 1 free, 0 blocked. */
const scrapeFactor = (ae, an, de, dn) => { const w2 = de * de + dn * dn; return w2 > 1e-12 ? Math.max(0, (ae * de + an * dn) / w2) : 1; };

export class Player {
  constructor(ctx) {
    this.ctx = ctx; // { scene, camera, hAt(e,n), colliders, settings, deckAt?(e,n) }
    this.mode = 'walk';
    this.e = 0; this.n = 0; this.y = 0;
    this.yaw = 0; this.pitch = 0; this.lookYaw = 0;
    this.vy = 0; this.vel = new THREE.Vector2(); // walk velocity (east, north)
    this.speed = 0; this.steer = 0; this.onGround = true;
    this.thirdPerson = false;
    this.bobPhase = 0;
    this.collided = 0;
    this.car = makePlayerCar();
    this.bike = makePlayerBike();
    this.avatar = makePerson(0x3d5a80);
    this.car.group.visible = this.bike.group.visible = this.avatar.visible = false;
    ctx.scene.add(this.car.group, this.bike.group, this.avatar);
    this.braking = false;
    this.altitude = 0;
    this.grade = 0;
  }

  get heading() { let h = (this.yaw * 180) / Math.PI % 360; if (h < 0) h += 360; return h; }
  get speedKmh() { return this.mode === 'walk' ? this.vel.length() * 3.6 : this.mode === 'fly' ? this.flySpeed * 3.6 : Math.abs(this.speed) * 3.6; }

  place(e, n, yaw = this.yaw) {
    this.e = e; this.n = n; this.yaw = yaw;
    const g = this.ground(e, n);
    this.y = this.mode === 'fly' ? g + 60 : g;
    this.speed = 0; this.vel.set(0, 0); this.vy = 0;
    // never start inside a building (terraced blocks share walls, so search for the nearest free spot)
    const [fe, fn] = this.ctx.colliders.escape(e, n, this.mode === 'drive' ? 1.4 : 0.6);
    this.e = fe; this.n = fn;
    if (fe !== e || fn !== n) { const g2 = this.ground(fe, fn); this.y = this.mode === 'fly' ? Math.max(this.y, g2 + 60) : g2; }
  }

  ground(e, n) {
    const t = this.ctx.hAt(e, n);
    const deck = this.ctx.deckAt ? this.ctx.deckAt(e, n) : null;
    return deck !== null && deck > t - 0.5 ? Math.max(t, deck) : t;
  }

  setMode(m) {
    if (!MODES[m] || m === this.mode) return;
    const prev = this.mode;
    this.mode = m;
    this.speed = 0; this.vel.set(0, 0); this.vy = 0; this.steer = 0; this.lookYaw = 0;
    if (prev === 'fly') this.y = this.ground(this.e, this.n);
    if (m === 'fly') this.y = Math.max(this.y, this.ground(this.e, this.n) + 25);
    this.thirdPerson = m === 'drive';
  }

  toggleCamera() { this.thirdPerson = !this.thirdPerson; }

  update(dt, inp) {
    const s = this.ctx.settings.get();
    const sens = 0.0021 * s.mouseSensitivity;
    const k = inp.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + (inp.pad ? -inp.pad.ly : 0);
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + (inp.pad ? inp.pad.lx : 0);
    const shift = k.has('ShiftLeft') || k.has('ShiftRight') || (inp.pad && inp.pad.boost);
    const lookX = inp.mouseDX * sens + (inp.pad ? inp.pad.rx * dt * 2.4 : 0);
    const lookY = inp.mouseDY * sens * (s.invertY ? -1 : 1) + (inp.pad ? inp.pad.ry * dt * 1.8 : 0);
    this.pitch = clamp(this.pitch - lookY, -1.45, 1.45);

    if (this.mode === 'walk') this.updateWalk(dt, fwd, right, shift, lookX, k, s);
    else if (this.mode === 'bike') this.updateBike(dt, fwd, right, shift, lookX, inp);
    else if (this.mode === 'drive') this.updateDrive(dt, fwd, right, shift, lookX, k, inp);
    else this.updateFly(dt, fwd, right, shift, lookX, k, inp);
    this.altitude = this.y - this.ctx.hAt(this.e, this.n);
    this.updateCamera(dt, s);
  }

  // ------------------------------------------------------------------ walk
  updateWalk(dt, fwd, right, shift, lookX, k, s) {
    this.yaw += lookX;
    const len = Math.hypot(fwd, right) || 1;
    const target = shift ? 3.6 : 1.45; // 13 / 5.2 km/h
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward (north-relative): (sin yaw, cos yaw) in (east, north)
    const de = (sy * fwd + cy * right) / len * target, dn = (cy * fwd - sy * right) / len * target;
    const want = (fwd || right) ? new THREE.Vector2(de, dn) : new THREE.Vector2(0, 0);
    this.vel.x = damp(this.vel.x, want.x, 9, dt); this.vel.y = damp(this.vel.y, want.y, 9, dt);
    this.moveHoriz(this.vel.x * dt, this.vel.y * dt, 0.32, true);
    const g = this.ground(this.e, this.n);
    if (this.onGround && k.has('Space')) { this.vy = 4.3; this.onGround = false; }
    this.vy -= G * dt;
    this.y += this.vy * dt;
    if (this.y <= g) { this.y = g; this.vy = 0; this.onGround = true; }
    else if (this.y - g < 0.05) this.onGround = true;
    if (this.onGround && this.y - g < 0.6) this.y = damp(this.y, g, 18, dt);
    const sp = this.vel.length();
    this.bobPhase += sp * dt * 2.1;
  }

  /** Horizontal move with building collisions and sea blocking. */
  moveHoriz(de, dn, radius, blockWater) {
    let ne = this.e + de, nn = this.n + dn;
    if (blockWater && this.ctx.hAt(ne, nn) < -0.4 && this.ctx.hAt(this.e, this.n) >= -0.4) { ne = this.e; nn = this.n; this.collided = 0.3; }
    const r = this.ctx.colliders.resolve(ne, nn, radius, this.e, this.n);
    if (r.hit) this.collided = 0.25;
    this.e = r.e; this.n = r.n;
    return r.hit;
  }

  slopeAlong(dist = 2.5) {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const a = this.ctx.hAt(this.e + sy * dist, this.n + cy * dist), b = this.ctx.hAt(this.e - sy * dist, this.n - cy * dist);
    return (a - b) / (2 * dist);
  }

  // ------------------------------------------------------------------ bike
  updateBike(dt, fwd, right, shift, lookX, inp) {
    this.lookYaw = clamp(this.lookYaw + lookX, -1.6, 1.6);
    if (!lookX) this.lookYaw = damp(this.lookYaw, 0, Math.abs(this.speed) > 1 ? 1.5 : 0.3, dt);
    const grade = this.slopeAlong(2.5);
    this.grade = grade;
    let a = 0;
    const cruise = shift ? 7.5 : 5.2; // 27 / 19 km/h on the flat
    if (fwd > 0) a += Math.max(0, (cruise - this.speed)) * 0.9 * fwd + 0.35;
    if (fwd < 0) a -= this.speed > 0.2 ? 5.0 : 0.6;
    a -= G * grade * 0.95;                          // hills matter on a bike
    a -= 0.12 + 0.008 * this.speed * this.speed;    // rolling + air drag
    if (fwd <= 0 && this.speed < 0.2 && a < 0 && grade >= -0.01) a = -this.speed / Math.max(dt, 1e-3);
    this.speed = clamp(this.speed + a * dt, -1.2, 16);
    const turn = right * Math.min(1.4, 0.35 + Math.abs(this.speed) / 4);
    this.steer = damp(this.steer, turn, 6, dt);
    this.yaw += this.steer * dt * Math.sign(this.speed || 1);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const de = sy * this.speed * dt, dn = cy * this.speed * dt, e0 = this.e, n0 = this.n;
    if (this.moveHoriz(de, dn, 0.4, true)) {
      // scraping along a wall keeps most of the speed, riding into it stops you
      const along = scrapeFactor(this.e - e0, this.n - n0, de, dn);
      this.speed *= along < 0.25 ? 0.3 : Math.max(0.6, along);
    }
    this.y = damp(this.y, this.ground(this.e, this.n), 14, dt);
    this.bobPhase += Math.abs(this.speed) * dt * 0.9;
  }

  // ------------------------------------------------------------------ drive
  updateDrive(dt, fwd, right, shift, lookX, k, inp) {
    this.lookYaw = clamp(this.lookYaw + lookX, -2.2, 2.2);
    if (!lookX) this.lookYaw = damp(this.lookYaw, 0, 1.2, dt);
    const grade = this.slopeAlong(1.4);
    this.grade = grade;
    const v = this.speed;
    let a = 0;
    const throttle = Math.max(0, fwd) + (inp.pad ? inp.pad.rt : 0);
    const brake = Math.max(0, -fwd) + (inp.pad ? inp.pad.lt : 0);
    this.braking = false;
    if (throttle > 0) a += (shift ? 4.6 : 3.0) * Math.min(1, throttle) * (1 - Math.min(0.85, Math.abs(v) / 42));
    if (brake > 0) { if (v > 0.6) { a -= 8.5 * Math.min(1, brake); this.braking = true; } else a -= 2.4 * Math.min(1, brake); }
    if (k.has('Space') || (inp.pad && inp.pad.a)) { a -= Math.sign(v) * 10; this.braking = true; }
    a -= G * grade * 0.95;
    a -= Math.sign(v) * (0.18 + 0.0011 * v * v);
    if (!throttle && !brake && Math.abs(v) < 0.25 && Math.abs(grade) < 0.04) { this.speed = 0; a = 0; }
    this.speed = clamp(v + a * dt, -6, 40);
    const maxSteer = 0.58 / (1 + Math.abs(this.speed) / 11);
    this.steer = damp(this.steer, right * maxSteer, 3.2, dt);
    this.yaw += (this.speed * Math.tan(this.steer)) / 2.7 * dt;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const de = sy * this.speed * dt, dn = cy * this.speed * dt;
    // collide using front and rear circles
    const ne = this.e + de, nn = this.n + dn;
    let hit = false;
    const fe = ne + sy * 1.25, fn = nn + cy * 1.25, re = ne - sy * 1.25, rn = nn - cy * 1.25;
    const rf = this.ctx.colliders.resolve(fe, fn, 0.95, this.e + sy * 1.25, this.n + cy * 1.25);
    const rr = this.ctx.colliders.resolve(re, rn, 0.95, this.e - sy * 1.25, this.n - cy * 1.25);
    if (rf.hit || rr.hit) hit = true;
    let ce = (rf.e + rr.e) / 2, cn = (rf.n + rr.n) / 2;
    if (this.ctx.hAt(ce, cn) < -0.4 && this.ctx.hAt(this.e, this.n) >= -0.4) { ce = this.e; cn = this.n; hit = true; }
    if (hit) {
      const along = scrapeFactor(ce - this.e, cn - this.n, de, dn);
      if (along < 0.3) { this.speed *= -0.2; this.collided = 0.4; } // head-on: bounce back
      else { this.speed *= Math.max(0.7, along); this.collided = 0.2; } // glancing: scrape along
    }
    this.e = ce; this.n = cn;
    this.y = damp(this.y, this.ground(this.e, this.n), 20, dt);
  }

  // ------------------------------------------------------------------ fly
  updateFly(dt, fwd, right, shift, lookX, k, inp) {
    this.yaw += lookX;
    const up = (k.has('Space') ? 1 : 0) - (k.has('ControlLeft') || k.has('KeyQ') ? 1 : 0) + (inp.pad ? (inp.pad.rt - inp.pad.lt) : 0);
    const g = this.ctx.hAt(this.e, this.n);
    const alt = Math.max(1, this.y - g);
    const base = 10 + alt * 0.55;
    const spd = base * (shift ? 4 : 1);
    this.flySpeed = (fwd || right || up) ? spd : 0;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const len = Math.hypot(fwd, right) || 1;
    this.e += ((sy * cp * fwd + cy * right) / len) * spd * dt;
    this.n += ((cy * cp * fwd - sy * right) / len) * spd * dt;
    this.y += (sp * fwd / len) * spd * dt + up * spd * 0.6 * dt;
    this.y = clamp(this.y, g + 1.6, 3500);
  }

  // ------------------------------------------------------------------ camera rigs
  updateCamera(dt, s) {
    const cam = this.ctx.camera;
    const yawTot = this.yaw + (this.mode === 'bike' || this.mode === 'drive' ? this.lookYaw : 0);
    const dirE = Math.sin(yawTot), dirN = Math.cos(yawTot);
    this.car.group.visible = this.mode === 'drive';
    this.bike.group.visible = this.mode === 'bike';
    this.avatar.visible = this.mode === 'walk' && this.thirdPerson;
    this.bike.rider.visible = this.thirdPerson;
    let eye;
    if (this.mode === 'walk') {
      const bob = s.headBob && this.onGround ? Math.sin(this.bobPhase * Math.PI) * 0.035 * Math.min(1, this.vel.length() / 1.5) : 0;
      eye = new THREE.Vector3(this.e, this.y + 1.68 + bob, -this.n);
      this.avatar.position.set(this.e, this.y, -this.n);
      this.avatar.rotation.y = -this.yaw;
    } else if (this.mode === 'bike') {
      const b = this.bike.group;
      b.position.set(this.e, this.y, -this.n);
      b.rotation.set(0, Math.PI / 2 - this.yaw, 0, 'YXZ');
      b.rotateX(this.steer * Math.min(0.3, Math.abs(this.speed) * 0.04)); // lean into the turn
      for (const w of this.bike.wheels) w.rotation.z -= (this.speed * dt) / 0.34;
      const bob = Math.sin(this.bobPhase * Math.PI * 2) * 0.012;
      eye = new THREE.Vector3(this.e - Math.sin(this.yaw) * 0.12, this.y + 1.62 + bob, -(this.n - Math.cos(this.yaw) * 0.12));
    } else if (this.mode === 'drive') {
      const c = this.car.group;
      const hf = this.ctx.hAt(this.e + Math.sin(this.yaw) * 1.4, this.n + Math.cos(this.yaw) * 1.4);
      const hb = this.ctx.hAt(this.e - Math.sin(this.yaw) * 1.4, this.n - Math.cos(this.yaw) * 1.4);
      const hl = this.ctx.hAt(this.e - Math.cos(this.yaw) * 0.8, this.n + Math.sin(this.yaw) * 0.8);
      const hr = this.ctx.hAt(this.e + Math.cos(this.yaw) * 0.8, this.n - Math.sin(this.yaw) * 0.8);
      c.position.set(this.e, this.y, -this.n);
      c.rotation.set(0, Math.PI / 2 - this.yaw, 0, 'YXZ');
      c.rotateZ(Math.atan2(hf - hb, 2.8));
      c.rotateX(Math.atan2(hl - hr, 1.6) * 0.8);
      for (const [i, w] of this.car.wheels.entries()) { w.rotation.z -= (this.speed * dt) / 0.33; if (i < 2) w.rotation.y = -this.steer; }
      this.car.steeringWheel.rotation.x = -this.steer * 3;
      this.car.setBrake(this.braking);
      if (this.thirdPerson) {
        const back = 7.2, h = 2.7;
        const want = new THREE.Vector3(this.e - dirE * back, this.y + h, -(this.n - dirN * back));
        const [ce, cn] = this.ctx.colliders.clipSegment(this.e, this.n, want.x, -want.z, 0.4);
        want.x = ce; want.z = -cn;
        const gy = this.ctx.hAt(want.x, -want.z) + 1.2;
        if (want.y < gy) want.y = gy;
        if (!this.chase) this.chase = want.clone();
        this.chase.lerp(want, 1 - Math.exp(-5 * dt));
        cam.position.copy(this.chase);
        cam.lookAt(this.e + dirE * 3, this.y + 1.1 + this.pitch * 3, -(this.n + dirN * 3));
        this.applyFov(dt, s);
        return;
      }
      // cockpit: driver sits on the left
      const le = -Math.cos(this.yaw) * 0.37, ln = Math.sin(this.yaw) * 0.37;
      eye = new THREE.Vector3(this.e + le + Math.sin(this.yaw) * 0.1, this.y + 1.22, -(this.n + ln + Math.cos(this.yaw) * 0.1));
    } else {
      eye = new THREE.Vector3(this.e, this.y, -this.n);
    }
    if (this.thirdPerson && (this.mode === 'walk' || this.mode === 'bike')) {
      const back = this.mode === 'bike' ? 4.2 : 3.4;
      const want = new THREE.Vector3(this.e - dirE * back, this.y + 2.1 - this.pitch * 1.5, -(this.n - dirN * back));
      const [ce, cn] = this.ctx.colliders.clipSegment(this.e, this.n, want.x, -want.z, 0.3);
      want.x = ce; want.z = -cn;
      cam.position.lerp(want, 1 - Math.exp(-10 * dt));
      cam.lookAt(this.e + dirE * 2, this.y + 1.5 + this.pitch * 2, -(this.n + dirN * 2));
    } else {
      cam.position.copy(eye);
      const cp = Math.cos(this.pitch);
      cam.lookAt(eye.x + dirE * cp, eye.y + Math.sin(this.pitch), eye.z - dirN * cp);
    }
    this.applyFov(dt, s);
  }

  applyFov(dt, s) {
    const cam = this.ctx.camera;
    const extra = this.mode === 'drive' ? Math.min(12, Math.abs(this.speed) * 0.35) : this.mode === 'fly' ? 4 : 0;
    const want = s.fov + extra;
    if (Math.abs(cam.fov - want) > 0.05) { cam.fov = damp(cam.fov, want, 4, dt); cam.updateProjectionMatrix(); }
    const near = this.mode === 'fly' ? clamp(this.altitude * 0.02, 0.2, 4) : 0.12;
    if (Math.abs(cam.near - near) > 0.01) { cam.near = near; cam.updateProjectionMatrix(); }
  }
}
