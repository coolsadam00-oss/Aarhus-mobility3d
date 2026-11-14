'use strict';
/**
 * Online "look up" services, all optional (Settings → Privacy → Online lookups):
 *  - Nominatim (OpenStreetMap) search & reverse geocoding — max 1 request/second per usage policy
 *  - Wikipedia page summaries (text + photo) and Wikidata facts (inception, architect, height, floors, image)
 *  - Live OpenStreetMap building lookup at a point (for places outside downloaded city packs)
 * Results are cached in SQLite (lookup_cache) so repeated lookups work offline.
 */
const { UA, overpassQuery } = require('./overpass');
const { elementToFeature } = require('./osm-assemble');
const { classifyBuilding } = require('../shared/classify');
const { pointInGeometry, geometryCentroid, haversine } = require('../shared/geo');
const { parseWikipedia } = require('../shared/tags');

const NOMINATIM = process.env.AM3D_NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const AARHUS_VIEWBOX = '10.00,56.30,10.40,56.05';

class Throttle {
  constructor(ms) { this.ms = ms; this.last = 0; this.chain = Promise.resolve(); }
  run(fn) {
    const p = this.chain.then(async () => {
      const wait = this.last + this.ms - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.last = Date.now();
      return fn();
    });
    this.chain = p.catch(() => {});
    return p;
  }
}
const nominatimThrottle = new Throttle(1100);
const wikiThrottle = new Throttle(150);

