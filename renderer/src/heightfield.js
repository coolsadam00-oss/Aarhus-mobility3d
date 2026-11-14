// Terrain heights for the map profile and the 3D explorer.
// Sources (best first):
//   1. bundled GeoDanmark 5 m grid (DVR90) – used where its samples are dense (conf ≤ 40 m), blended out to 120 m
//   2. AWS Terrain Tiles (Terrarium PNG, z15 ≈ 2.7 m/px at Aarhus) – global, incl. sea-floor bathymetry
//   3. fallback: nearest grid edge value (offline) or 0

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const TZ = 15;
const SIZE = 256;

export class Heightfield {
  constructor() {
    this.grid = null;            // { bbox:[w,s,e,n], nx, ny, data:Int16Array (dm), conf:Uint8Array }
    this.tiles = new Map();      // key -> Float32Array(256*256) | 'pending' | 'failed'
    this.pending = new Map();    // key -> Promise
    this.online = true;
    this.failures = 0;
    this.version = 0;            // bumps when new tiles arrive (callers may refresh)
  }

  setGrid(grid) { this.grid = grid; this.version++; }

  // ---------------------------------------------------------------- grid
  gridSample(lng, lat) {
    const g = this.grid;
    if (!g) return null;
    const [w, s, e, n] = g.bbox;
    const fx = ((lng - w) / (e - w)) * (g.nx - 1);
    const fy = ((n - lat) / (n - s)) * (g.ny - 1);
    const inside = fx >= 0 && fy >= 0 && fx <= g.nx - 1 && fy <= g.ny - 1;
    const cx = Math.max(0, Math.min(g.nx - 1.0001, fx)), cy = Math.max(0, Math.min(g.ny - 1.0001, fy));
    const i = Math.floor(cx), j = Math.floor(cy), ax = cx - i, ay = cy - j;
    const z = (ii, jj) => g.data[jj * g.nx + ii] / 10;
    const v = (z(i, j) * (1 - ax) + z(i + 1, j) * ax) * (1 - ay) + (z(i, j + 1) * (1 - ax) + z(i + 1, j + 1) * ax) * ay;
    let conf = 255;
    if (g.conf) conf = g.conf[Math.round(cy) * g.nx + Math.round(cx)];
    if (!inside) {
      const dx = fx < 0 ? -fx : fx > g.nx - 1 ? fx - (g.nx - 1) : 0;
      const dy = fy < 0 ? -fy : fy > g.ny - 1 ? fy - (g.ny - 1) : 0;
      conf = 255 + Math.hypot(dx, dy) * 5;
    }
    return { z: v, conf, inside };
  }

  // ---------------------------------------------------------------- terrarium tiles
  static tileXY(lng, lat, z = TZ) {
    const n = 2 ** z;
    const x = ((lng + 180) / 360) * n;
    const r = (lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    return [x, y];
  }

  _key(x, y) { return `${x}/${y}`; }

  loadTile(x, y) {
    const k = this._key(x, y);
    const t = this.tiles.get(k);
    if (t instanceof Float32Array || t === 'failed') return Promise.resolve(t);
    if (this.pending.has(k)) return this.pending.get(k);
    if (!this.online) return Promise.resolve('failed');
    const url = TERRARIUM_URL.replace('{z}', TZ).replace('{x}', x).replace('{y}', y);
    const p = fetch(url)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then(b => createImageBitmap(b))
      .then(bmp => {
        const c = new OffscreenCanvas(SIZE, SIZE);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
        const h = new Float32Array(SIZE * SIZE);
        for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        this.tiles.set(k, h);
        this.failures = 0;
        this.version++;
        return h;
      })
      .catch(() => {
        this.tiles.set(k, 'failed');
        if (++this.failures >= 6) this.online = false; // stop hammering when offline
        return 'failed';
      })
      .finally(() => this.pending.delete(k));
    this.pending.set(k, p);
    return p;
  }

  /** Preload all z15 tiles covering a lng/lat bbox. */
  async ensure(bbox) {
    const [x0, y1] = Heightfield.tileXY(bbox[0], bbox[1]);
    const [x1, y0] = Heightfield.tileXY(bbox[2], bbox[3]);
    const jobs = [];
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y0); y <= Math.floor(y1); y++) jobs.push(this.loadTile(x, y));
    await Promise.all(jobs);
  }

  tileSample(lng, lat) {
    const [xf, yf] = Heightfield.tileXY(lng, lat);
    const tx = Math.floor(xf), ty = Math.floor(yf);
    const h = this.tiles.get(this._key(tx, ty));
    if (!(h instanceof Float32Array)) return null;
    const fx = (xf - tx) * SIZE - 0.5, fy = (yf - ty) * SIZE - 0.5;
    const x0 = Math.max(0, Math.min(SIZE - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(SIZE - 1, Math.floor(fy)));
    const x1 = Math.min(SIZE - 1, x0 + 1), y1 = Math.min(SIZE - 1, y0 + 1);
    const ax = Math.max(0, Math.min(1, fx - x0)), ay = Math.max(0, Math.min(1, fy - y0));
    return (h[y0 * SIZE + x0] * (1 - ax) + h[y0 * SIZE + x1] * ax) * (1 - ay) + (h[y1 * SIZE + x0] * (1 - ax) + h[y1 * SIZE + x1] * ax) * ay;
  }

  /** Best available height (sync). */
  heightAt(lng, lat) {
    const g = this.gridSample(lng, lat);
    if (g && g.conf <= 40) return g.z;
    const t = this.tileSample(lng, lat);
    if (g && t !== null) {
      const w = Math.max(0, Math.min(1, (g.conf - 40) / 80)); // 40 m → grid, 120 m → tiles
      return g.z * (1 - w) + t * w;
    }
    if (t !== null) return t;
    if (g) return g.z;
    return 0;
  }

  async heightAtAsync(lng, lat) {
    const g = this.gridSample(lng, lat);
    if (!(g && g.conf <= 40)) {
      const [xf, yf] = Heightfield.tileXY(lng, lat);
      await this.loadTile(Math.floor(xf), Math.floor(yf));
    }
    return this.heightAt(lng, lat);
  }
}

export const heightfield = new Heightfield();
