'use strict';
/**
 * Converts raw OSM features (from osm-assemble) into the compact "city pack" layers used by the app.
 * Pure functions — no network or disk access — so everything here is unit-tested.
 *
 * Building properties (all optional except id/k):
 *   id  "w123"           k   kind (classification key, e.g. "apartments", "amenity=university")
 *   lbl label (English)  lda label (Danish)  ic icon  g group  cf confidence (tagged|name|context|unknown)
 *   part 1 for building:part         n name           a address (from tags or assigned address points)
 *   h   height (m)  ht 1 if h includes the roof (OSM "height")  hs height source (t=tag l=levels g=GeoDanmark e=estimate)
 *   mh  min height  lv levels  rlv roof levels  rs roof shape (tag)  rh roof height (tag)
 *   c facade colour  rc roof colour  m facade material  rm roof material  st facade style
 *   ctx enclosing-area kind  ctxn enclosing-area name   note  classification note   also  extra functions
 *   t   full OSM tags
 */
const { classifyBuilding, classifyPoi, roadInfo, roadWidth, landuseInfo, CONTEXT_KINDS, hashString } = require('../shared/classify');
const { dedupeBuildings } = require('../shared/dedupe.js');
const { parseLength, parseLevels, parseMaxspeed, parseColour, formatAddress } = require('../shared/tags');
const { geometryCentroid, geometryAreaM2, bboxOfGeometry, pointInGeometry, GridIndex, haversine } = require('../shared/geo');

const LEVEL_H = 3.0;

