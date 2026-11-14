'use strict';
/**
 * OSM tag parsing and human-readable formatting.
 * Used by the city-pack converter (heights, colours) and by the info panel (grouped, labelled tags).
 */

// ------------------------------------------------------------------ numbers & units
function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** Parse an OSM length ("12", "12 m", "12.5m", "40'", "40 ft", "12'6\"") to metres. */
function parseLength(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase().replace(',', '.');
  const ftIn = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (ftIn) return Number(ftIn[1]) * 0.3048 + (ftIn[2] ? Number(ftIn[2]) * 0.0254 : 0);
  const n = parseNumber(s);
  if (n === null) return null;
  if (/\b(ft|feet)\b/.test(s)) return n * 0.3048;
  if (/\bmi\b/.test(s)) return n * 1609.34;
  if (/\bkm\b/.test(s)) return n * 1000;
  if (/\bcm\b/.test(s)) return n / 100;
  if (/\bmm\b/.test(s)) return n / 1000;
  return n;
}

function parseLevels(v) {
  const n = parseNumber(v);
  return n === null ? null : Math.max(0, Math.round(n * 2) / 2);
}

/** Parse maxspeed to km/h (handles "50", "30 mph", "DK:urban", "walk", "none"). */
function parseMaxspeed(v) {
  if (!v) return null;
  const s = String(v).toLowerCase();
  if (s === 'walk') return 7;
  if (s === 'none') return null;
  if (/dk:urban/.test(s)) return 50;
  if (/dk:rural/.test(s)) return 80;
  if (/dk:motorway/.test(s)) return 130;
  const n = parseNumber(s);
  if (n === null) return null;
  return /mph/.test(s) ? Math.round(n * 1.609) : n;
}

// ------------------------------------------------------------------ colours
const NAMED_COLOURS = {
  black: '#1e1e1e', white: '#f2f0ea', grey: '#8f8f8f', gray: '#8f8f8f', lightgrey: '#c7c7c3', lightgray: '#c7c7c3',
  darkgrey: '#555555', darkgray: '#555555', silver: '#bfc1c2', red: '#a33a2c', darkred: '#6f2a22', brown: '#7a4b32',
  maroon: '#6b2b26', orange: '#cf7a3a', yellow: '#d9c26a', beige: '#d8cba8', cream: '#ece3c8', ivory: '#efe9d6',
  tan: '#c8a77c', khaki: '#b9a873', olive: '#6f6b3a', green: '#5f8a4c', darkgreen: '#2f4f2f', lightgreen: '#9cc78a',
  teal: '#3c7f7f', cyan: '#6bb7c4', blue: '#4a6fa5', navy: '#2d3e63', lightblue: '#a7c4dd', purple: '#6c4a7c',
  pink: '#d9a3a8', salmon: '#d98c74', terracotta: '#b5583a', sandstone: '#d7c08f', brick: '#9c4a32', copper: '#5f9483',
  gold: '#c9a443', rose: '#c98b8b', bordeaux: '#5e1f27', anthracite: '#383e42', ochre: '#c18a32'
};

function parseColour(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase().replace(/[\s_-]/g, '');
  if (/^#([0-9a-f]{3}){1,2}$/.test(s)) {
    return s.length === 4 ? '#' + s.slice(1).split('').map(c => c + c).join('') : s;
  }
  return NAMED_COLOURS[s] || null;
}

// Typical surface colours for building / roof materials (used when no explicit colour is tagged)
const MATERIAL_COLOURS = {
  brick: '#9c4a32', plaster: '#e3dccd', concrete: '#a9a8a1', glass: '#7f93a3', wood: '#8a6a4a', metal: '#9aa1a6',
  stone: '#b8ad98', sandstone: '#d7c08f', limestone: '#d9d2bf', timber_framing: '#e6dcc8', steel: '#8d959b',
  cement_block: '#b0aea6', mirror: '#8ca2b4', panels: '#c9c4b8', tiles: '#b65a3c', slate: '#4a4f55',
  roof_tiles: '#a34a32', copper: '#5f9483', tar_paper: '#3a3a3a', grass: '#5f7f3e', gravel: '#8d8a83',
  eternit: '#8b8d8f', asbestos: '#8b8d8f', thatch: '#9a8355', zinc: '#9da3a6', plastic: '#d8d8d8'
};

