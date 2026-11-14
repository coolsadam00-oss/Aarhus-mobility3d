'use strict';
/**
 * End-to-end test of the real app (Electron main + renderer), fully offline:
 *   xvfb-run -a -s "-screen 0 1600x1000x24" ./node_modules/electron/dist/electron test/e2e/run.js --no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader
 * Screenshots and a JSON report are written to $E2E_OUT (default /tmp/e2e).
 */
const { app, protocol, nativeImage } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fx = require('./fixtures');

const ROOT = path.join(__dirname, '..', '..');
const OUT = process.env.E2E_OUT || '/tmp/e2e';
const STARTER = path.join(ROOT, 'data', 'starter');
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const report = { steps: [], console: [], errors: [], overpass: {} };
const log = (...a) => { console.log('[e2e]', ...a); };

const els = fx.buildFixtures(STARTER);
log('fixtures:', Object.fromEntries(Object.entries(els).map(([k, v]) => [k, v.length])));
const dem = fx.demSampler(STARTER);
const aerial = fx.aerialTileFactory(STARTER, els);

// ---------------------------------------------------------------- fake Overpass + Nominatim
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/interpreter') {
      const q = decodeURIComponent((body.split('data=')[1] || '').replace(/\+/g, ' '));
      const json = fx.answer(els, q, report.overpass);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    } else if (u.pathname === '/nominatim/search') {
      const q = u.searchParams.get('q') || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ lat: '56.1530', lon: '10.2050', display_name: `${q}, Aarhus C, 8000, Danmark`, name: q, category: 'highway', type: 'pedestrian', osm_type: 'way', osm_id: 123, namedetails: { name: q } }]));
    } else if (u.pathname === '/nominatim/reverse') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'Testadresse', display_name: 'Søndergade 12, 8000 Aarhus C, Danmark', category: 'building', type: 'apartments', osm_type: 'way', osm_id: 500000001, address: { road: 'Søndergade', house_number: '12' } }));
    } else { res.writeHead(404); res.end(); }
  });
});

const tileCache = new Map();
function png(key, make) {
  if (!tileCache.has(key)) tileCache.set(key, nativeImage.createFromBitmap(make(), { width: 256, height: 256 }).toPNG());
  return tileCache.get(key);
}

// fixed port so env vars exist before main.js is required (it must load before app 'ready')
const PORT = Number(process.env.E2E_PORT || 47911);
process.env.AM3D_OVERPASS_URL = `http://127.0.0.1:${PORT}/api/interpreter`;
process.env.AM3D_NOMINATIM_URL = `http://127.0.0.1:${PORT}/nominatim`;
process.env.AM3D_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'am3d-e2e-'));
log('data dir', process.env.AM3D_DATA_DIR);
server.listen(PORT, '127.0.0.1');

