# Aarhus Mobility 3D

A Windows desktop app that rebuilds Aarhus, Denmark, as a realistic 3D city you can walk, bike, drive and fly through. Every street is coloured by its **NetAScore** bikeability or walkability. Look at any building, street, shop, tree or lamp and the app tells you what it is, and you can leave feedback on it. Comments stay on your PC in a local SQLite database and can be exported as CSV or GeoJSON.

| | |
|---|---|
| **Map view** | 2D/3D map (MapLibre) with satellite, hybrid or street basemaps and terrain. Buildings can be coloured *realistic*, *by type* ("what is what"), *by height* or *by data source*. Also shown: NetAScore street colours, places, feedback pins and right-click "Explore in 3D here". |
| **3D explore** | A streamed 3D city: terrain, aerial photos, buildings with procedural facades, windows and roofs, streets with lanes, sidewalks, cycle tracks, curbs and zebra crossings, rails, water, trees, street furniture and traffic. Walk, bike (hills matter), drive or fly. The sun, sky, haze and twilight follow the real sun position for any time; there are 5 kinds of weather and lit windows and street lights at night. |
| **What is what** | The type of 582 kinds of buildings and places (EN + DA), with a confidence for each: tagged in OSM, inferred from name or surrounding area, or not mapped. Each building also has its address, floors, height and where the height comes from, plus its roof, opening hours, website, Wikipedia and Wikidata facts, and links to OSM, Street View and Mapillary. |
| **Data** | A bundled offline starter set (GeoDanmark buildings with surveyed heights, roads and DEM for central Aarhus). Fuller **OpenStreetMap city packs** can be downloaded in-app for Aarhus C, the inner city or Greater Aarhus. Every download is logged with its queries, sizes and timings. |
| **Feedback** | Category, severity, mode and free text for any street segment, building, place or point, each with a timestamp, pinned on the map and in 3D. Comments export to CSV or GeoJSON. |

---

## 1. Quick start

1. Run `AarhusMobility3D-2.1.0-portable.exe`. No installation and no admin rights are needed.
   * Windows SmartScreen may warn the first time, because the build is unsigned. Choose *More info → Run anyway*.
   * To keep all data next to the exe (for a USB stick), create a folder named `AarhusMobility3D-data` beside it.
2. The map opens on the bundled starter data. Press **📦 Data → Download** and choose *Aarhus C – city centre* to get full OSM detail: building types, shops, lamps, trees, addresses. This takes about 20–60 s.
3. Press **🎮 3D Explore**, or right-click the map → *Explore in 3D here*. Click into the view to look around with the mouse.
4. Press **⚙️** for quality (Low → Ultra), what to show, labels, time, weather and season. **F1** shows all controls.

Requirements: Windows 10/11 x64 and a GPU with WebGL 2, which almost any GPU from 2014 onwards has. An internet connection is used for aerial photos, terrain tiles, city-pack downloads and lookups. Everything already downloaded keeps working offline.

## 2. Controls

| Key | 3D explore |
|---|---|
| `W A S D` / arrows | walk · pedal & steer · drive & steer · fly |
| Mouse (click view first) | look around |
| `Shift` / `Space` / `Ctrl`,`Q` | run, boost · jump, handbrake, fly up · fly down |
| `1` `2` `3` `4` | Walk · Bike · Drive · Fly |
| `C` | camera: first person ↔ third person / cockpit ↔ chase |
| `E` or left click | inspect what is under the crosshair |
| `F` | leave feedback on the street / building in front of you |
| `L` · `N` · `M` · `H` | labels · NetAScore colours (off → bike → walk) · minimap · HUD |
| `T` / `Shift+T` · `Y` | time +1 h / −1 h · next weather |
| `R` | back on the street (nearest road, facing along it) |
| `Esc` | release the mouse / pause · close the info panel |
| `F12` · `Ctrl+F` | screenshot · search & teleport |
| Gamepad | left stick move/steer, right stick look, RT/LT throttle/brake, D-pad mode, Y inspect |

On the map, left click gives information, right click gives *Explore in 3D here / What's here? / Copy coordinates*, and Ctrl+drag rotates and tilts. `Ctrl+1` / `Ctrl+2` switch view and `Ctrl+D` opens city data.

## 3. How realistic and how precise is it?

