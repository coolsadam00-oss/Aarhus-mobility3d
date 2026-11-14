'use strict';
/** Serialise feedback rows to CSV or GeoJSON. */

const COLUMNS = ['id', 'target_type', 'osm_way_id', 'segment_id', 'street_name', 'category', 'mode', 'severity', 'body', 'author', 'lng', 'lat', 'dataset', 'created_at'];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  const lines = [COLUMNS.join(',')];
  for (const r of rows) lines.push(COLUMNS.map(c => csvCell(r[c])).join(','));
  // BOM so Excel opens UTF-8 (æ, ø, å) correctly
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function toGeoJson(rows) {
  return JSON.stringify({
    type: 'FeatureCollection',
    name: 'aarhus_mobility_feedback',
    features: rows.map(r => ({
      type: 'Feature',
      geometry: (r.lng != null && r.lat != null) ? { type: 'Point', coordinates: [r.lng, r.lat] } : null,
      properties: Object.fromEntries(COLUMNS.filter(c => c !== 'lng' && c !== 'lat').map(c => [c, r[c]]))
    }))
  }, null, 2);
}

module.exports = { toCsv, toGeoJson, COLUMNS };
