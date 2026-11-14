'use strict';
/**
 * "NetAScore-lite": downloads the Aarhus street network from the Overpass API and
 * computes APPROXIMATE bikeability / walkability indices from OSM tags.
 *
 * This is a convenience fallback so the app shows real Aarhus streets on first run.
 * It imitates the structure of NetAScore's default profiles (weighted mean of 0..1
 * indicator values) but it is NOT the official NetAScore algorithm: there is no
 * DEM gradient, noise, greenness, building or route-relation data. For real
 * analyses, run NetAScore itself (see netascore/README) and load its GeoPackage.
 */

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

// south, west, north, east — central Aarhus incl. harbour, Risskov, Viby, Brabrand edge
const AARHUS_BBOX = [56.115, 10.120, 56.205, 10.255];

const EXCLUDED = 'motorway|motorway_link|construction|proposed|raceway|bus_guideway|abandoned|platform|corridor|elevator|escape|rest_area|services|busway';

function buildQuery(bbox) {
  const b = bbox.join(',');
  return `[out:json][timeout:240];
way["highway"]["highway"!~"^(${EXCLUDED})$"]["area"!="yes"]["access"!~"^(private|no)$"](${b});
out tags geom;`;
}

const { scoreWay } = require('../shared/netascore-lite');

function wayToFeature(el) {
  if (!el.geometry || el.geometry.length < 2) return null;
  const t = el.tags || {};
  const s = scoreWay(t);
  const r = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: el.geometry.map(g => [Math.round(g.lon * 1e7) / 1e7, Math.round(g.lat * 1e7) / 1e7]) },
    properties: {
      osm_id: el.id,
      name: t.name || null,
      highway: t.highway,
      maxspeed: t.maxspeed || null,
      surface: t.surface || null,
      cycleway: t.cycleway || t['cycleway:both'] || t['cycleway:right'] || t['cycleway:left'] || null,
      sidewalk: t.sidewalk || t['sidewalk:both'] || null,
      lit: t.lit || null,
      index_bike: s.index_bike,
      index_walk: s.index_walk,
      bicycle_infrastructure: r(s.bikeInd.bicycle_infrastructure),
      pedestrian_infrastructure: r(s.walkInd.pedestrian_infrastructure),
      road_category_bike: r(s.bikeInd.road_category),
      road_category_walk: r(s.walkInd.road_category),
      max_speed_bike: r(s.bikeInd.max_speed),
      max_speed_walk: r(s.walkInd.max_speed),
      pavement_bike: r(s.bikeInd.pavement),
      pavement_walk: r(s.walkInd.pavement),
      width_ind: r(s.bikeInd.width),
      lit_ind: r(s.bikeInd.lit),
      _source: 'osm-lite'
    }
  };
}

async function fetchOverpass(query, onProgress) {
  let lastErr;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      onProgress && onProgress(`Querying ${new URL(url).host} …`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AarhusMobility3D/1.0' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(300000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onProgress && onProgress('Downloading street network …');
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`All Overpass endpoints failed (${lastErr && lastErr.message}). Check your internet connection.`);
}

async function fetchAarhusOsmLite({ bbox = AARHUS_BBOX, onProgress } = {}) {
  const data = await fetchOverpass(buildQuery(bbox), onProgress);
  onProgress && onProgress(`Scoring ${data.elements.length.toLocaleString()} ways …`);
  const features = [];
  for (const el of data.elements) {
    if (el.type !== 'way') continue;
    const f = wayToFeature(el);
    if (f) features.push(f);
  }
  return {
    type: 'FeatureCollection',
    metadata: {
      source: 'osm-lite',
      description: 'Approximate indices computed from OSM tags (NetAScore-lite). Not official NetAScore output.',
      bbox,
      generated: new Date().toISOString(),
      attribution: '© OpenStreetMap contributors (ODbL)'
    },
    features
  };
}

module.exports = { fetchAarhusOsmLite, scoreWay, wayToFeature, buildQuery, AARHUS_BBOX };
