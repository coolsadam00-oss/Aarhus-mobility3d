// Aerial imagery for terrain chunks: XYZ tiles are fetched, cropped exactly to the chunk's lng/lat box and
// drawn into one canvas per chunk. When imagery is off or unreachable, a stylised land-use texture is painted
// instead (same UV mapping), so the 3D world still looks right offline.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const merc = (lng, lat, z) => {
  const n = 256 * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lng + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};

export class Imagery {
  constructor(template) {
    this.template = template && /\{z\}/.test(template) ? template : ESRI;
    this.cache = new Map();    // key -> Promise<ImageBitmap|null>
    this.failures = 0;
    this.successes = 0;
    this.offline = false;
  }

  tile(z, x, y) {
    const k = `${z}/${x}/${y}`;
    if (this.cache.has(k)) { const v = this.cache.get(k); this.cache.delete(k); this.cache.set(k, v); return v; }
    const url = this.template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const p = (this.offline ? Promise.resolve(null) : fetch(url).then(r => (r.ok ? r.blob() : null)).then(b => (b ? createImageBitmap(b) : null)))
      .then(bmp => { if (bmp) { this.successes++; this.failures = 0; } else this._fail(); return bmp; })
      .catch(() => { this._fail(); return null; });
    this.cache.set(k, p);
    if (this.cache.size > 900) {
      const old = this.cache.keys().next().value;
      const v = this.cache.get(old);
      this.cache.delete(old);
      v.then(b => b && b.close && b.close()).catch(() => {});
    }
    return p;
  }
  _fail() { if (++this.failures > 12 && this.successes === 0) this.offline = true; }

  /** Compose imagery for bbox [w,s,e,n] at zoom z into a size×size canvas. Returns null when nothing loaded. */
  async compose(bbox, z, size) {
    if (this.offline) return null;
    const [w, s, e, n] = bbox;
    const [px0, py0] = merc(w, n, z), [px1, py1] = merc(e, s, z);
    const tx0 = Math.floor(px0 / 256), tx1 = Math.floor(px1 / 256), ty0 = Math.floor(py0 / 256), ty1 = Math.floor(py1 / 256);
    const jobs = [];
    for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) jobs.push(this.tile(z, x, y).then(b => ({ x, y, b })));
    const tiles = await Promise.all(jobs);
    if (!tiles.some(t => t.b)) return null;
    const c = new OffscreenCanvas(size, size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6d7366';
    ctx.fillRect(0, 0, size, size);
    const sx = size / (px1 - px0), sy = size / (py1 - py0);
    for (const t of tiles) {
      if (!t.b) continue;
      ctx.drawImage(t.b, (t.x * 256 - px0) * sx, (t.y * 256 - py0) * sy, 256 * sx + 0.5, 256 * sy + 0.5);
    }
    return { canvas: c, px0, py0, px1, py1, z };
  }

  /** UV for a lng/lat inside a composed chunk image (flipY texture convention). */
  static uv(info, lng, lat) {
    const [px, py] = merc(lng, lat, info.z);
    return [(px - info.px0) / (info.px1 - info.px0), 1 - (py - info.py0) / (info.py1 - info.py0)];
  }
}

// ------------------------------------------------------------------ stylised ground (offline / imagery off)
const LANDUSE_COLORS = {
  'leisure=park': '#5f8a45', 'leisure=garden': '#6b934c', 'leisure=pitch': '#4f8a3f', 'leisure=playground': '#9c8a62', 'leisure=golf_course': '#6a9a4a',
  'leisure=common': '#7a9a55', 'leisure=dog_park': '#6f8f4f', 'leisure=nature_reserve': '#557a40', 'leisure=stadium': '#5a7f45', 'leisure=track': '#a0523a',
  'natural=wood': '#3f6533', 'landuse=forest': '#3f6533', 'natural=scrub': '#5d7a45', 'natural=heath': '#7f7a52', 'natural=grassland': '#7b9a55',
  'natural=beach': '#d8c99a', 'natural=sand': '#d4c290', 'natural=wetland': '#5b7a5a', 'landuse=grass': '#6f9a4f', 'landuse=meadow': '#82a35a',
  'landuse=village_green': '#6f9a4f', 'landuse=recreation_ground': '#6a9450', 'landuse=cemetery': '#6b8a52', 'landuse=allotments': '#7a8f4a',
  'landuse=farmland': '#a59a62', 'landuse=orchard': '#7f9a4f', 'landuse=flowerbed': '#8a7a4a', 'landuse=residential': '#8d8c84', 'landuse=commercial': '#8a8580',
  'landuse=retail': '#8a8580', 'landuse=industrial': '#85807a', 'landuse=railway': '#7d766c', 'landuse=construction': '#9a8a70', 'landuse=brownfield': '#9a8f78',
  'landuse=education': '#8d8c84', 'landuse=religious': '#7f8a6f', 'landuse=garages': '#8a8780', 'landuse=port': '#86827c', 'amenity=parking': '#6c6c6a',
  'highway=pedestrian': '#9a948a', 'place=square': '#9a948a', 'man_made=pier': '#8f8c86'
};

export function paintStylised(bbox, size, layers) {
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d');
  const [w, s, e, n] = bbox;
  const X = (lng) => ((lng - w) / (e - w)) * size;
  const Y = (lat) => ((n - lat) / (n - s)) * size;
  ctx.fillStyle = '#7d8172';
  ctx.fillRect(0, 0, size, size);
  const fillGeom = (g, color) => {
    ctx.fillStyle = color;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      ctx.beginPath();
      for (const ring of poly) { ring.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.closePath(); }
      ctx.fill('evenodd');
    }
  };
  for (const f of layers.landuse || []) { const col = LANDUSE_COLORS[f.properties.k]; if (col) fillGeom(f.geometry, col); }
  for (const f of layers.roadAreas || []) fillGeom(f.geometry, '#9a948a');
  for (const f of layers.water || []) fillGeom(f.geometry, '#2f5b73');
  for (const f of layers.buildings || []) fillGeom(f.geometry, '#5a5853');
  // subtle noise so it does not look flat
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const r = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const k = 0.92 + 0.16 * Math.abs(r);
    img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, stylised: true, bbox };
}

export function stylisedUv(info, lng, lat) {
  const [w, s, e, n] = info.bbox;
  return [(lng - w) / (e - w), (lat - s) / (n - s)];
}
