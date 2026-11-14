// MapLibre base style: satellite / hybrid / streets basemaps, terrain, hillshade, sky.
import { TERRARIUM_URL } from '../heightfield.js';

export const AARHUS = { center: [10.2039, 56.1555], zoom: 15.2, pitch: 60, bearing: -24 };

// layer groups toggled by the basemap switch
export const BASEMAP_LAYERS = {
  satellite: ['satellite'],
  vector: ['landuse-residential', 'landuse-commercial', 'landcover-wood', 'landcover-grass', 'park', 'landuse-green', 'water', 'waterway', 'road-base', 'rail'],
  hybridRoads: ['road-hybrid'],
  streetLabels: ['street-labels']
};

export function buildStyle(customImagery) {
  const font = ['Noto Sans Regular'];
  const imagery = customImagery && /^https:\/\/.+\{z\}.+\{x\}.+\{y\}|^https:\/\/.+\{z\}.+\{y\}.+\{x\}/.test(customImagery)
    ? customImagery : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  return {
    version: 8,
    name: 'Aarhus realistic',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>' },
      dem: { type: 'raster-dem', tiles: [TERRARIUM_URL], tileSize: 256, maxzoom: 15, encoding: 'terrarium', attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">AWS Terrain Tiles</a> · GeoDanmark' },
      'dem-hillshade': { type: 'raster-dem', tiles: [TERRARIUM_URL], tileSize: 256, maxzoom: 15, encoding: 'terrarium' },
      satellite: { type: 'raster', tiles: [imagery], tileSize: 256, maxzoom: 19, attribution: customImagery ? 'Custom imagery' : 'Imagery © Esri, Maxar, Earthstar Geographics' }
    },
    terrain: { source: 'dem', exaggeration: 1.3 },
    sky: {
      'sky-color': '#6fa6dc', 'horizon-color': '#d6e6f5', 'fog-color': '#e3ecf5',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.55, 'fog-ground-blend': 0.2,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 12, 0.6, 16, 0.15]
    },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.38, position: [1.4, 210, 35] },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e9e6df' } },
      { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-saturation': -0.05, 'raster-contrast': 0.06, 'raster-fade-duration': 150 } },
      { id: 'landuse-residential', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]], paint: { 'fill-color': '#e3dfd6', 'fill-opacity': 0.7 } },
      { id: 'landuse-commercial', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['commercial', 'retail', 'industrial', 'railway']]], paint: { 'fill-color': '#e2dbd6', 'fill-opacity': 0.6 } },
      { id: 'landcover-wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': '#8fbf7f', 'fill-opacity': 0.85 } },
      { id: 'landcover-grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['grass', 'farmland', 'wetland', 'scrub']]], paint: { 'fill-color': '#b8d8a0', 'fill-opacity': 0.75 } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#a9d394', 'fill-opacity': 0.75 } },
      { id: 'landuse-green', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['cemetery', 'pitch', 'stadium', 'playground', 'garden']]], paint: { 'fill-color': '#bfe0aa', 'fill-opacity': 0.7 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#6fa8dc', 'fill-opacity': 0.92 } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': '#6fa8dc', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 17, 5] } },
      { id: 'hillshade', type: 'hillshade', source: 'dem-hillshade', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#4a4a52', 'hillshade-highlight-color': '#ffffff' } },
      { id: 'road-base', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['!', ['in', ['get', 'class'], ['literal', ['rail', 'transit', 'ferry']]]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-opacity': 0.6, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.5, 16, 4, 19, 16] } },
      { id: 'road-hybrid', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']]], layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': '#fff4c2', 'line-opacity': 0.35, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.6, 16, 2.5, 19, 8] } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#8b8b95', 'line-width': 1.2, 'line-dasharray': [3, 2] } },
      { id: 'building-ofm', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13,
        paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, '#d9d3c7', 15, '#cfc7b8', 40, '#bdb4a3', 100, '#a59b8a'],
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, ['coalesce', ['get', 'render_height'], 8]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.9, 'fill-extrusion-vertical-gradient': true } },
      { id: 'street-labels', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 15,
        layout: { 'text-field': ['coalesce', ['get', 'name:da'], ['get', 'name']], 'text-font': font, 'text-size': 11.5, 'symbol-placement': 'line', 'text-letter-spacing': 0.03 },
        paint: { 'text-color': '#1d232b', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.4 } },
      { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name', layout: { 'text-field': ['coalesce', ['get', 'name:da'], ['get', 'name']], 'text-font': font, 'text-size': 13 }, paint: { 'text-color': '#2f5f8a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } },
      { id: 'place-labels', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'quarter', 'neighbourhood', 'village']]],
        layout: { 'text-field': ['coalesce', ['get', 'name:da'], ['get', 'name']], 'text-font': font, 'text-size': ['match', ['get', 'class'], 'city', 18, 'town', 15, 13], 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 },
        paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.65)', 'text-halo-width': 1.6 } }
    ]
  };
}