// ------------------------------------------------------------------ helpers
function polygonFeatures(features) { return features.filter(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')); }

function contextKindOf(tags) {
  for (const k of ['amenity', 'railway', 'public_transport', 'tourism', 'leisure', 'man_made', 'power', 'landuse']) {
    const v = tags[k];
    if (v && CONTEXT_KINDS.includes(`${k}=${v}`)) return `${k}=${v}`;
  }
  return null;
}
const CONTEXT_PRIORITY = (kind) => (kind.startsWith('landuse=') ? 1 : 2);

function buildContextIndex(areaFeatures) {
  const idx = new GridIndex(0.003);
  let n = 0;
  for (const f of polygonFeatures(areaFeatures)) {
    const kind = contextKindOf(f.properties.tags || {});
    if (!kind) continue;
    const bb = bboxOfGeometry(f.geometry);
    idx.insert({ f, kind, name: (f.properties.tags || {}).name || null, area: geometryAreaM2(f.geometry), bb }, bb);
    n++;
  }
  idx.count = n;
  return idx;
}

function findContext(idx, pt) {
  if (!idx || !idx.count) return null;
  let best = null;
  for (const c of idx.queryPoint(pt)) {
    if (pt[0] < c.bb[0] || pt[0] > c.bb[2] || pt[1] < c.bb[1] || pt[1] > c.bb[3]) continue;
    if (!pointInGeometry(pt, c.f.geometry)) continue;
    if (!best || CONTEXT_PRIORITY(c.kind) > CONTEXT_PRIORITY(best.kind) ||
      (CONTEXT_PRIORITY(c.kind) === CONTEXT_PRIORITY(best.kind) && c.area < best.area)) best = c;
  }
  return best;
}

function buildAddressIndex(addressFeatures) {
  const idx = new GridIndex(0.0015);
  for (const a of addressFeatures) {
    if (!a.geometry || a.geometry.type !== 'Point') continue;
    const p = a.geometry.coordinates;
    idx.insert(a, [p[0], p[1], p[0], p[1]]);
  }
  return idx;
}

/** Addresses (street + number) located inside a building footprint, compacted "Søndergade 12, 14". */
function addressesInside(idx, geom) {
  if (!idx) return null;
  const bb = bboxOfGeometry(geom);
  const byStreet = new Map();
  for (const a of idx.query(bb)) {
    const p = a.geometry.coordinates;
    if (!pointInGeometry(p, geom)) continue;
    const t = a.properties;
    const s = t.s || '';
    if (!byStreet.has(s)) byStreet.set(s, { nums: new Set(), pc: t.pc, c: t.c });
    if (t.hn) byStreet.get(s).nums.add(t.hn);
  }
  if (!byStreet.size) return null;
  const parts = [];
  for (const [street, v] of byStreet) {
    const nums = [...v.nums].sort((x, y) => (parseInt(x, 10) - parseInt(y, 10)) || String(x).localeCompare(String(y)));
    parts.push(`${street} ${nums.slice(0, 8).join(', ')}${nums.length > 8 ? ' …' : ''}`.trim() + (v.pc ? `, ${v.pc}${v.c ? ' ' + v.c : ''}` : ''));
  }
  return parts.slice(0, 3).join(' · ');
}

/** GeoDanmark (FOT) building index used to give OSM buildings a measured height. */
function buildHeightIndex(fotBuildings) {
  if (!fotBuildings || !fotBuildings.length) return null;
  const idx = new GridIndex(0.0015);
  for (const f of fotBuildings) {
    const bb = bboxOfGeometry(f.geometry);
    idx.insert({ f, bb, area: geometryAreaM2(f.geometry) }, bb);
  }
  return idx;
}

function matchMeasuredHeight(idx, geom, centroid) {
  if (!idx) return null;
  const area = geometryAreaM2(geom);
  let best = null, bestScore = Infinity;
  for (const c of idx.queryPoint(centroid)) {
    if (!pointInGeometry(centroid, c.f.geometry)) continue;
    const ratio = area / Math.max(1, c.area);
    if (ratio < 0.5 || ratio > 2) continue;
    const score = Math.abs(Math.log(ratio));
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best ? { h: best.f.properties.h, id: best.f.properties.id } : null;
}

// ------------------------------------------------------------------ buildings
function convertBuildings(features, { areas = [], addresses = [], fot = null } = {}) {
  const ctxIdx = buildContextIndex(areas);
  const addrIdx = buildAddressIndex(addresses);
  const hIdx = buildHeightIndex(fot);
  const out = [];
  const stats = { total: 0, heightTag: 0, levels: 0, measured: 0, estimated: 0, tagged: 0, name: 0, context: 0, unknown: 0, parts: 0 };

  for (const f of polygonFeatures(features)) {
    const tags = f.properties.tags || {};
    if (!tags.building && !tags['building:part']) continue;
    if (tags.building === 'no' || tags['building:part'] === 'no') continue;
    const centroid = geometryCentroid(f.geometry);
    const ctx = findContext(ctxIdx, centroid);
    const cls = classifyBuilding(tags, ctx ? { kind: ctx.kind, name: ctx.name } : null);
    const p = { id: f.id, k: cls.kind, lbl: cls.label, lda: cls.labelDa, ic: cls.icon, g: cls.group, cf: cls.confidence, st: cls.style };
    if (cls.func) p.fn = cls.func;
    if (cls.part) { p.part = 1; stats.parts++; }
    if (cls.note) p.note = cls.note;
    if (cls.also && cls.also.length) p.also = cls.also;
    if (ctx) { p.ctx = ctx.kind; if (ctx.name) p.ctxn = ctx.name; }
    const name = tags.name || tags['name:da'] || tags['addr:housename'] || null;
    if (name) p.n = name;
    const addr = formatAddress(tags) || addressesInside(addrIdx, f.geometry);
    if (addr) p.a = addr;

    // ---- heights (OSM semantics: height = top of roof, min_height = bottom of part)
    const lv = parseLevels(tags['building:levels']);
    const rlv = parseLevels(tags['roof:levels']);
    const tagH = parseLength(tags.height) || parseLength(tags['building:height']);
    const tagRH = parseLength(tags['roof:height']);
    let mh = parseLength(tags.min_height);
    if (mh === null && tags['building:min_level'] !== undefined) {
      const ml = parseLevels(tags['building:min_level']);
      if (ml !== null) mh = ml * LEVEL_H;
    }
    if (lv !== null) p.lv = lv;
    if (rlv !== null) p.rlv = rlv;
    if (tagRH !== null) p.rh = tagRH;
    if (mh !== null && mh > 0) p.mh = mh;
    if (tagH !== null && tagH > 0.5) { p.h = tagH; p.ht = 1; p.hs = 't'; stats.heightTag++; }
    else if (lv !== null && lv > 0) { p.h = lv * LEVEL_H + 0.6; p.hs = 'l'; stats.levels++; }
    else {
      const m = cls.part ? null : matchMeasuredHeight(hIdx, f.geometry, centroid);
      if (m && m.h > 1.5) { p.h = m.h; p.hs = 'g'; p.hsid = m.id; stats.measured++; }
      else { p.h = (cls.levels || 2) * LEVEL_H + (cls.levels >= 2 ? 0.6 : 0.3); p.hs = 'e'; stats.estimated++; }
    }
    if (tags['roof:shape']) p.rs = String(tags['roof:shape']).toLowerCase();
    const c = parseColour(tags['building:colour'] || tags.colour);
    const rc = parseColour(tags['roof:colour']);
    if (c) p.c = c;
    if (rc) p.rc = rc;
    if (tags['building:material']) p.m = tags['building:material'];
    if (tags['roof:material']) p.rm = tags['roof:material'];
    p.seed = hashString(f.id) % 100000;
    p.t = tags;
    stats[cls.confidence] = (stats[cls.confidence] || 0) + 1;
    stats.total++;
    out.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: p });
  }
  // the same building mapped twice → keep the better-described one (avoids flickering walls)
  const dup = dedupeBuildings(out);
  stats.duplicates = dup.dropped.length;
  stats.total -= dup.dropped.length;
  return { features: dup.features, stats };
}

// ------------------------------------------------------------------ roads
function sideSpec(tags, base) {
  const both = tags[`${base}:both`];
  const l = tags[`${base}:left`], r = tags[`${base}:right`];
  const v = tags[base];
  let left = null, right = null;
  const norm = (x) => (x === 'yes' ? (base === 'sidewalk' ? 'yes' : 'lane') : x);
  if (both) { left = right = norm(both); }
  if (v) {
    if (v === 'both') left = right = 'yes';
    else if (v === 'left') left = 'yes';
    else if (v === 'right') right = 'yes';
    else if (v === 'no' || v === 'none') { left = left || 'no'; right = right || 'no'; }
    else if (v === 'separate') { left = left || 'separate'; right = right || 'separate'; }
    else if (base === 'cycleway') { left = left || norm(v); right = right || norm(v); }
  }
  if (l) left = norm(l);
  if (r) right = norm(r);
  return [left, right];
}

function convertRoads(features) {
  const out = [];
  const areas = [];
  for (const f of features) {
    const tags = f.properties.tags || {};
    if (!tags.highway) continue;
    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
      areas.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { id: f.id, k: `highway=${tags.highway}`, lbl: roadInfo(tags.highway).label, n: tags.name || null, t: tags } });
      continue;
    }
    if (f.geometry.type !== 'LineString') continue;
    const info = roadInfo(tags.highway);
    const [swl, swr] = sideSpec(tags, 'sidewalk');
    const [cwl, cwr] = sideSpec(tags, 'cycleway');
    const p = {
      id: f.id, k: tags.highway, lbl: info.label, lda: info.labelDa, rk: info.rank,
      w: Math.round(roadWidth(tags) * 10) / 10
    };
    if (tags.name) p.n = tags.name;
    if (tags.ref) p.ref = tags.ref;
    const lanes = parseInt(tags.lanes, 10);
    if (lanes > 0) p.ln = lanes;
    if (tags.oneway === 'yes' || tags.oneway === '1' || tags.junction === 'roundabout') p.ow = 1;
    else if (tags.oneway === '-1') p.ow = -1;
    if (tags.bridge && tags.bridge !== 'no') p.br = 1;
    if (tags.tunnel && tags.tunnel !== 'no' && tags.tunnel !== 'building_passage') p.tu = 1;
    if (tags.tunnel === 'building_passage' || tags.covered === 'yes') p.cov = 1;
    const layer = parseInt(tags.layer, 10);
    if (layer) p.ly = layer;
    if (swl) p.swl = swl;
    if (swr) p.swr = swr;
    if (cwl) p.cwl = cwl;
    if (cwr) p.cwr = cwr;
    const ms = parseMaxspeed(tags.maxspeed);
    if (ms) p.ms = ms;
    if (tags.surface) p.sf = tags.surface;
    if (tags.lit) p.lit = tags.lit === 'no' ? 0 : 1;
    if (tags.footway) p.fw = tags.footway;
    if (tags.cycleway && tags.highway === 'cycleway') p.cw = tags.cycleway;
    if (tags.segregated) p.seg = tags.segregated === 'yes' ? 1 : 0;
    if (tags.junction === 'roundabout') p.rb = 1;
    if (f.nodes) p.nd = f.nodes;
    p.t = tags;
    out.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: p });
  }
  return { features: out, areas };
}