async function getJson(url, { timeout = 15000 } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'da,en' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function createLookup({ cacheGet, cacheSet, enabled }) {
  const cached = async (key, ttlDays, fn) => {
    const hit = cacheGet(key, ttlDays);
    if (hit !== undefined) return hit;
    if (!enabled()) return null;
    const v = await fn();
    cacheSet(key, v);
    return v;
  };

  async function search(q) {
    q = String(q || '').trim().slice(0, 200);
    if (q.length < 2) return [];
    return cached(`nom:s:${q.toLowerCase()}`, 7, () => nominatimThrottle.run(async () => {
      const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=1&extratags=1&namedetails=1&limit=10&countrycodes=dk&viewbox=${AARHUS_VIEWBOX}&bounded=0&q=${encodeURIComponent(q)}`;
      const rows = await getJson(url);
      return rows.map(r => ({
        name: (r.namedetails && (r.namedetails.name || r.namedetails['name:da'])) || r.name || r.display_name.split(',')[0],
        display: r.display_name, lat: Number(r.lat), lon: Number(r.lon), cls: r.category || r.class, type: r.type,
        osm: r.osm_type ? `${r.osm_type[0]}${r.osm_id}` : null, bbox: r.boundingbox ? r.boundingbox.map(Number) : null, source: 'nominatim'
      }));
    }));
  }

  async function reverse(lat, lon) {
    lat = Number(lat); lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return cached(`nom:r:${lat.toFixed(5)},${lon.toFixed(5)}`, 14, () => nominatimThrottle.run(async () => {
      const r = await getJson(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&extratags=1&namedetails=1&zoom=18&lat=${lat}&lon=${lon}`);
      if (!r || r.error) return null;
      return { name: r.name || null, display: r.display_name, address: r.address || {}, cls: r.category || r.class, type: r.type, osm: r.osm_type ? `${r.osm_type[0]}${r.osm_id}` : null, extratags: r.extratags || {} };
    }));
  }

  /** Wikipedia summary + Wikidata facts for an object with wikipedia / wikidata tags. */
  async function wiki(tags) {
    tags = tags || {};
    const wp = parseWikipedia(tags.wikipedia);
    const qid = /^Q\d+$/.test(String(tags.wikidata || '').trim()) ? String(tags.wikidata).trim() : null;
    if (!wp && !qid) return null;
    return cached(`wiki:${qid || ''}:${wp ? wp.lang + ':' + wp.title : ''}`, 30, async () => {
      const out = { title: null, extract: null, url: null, image: null, imagePage: null, lang: null, facts: [], wikidata: qid };
      let wd = null;
      if (qid) {
        try {
          const r = await wikiThrottle.run(() => getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels|descriptions|claims|sitelinks&languages=da|en&format=json`));
          wd = r.entities && r.entities[qid];
        } catch { wd = null; }
      }
      let lang = wp ? wp.lang : null, title = wp ? wp.title : null;
      if (!title && wd && wd.sitelinks) {
        if (wd.sitelinks.dawiki) { lang = 'da'; title = wd.sitelinks.dawiki.title; }
        else if (wd.sitelinks.enwiki) { lang = 'en'; title = wd.sitelinks.enwiki.title; }
      }
      if (title) {
        try {
          const s = await wikiThrottle.run(() => getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`));
          out.title = s.title; out.extract = s.extract || null; out.lang = lang;
          out.url = s.content_urls && s.content_urls.desktop ? s.content_urls.desktop.page : `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;
          if (s.thumbnail && s.thumbnail.source) out.image = s.originalimage && s.originalimage.width <= 1600 ? s.originalimage.source : s.thumbnail.source;
        } catch { /* page may not exist */ }
      }
      if (wd) {
        const claim = (p) => (wd.claims && wd.claims[p] && wd.claims[p][0] && wd.claims[p][0].mainsnak && wd.claims[p][0].mainsnak.datavalue) ? wd.claims[p][0].mainsnak.datavalue.value : null;
        const label = (wd.labels && (wd.labels.da || wd.labels.en)) ? (wd.labels.da || wd.labels.en).value : null;
        const desc = (wd.descriptions && (wd.descriptions.en || wd.descriptions.da)) ? (wd.descriptions.en || wd.descriptions.da).value : null;
        if (!out.title && label) out.title = label;
        if (desc) out.facts.push({ label: 'Description', value: desc });
        const img = claim('P18');
        if (img && !out.image) {
          out.image = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=800`;
        }
        if (img) out.imagePage = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(img.replace(/ /g, '_'))}`;
        const inception = claim('P571');
        if (inception && inception.time) out.facts.push({ label: 'Inception', value: inception.time.replace(/^\+/, '').slice(0, 4) });
        const height = claim('P2048');
        if (height && height.amount) out.facts.push({ label: 'Height (Wikidata)', value: `${Number(height.amount).toFixed(1)} m` });
        const floors = claim('P1101');
        if (floors && floors.amount) out.facts.push({ label: 'Floors (Wikidata)', value: String(Number(floors.amount)) });
        const site = claim('P856');
        if (site) out.facts.push({ label: 'Official website', value: site, url: site });
        const archIds = (wd.claims && wd.claims.P84 ? wd.claims.P84 : []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean).slice(0, 4);
        const styleIds = (wd.claims && wd.claims.P149 ? wd.claims.P149 : []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean).slice(0, 3);
        const ids = [...archIds, ...styleIds];
        if (ids.length) {
          try {
            const r = await wikiThrottle.run(() => getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels&languages=da|en&format=json`));
            const lab = (id) => { const e = r.entities[id]; return e && e.labels && (e.labels.da || e.labels.en) ? (e.labels.da || e.labels.en).value : id; };
            if (archIds.length) out.facts.push({ label: 'Architect (Wikidata)', value: archIds.map(lab).join(', ') });
            if (styleIds.length) out.facts.push({ label: 'Architectural style', value: styleIds.map(lab).join(', ') });
          } catch { /* ignore */ }
        }
      }
      return out;
    });
  }

  /** Live OSM lookup of the building at a point (used outside downloaded packs). */
  async function osmBuildingAt(lat, lon) {
    lat = Number(lat); lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return cached(`osm:b:${lat.toFixed(5)},${lon.toFixed(5)}`, 3, async () => {
      const q = `[out:json][timeout:25];(way["building"](around:30,${lat},${lon});relation["building"]["type"="multipolygon"](around:30,${lat},${lon}););out body geom;`;
      const { json } = await overpassQuery(q, { timeoutMs: 30000 });
      const pt = [lon, lat];
      let best = null, bestD = Infinity;
      for (const el of json.elements || []) {
        const f = elementToFeature(el, { forceArea: true });
        if (!f || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue;
        const inside = pointInGeometry(pt, f.geometry);
        const d = inside ? -1 : haversine(pt, geometryCentroid(f.geometry));
        if (d < bestD) { bestD = d; best = f; }
      }
      if (!best) return null;
      const cls = classifyBuilding(best.properties.tags);
      return { id: best.id, geometry: best.geometry, inside: bestD < 0, cls, tags: best.properties.tags };
    });
  }

  return { search, reverse, wiki, osmBuildingAt };
}

module.exports = { createLookup, Throttle };
