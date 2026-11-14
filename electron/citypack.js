'use strict';
/**
 * City-pack download manager: queries OpenStreetMap (Overpass) layer by layer for a bounding box,
 * converts everything with citypack-convert and writes a pack folder with a manifest that records
 * exactly what was downloaded (queries, servers, sizes, timings, OSM data timestamp).
 */
const path = require('path');
const { overpassQuery } = require('./overpass');
const { elementToFeature, mergeElements } = require('./osm-assemble');
const conv = require('./citypack-convert');
const { writePack, readLayer } = require('./citypack-io');
const { bboxAreaKm2 } = require('../shared/geo');

const PRESETS = [
  { id: 'aarhus-c', name: 'Aarhus C – city centre', bbox: [10.1850, 56.1450, 10.2250, 56.1650], note: '≈ 5 km², about 1 minute' },
  { id: 'aarhus-inner', name: 'Inner Aarhus (C, N, V, Ø, Trøjborg, Frederiksbjerg)', bbox: [10.1650, 56.1350, 10.2450, 56.1800], note: '≈ 25 km², 2–5 minutes' },
  { id: 'aarhus-greater', name: 'Greater Aarhus (incl. Viby, Brabrand edge, Risskov, Åbyhøj)', bbox: [10.1200, 56.1100, 10.2600, 56.2100], note: '≈ 95 km², 5–15 minutes, large' }
];

const MAX_AREA_KM2 = 150;

// layer → { tileKm2, query(bboxString) }
const LAYER_QUERIES = {
  buildings: {
    label: 'Buildings', tileKm2: 6,
    q: (b) => `[out:json][timeout:240];(way["building"](${b});way["building:part"](${b});relation["building"]["type"="multipolygon"](${b});relation["building:part"]["type"="multipolygon"](${b}););out body geom qt;`
  },
  roads: {
    label: 'Streets & paths', tileKm2: 20,
    q: (b) => `[out:json][timeout:240];way["highway"](${b});out body geom qt;`
  },
  railways: {
    label: 'Railways & light rail', tileKm2: 60,
    q: (b) => `[out:json][timeout:180];(way["railway"~"^(rail|light_rail|tram|subway|narrow_gauge|preserved|monorail|platform)$"](${b});way["public_transport"="platform"](${b}););out body geom qt;`
  },
  areas: {
    label: 'Water, parks, land use & campuses', tileKm2: 20,
    q: (b) => `[out:json][timeout:240];(way["landuse"](${b});relation["landuse"]["type"="multipolygon"](${b});way["leisure"](${b});relation["leisure"]["type"="multipolygon"](${b});way["natural"]["natural"!~"^(tree|tree_row|coastline)$"](${b});relation["natural"]["type"="multipolygon"](${b});way["waterway"](${b});relation["waterway"]["type"="multipolygon"](${b});way["water"](${b});relation["water"]["type"="multipolygon"](${b});way["amenity"~"^(university|college|school|kindergarten|hospital|place_of_worship|grave_yard|prison|parking|fountain)$"](${b});relation["amenity"~"^(university|college|school|kindergarten|hospital|place_of_worship|grave_yard|prison)$"](${b});way["railway"="station"](${b});way["public_transport"="station"](${b});way["tourism"~"^(zoo|theme_park|museum)$"](${b});way["man_made"~"^(wastewater_plant|pier|breakwater|quay)$"](${b});way["power"~"^(plant|substation)$"](${b});way["place"="square"](${b}););out body geom qt;`
  },
  pois: {
    label: 'Places, shops & services', tileKm2: 10,
    q: (b) => `[out:json][timeout:240];(node["amenity"](${b});node["shop"](${b});node["tourism"](${b});node["leisure"](${b});node["office"](${b});node["healthcare"](${b});node["craft"](${b});node["historic"](${b});node["railway"~"^(station|halt|tram_stop|subway_entrance)$"](${b});node["public_transport"="station"](${b});node["man_made"~"^(tower|lighthouse|water_tower|windmill|chimney|observatory|obelisk|crane|mast)$"](${b});way["amenity"](${b});way["shop"](${b});way["tourism"](${b});way["office"](${b});way["healthcare"](${b});way["historic"](${b});way["leisure"~"^(sports_centre|stadium|fitness_centre|swimming_pool|ice_rink|water_park|marina|park|garden|playground|dog_park|pitch)$"](${b});relation["amenity"](${b});relation["tourism"](${b});relation["leisure"~"^(park|stadium|sports_centre)$"](${b}););out tags center qt;`
  },
  furniture: {
    label: 'Street furniture, trees & hedges', tileKm2: 10,
    q: (b) => `[out:json][timeout:240];(node["highway"~"^(street_lamp|traffic_signals|crossing|bus_stop|stop|give_way|speed_camera)$"](${b});node["amenity"~"^(bench|bicycle_parking|waste_basket|post_box|parcel_locker|telephone|vending_machine|recycling|drinking_water|charging_station|bicycle_rental|fountain|clock|shelter|bbq|toilets)$"](${b});node["emergency"~"^(fire_hydrant|defibrillator)$"](${b});node["man_made"~"^(flagpole|street_cabinet|surveillance)$"](${b});node["barrier"="bollard"](${b});node["leisure"="picnic_table"](${b});node["advertising"](${b});node["railway"="level_crossing"](${b});node["natural"="tree"](${b});way["natural"="tree_row"](${b});way["barrier"~"^(hedge|wall|fence|retaining_wall|city_wall|guard_rail)$"](${b}););out body geom qt;`
  },
  addresses: {
    label: 'Addresses', tileKm2: 8,
    q: (b) => `[out:json][timeout:240];(node["addr:housenumber"](${b});way["addr:housenumber"](${b}););out tags center qt;`
  }
};