// ------------------------------------------------------------------ railways
function convertRailways(features) {
  const out = [];
  for (const f of features) {
    const tags = f.properties.tags || {};
    const kind = tags.railway || (tags.public_transport === 'platform' ? 'platform' : null);
    if (!kind) continue;
    const p = { id: f.id, k: kind, t: tags };
    if (tags.name) p.n = tags.name;
    if (tags.bridge && tags.bridge !== 'no') p.br = 1;
    if (tags.tunnel && tags.tunnel !== 'no') p.tu = 1;
    if (tags.electrified && tags.electrified !== 'no') p.el = 1;
    const layer = parseInt(tags.layer, 10);
    if (layer) p.ly = layer;
    if (f.nodes) p.nd = f.nodes;
    out.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: p });
  }
  return out;
}

// ------------------------------------------------------------------ areas: water, landuse, context
const WATER_DEFAULT_WIDTH = { river: 12, canal: 10, stream: 3, ditch: 1.5, drain: 1.5, brook: 2, tidal_channel: 6 };

function isWaterArea(tags) {
  return tags.natural === 'water' || tags.waterway === 'riverbank' || tags.waterway === 'dock' || tags.landuse === 'basin' ||
    tags.landuse === 'reservoir' || (tags.water && tags.natural !== 'wetland') || tags.leisure === 'swimming_pool' || tags.amenity === 'fountain';
}

