'use strict';
/**
 * "NetAScore-lite": APPROXIMATE bikeability / walkability indices from OSM tags.
 * Mirrors the structure of NetAScore's default profiles (weighted mean of 0..1 indicators) but is
 * NOT the official algorithm (no gradient, noise, greenness or route relations). Shared by the
 * main process (Overpass download) and the 3D explorer HUD (scores for any street the user is on).
 */
const tagIs = (t, k, ...vals) => vals.includes(t[k]);
const anyTag = (t, keys, ...vals) => keys.some(k => vals.includes(t[k]));
const CYCLEWAY_KEYS = ['cycleway', 'cycleway:both', 'cycleway:right', 'cycleway:left'];
const SIDEWALK_KEYS = ['sidewalk', 'sidewalk:both', 'sidewalk:right', 'sidewalk:left'];

function bicycleInfrastructure(t) {
  if (t.highway === 'cycleway') return t.foot === 'designated' && t.segregated !== 'yes' ? 0.9 : 1.0;
  if (anyTag(t, CYCLEWAY_KEYS, 'track', 'separate')) return 1.0;
  if (t.bicycle_road === 'yes' || t.cyclestreet === 'yes') return 0.85;
  if (['path', 'footway', 'track', 'bridleway'].includes(t.highway) && tagIs(t, 'bicycle', 'designated')) return 0.9;
  if (anyTag(t, CYCLEWAY_KEYS, 'lane', 'opposite_lane')) return 0.75;
  if (anyTag(t, CYCLEWAY_KEYS, 'share_busway', 'opposite_share_busway')) return 0.75;
  if (anyTag(t, CYCLEWAY_KEYS, 'shared_lane', 'opposite')) return 0.5;
  if (['path', 'track'].includes(t.highway) && tagIs(t, 'bicycle', 'yes', 'permissive')) return 0.6;
  return 0.2;
}

function pedestrianInfrastructure(t) {
  if (['pedestrian', 'living_street'].includes(t.highway)) return 1.0;
  if (t.highway === 'footway') return t.footway === 'crossing' ? 0.8 : 1.0;
  if (t.highway === 'steps') return 0.6;
  if (t.highway === 'path') return tagIs(t, 'foot', 'designated') ? 1.0 : 0.8;
  if (t.highway === 'track') return 0.6;
  if (anyTag(t, ['sidewalk', 'sidewalk:both'], 'both', 'separate')) return 1.0;
  if (anyTag(t, SIDEWALK_KEYS, 'left', 'right', 'yes')) return 0.7;
  if (t.highway === 'cycleway') return tagIs(t, 'foot', 'designated', 'yes') ? 0.6 : 0.3;
  if (anyTag(t, ['sidewalk', 'sidewalk:both'], 'no', 'none')) return 0.1;
  if (['residential', 'service', 'unclassified'].includes(t.highway)) return 0.5;
  return 0.3;
}

function roadCategory(t, profile) {
  const h = t.highway;
  const bike = { trunk: 0, trunk_link: 0, primary: 0.1, primary_link: 0.1, secondary: 0.3, secondary_link: 0.3, tertiary: 0.5, tertiary_link: 0.5,
    unclassified: 0.7, residential: 0.8, living_street: 0.9, service: 0.8, cycleway: 1, path: 0.9, track: 0.7, footway: 0.4, pedestrian: 0.5, bridleway: 0.4, steps: 0, road: 0.5 };
  const walk = { trunk: 0, trunk_link: 0, primary: 0.2, primary_link: 0.2, secondary: 0.3, secondary_link: 0.3, tertiary: 0.5, tertiary_link: 0.5,
    unclassified: 0.6, residential: 0.7, living_street: 0.9, service: 0.6, cycleway: 0.4, path: 1, track: 0.8, footway: 1, pedestrian: 1, bridleway: 0.7, steps: 0.7, road: 0.5 };
  const table = profile === 'bike' ? bike : walk;
  return table[h] ?? 0.5;
}

function parseSpeed(t) {
  const raw = t.maxspeed || t['maxspeed:forward'] || t['maxspeed:backward'];
  if (!raw) return null;
  if (/walk/i.test(raw)) return 7;
  if (/dk:urban/i.test(raw)) return 50;
  if (/dk:rural/i.test(raw)) return 80;
  const m = String(raw).match(/(\d+)/);
  if (!m) return null;
  let v = Number(m[1]);
  if (/mph/i.test(raw)) v *= 1.609;
  return v;
}
function defaultSpeed(t) {
  const h = t.highway;
  if (['cycleway', 'footway', 'path', 'pedestrian', 'steps', 'track', 'bridleway'].includes(h)) return 0;
  if (h === 'living_street') return 15;
  if (h === 'service') return 30;
  if (['trunk', 'trunk_link'].includes(h)) return 80;
  return 50; // Danish urban default
}
function maxSpeed(t, profile) {
  const s = parseSpeed(t) ?? defaultSpeed(t);
  if (s <= 0) return 1;
  const separated = profile === 'bike'
    ? (t.highway === 'cycleway' || anyTag(t, CYCLEWAY_KEYS, 'track', 'separate'))
    : anyTag(t, ['sidewalk', 'sidewalk:both'], 'both', 'separate');
  let v;
  if (s <= 15) v = 1; else if (s <= 20) v = 0.95; else if (s <= 30) v = 0.85; else if (s <= 40) v = 0.7;
  else if (s <= 50) v = 0.55; else if (s <= 60) v = 0.4; else if (s <= 70) v = 0.3; else if (s <= 80) v = 0.2; else v = 0;
  return separated ? Math.min(1, v + 0.35) : v;
}