// ------------------------------------------------------------------ labels
const KEY_LABELS = {
  name: 'Name', 'name:da': 'Name (Danish)', 'name:en': 'Name (English)', alt_name: 'Also known as', old_name: 'Former name',
  official_name: 'Official name', short_name: 'Short name', loc_name: 'Local name',
  building: 'Building type', 'building:part': 'Building part', 'building:levels': 'Floors (above ground)',
  'building:levels:underground': 'Floors (underground)', 'building:min_level': 'Lowest floor of part', 'roof:levels': 'Floors in roof',
  'building:flats': 'Number of flats', 'building:units': 'Units', 'building:use': 'Building use',
  height: 'Height', min_height: 'Height of base', 'roof:height': 'Roof height', 'roof:shape': 'Roof shape',
  'roof:material': 'Roof material', 'roof:colour': 'Roof colour', 'roof:orientation': 'Roof orientation', 'roof:direction': 'Roof direction',
  'building:material': 'Facade material', 'building:colour': 'Facade colour', 'building:architecture': 'Architectural style',
  'building:condition': 'Condition', start_date: 'Built / opened', 'construction_date': 'Construction date', architect: 'Architect',
  heritage: 'Heritage protection', 'heritage:operator': 'Heritage register', 'listed_status': 'Listed status',
  'addr:street': 'Street', 'addr:housenumber': 'House number', 'addr:postcode': 'Postcode', 'addr:city': 'City',
  'addr:unit': 'Unit', 'addr:floor': 'Floor', 'addr:place': 'Place', 'addr:country': 'Country', 'addr:door': 'Door',
  'addr:municipality': 'Municipality', 'osak:identifier': 'Danish address ID (OSAK)',
  amenity: 'Amenity', shop: 'Shop', tourism: 'Tourism', leisure: 'Leisure', office: 'Office', craft: 'Craft',
  healthcare: 'Healthcare', 'healthcare:speciality': 'Medical speciality', historic: 'Historic', man_made: 'Man-made structure',
  railway: 'Railway', public_transport: 'Public transport', highway: 'Road / path type', landuse: 'Land use', natural: 'Natural feature',
  operator: 'Operator', brand: 'Brand', 'brand:wikidata': 'Brand (Wikidata)', network: 'Network', owner: 'Owner',
  opening_hours: 'Opening hours', 'opening_hours:covid19': 'Opening hours (COVID-19)', website: 'Website', 'contact:website': 'Website',
  url: 'Website', phone: 'Phone', 'contact:phone': 'Phone', email: 'E-mail', 'contact:email': 'E-mail',
  'contact:facebook': 'Facebook', 'contact:instagram': 'Instagram', fax: 'Fax',
  wheelchair: 'Wheelchair access', 'wheelchair:description': 'Wheelchair notes', 'toilets:wheelchair': 'Accessible toilet',
  capacity: 'Capacity', 'capacity:disabled': 'Disabled spaces', fee: 'Fee', charge: 'Charge', access: 'Access',
  cuisine: 'Cuisine', diet: 'Diet', 'diet:vegetarian': 'Vegetarian', 'diet:vegan': 'Vegan', outdoor_seating: 'Outdoor seating',
  takeaway: 'Takeaway', delivery: 'Delivery', internet_access: 'Internet access', 'internet_access:fee': 'Internet fee',
  religion: 'Religion', denomination: 'Denomination', 'service_times': 'Service times',
  sport: 'Sport', 'school:type': 'School type', 'isced:level': 'Education level (ISCED)', 'grades': 'Grades',
  emergency: 'Emergency', 'emergency_service': 'Emergency service', beds: 'Beds',
  description: 'Description', note: 'Note', inscription: 'Inscription', 'artist_name': 'Artist', artwork_type: 'Artwork type',
  wikipedia: 'Wikipedia', wikidata: 'Wikidata', wikimedia_commons: 'Wikimedia Commons', image: 'Image', mapillary: 'Mapillary photo',
  ele: 'Elevation', level: 'Floor level', layer: 'Layer (vertical order)', surface: 'Surface', smoothness: 'Smoothness',
  lanes: 'Lanes', 'lanes:forward': 'Lanes forward', 'lanes:backward': 'Lanes backward', maxspeed: 'Speed limit',
  oneway: 'One-way', 'oneway:bicycle': 'One-way for bicycles', lit: 'Street lighting', width: 'Width', est_width: 'Width (estimated)',
  sidewalk: 'Sidewalk', 'sidewalk:both': 'Sidewalk (both sides)', 'sidewalk:left': 'Sidewalk (left)', 'sidewalk:right': 'Sidewalk (right)',
  'sidewalk:surface': 'Sidewalk surface', cycleway: 'Cycleway', 'cycleway:both': 'Cycleway (both sides)',
  'cycleway:left': 'Cycleway (left)', 'cycleway:right': 'Cycleway (right)', 'cycleway:surface': 'Cycleway surface',
  bicycle: 'Bicycles', foot: 'Pedestrians', motor_vehicle: 'Motor vehicles', motorcar: 'Cars', hgv: 'Lorries', bus: 'Buses',
  psv: 'Public service vehicles', segregated: 'Segregated foot/cycle', bicycle_road: 'Bicycle street', cyclestreet: 'Cycle street',
  incline: 'Incline', bridge: 'Bridge', 'bridge:name': 'Bridge name', tunnel: 'Tunnel', junction: 'Junction', ref: 'Reference',
  'parking:lane:both': 'Parking lane', 'parking:both': 'Parking', 'parking:left': 'Parking (left)', 'parking:right': 'Parking (right)',
  crossing: 'Crossing type', 'crossing:markings': 'Crossing markings', tactile_paving: 'Tactile paving', kerb: 'Kerb',
  traffic_calming: 'Traffic calming', 'maxspeed:type': 'Speed-limit type', 'source:maxspeed': 'Speed-limit source',
  leaf_type: 'Leaf type', leaf_cycle: 'Leaf cycle', species: 'Species', 'species:da': 'Species (Danish)', genus: 'Genus',
  circumference: 'Trunk circumference', diameter_crown: 'Crown diameter', denotation: 'Denotation',
  water: 'Water type', waterway: 'Waterway', intermittent: 'Intermittent', salt: 'Salt water', tidal: 'Tidal',
  source: 'Data source', 'source:date': 'Source date', check_date: 'Last checked', survey_date: 'Survey date', fixme: 'Fix-me note',
  'ref:FOT': 'GeoDanmark FOT id', 'ref:bygningsid': 'BBR building id', 'ref:BBR': 'BBR id',
  'contact:housenumber': 'House number', level_ref: 'Level reference', entrance: 'Entrance', door: 'Door',
  'building:roof': 'Roof', 'roof:angle': 'Roof angle', 'building:part:height': 'Part height', colour: 'Colour', material: 'Material',
  power: 'Power', voltage: 'Voltage', generator: 'Generator', 'generator:source': 'Generator source',
  'disused:shop': 'Former shop', 'disused:amenity': 'Former amenity', 'was:amenity': 'Former amenity',
  'payment:cash': 'Cash', 'payment:cards': 'Cards', 'payment:mobilepay': 'MobilePay', 'payment:contactless': 'Contactless',
  'opening_hours:kitchen': 'Kitchen hours', 'happy_hours': 'Happy hours', 'drive_through': 'Drive-through', 'self_service': 'Self service',
  bench: 'Bench', shelter: 'Shelter', bin: 'Waste bin', departures_board: 'Departure board', route_ref: 'Routes',
  'tram': 'Tram', 'train': 'Train', 'light_rail': 'Light rail', platforms: 'Platforms', 'local_ref': 'Local reference',
  'uic_ref': 'UIC station code', 'railway:ref': 'Railway reference', electrified: 'Electrified', gauge: 'Gauge', usage: 'Usage',
  'service': 'Service type', 'maxheight': 'Max height', 'maxweight': 'Max weight', 'maxwidth': 'Max width', toll: 'Toll',
  'name:etymology': 'Named after', 'name:etymology:wikidata': 'Named after (Wikidata)', 'subject:wikidata': 'Subject (Wikidata)',
  'memorial': 'Memorial type', 'tower:type': 'Tower type', 'tower:construction': 'Tower construction'
};

