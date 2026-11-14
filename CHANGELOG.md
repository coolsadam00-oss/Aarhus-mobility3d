# Changelog

## 2.1.0 – reviewed release

The result of two review rounds; details are in [REVIEW.md](REVIEW.md).

**Lighting and realism**
- **Night street lighting.** Mapped and illustrative lamps light streets, sidewalks and the facades facing them through a lamp light map (cos³ fall-off, albedo-correct, glossy on wet streets). This replaces the additive light-pool decals.
- **Lit windows** follow the hour of the day, in warm, neutral or screen-blue colours. Rooms are brighter at the ceiling, some curtains are drawn, and shop windows are lit.
- **Calibrated daylight.** A CPU copy of the sky model sets ambient strength, sky brightness under heavy cloud, haze colour (the sky at the horizon where you look) and a metered exposure. The sun disc no longer lights the scene twice.
- **Blue hour.** Twilight gives a deep blue sky with an orange band towards the set sun. Stars appear only after nautical dusk.
- **Bloom** only catches genuinely bright things. Ambient occlusion fades at night.
- **Materials.** Glass is a dielectric, aged asphalt is grey rather than black, and car paint is clear-coated. NetAScore overlay colours are brighter.

**Precision**
- **Sidewalks, cycle tracks and curbs** stop at the curb line of crossing streets instead of running across junctions.
- **Duplicate building footprints** are merged when a pack is built and when it is loaded, keeping the better-described twin.
- **Building walls get a tiny building-specific offset**, so overlapping footprints no longer flicker (z-fighting).
- **No more stippled windows.** The per-building seed is snapped in the shader, so hash-based choices no longer flip per pixel.
- **Portable GLSL.** No `smoothstep` with reversed edges, which is undefined on some GPUs.
- **Illustrative lamps** only fill gaps between mapped lamps, never inside buildings or in the middle of a crossing street.

**Movement and interaction**
- **Collisions** handle terraced blocks with shared walls: no more getting stuck, escaping to the nearest free spot, scraping along walls with bikes and cars, and clipped chase cameras.
- **Spawning** takes the first sidewalk or lane that is clear of buildings and re-checks once buildings have loaded.
- **Keyboard focus** returns to the 3D view when entering it and when the info panel closes. `Esc` closes the info panel. `R` puts you back on the street.
- **Inspection.** Trees and street furniture can be inspected again; a picking filter had excluded them.
- **Labels** are decluttered on screen and hidden only by *other* buildings. They render from their own small scene.
- **Settings.** A new toggle switches street lighting on or off.

**Performance and robustness**
- **Ray tests** (crosshair, clicks, label occlusion) use lazily built bounding-volume hierarchies (`three-mesh-bvh`).
- **The lamp light map** is splatted from a precomputed stamp.
- **The loading card** hides once the surroundings are ready (≤ 380 m), or after 25 s.
- **Statistics.** `renderer.info` counts the whole frame.
- **GPU resets.** After a reset (WebGL context loss) the 3D view restores itself.

**Tests**
- Unit tests grew to 32: collisions in terraced blocks, the lamp light map, lit windows, the sky model, sidewalk cutting, wall offsets and duplicate footprints.
- The end-to-end test now does the following:
  - sets the time explicitly;
  - takes screenshots in sync with rendered frames;
  - holds keys for simulated seconds;
  - adds night-street and night-rain scenes;
  - checks that bike and drive modes really move.

## 2.0.0 – realistic city

- **3D explore mode.** A streamed three.js city with terrain, aerial photos, procedural facades and roofs, detailed streets, rails, water, trees, furniture and traffic, plus walk, bike, drive and fly modes, HUD, minimap and labels.
- **Building and place classification.** 582 kinds in EN and DA, with confidence levels, measured heights and roof shapes. The info panel shows addresses, opening hours, links, Wikipedia and Wikidata.
- **OSM city packs.** Download in-app (Overpass with tiling, retries and fail-over) with a full download log. A bundled offline GeoDanmark starter set comes with the app.
- **Sky.** Real sun position, five kinds of weather, seasons, clouds, rain and night lights.
- **Settings and help.** A settings window (quality presets, everything switchable), search (offline plus Nominatim), screenshots and an activity log.

## 1.0.0 – first release

- **Map.** MapLibre 3D map of Aarhus with DEM terrain, OSM buildings, water and green spaces.
- **NetAScore.** Bikeability and walkability colours, GeoJSON and GeoPackage import, and a segment panel with slope profile and score breakdown.
- **Feedback.** Comments stored in SQLite with CSV and GeoJSON export. Delivered as a portable Windows exe.
