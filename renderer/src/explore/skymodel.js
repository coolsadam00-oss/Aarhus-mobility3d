// CPU copy of the radiance model in three.js Sky.js (Preetham et al. 1999, as implemented in three r187),
// without the sun disc and with clouds approximated by their mean coverage. Used to calibrate lighting:
//  * the sky's image-based light (scene.environment) is scaled so its ambient matches a target that depends on
//    weather and sun height (Sky.js renders overcast/fog skies 5–10× brighter than a clear blue sky, so a fixed
//    intensity made rainy days glow),
//  * the haze/fog colour equals the rendered sky at the horizon, so distant buildings fade into the actual sky.
const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUTOFF = 1.6110731556870734, STEEP = 1.5, EE = 1000;
const RAY_ZENITH = 8.4e3, MIE_ZENITH = 1.25e3;
const T16PI = 0.05968310365946075, O4PI = 0.07957747154594767;
const NIGHT_BIAS = [0, 0.0003, 0.00075];

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const sunIntensity = (c) => EE * Math.max(0, 1 - Math.exp(-((CUTOFF - Math.acos(Math.max(-1, Math.min(1, c)))) / STEEP)));
export const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Linear radiance of the sky in direction `dir` (unit, y up) for a sun direction `sun` (unit).
 * @param {{turbidity:number, rayleigh:number, mie:number, g:number, cover:number, dens:number, cloudElevation?:number}} p
 */
export function skyRadiance(p, sun, dir, out = [0, 0, 0]) {
  const sunE = sunIntensity(sun[1]);
  const c = 0.2 * p.turbidity * 10e-18;
  const za = Math.acos(Math.max(0, dir[1]));
  const inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - (za * 180) / Math.PI, -1.253));
  const sR = RAY_ZENITH * inv, sM = MIE_ZENITH * inv;
  const cosT = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2];
  const ct = cosT * 0.5 + 0.5;                       // (sic) as in Sky.js
  const rPhase = T16PI * (1 + ct * ct);
  const g = p.g, g2 = g * g;
  const mPhase = O4PI * ((1 - g2) / Math.pow(1 - 2 * g * cosT + g2, 1.5));
  const fade = Math.max(0, Math.min(1, Math.pow(1 - sun[1], 5)));
  const dayF = Math.max(0.03, smooth(-0.08, 0.3, sun[1]));
  const hf = dir[1] > 0 ? smooth(0, 0.03 + 0.06 * (p.cloudElevation ?? 0.55), dir[1]) : 0;
  const alpha = Math.min(1, (p.cover || 0) * (0.35 + 0.65 * (p.dens || 0))) * hf;
  for (let i = 0; i < 3; i++) {
    const bR = TOTAL_RAYLEIGH[i] * p.rayleigh, bM = 0.434 * c * MIE_CONST[i] * p.mie;
    const Fex = Math.exp(-(bR * sR + bM * sM));
    const r = (bR * rPhase + bM * mPhase) / (bR + bM);
    let Lin = Math.pow(sunE * r * (1 - Fex), 1.5);
    Lin *= 1 + (Math.pow(sunE * r * Fex, 0.5) - 1) * fade;
    let tex = (Lin + 0.1 * Fex) * 0.04 + NIGHT_BIAS[i];
    if (alpha > 0) {
      const cloud = (Lin * 0.04 + NIGHT_BIAS[i] + sunE * Fex * 0.22 * 0.04 * 0.72) * dayF;
      tex += (tex + (cloud - tex) * Fex - tex) * alpha;
    }
    out[i] = tex;
  }
  // twilight glow (see TWILIGHT_GLSL in sky.js)
  if (p.twilight > 0) {
    const up = Math.max(dir[1], 0), hzn = Math.exp(-up * 6);
    const dl = Math.hypot(dir[0], dir[2]) || 1, sl = Math.hypot(sun[0], sun[2]) || 1;
    const t = Math.max(0, (dir[0] * sun[0] + dir[2] * sun[2]) / (dl * sl));
    const zen = [0.012, 0.022, 0.055], glow = [0.16, 0.07, 0.03];
    for (let i = 0; i < 3; i++) out[i] += p.twilight * (zen[i] * (0.6 + 0.4 * hzn) + glow[i] * t * t * t * hzn);
  }
  return out;
}

/**
 * Sky statistics for lighting: cosine-weighted mean luminance of the upper hemisphere (`up`, i.e. what an
 * upward-facing white surface receives from the environment map) and the mean horizon colour (`horizon`, linear RGB).
 */
export function skyStats(p, sun, nAz = 24, nEl = 12) {
  let up = 0, wu = 0;
  const hz = [0, 0, 0], tmp = [0, 0, 0];
  for (let a = 0; a < nAz; a++) {
    const az = ((a + 0.5) / nAz) * Math.PI * 2, sa = Math.sin(az), ca = Math.cos(az);
    for (let e = 0; e < nEl; e++) {
      const el = ((e + 0.5) / nEl) * Math.PI / 2, ce = Math.cos(el), se = Math.sin(el);
      skyRadiance(p, sun, [sa * ce, se, -ca * ce], tmp);
      const w = se * ce; // cos(zenith) × solid-angle weight
      up += luminance(tmp) * w; wu += w;
    }
    skyRadiance(p, sun, [sa * Math.cos(0.05), Math.sin(0.05), -ca * Math.cos(0.05)], tmp);
    hz[0] += tmp[0] / nAz; hz[1] += tmp[1] / nAz; hz[2] += tmp[2] / nAz;
  }
  return { up: up / wu, horizon: hz };
}