const VALUE_LABELS = {
  yes: 'Yes', no: 'No', limited: 'Limited', designated: 'Designated', permissive: 'Permissive', private: 'Private',
  customers: 'Customers only', destination: 'Destination only', dismount: 'Dismount', use_sidepath: 'Use separate path',
  both: 'Both sides', left: 'Left side', right: 'Right side', separate: 'Mapped separately', none: 'None',
  track: 'Cycle track (separated)', lane: 'Painted cycle lane', shared_lane: 'Shared lane (sharrows)', share_busway: 'Shared bus lane',
  opposite: 'Contraflow allowed', opposite_lane: 'Contraflow lane', asphalt: 'Asphalt', paving_stones: 'Paving stones',
  sett: 'Sett (cobbles)', cobblestone: 'Cobblestone', unhewn_cobblestone: 'Unhewn cobblestone', concrete: 'Concrete',
  'concrete:plates': 'Concrete plates', compacted: 'Compacted gravel', fine_gravel: 'Fine gravel', gravel: 'Gravel', grass: 'Grass',
  ground: 'Ground', dirt: 'Dirt', unpaved: 'Unpaved', paved: 'Paved', wood: 'Wood', metal: 'Metal', sand: 'Sand',
  excellent: 'Excellent', good: 'Good', intermediate: 'Intermediate', bad: 'Bad', very_bad: 'Very bad', horrible: 'Horrible',
  flat: 'Flat', gabled: 'Gabled', hipped: 'Hipped', pyramidal: 'Pyramidal', skillion: 'Skillion (mono-pitch)', dome: 'Dome',
  onion: 'Onion dome', round: 'Round', mansard: 'Mansard', gambrel: 'Gambrel', half_hipped: 'Half-hipped', saltbox: 'Saltbox',
  cone: 'Cone', roof_tiles: 'Roof tiles', slate: 'Slate', tar_paper: 'Tar paper', eternit: 'Fibre cement', glass: 'Glass',
  brick: 'Brick', plaster: 'Plaster', stone: 'Stone', timber_framing: 'Timber framing', broadleaved: 'Broadleaved (deciduous)',
  needleleaved: 'Needleleaved (conifer)', deciduous: 'Deciduous', evergreen: 'Evergreen', zebra: 'Zebra crossing',
  marked: 'Marked crossing', unmarked: 'Unmarked crossing', traffic_signals: 'Traffic signals', uncontrolled: 'Uncontrolled crossing'
};