**Geometry.**
* **Footprints.** Building footprints come from OSM or GeoDanmark.
* **Heights.** The height of each building comes from, in order of preference:
  1. the OSM `height` tag;
  2. its number of floors;
  3. a GeoDanmark roof survey (median roof height minus ground);
  4. an estimate.

  The info panel shows which one was used.
* **Building parts.** OSM *Simple 3D Buildings* parts replace their outline.
* **Duplicates.** Duplicate footprints are merged.
* **Streets.** Streets follow the OSM centre-line with the tagged or typical width. Lane markings come from tags and fade at junctions. Sidewalks and cycle tracks follow the tags, follow Danish street layout when untagged, and stop at the curb line of crossing streets.
* **Bridges.** Bridges get decks and parapets.
* **Terrain.** Terrain comes from a 5 m grid (GeoDanmark, gap-filled), blended into AWS Terrain Tiles outside it. Geodesy uses the WGS84 ellipsoid.

**Light.**
* **Sun.** The sun is computed for Aarhus (SunCalc formulas, about 0.1° accuracy). Shadows follow the camera.
* **Sky light.** The sky's own light is calibrated against a CPU copy of the sky model, so a clear day has crisp sunlit facades. Overcast and rain are grey and soft, and the haze is the sky's colour at the horizon where you look.
* **Night and dusk.** Twilight brings the blue hour. At night, lamps light streets and facades: real OSM lamps, plus illustrative ones only where gaps are mapped. Windows light up by the hour of the day.
* **Materials.** Brick, plaster, concrete panels, metal and glass curtain walls, roof tiles and seams, and green roofs are drawn procedurally. Asphalt, pavers, setts, slabs, gravel, rails and water each have their own physically based surface. Streets look wet in rain.

**Honest about gaps.** The following are drawn to look plausible and are marked as illustrative in the app:
* street lamps added in gaps between mapped lamps;
* sidewalks on untagged streets;
* park trees;
* traffic.

Where OSM has no building type, the app says *Type not mapped* and does not guess.

## 4. Data sources & licences

| Data | Source | Licence / terms |
|---|---|---|
| Buildings, streets, places, furniture, trees, addresses | OpenStreetMap via Overpass API | © OpenStreetMap contributors, ODbL |
| Starter set: buildings with surveyed roof heights, roads, 5 m terrain | GeoDanmark FOT 2016 (Aarhus CityPulse dataset) | GeoDanmark terms / dataset licence (MIT for the CityPulse package) |
| Terrain outside the grid | AWS Terrain Tiles (Terrarium) | Mapzen / AWS open data, various sources |
| Aerial photos (3D ground, map satellite) | Esri World Imagery | Esri terms of use, attribution shown in-app |
| Vector basemap | OpenFreeMap (OpenMapTiles schema) | © OpenMapTiles, © OSM contributors |
| Search & reverse geocoding | Nominatim | OSM Foundation usage policy (max. 1 request/s, which the app enforces) |
| Descriptions, photos, facts | Wikipedia REST API, Wikidata | CC BY-SA / CC0 |
| Street scores | NetAScore (TU Wien / Plus), or the built-in *NetAScore-lite* approximation from OSM tags | per dataset |

