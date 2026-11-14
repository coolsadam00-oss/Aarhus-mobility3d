'use strict';
/**
 * Overpass API client with endpoint fail-over, retry/back-off on rate limits, streaming byte
 * progress and cancellation. The endpoint list can be overridden with AM3D_OVERPASS_URL (tests).
 */
const DEFAULT_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const UA = 'AarhusMobility3D/2.0 (Electron desktop app; NetAScore + 3D city explorer)';

function endpoints() {
  return process.env.AM3D_OVERPASS_URL ? process.env.AM3D_OVERPASS_URL.split(',') : DEFAULT_ENDPOINTS;
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Cancelled')); }, { once: true });
});

async function readBody(res, onBytes, signal) {
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0, lastReport = 0;
  for (;;) {
    if (signal && signal.aborted) { try { reader.cancel(); } catch { /* ignore */ } throw new Error('Cancelled'); }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.byteLength;
    if (onBytes && n - lastReport > 256 * 1024) { lastReport = n; onBytes(n); }
  }
  if (onBytes) onBytes(n);
  return { text: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8'), bytes: n };
}

/**
 * Run an Overpass QL query. Returns { json, bytes, endpoint, ms }.
 * @param {string} query
 * @param {{signal?:AbortSignal, onBytes?:(n:number)=>void, onStatus?:(s:string)=>void, timeoutMs?:number}} opt
 */
async function overpassQuery(query, opt = {}) {
  const list = endpoints();
  let lastErr = null;
  for (let attempt = 0; attempt < list.length * 2; attempt++) {
    const endpoint = list[attempt % list.length];
    if (opt.signal && opt.signal.aborted) throw new Error('Cancelled');
    const t0 = Date.now();
    try {
      opt.onStatus && opt.onStatus(`Contacting ${new URL(endpoint).host} …`);
      const timeout = AbortSignal.timeout(opt.timeoutMs || 300000);
      const signal = opt.signal ? AbortSignal.any([opt.signal, timeout]) : timeout;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': UA, Accept: 'application/json' },
        body: 'data=' + encodeURIComponent(query),
        signal
      });
      if (res.status === 429 || res.status === 504 || res.status === 503) {
        lastErr = new Error(`${new URL(endpoint).host} is busy (HTTP ${res.status})`);
        opt.onStatus && opt.onStatus(`${lastErr.message} – retrying …`);
        await sleep(attempt < list.length ? 4000 : 12000, opt.signal);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { text, bytes } = await readBody(res, opt.onBytes, opt.signal);
      const json = JSON.parse(text);
      if (json.remark && /runtime error|timed out|out of memory/i.test(json.remark)) throw new Error(`Overpass: ${json.remark}`);
      return { json, bytes, endpoint, ms: Date.now() - t0 };
    } catch (e) {
      if (opt.signal && opt.signal.aborted) throw new Error('Cancelled');
      lastErr = e;
      opt.onStatus && opt.onStatus(`${new URL(endpoint).host} failed (${e.message}) – trying next server …`);
    }
  }
  throw new Error(`OpenStreetMap download failed: ${lastErr ? lastErr.message : 'no server reachable'}. Check your internet connection and try again later.`);
}

module.exports = { overpassQuery, endpoints, UA };