app.whenReady().then(() => {
  protocol.handle('https', (request) => {
    const u = new URL(request.url);
    let m;
    if (u.hostname === 's3.amazonaws.com' && (m = u.pathname.match(/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/))) {
      const [z, x, y] = m.slice(1).map(Number);
      return new Response(png(`t${z}/${x}/${y}`, () => fx.terrariumTile(dem, z, x, y)), { headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } });
    }
    if (u.hostname === 'server.arcgisonline.com' && (m = u.pathname.match(/tile\/(\d+)\/(\d+)\/(\d+)/))) {
      const [z, y, x] = m.slice(1).map(Number);
      return new Response(png(`a${z}/${x}/${y}`, () => aerial(z, x, y)), { headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response('offline in test', { status: 404 });
  });
});
app.on('browser-window-created', (_e, w) => {
  const wc = w.webContents;
  wc.setBackgroundThrottling(false); // xvfb windows count as hidden; keep requestAnimationFrame running
  wc.on('console-message', (e) => { const entry = { level: e.level, msg: String(e.message).slice(0, 400) }; report.console.push(entry); if (e.level === 'error') log('console error:', entry.msg); });
  wc.on('render-process-gone', (_ev, d) => { report.errors.push('renderer gone: ' + JSON.stringify(d)); });
  wc.once('did-finish-load', () => scenario(w).catch(err => { report.errors.push('scenario: ' + (err && err.stack || err)); finish(); }));
});
require(path.join(ROOT, 'electron', 'main.js'));

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let win = null;
const js = (code) => win.webContents.executeJavaScript(code, true);
async function waitFor(code, timeout = 60000, every = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { if (await js(code)) return true; } catch { /* page busy */ } await sleep(every); }
  return false;
}
let shotN = 0;
/** Let the 3D view render a few more frames (software GL can take a second per frame after a change). */
async function settle(frames = 3, timeout = 20000) {
  const f0 = await js("window.__am3dExplorer && window.__am3dExplorer.active ? window.__am3dExplorer.frameNo : -1");
  if (f0 < 0) return;
  await waitFor(`window.__am3dExplorer.frameNo >= ${f0 + frames}`, timeout, 100);
}
/** Hold a key for `simSeconds` of simulated time (frame-rate independent). */
async function holdKey(code, simSeconds, extra = []) {
  const kc = (c) => c.replace(/^Key|^Digit/, '');
  const t0 = await js('window.__am3dExplorer.simTime');
  for (const c of [code, ...extra]) win.webContents.sendInputEvent({ type: 'keyDown', keyCode: kc(c) });
  await waitFor(`window.__am3dExplorer.simTime >= ${t0 + simSeconds}`, 60000, 50);
  for (const c of [code, ...extra]) win.webContents.sendInputEvent({ type: 'keyUp', keyCode: kc(c) });
}
async function shot(name) {
  await settle();
  await sleep(150);
  const img = await win.webContents.capturePage();
  const f = path.join(OUT, 'shots', `${String(++shotN).padStart(2, '0')}-${name}.png`);
  fs.writeFileSync(f, img.toPNG());
  return f;
}
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ok = r !== false && !(r && typeof r === 'object' && !Array.isArray(r) && (r.ok === false || r.error));
    report.steps.push({ name, ok, ms: Date.now() - t0, detail: r });
    log(ok ? '✔' : '✗', name, typeof r === 'object' ? JSON.stringify(r).slice(0, 300) : (r === undefined ? '' : r));
  } catch (e) {
    report.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e && e.stack || e) });
    log('✗', name, e && e.message);
  }
}
async function key(code, holdMs = 0) {
  const keyCode = code.replace(/^Key|^Digit/, '');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  if (holdMs) await sleep(holdMs);
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
}
async function click(x, y) {
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(30);
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}
function finish() {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const failed = report.steps.filter(s => !s.ok).length;
  log(`done: ${report.steps.length - failed}/${report.steps.length} steps ok, ${report.console.filter(c => c.level === 'error').length} console errors, ${report.errors.length} fatal`);
  setTimeout(() => app.exit(failed || report.errors.length ? 1 : 0), 200);
}

