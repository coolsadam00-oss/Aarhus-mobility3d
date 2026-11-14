'use strict';
/** Reading / writing city packs on disk (manifest.json + one JSON file per layer + optional DEM). */
const fs = require('fs');
const path = require('path');

const LAYERS = ['buildings', 'roads', 'roadAreas', 'railways', 'water', 'waterways', 'landuse', 'context', 'pois', 'furniture', 'trees', 'barriers', 'addresses'];

function writePack(dir, manifest, layers, dem) {
  fs.mkdirSync(dir, { recursive: true });
  manifest.layers = manifest.layers || {};
  for (const name of LAYERS) {
    const feats = layers[name];
    if (!feats) continue;
    const file = `${name}.json`;
    const json = JSON.stringify({ type: 'FeatureCollection', features: feats });
    fs.writeFileSync(path.join(dir, file), json);
    manifest.layers[name] = { file, count: feats.length, bytes: Buffer.byteLength(json) };
  }
  if (dem) {
    fs.writeFileSync(path.join(dir, 'dem.bin'), Buffer.from(dem.data.buffer, dem.data.byteOffset, dem.data.byteLength));
    if (dem.conf) fs.writeFileSync(path.join(dir, 'dem_conf.bin'), Buffer.from(dem.conf.buffer, dem.conf.byteOffset, dem.conf.byteLength));
    manifest.dem = { file: 'dem.bin', confFile: dem.conf ? 'dem_conf.bin' : null, bbox: dem.bbox, nx: dem.nx, ny: dem.ny, res: dem.res, format: 'int16-dm', note: dem.note || null };
  }
  manifest.totalBytes = Object.values(manifest.layers).reduce((s, l) => s + l.bytes, 0) +
    (dem ? dem.data.byteLength + (dem.conf ? dem.conf.byteLength : 0) : 0);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

function readManifest(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (m.format !== 'am3d-citypack') return null;
    return { ...m, dir };
  } catch { return null; }
}

function readLayer(dir, name) {
  const f = path.join(dir, `${name}.json`);
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, 'utf8')).features || [];
}

function listPacks(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => readManifest(path.join(root, d.name)))
    .filter(Boolean)
    .sort((a, b) => String(b.created).localeCompare(String(a.created)));
}

function deletePack(root, id) {
  if (!/^[a-z0-9-]+$/i.test(id)) throw new Error('Invalid pack id');
  const dir = path.join(root, id);
  if (!dir.startsWith(path.resolve(root))) throw new Error('Invalid pack path');
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { LAYERS, writePack, readManifest, readLayer, listPacks, deletePack };
