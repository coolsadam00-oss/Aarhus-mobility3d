// Solar position (altitude / azimuth) for a date and location.
// Algorithm after SunCalc (V. Agafonkin, BSD-2) / Astronomy Answers formulas; accuracy ≈ 0.1°.
const rad = Math.PI / 180;
const dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
const e = rad * 23.4397; // obliquity of the Earth

const toDays = (date) => date.valueOf() / dayMs - 0.5 + J1970 - J2000;
const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const siderealTime = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + Math.PI;
}

/**
 * @returns {{altitude:number, azimuth:number}} radians; azimuth measured clockwise from NORTH.
 */
export function sunPosition(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date);
  const M = solarMeanAnomaly(d), L = eclipticLongitude(M);
  const dec = declination(L, 0), ra = rightAscension(L, 0);
  const H = siderealTime(d, lw) - ra;
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  let az = azSouth + Math.PI;
  if (az > 2 * Math.PI) az -= 2 * Math.PI;
  return { altitude: alt, azimuth: az };
}

/** Unit direction towards the sun in the local frame (x east, y up, z south). */
export function sunDirection(alt, az) {
  const c = Math.cos(alt);
  return [Math.sin(az) * c, Math.sin(alt), -Math.cos(az) * c];
}

/** Date in Copenhagen time for "manual" hour-of-day on today's date. */
export function dateAtLocalHour(hour, base = new Date()) {
  // Find the UTC offset of Europe/Copenhagen for the base date (handles summer time).
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(base).map(p => [p.type, p.value]));
  const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  const offsetMin = Math.round((localAsUtc - base.getTime()) / 60000);
  const midnightLocalUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offsetMin * 60000;
  return new Date(midnightLocalUtc + hour * 3600000);
}

export function localHour(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour12: false, hour: '2-digit', minute: '2-digit' });
  const [h, m] = fmt.format(date).split(':').map(Number);
  return (h % 24) + m / 60;
}

export function seasonOf(date = new Date()) {
  const m = date.getMonth();
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}
