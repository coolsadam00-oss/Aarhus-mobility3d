// Floating 3D labels ("what is what"): building names & types, places, street names. Nearest first, occlusion-tested,
// decluttered on screen (a label that would overlap a more important one waits until there is room).
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { esc } from '../util.js';

export class Labels {
  constructor(root, scene, camera) {
    this.renderer = new CSS2DRenderer();
    this.renderer.domElement.style.position = 'absolute';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.pointerEvents = 'none';
    this.renderer.domElement.style.zIndex = '5';
    root.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene(); // labels only: CSS2DRenderer walks its whole scene every frame
    this.camera = camera;
    this.v = new THREE.Vector3();
    this.pool = [];
    this.active = new Map();
    this.timer = 0;
    this.ray = new THREE.Raycaster();
  }

  setSize(w, h) { this.renderer.setSize(w, h); }

  _obj() {
    const o = this.pool.pop();
    if (o) return o;
    const div = document.createElement('div');
    div.className = 'label3d';
    const obj = new CSS2DObject(div);
    return obj;
  }

  update(dt, chunks, s, occluders) {
    this.timer -= dt;
    if (this.timer > 0) { this.renderer.render(this.scene, this.camera); return; }
    this.timer = 0.3;
    const cam = this.camera.position;
    const cand = [];
    const any = s.labelsBuildings || s.labelsPoi || s.labelsStreets;
    if (any) {
      for (const ch of chunks.values()) {
        for (const l of ch.labels || []) {
          if (l.kind === 'building' && !s.labelsBuildings) continue;
          if (l.kind === 'building' && l.typeOnly && !s.labelTypes) continue;
          if (l.kind === 'poi' && !s.labelsPoi) continue;
          if (l.kind === 'street' && !s.labelsStreets) continue;
          const d = Math.hypot(l.x - cam.x, l.y - cam.y, l.z - cam.z);
          const max = l.kind === 'building' ? (l.named ? 450 : 140) : l.kind === 'poi' ? 160 : 220;
          if (d > max) continue;
          cand.push({ l, d, score: d * (l.named ? 0.7 : 1.3) * (l.kind === 'poi' ? 1.1 : 1) });
        }
      }
    }
    cand.sort((a, b) => a.score - b.score);
    const pick = cand.slice(0, 48);
    const keep = new Set();
    const size = this.renderer.getSize();
    // the crosshair target card sits just below the screen centre
    const boxes = [[size.width / 2 - 170, size.height / 2 + 14, size.width / 2 + 170, size.height / 2 + 70]];
    let shown = 0;
    for (const c of pick) {
      if (shown >= 34) break;
      // screen-space declutter
      const p = this.v.set(c.l.x, c.l.y, c.l.z).project(this.camera);
      if (p.z > 1 || p.z < -1) continue;
      const sx = ((p.x + 1) / 2) * size.width, sy = ((1 - p.y) / 2) * size.height;
      const chars = (c.l.text || '').length + (c.l.sub && c.l.kind !== 'street' ? c.l.sub.length * 0.8 : 0);
      const hw = Math.min(170, 14 + chars * 3.6), hh = c.l.kind === 'street' ? 9 : 12;
      const box = [sx - hw, sy - hh, sx + hw, sy + hh];
      if (boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      shown++;
      const id = c.l;
      keep.add(id);
      let obj = this.active.get(id);
      if (!obj) {
        obj = this._obj();
        const l = c.l;
        obj.element.className = 'label3d' + (l.kind === 'poi' ? ' poi' : l.kind === 'street' ? ' street' : '');
        obj.element.innerHTML = l.kind === 'street' ? esc(l.text) : `${esc(l.icon)} ${esc(l.text)}${l.sub && l.kind !== 'street' ? `<small>${esc(l.sub)}</small>` : ''}`;
        obj.position.set(l.x, l.y, l.z);
        this.scene.add(obj);
        this.active.set(id, obj);
      }
      // occlusion: hide a label only when *another* building stands in front of it. Its own facade does not
      // count (a label floats above the middle of its roof, behind the facade you are looking at), nor does the
      // building a shop or café is in.
      if (occluders && occluders.length && c.d > 20) {
        const l = c.l;
        const dir = new THREE.Vector3().subVectors(obj.position, cam);
        const dist = dir.length();
        this.ray.set(cam, dir.normalize());
        this.ray.far = dist - 2;
        let blocked = false;
        for (const h of this.ray.intersectObjects(occluders, false)) {
          if (l.kind === 'building') {
            const a = h.face && h.object.geometry.attributes.aBid;
            const ch = h.object.userData && h.object.userData.chunk;
            if (a && ch && ch.buildRefs[Math.round(a.getX(h.face.a))] === l.f) continue;
          } else if (Math.hypot(h.point.x - l.x, h.point.z - l.z) < 14) continue;
          blocked = true;
          break;
        }
        obj.element.style.opacity = blocked ? '0' : '1';
      } else obj.element.style.opacity = '1';
    }
    for (const [id, obj] of this.active) {
      if (keep.has(id)) continue;
      this.scene.remove(obj);
      this.active.delete(id);
      this.pool.push(obj);
    }
    this.renderer.render(this.scene, this.camera);
  }

  clear() { for (const [, obj] of this.active) { this.scene.remove(obj); this.pool.push(obj); } this.active.clear(); this.renderer.render(this.scene, this.camera); }
}