function convertAreas(features) {
  const water = [], waterways = [], landuse = [], context = [];
  for (const f of features) {
    const tags = f.properties.tags || {};
    const g = f.geometry.type;
    if (g === 'LineString' && tags.waterway && WATER_DEFAULT_WIDTH[tags.waterway] !== undefined) {
      if (tags.tunnel === 'culvert' || tags.tunnel === 'yes') continue;
      const w = parseLength(tags.width) || WATER_DEFAULT_WIDTH[tags.waterway];
      waterways.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { id: f.id, k: tags.waterway, w, n: tags.name || null, t: tags } });
      continue;
    }
    if (g !== 'Polygon' && g !== 'MultiPolygon') continue;
    if (isWaterArea(tags)) {
      const k = tags.leisure === 'swimming_pool' ? 'swimming_pool' : tags.amenity === 'fountain' ? 'fountain' : (tags.water || tags.waterway || tags.landuse || 'water');
      water.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { id: f.id, k, n: tags.name || null, t: tags } });
      continue;
    }
    const ctxKind = contextKindOf(tags);
    const lu = landuseInfo(tags);
    if (ctxKind) context.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { id: f.id, k: ctxKind, n: tags.name || null, lbl: lu ? lu.label : ctxKind, t: tags } });
    if (lu) landuse.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { id: f.id, k: lu.key, lbl: lu.label, lda: lu.labelDa, g: lu.group, n: tags.name || null, t: tags } });
    else if (tags.man_made === 'pier' || tags.man_made === 'breakwater' || tags.man_made === 'quay' || tags.place === 'square') {
      landuse.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { id: f.id, k: tags.place === 'square' ? 'place=square' : `man_made=${tags.man_made}`, lbl: tags.place === 'square' ? 'Square' : 'Pier', n: tags.name || null, t: tags } });
    }
  }
  return { water, waterways, landuse, context };
}

// ------------------------------------------------------------------ POIs, furniture, trees, barriers, addresses
const FURNITURE_KEYS = new Set([
  'highway=street_lamp', 'highway=traffic_signals', 'highway=crossing', 'highway=bus_stop', 'highway=stop', 'highway=give_way', 'highway=speed_camera',
  'amenity=bench', 'amenity=bicycle_parking', 'amenity=waste_basket', 'amenity=post_box', 'amenity=parcel_locker', 'amenity=telephone',
  'amenity=vending_machine', 'amenity=recycling', 'amenity=drinking_water', 'amenity=charging_station', 'amenity=bicycle_rental',
  'amenity=fountain', 'amenity=clock', 'amenity=shelter', 'amenity=bbq', 'amenity=toilets', 'emergency=fire_hydrant', 'emergency=defibrillator',
  'man_made=flagpole', 'man_made=street_cabinet', 'man_made=surveillance', 'barrier=bollard', 'leisure=picnic_table', 'railway=level_crossing'
]);

function furnitureKind(tags) {
  for (const k of ['highway', 'amenity', 'emergency', 'man_made', 'barrier', 'leisure', 'railway']) {
    if (tags[k] && FURNITURE_KEYS.has(`${k}=${tags[k]}`)) return `${k}=${tags[k]}`;
  }
  if (tags.advertising) return 'advertising=' + tags.advertising;
  return null;
}