// ---------------------------------------------------------------- scenario
async function scenario(w) {
  win = w;
  win.setSize(1600, 1000);
  await step('boot with built-in GeoDanmark starter data', async () => {
    const ok = await waitFor("window.__am3d && document.querySelector('#loading').classList.contains('hidden') && window.__am3d.cityData.layer('buildings').length > 7000", 90000);
    if (!ok) return false;
    return js("({ buildings: __am3d.cityData.layer('buildings').length, roads: __am3d.cityData.layer('roads').length, trees: __am3d.cityData.layer('trees').length, demGrid: !!document })");
  });
  await sleep(3000);
  await step('map view screenshot (starter)', async () => shot('map-starter'));

  await step('download OpenStreetMap city pack through the Data window', async () => {
    await js("document.querySelector('#btn-data').click()");
    await waitFor("document.querySelector('.modal [data-tab=download]')");
    await js("document.querySelector('.modal [data-tab=download]').click()");
    await waitFor("document.querySelector('[data-preset=aarhus-c]')");
    await shot('data-window');
    await js("document.querySelector('[data-preset=aarhus-c]').click()");
    const ok = await waitFor("__am3d.cityData.manifest && __am3d.cityData.manifest.source === 'osm' && !document.querySelector('#loading:not(.hidden)')", 120000);
    if (!ok) return false;
    return js("({ name: __am3d.cityData.manifest.name, layers: Object.fromEntries(Object.entries(__am3d.cityData.manifest.layers).map(([k,v]) => [k, v.count])), stats: __am3d.cityData.manifest.stats.buildings })");
  });

  await step('building classification & measured heights in the pack', async () => js(`(() => {
    const b = __am3d.cityData.layer('buildings');
    const by = (k) => b.filter(f => f.properties[k]).length;
    const kinds = {}; for (const f of b) kinds[f.properties.lbl] = (kinds[f.properties.lbl] || 0) + 1;
    const uni = b.filter(f => f.properties.cf === 'context' && /University/.test(f.properties.lbl)).length;
    return { total: b.length, withAddress: by('a'), measured: b.filter(f => f.properties.hs === 'g').length, contextUniversity: uni, topKinds: Object.entries(kinds).sort((a, c) => c[1] - a[1]).slice(0, 8) };
  })()`));

  await step('map: colour buildings by type and click one', async () => {
    await js("__am3d.settings.set({ mapBuildingColors: 'type' }); __am3d.map.jumpTo({ center: [10.2045, 56.1545], zoom: 17.3, pitch: 55, bearing: -20 }); true");
    await sleep(4000);
    const pt = await js(`(() => {
      const map = __am3d.map; const r = map.getCanvas().getBoundingClientRect();
      const feats = map.queryRenderedFeatures({ layers: ['pack-buildings'] });
      // a building whose centre is on screen (not under the side panel) and is the top feature there
      for (const f of feats) {
        const b = __am3d.cityData.byId.get(f.properties.id);
        if (!b) continue;
        const p = map.project(b.properties.centroid);
        if (p.x < 380 || p.x > r.width - 60 || p.y < 140 || p.y > r.height - 80) continue;
        const top = map.queryRenderedFeatures([p.x, p.y]).filter(x => x.layer.type !== 'symbol')[0];
        if (!top || top.layer.id !== 'pack-buildings' || top.properties.id !== f.properties.id) continue;
        return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y), id: f.properties.id, n: feats.length };
      }
      return null;
    })()`);
    if (!pt) return false;
    await click(pt.x, pt.y);
    await waitFor("!document.querySelector('#panel').classList.contains('hidden')", 8000);
    await sleep(500);
    await shot('map-building-info');
    return js("(() => { const h = document.querySelector('#panel:not(.hidden) h2'); if (!h) return false; const k = document.querySelector('#panel .kind-line b'); return { title: h.textContent, kind: k ? k.textContent : null, facts: [...document.querySelectorAll('#panel .fact span')].map(e => e.textContent).slice(0, 8) }; })()");
  });

  await step('search: offline city data + online (Enter)', async () => {
    await js("const s = document.querySelector('#search'); s.focus(); s.value = 'Søndergade'; s.dispatchEvent(new Event('input'));");
    await waitFor("document.querySelectorAll('#search-results .sr[data-i]').length > 0", 8000, 100); // debounced; slow under software GL
    const local = await js("document.querySelectorAll('#search-results .sr[data-i]').length");
    await js("document.querySelector('#search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
    await waitFor("[...document.querySelectorAll('.sr-h')].some(h => /online/.test(h.textContent) && !/Press Enter/.test(h.textContent))", 8000);
    const total = await js("document.querySelectorAll('#search-results .sr[data-i]').length");
    await shot('search');
    await js("document.querySelector('#search-results .sr[data-i]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))");
    await sleep(800);
    return { local, total, panel: await js("document.querySelector('#panel h2') && document.querySelector('#panel h2').textContent") };
  });

  await step('3D explore: enter and build the world', async () => {
    // daylight for the first screenshots (the real clock may be after sunset)
    await js("__am3d.settings.set({ timeMode: 'manual', timeOfDay: 13 }); document.querySelector('#panel-close').click(); __am3d.map.jumpTo({ center: [10.2045, 56.1545] }); document.querySelector('#topbar .views .seg[data-view=explore]').click(); true");
    const ok = await waitFor("document.body.classList.contains('explore') && window.__am3dExplorer && window.__am3dExplorer.active && !window.__am3dExplorer.loadingWanted", 120000, 500);
    const st = await js("(async () => { const ex = await __am3d.getExplorer(); return { chunks: ex.chunks.chunks.size, buildings: ex.chunks.stats.buildings, mode: ex.player.mode, e: Math.round(ex.player.e), n: Math.round(ex.player.n), imagery: [...ex.chunks.chunks.values()].filter(c => c.imagery).length } })()");
    await js("document.querySelector('.pause').classList.add('hidden')");
    await sleep(1500);
    await shot('explore-walk');
    return ok ? st : false;
  });

  await step('walk forward with W (keyboard input)', async () => {
    const a = await js("(async () => { const ex = await __am3d.getExplorer(); return [ex.player.e, ex.player.n]; })()");
    await holdKey('KeyW', 2.5);
    await settle(2);
    const b = await js("(async () => { const ex = await __am3d.getExplorer(); return [ex.player.e, ex.player.n]; })()");
    const moved = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return moved > 1 ? { moved: Number(moved.toFixed(2)) } : false;
  });

  await step('walls block walking (collision)', async () => js(`(async () => {
    const ex = await __am3d.getExplorer();
    // find the nearest building and walk into it
    let best = null, bd = 1e9;
    for (const ch of ex.chunks.chunks.values()) for (const f of ch.buildRefs || []) { const d = Math.hypot(f._c[0] - ex.player.e, f._c[1] - ex.player.n); if (d < bd && !f.properties.part) { bd = d; best = f; } }
    if (!best) return false;
    const p = ex.player;
    p.setMode('walk');
    p.place(best._c[0] + 0, best._c[1] + 0, 0); // place inside: collision resolver must push us out
    const inside = () => ex.colliders.ringsNear(p.e, p.n, 1).some(r => r.length > 2 && (function(pt, r){ let c=false; for (let i=0,j=r.length-1;i<r.length;j=i++){ const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1]; if(((yi>pt[1])!==(yj>pt[1]))&&(pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)) c=!c; } return c; })([p.e,p.n], r));
    const out = !inside();
    const dist = Number(Math.hypot(p.e - best._c[0], p.n - best._c[1]).toFixed(1));
    // then walk straight at the building for 3 s: we must stay outside
    p.yaw = Math.atan2(best._c[0] - p.e, best._c[1] - p.n); p.pitch = 0;
    for (let i = 0; i < 180; i++) p.update(1 / 60, { keys: new Set(['KeyW']), mouseDX: 0, mouseDY: 0, pad: null });
    const stillOut = !inside();
    return out && stillOut ? { pushedOut: out, stayedOutside: stillOut, distanceToCentroid: dist } : false;
  })()`));

  await step('inspect the building in view (E)', async () => {
    await js(`(async () => {
      const ex = await __am3d.getExplorer(); const p = ex.player;
      ex.placeAt(10.2045, 56.1545, 0);
      let best = null, bd = 1e9;
      for (const ch of ex.chunks.chunks.values()) for (const f of ch.buildRefs || []) { const d = Math.hypot(f._c[0] - p.e, f._c[1] - p.n); if (d > 8 && d < bd) { bd = d; best = f; } }
      p.yaw = Math.atan2(best._c[0] - p.e, best._c[1] - p.n); p.pitch = 0.05;
      window.__target = best.id;
    })()`);
    await sleep(800);
    await key('KeyE');
    await waitFor("!document.querySelector('#panel').classList.contains('hidden')", 6000);
    await sleep(600);
    await shot('explore-inspect');
    return js("({ title: document.querySelector('#panel h2') && document.querySelector('#panel h2').textContent, kind: document.querySelector('.kind-line b') && document.querySelector('.kind-line b').textContent })");
  });

  await step('leave feedback in 3D (F) and see it stored', async () => {
    const before = await js("window.mobility.listComments().then(l => l.length)");
    await js("document.querySelector('#panel-close').click()");
    await key('KeyF');
    await waitFor("document.querySelector('#fb-form textarea')", 6000);
    await js("const f = document.querySelector('#fb-form'); f.category.value = 'safety_hazard'; f.body.value = 'Testkommentar fra 3D-visningen: cyklister og fodgængere mødes i hjørnet.'; f.requestSubmit();");
    await sleep(1500);
    const after = await js("window.mobility.listComments().then(l => l.length)");
    const last = await js("window.mobility.listComments().then(l => l[0])");
    return after === before + 1 ? { before, after, target: last.target_type, name: last.street_name } : false;
  });

  await step('bike mode: pedal uphill/downhill', async () => {
    await js("document.querySelector('#panel-close').click()");
    await settle(1);
    const focus = await js("document.activeElement ? document.activeElement.tagName : null");
    await key('Digit2');
    await key('KeyR'); // back on the street, facing along it
    await settle(2);
    const modeNow = await js("window.__am3dExplorer.player.mode");
    if (modeNow !== 'bike') return { error: 'key 2 did not switch to bike', focus, modeNow };
    await holdKey('KeyW', 3);
    const st = await js("(async () => { const ex = await __am3d.getExplorer(); return { mode: ex.player.mode, kmh: Number(ex.player.speedKmh.toFixed(1)), grade: Number((ex.player.grade * 100).toFixed(2)) }; })()");
    await shot('explore-bike');
    return st.mode === 'bike' && st.kmh > 3 ? { ...st, focusAfterPanel: focus } : { ...st, focusAfterPanel: focus, ok: false };
  });

  await step('drive mode: accelerate & steer (chase camera)', async () => {
    await key('Digit3');
    await key('KeyR');
    await settle(2);
    await holdKey('KeyW', 2.5);
    await holdKey('KeyW', 0.7, ['KeyD']);
    const st = await js("(async () => { const ex = await __am3d.getExplorer(); return { mode: ex.player.mode, kmh: Number(ex.player.speedKmh.toFixed(1)), yaw: Number(ex.player.yaw.toFixed(2)) }; })()");
    await shot('explore-drive');
    return st.mode === 'drive' && st.kmh > 5 ? st : false;
  });

  await step('fly mode: aerial view of the city', async () => {
    await key('Digit4');
    await js("(async () => { const ex = await __am3d.getExplorer(); ex.player.y = ex.hAt(ex.player.e, ex.player.n) + 180; ex.player.pitch = -0.55; })()");
    await sleep(4000);
    await settle(6, 40000);
    await shot('explore-fly');
    return js("(async () => { const ex = await __am3d.getExplorer(); return { alt: Math.round(ex.player.altitude), chunks: ex.chunks.chunks.size, buildings: ex.chunks.stats.buildings } })()");
  });

  await step('street level: walk mode screenshot with labels', async () => {
    await key('Digit1');
    await js("(async () => { const ex = await __am3d.getExplorer(); ex.placeAt(10.2058, 56.1528, 20); ex.player.pitch = 0.08; })()");
    await sleep(5000);
    await shot('explore-street');
    return js("document.querySelectorAll('.label3d').length");
  });

  await step('evening & night lighting', async () => {
    await js("__am3d.settings.set({ timeMode: 'manual', timeOfDay: 16.4 })");
    await sleep(2500);
    await shot('explore-dusk');
    await js("__am3d.settings.set({ timeOfDay: 22.5 })");
    await sleep(2500);
    await shot('explore-night');
    return js("(async () => { const ex = await __am3d.getExplorer(); return { night: Number(ex.sky.state.night.toFixed(2)) } })()");
  });

  await step('night street lighting & wet streets at night', async () => {
    await js("__am3d.settings.set({ timeOfDay: 21.5, weather: 'clear' })");
    await js("(async () => { const ex = await __am3d.getExplorer(); ex.placeAt(10.2058, 56.1528, 200); ex.player.pitch = -0.06; })()");
    await sleep(4000);
    await shot('explore-night-street');
    await js("__am3d.settings.set({ weather: 'rain' })");
    await sleep(3500);
    await shot('explore-night-rain');
    return js("(async () => { const ex = await __am3d.getExplorer(); return { lampsLit: ex.lamps.count, night: Number(ex.sky.state.night.toFixed(2)), exposure: Number(ex.sky.exposure.toFixed(2)) } })()");
  });

  await step('rain & wet streets, NetAScore overlay', async () => {
    await js("__am3d.settings.set({ timeOfDay: 13, weather: 'rain' })");
    await sleep(4000);
    await shot('explore-rain');
    await js("__am3d.settings.set({ weather: 'clear', netOverlay: 'bike' })");
    await sleep(2500);
    await shot('explore-netascore');
    await js("__am3d.settings.set({ netOverlay: 'off' })");
    return true;
  });

  await step('quality presets and toggles do not break rendering', async () => {
    await js("__am3d.settings.applyQuality('ultra')");
    await sleep(3000);
    await js("__am3d.settings.applyQuality('low')");
    await sleep(2000);
    await js("__am3d.settings.set({ trees: false, furniture: false, roofs: false, windows: false, labelsBuildings: false })");
    await sleep(2500);
    await js("__am3d.settings.set({ trees: true, furniture: true, roofs: true, windows: true, labelsBuildings: true }); __am3d.settings.applyQuality('medium')");
    await sleep(3000);
    await shot('explore-after-toggles');
    return js("(async () => { const ex = await __am3d.getExplorer(); return { chunks: ex.chunks.chunks.size, glCalls: ex.renderer.info.render.calls, tris: ex.renderer.info.render.triangles } })()");
  });

  await step('frame time (software GPU, for relative comparison only)', async () => js(`(async () => {
    const ex = await __am3d.getExplorer();
    const ft = ex.frameTimes; return { fps: Math.round(ft.length / ft.reduce((a, b) => a + b, 0)), memoryMB: Math.round(performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0), geometries: ex.renderer.info.memory.geometries, textures: ex.renderer.info.memory.textures };
  })()`));

  await step('back to map view', async () => {
    await js("document.querySelector('#topbar .views .seg[data-view=map]').click()");
    await sleep(2500);
    await shot('map-after');
    return js("document.querySelector('#view-map').classList.contains('active')");
  });

  await step('activity log records the download and the comment', async () => js("window.mobility.activity(50).then(l => l.map(x => x.kind + ': ' + x.message.slice(0, 80)))"));
  finish();
}