You can switch online lookups off in ⚙️ → *Privacy & data*. Lookups send only the clicked coordinate or search text, never your comments. Downloaded packs and the lookup cache live in `%APPDATA%\Aarhus Mobility 3D\`, or in `AarhusMobility3D-data\` next to the exe if that folder exists.

## 5. Architecture

```
┌───────────────────────────── AarhusMobility3D.exe (Electron 45) ───────────────────────────────┐
│ Main process (Node 24)                                   Renderer (Chromium, context-isolated)  │
│  electron/main.js      window, menu, IPC, am3d:// protocol  renderer/src/main.js   boot, views   │
│  electron/db.js        node:sqlite – comments, settings,    renderer/src/map/*     MapLibre map  │
│                        lookup cache, activity log           renderer/src/explore/* three.js city │
│  electron/citypack.js  Overpass download → city pack        renderer/src/ui/*      search, data, │
│  electron/citypack-convert.js  classify, heights, addresses                         settings, help│
│  electron/overpass.js  retries, fail-over, progress     ◄─IPC─► preload.js (window.mobility)      │
│  electron/lookup.js    Nominatim / Wikipedia / Wikidata                                           │
│  shared/*  tags, classification (582 kinds), geodesy, NetAScore-lite, de-duplication (Node+web)  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The **3D engine** lives in `renderer/src/explore/`:

| Module | Role |
|---|---|
| `explorer.js` | Renderer, post-processing (MSAA, optional GTAO, calibrated bloom), the main loop, inspection and feedback |
| `worlddata.js` | Local metric frame, 250 m chunk bins, junctions and crossing widths, the street graph |
| `chunks.js` | Streaming by distance with level of detail. Each chunk has ground (terrain + aerial photo), buildings and detail (streets, sidewalks, rails, water, barriers, trees, furniture), built in time slices |
| `builders/*.js` | Pure geometry, unit-tested: walls, roofs (flat, gabled, hipped, pyramidal, skillion, dome), parapets, courtyards, ribbons, curbs, zebras, terrain |
| `materials.js` | Shader-injected PBR materials: facades, roofs, roads, terrain, water, foliage |
| `sky.js`, `skymodel.js`, `sun.js` | Sun and moon, Sky.js with clouds and twilight, calibrated ambient light, haze and exposure, rain and wetness |
| `lamps.js` | Night street-lighting light map (cos³ lamp fall-off, direction to the lamp) |
| `physics.js` | Building collisions: slide along walls, block moves into footprints, escape terraced blocks |
| `player.js`, `vehicles.js`, `traffic.js` | Walk, bike, car and fly physics, vehicles, agents on the street graph |
| `hud.js`, `labels.js`, `bvh.js` | HUD, minimap and compass; decluttered, occlusion-tested labels; BVH-accelerated ray tests |

**City packs** (`%APPDATA%\…\citypacks\<id>\`) are plain GeoJSON layers plus a manifest. The manifest records the area, the time of the OSM data, every query with its endpoint, bytes, elements and time, and statistics. Packs are served to the renderer through the privileged `am3d://` protocol. The renderer has no file system or Node access; everything else goes through the `window.mobility` IPC API.

## 6. NetAScore data

* **Import.** Use *Map → NetAScore data → Import .geojson / .gpkg*. A GeoPackage is read directly, as an SQLite file with its geometry decoded in `gpkg.js`. Any CRS listed in `gpkg_spatial_ref_sys` is reprojected with proj4, with EPSG 25832/32632/3857 built in. Scores `index_bike_ft/tf` and `index_walk_ft/tf` are averaged per segment. OSM way ids link comments to streets.
* **Batch conversion.** To convert a NetAScore output once into a lighter GeoJSON, run `npm run convert -- input.gpkg output.geojson`.
* **Without NetAScore data.** Streets in city packs get *NetAScore-lite* scores from OSM tags (cycle infrastructure, speed, lanes, surface, lighting, sidewalks). The app marks these as approximate.

## 7. Build from source

```bash
npm install                 # Node 20+; downloads Electron
npm start                   # build the renderer bundle and run the app
npm test                    # 5 smoke + 12 data + 15 render unit tests
npm run dist                # renderer bundle + Windows portable exe → dist/
npm run dist:installer      # NSIS installer instead
```

* **Building on Linux or macOS.** Cross-building the Windows exe works; electron-builder needs Wine only for embedding the icon and version info. Without Wine, set `"win": { "signAndEditExecutable": false }`.
* **End-to-end test.** The test runs the real app fully offline under a virtual display, with fake Overpass, Nominatim and tile servers, and writes screenshots and a JSON report to `$E2E_OUT`:

  ```bash
  xvfb-run -a -s "-screen 0 1600x1000x24" ./node_modules/electron/dist/electron test/e2e/run.js \
    --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist
  ```
* **Rebuilding the starter data.** Run `npm run build-starter` against the GeoDanmark/CityPulse KML files.

## 8. Troubleshooting

* **3D is slow.** Use ⚙️ → Quality *Low* or *Medium* and shorten the view distance. On laptops, make sure the app runs on the dedicated GPU (Windows Settings → Display → Graphics). Ambient occlusion is only on in *Ultra*.
* **No aerial photos or terrain.** You are offline or the tile service is blocked. The ground then falls back to a drawn land-use map; everything else still works.
* **Download failed.** Overpass servers are busy at times. The app retries and switches servers, and the Data window shows the full log. Try a smaller area.
* **Where are my comments?** Use *Map → Feedback → Export*, or open `%APPDATA%\Aarhus Mobility 3D\feedback.sqlite` with any SQLite tool.

See [REVIEW.md](REVIEW.md) for the two review rounds (what was checked, found and fixed) and [CHANGELOG.md](CHANGELOG.md) for versions.