const KEEP_FURNITURE_TAGS = /^(crossing|crossing:markings|crossing_ref|traffic_signals|shelter|bench|bin|lit|lamp_type|light:colour|support|height|operator|name|ref|route_ref|direction|traffic_signals:direction|bicycle_parking|capacity|covered|recycling_type|backrest|material|colour|surveillance:type|advertising|bus|tactile_paving|button_operated|network|wheelchair|departures_board|opening_hours|fee|socket:.*|amperage)$/;

function convertPoints(features) {
  const pois = [], furniture = [], trees = [], barriers = [];
  for (const f of features) {
    const tags = f.properties.tags || {};
    const g = f.geometry.type;
    if (tags.natural === 'tree' && g === 'Point') {
      const p = { id: f.id };
      if (tags.leaf_type) p.lt = tags.leaf_type;
      const h = parseLength(tags.height); if (h) p.h = h;
      const cd = parseLength(tags.diameter_crown); if (cd) p.cd = cd;
      const sp = tags['species:da'] || tags.species || tags.genus || tags['genus:da']; if (sp) p.sp = sp;
      if (tags.denotation) p.den = tags.denotation;
      trees.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: p });
      continue;
    }
    if (tags.natural === 'tree_row' && g === 'LineString') {
      // expand a tree row into individual trees every ~7 m
      const c = f.geometry.coordinates;
      let carry = 0, n = 0;
      for (let i = 1; i < c.length; i++) {
        const d = haversine(c[i - 1], c[i]);
        let s = carry;
        while (s <= d) {
          const t = d ? s / d : 0;
          const tid = `${f.id}-${n++}`;
          trees.push({ type: 'Feature', id: tid, geometry: { type: 'Point', coordinates: [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t] }, properties: { id: tid, lt: tags.leaf_type || null, row: 1 } });
          s += 7;
        }
        carry = s - d;
      }
      continue;
    }
    if (tags.barrier && (g === 'LineString' || g === 'Polygon')) {
      const def = { hedge: 1.5, wall: 1.8, fence: 1.4, retaining_wall: 1.0, city_wall: 5, guard_rail: 0.8 }[tags.barrier];
      if (def === undefined) continue;
      const coords = g === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates;
      barriers.push({ type: 'Feature', id: f.id, geometry: { type: 'LineString', coordinates: coords }, properties: { id: f.id, k: tags.barrier, h: parseLength(tags.height) || def, m: tags.material || null } });
      continue;
    }
    if (g !== 'Point') continue;
    const fk = furnitureKind(tags);
    if (fk) {
      const kept = {};
      for (const [k, v] of Object.entries(tags)) if (KEEP_FURNITURE_TAGS.test(k)) kept[k] = v;
      furniture.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: { id: f.id, k: fk, t: kept } });
      // named bus stops / stations are also useful POIs
      if (!(tags.name && (fk === 'highway=bus_stop'))) continue;
    }
    const cls = classifyPoi(tags);
    if (cls.key === 'place' && !tags.name) continue;
    const p = { id: f.id, k: cls.key, lbl: cls.label, lda: cls.labelDa, ic: cls.icon, g: cls.group, col: cls.color, t: tags };
    if (tags.name) p.n = tags.name;
    if (cls.also && cls.also.length) p.also = cls.also;
    pois.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: p });
  }
  return { pois, furniture, trees, barriers };
}

function convertAddresses(features) {
  const out = [];
  for (const f of features) {
    const t = f.properties.tags || {};
    if (!t['addr:housenumber'] || !f.geometry || f.geometry.type !== 'Point') continue;
    const p = { id: f.id, s: t['addr:street'] || t['addr:place'] || '', hn: t['addr:housenumber'] };
    if (t['addr:postcode']) p.pc = t['addr:postcode'];
    if (t['addr:city']) p.c = t['addr:city'];
    out.push({ type: 'Feature', id: f.id, geometry: f.geometry, properties: p });
  }
  return out;
}

module.exports = {
  convertBuildings, convertRoads, convertRailways, convertAreas, convertPoints, convertAddresses,
  buildContextIndex, findContext, buildAddressIndex, addressesInside, buildHeightIndex, matchMeasuredHeight, sideSpec, furnitureKind
};
