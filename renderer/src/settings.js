// Central settings store: defaults, persistence (SQLite via IPC), quality presets and change events.
const api = window.mobility;

export const QUALITY = {
  low:    { label: 'Low (laptops)',      pixelRatio: 0.75, shadows: false, shadowSize: 1024, ao: false, bloom: false, viewDistance: 900,  treeDensity: 0.5, trafficDensity: 0.5, imageryZoom: 17, terrainSeg: 24 },
  medium: { label: 'Medium',             pixelRatio: 1.0,  shadows: true,  shadowSize: 2048, ao: false, bloom: true,  viewDistance: 1500, treeDensity: 1,   trafficDensity: 1,   imageryZoom: 18, terrainSeg: 40 },
  high:   { label: 'High',               pixelRatio: 1.25, shadows: true,  shadowSize: 4096, ao: false, bloom: true,  viewDistance: 2200, treeDensity: 1,   trafficDensity: 1.5, imageryZoom: 18, terrainSeg: 56 },
  ultra:  { label: 'Ultra (gaming GPU)', pixelRatio: 1.5,  shadows: true,  shadowSize: 4096, ao: true,  bloom: true,  viewDistance: 3000, treeDensity: 1.3, trafficDensity: 2,   imageryZoom: 19, terrainSeg: 64 }
};

export const DEFAULTS = {
  // privacy & data
  onlineLookups: true,
  activePack: null,
  customImagery: '',
  // map view
  mapBasemap: 'satellite',
  mapBuildings: true,
  mapBuildingColors: 'realistic',
  mapPois: true,
  mapLabels: true,
  mapNetascore: true,
  mapPins: true,
  mapHillshade: false,
  mapTerrainExag: 1.3,
  // 3D explore — rendering
  quality: 'medium',
  pixelRatio: 1.0,
  viewDistance: 1500,
  shadows: true,
  ao: false,
  bloom: true,
  fog: true,
  clouds: true,
  imagery: true,
  windows: true,
  roofs: true,
  trees: true,
  treeDensity: 1,
  furniture: true,
  autoLamps: true,
  streetLights: true,
  traffic: true,
  trafficDensity: 1,
  // 3D explore — information
  labelsBuildings: true,
  labelTypes: true,
  labelsPoi: true,
  labelsStreets: false,
  netOverlay: 'off',
  pins3d: true,
  minimap: true,
  hud: true,
  showFps: false,
  // 3D explore — controls & world
  fov: 72,
  mouseSensitivity: 1,
  invertY: false,
  headBob: true,
  startMode: 'walk',
  timeMode: 'real',
  timeOfDay: 13,
  season: 'auto',
  weather: 'clear'
};

let state = { ...DEFAULTS };
const listeners = new Set();

export async function loadSettings() {
  try {
    const saved = await api.getSettings();
    state = { ...DEFAULTS, ...(saved || {}) };
  } catch { state = { ...DEFAULTS }; }
  return state;
}

export function get(key) { return key ? state[key] : state; }

export function set(patch, { persist = true } = {}) {
  const changed = {};
  for (const [k, v] of Object.entries(patch)) {
    if (state[k] !== v) { changed[k] = v; state[k] = v; }
  }
  if (!Object.keys(changed).length) return;
  if (persist) api.setSettings(changed).catch(() => {});
  for (const l of listeners) { try { l(changed, state); } catch (e) { console.error(e); } }
}

export function applyQuality(level) {
  const q = QUALITY[level] || QUALITY.medium;
  set({ quality: level, pixelRatio: q.pixelRatio, shadows: q.shadows, ao: q.ao, bloom: q.bloom, viewDistance: q.viewDistance, treeDensity: q.treeDensity, trafficDensity: q.trafficDensity });
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