/** Split a bbox into a grid of tiles so no single Overpass query gets too large. */
function tileBbox(bbox, maxKm2) {
  const area = bboxAreaKm2(bbox);
  const n = Math.max(1, Math.ceil(Math.sqrt(area / maxKm2)));
  const tiles = [];
  const dx = (bbox[2] - bbox[0]) / n, dy = (bbox[3] - bbox[1]) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    tiles.push([bbox[0] + i * dx, bbox[1] + j * dy, bbox[0] + (i + 1) * dx, bbox[1] + (j + 1) * dy]);
  }
  return tiles;
}
const ovBbox = (b) => `${b[1].toFixed(6)},${b[0].toFixed(6)},${b[3].toFixed(6)},${b[2].toFixed(6)}`;

function slug(s) {
  return String(s).toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'area';
}

/**
 * Download and build a city pack.
 * @param {{bbox:number[], name:string, id?:string}} area
 * @param {{packsRoot:string, starterDir?:string, signal?:AbortSignal, onProgress?:Function}} ctx
 */
async function downloadPack(area, ctx) {
  const bbox = area.bbox.map(Number);
  if (bbox.length !== 4 || bbox.some(v => !Number.isFinite(v)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) throw new Error('Invalid area.');
  const km2 = bboxAreaKm2(bbox);
  if (km2 > MAX_AREA_KM2) throw new Error(`Area is ${km2.toFixed(0)} km² – please choose at most ${MAX_AREA_KM2} km².`);
  const progress = (p) => ctx.onProgress && ctx.onProgress(p);
  const started = Date.now();
  const log = [];
  const raw = {};
  let osmBase = null;
  let totalBytes = 0;

  const layerNames = Object.keys(LAYER_QUERIES);
  for (let li = 0; li < layerNames.length; li++) {
    const name = layerNames[li];
    const L = LAYER_QUERIES[name];
    const tiles = tileBbox(bbox, L.tileKm2);
    const responses = [];
    for (let ti = 0; ti < tiles.length; ti++) {
      const query = L.q(ovBbox(tiles[ti]));
      const base = { phase: 'download', layer: name, label: L.label, layerIndex: li, layerCount: layerNames.length, tile: ti + 1, tiles: tiles.length };
      progress({ ...base, message: `${L.label}${tiles.length > 1 ? ` (part ${ti + 1}/${tiles.length})` : ''} …` });
      const r = await overpassQuery(query, {
        signal: ctx.signal,
        onBytes: (n) => progress({ ...base, bytes: n, message: `${L.label}${tiles.length > 1 ? ` (part ${ti + 1}/${tiles.length})` : ''}: ${(n / 1048576).toFixed(1)} MB` }),
        onStatus: (s) => progress({ ...base, message: s })
      });
      totalBytes += r.bytes;
      if (r.json.osm3s && r.json.osm3s.timestamp_osm_base) osmBase = r.json.osm3s.timestamp_osm_base;
      responses.push(r.json);
      log.push({ layer: name, tile: ti + 1, tiles: tiles.length, endpoint: r.endpoint, ms: r.ms, bytes: r.bytes, elements: (r.json.elements || []).length, query });
      // be polite to the shared public Overpass servers
      await new Promise(res => setTimeout(res, 600));
    }
    raw[name] = mergeElements(responses);
  }

  progress({ phase: 'convert', message: 'Converting and classifying …' });
  const feats = {};
  for (const [name, els] of Object.entries(raw)) {
    feats[name] = els.map(el => elementToFeature(el, { forceLine: name === 'roads' && !(el.tags && el.tags.area === 'yes') && !(el.tags && el.tags['area:highway']) })).filter(Boolean);
  }
  const addresses = conv.convertAddresses(feats.addresses);
  const areas = conv.convertAreas(feats.areas);
  let fot = null;
  if (ctx.starterDir) { try { fot = readLayer(ctx.starterDir, 'buildings'); } catch { fot = null; } }
  const b = conv.convertBuildings(feats.buildings, { areas: areas.context.map(f => ({ ...f, properties: { ...f.properties, tags: f.properties.t } })), addresses, fot });
  const roads = conv.convertRoads(feats.roads);
  const railways = conv.convertRailways(feats.railways);
  const pts = conv.convertPoints([...feats.pois, ...feats.furniture]);

  const id = area.id || `${slug(area.name || 'area')}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const dir = path.join(ctx.packsRoot, id);
  progress({ phase: 'write', message: 'Saving city pack …' });
  const manifest = {
    format: 'am3d-citypack', version: 1, id, name: area.name || 'Custom area', source: 'osm', bbox,
    created: new Date().toISOString(), osmBase, areaKm2: Math.round(km2 * 10) / 10,
    attribution: ['© OpenStreetMap contributors – data available under the Open Database Licence (ODbL)', fot ? 'Building heights partly from GeoDanmark (FOT) 2016 survey' : null].filter(Boolean),
    stats: { buildings: b.stats, downloadBytes: totalBytes, durationMs: Date.now() - started },
    log
  };
  writePack(dir, manifest, {
    buildings: b.features, roads: roads.features, roadAreas: roads.areas, railways, water: areas.water, waterways: areas.waterways,
    landuse: areas.landuse, context: areas.context, pois: pts.pois, furniture: pts.furniture, trees: pts.trees, barriers: pts.barriers, addresses
  });
  progress({ phase: 'done', message: 'City pack ready', id });
  return { ...manifest, dir };
}

module.exports = { PRESETS, LAYER_QUERIES, MAX_AREA_KM2, downloadPack, tileBbox, slug };