function pavement(t, profile) {
  const s = t.surface;
  if (!s) {
    if (['track', 'path'].includes(t.highway)) return profile === 'bike' ? 0.6 : 0.8;
    return 0.9;
  }
  const bike = { asphalt: 1, concrete: 0.95, 'concrete:plates': 0.85, paved: 0.95, paving_stones: 0.8, chipseal: 0.85,
    compacted: 0.7, fine_gravel: 0.65, gravel: 0.4, pebblestone: 0.3, sett: 0.4, cobblestone: 0.3, unhewn_cobblestone: 0.2,
    wood: 0.6, metal: 0.6, grass_paver: 0.4, unpaved: 0.4, ground: 0.35, dirt: 0.3, earth: 0.3, grass: 0.1, sand: 0.1, mud: 0 };
  const walk = { asphalt: 1, concrete: 1, paved: 1, paving_stones: 1, 'concrete:plates': 1, chipseal: 0.9, compacted: 0.9,
    fine_gravel: 0.85, gravel: 0.6, sett: 0.75, cobblestone: 0.65, unhewn_cobblestone: 0.5, wood: 0.9, metal: 0.8,
    grass_paver: 0.7, unpaved: 0.6, ground: 0.6, dirt: 0.5, earth: 0.5, grass: 0.4, sand: 0.3, mud: 0.1 };
  return (profile === 'bike' ? bike : walk)[s] ?? 0.7;
}

function width(t) {
  const w = Number(String(t.width || t.est_width || '').replace(',', '.').replace(/[^\d.]/g, ''));
  if (!w) return null;
  if (w >= 4) return 1; if (w >= 3) return 0.8; if (w >= 2) return 0.6; if (w >= 1.5) return 0.4; return 0.2;
}

function lit(t) {
  if (!t.lit) return null;
  return t.lit === 'yes' || t.lit === '24/7' || t.lit === 'automatic' ? 1 : 0.3;
}

function accessible(t, profile) {
  if (profile === 'bike') {
    if (tagIs(t, 'bicycle', 'no', 'dismount', 'use_sidepath')) return false;
    if (t.highway === 'steps') return false;
    if (['footway', 'pedestrian'].includes(t.highway) && !tagIs(t, 'bicycle', 'yes', 'designated', 'permissive')) return false;
    if (['trunk', 'trunk_link', 'motorway', 'motorway_link'].includes(t.highway) && !tagIs(t, 'bicycle', 'yes', 'designated')) return false;
    return true;
  }
  if (tagIs(t, 'foot', 'no', 'use_sidepath')) return false;
  if (['motorway', 'motorway_link'].includes(t.highway)) return false;
  if (['trunk', 'trunk_link'].includes(t.highway) && !tagIs(t, 'foot', 'yes', 'designated') && !anyTag(t, SIDEWALK_KEYS, 'both', 'left', 'right', 'yes', 'separate')) return false;
  if (t.highway === 'cycleway' && tagIs(t, 'foot', 'no')) return false;
  return true;
}

const WEIGHTS = {
  bike: { bicycle_infrastructure: 0.30, road_category: 0.20, max_speed: 0.20, pavement: 0.15, width: 0.10, lit: 0.05 },
  walk: { pedestrian_infrastructure: 0.35, road_category: 0.20, max_speed: 0.20, pavement: 0.10, width: 0.05, lit: 0.10 }
};

function weightedIndex(indicators, weights) {
  let s = 0, w = 0;
  for (const [k, wt] of Object.entries(weights)) {
    const v = indicators[k];
    if (v === null || v === undefined) continue;
    s += v * wt; w += wt;
  }
  return w ? Math.round((s / w) * 1000) / 1000 : null;
}

function scoreWay(tags) {
  const t = tags || {};
  const bikeInd = { bicycle_infrastructure: bicycleInfrastructure(t), road_category: roadCategory(t, 'bike'), max_speed: maxSpeed(t, 'bike'), pavement: pavement(t, 'bike'), width: width(t), lit: lit(t) };
  const walkInd = { pedestrian_infrastructure: pedestrianInfrastructure(t), road_category: roadCategory(t, 'walk'), max_speed: maxSpeed(t, 'walk'), pavement: pavement(t, 'walk'), width: width(t), lit: lit(t) };
  return {
    index_bike: accessible(t, 'bike') ? weightedIndex(bikeInd, WEIGHTS.bike) : null,
    index_walk: accessible(t, 'walk') ? weightedIndex(walkInd, WEIGHTS.walk) : null,
    bikeInd, walkInd
  };
}

module.exports = { scoreWay, WEIGHTS, accessible };