function humanizeKey(k) {
  if (KEY_LABELS[k]) return KEY_LABELS[k];
  const s = k.replace(/^(contact|addr|name|building|roof|payment|diet|disused|was|source|ref):/, (m, p) => p + ' ')
    .replace(/[:_]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function humanizeValue(k, v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (k === 'height' || k === 'min_height' || k === 'roof:height' || k === 'width' || k === 'est_width' || k === 'ele' || k === 'maxheight' || k === 'maxwidth') {
    const n = parseLength(s);
    return n === null ? s : `${round(n, 1)} m`;
  }
  if (k === 'maxspeed') { const n = parseMaxspeed(s); return n === null ? s : `${n} km/h`; }
  if (k === 'circumference') { const n = parseLength(s); return n === null ? s : `${round(n, 2)} m`; }
  if (k === 'incline') return /%$/.test(s) ? s : s;
  if (/colour$/.test(k)) return s;
  if (s.includes(';')) return s.split(';').map(x => VALUE_LABELS[x.trim()] || prettify(x.trim())).join(', ');
  return VALUE_LABELS[s] || prettify(s);
}

function prettify(s) {
  if (/^https?:\/\//i.test(s) || /^[+\d\s()-]{6,}$/.test(s) || /\s/.test(s) || /[A-ZÆØÅ]/.test(s)) return s;
  return s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

// ------------------------------------------------------------------ grouping for the info panel
const GROUPS = [
  { id: 'identity', label: 'Identity', test: (k) => /^(name|alt_name|old_name|official_name|short_name|loc_name|brand|operator|owner|network|ref|description|inscription|artist_name|artwork_type|memorial|denotation)(:|$)/.test(k) },
  { id: 'address', label: 'Address', test: (k) => /^addr:|^osak:/.test(k) },
  { id: 'building', label: 'Building', test: (k) => /^(building|roof|height|min_height|start_date|construction_date|architect|heritage|listed_status|level|levels|tower:)/.test(k) },
  { id: 'contact', label: 'Contact & opening hours', test: (k) => /^(website|url|phone|email|fax|contact:|opening_hours|service_times|happy_hours)/.test(k) },
  { id: 'access', label: 'Accessibility & access', test: (k) => /^(wheelchair|toilets:wheelchair|access|fee|charge|capacity|tactile_paving|kerb|entrance|door)/.test(k) },
  { id: 'mobility', label: 'Street & mobility', test: (k) => /^(highway|surface|smoothness|lanes|maxspeed|oneway|lit|width|est_width|sidewalk|cycleway|bicycle|foot|motor_vehicle|motorcar|hgv|bus|psv|segregated|bicycle_road|cyclestreet|incline|bridge|tunnel|junction|parking|crossing|traffic_calming|service|maxheight|maxweight|maxwidth|toll|layer)/.test(k) },
  { id: 'nature', label: 'Nature', test: (k) => /^(leaf_|species|genus|circumference|diameter_crown|natural|water|waterway|intermittent|salt|tidal)/.test(k) },
  { id: 'links', label: 'Links & references', test: (k) => /^(wikipedia|wikidata|wikimedia_commons|image|mapillary|brand:wikidata|subject:wikidata|name:etymology)/.test(k) },
  { id: 'source', label: 'Data source', test: (k) => /^(source|check_date|survey_date|fixme|note|ref:)/.test(k) }
];

/** Group tags into labelled sections for display. Returns [{id,label,rows:[{key,label,value,raw}]}]. */
function groupTags(tags) {
  const used = new Set();
  const out = [];
  for (const g of GROUPS) {
    const rows = [];
    for (const [k, v] of Object.entries(tags || {})) {
      if (used.has(k) || !g.test(k)) continue;
      used.add(k);
      rows.push({ key: k, label: humanizeKey(k), value: humanizeValue(k, v), raw: v });
    }
    if (rows.length) out.push({ id: g.id, label: g.label, rows });
  }
  const rest = Object.entries(tags || {}).filter(([k]) => !used.has(k));
  if (rest.length) out.push({ id: 'other', label: 'Other details', rows: rest.map(([k, v]) => ({ key: k, label: humanizeKey(k), value: humanizeValue(k, v), raw: v })) });
  return out;
}

/** "Søndergade 12, 8000 Aarhus C" from addr:* tags. */
function formatAddress(tags) {
  if (!tags) return null;
  const street = tags['addr:street'] || tags['addr:place'];
  const hn = tags['addr:housenumber'];
  const line1 = [street, hn].filter(Boolean).join(' ');
  const line2 = [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' ');
  const s = [line1, line2].filter(Boolean).join(', ');
  return s || null;
}

/** Normalise a website tag to a safe https URL or null. */
function safeUrl(v) {
  if (!v) return null;
  let s = String(v).trim().split(';')[0].trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch { return null; }
}

/** Parse "da:Aarhus Rådhus" -> {lang:'da', title:'Aarhus Rådhus'}. */
function parseWikipedia(v) {
  if (!v) return null;
  const m = String(v).match(/^([a-z-]{2,12}):(.+)$/);
  if (m) return { lang: m[1], title: m[2].trim() };
  return { lang: 'en', title: String(v).trim() };
}

module.exports = {
  parseNumber, parseLength, parseLevels, parseMaxspeed, parseColour, NAMED_COLOURS, MATERIAL_COLOURS,
  KEY_LABELS, VALUE_LABELS, humanizeKey, humanizeValue, groupTags, formatAddress, safeUrl, parseWikipedia
};
