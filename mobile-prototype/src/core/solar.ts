// Solar position and sun times (NOAA algorithm). Line-for-line port of core/src/Solar.cpp so the
// web prototype and the Unreal project agree; tests/solar.test.ts checks it against known values.
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (v: number, m: number) => ((v % m) + m) % m;

function ephem(unixUtc: number) {
  const jd = unixUtc / 86400 + 2440587.5;
  const t = (jd - 2451545.0) / 36525.0;
  const l0 = wrap(280.46646 + t * (36000.76983 + 0.0003032 * t), 360);
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = rad(m);
  const c =
    Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mr) * 0.000289;
  const omega = rad(125.04 - 1934.136 * t);
  const lambda = rad(l0 + c - 0.00569 - 0.00478 * Math.sin(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = rad(eps0 + 0.00256 * Math.cos(omega));
  const declRad = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const l0r = rad(l0);
  const eotMin =
    4 *
    deg(
      y * Math.sin(2 * l0r) -
        2 * e * Math.sin(mr) +
        4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) -
        0.5 * y * y * Math.sin(4 * l0r) -
        1.25 * e * e * Math.sin(2 * mr),
    );
  return { declRad, eotMin };
}

export interface SunPosition { elevationDeg: number; azimuthDeg: number }
export interface SunTimes {
  valid: boolean; civilDawn: number; sunrise: number; solarNoon: number; sunset: number; civilDusk: number;
}

/** Geometric sun position; azimuth is clockwise from true north. */
export function sunPosition(unixUtc: number, latDeg: number, lonDeg: number): SunPosition {
  const ep = ephem(unixUtc);
  const minutesUtc = wrap(unixUtc, 86400) / 60;
  const tst = wrap(minutesUtc + ep.eotMin + 4 * lonDeg, 1440);
  const ha = rad(tst / 4 - 180);
  const lat = rad(latDeg);
  let cosZ = Math.sin(lat) * Math.sin(ep.declRad) + Math.cos(lat) * Math.cos(ep.declRad) * Math.cos(ha);
  cosZ = Math.max(-1, Math.min(1, cosZ));
  const z = Math.acos(cosZ);
  let az = 0;
  const denom = Math.cos(lat) * Math.sin(z);
  if (Math.abs(denom) > 1e-9) {
    let a = (Math.sin(lat) * cosZ - Math.sin(ep.declRad)) / denom;
    a = deg(Math.acos(Math.max(-1, Math.min(1, a))));
    az = ha > 0 ? wrap(a + 180, 360) : wrap(540 - a, 360);
  }
  return { elevationDeg: 90 - deg(z), azimuthDeg: az };
}

/** Sun times (unix seconds UTC) for the local calendar day containing unixUtc. */
export function sunTimes(unixUtc: number, latDeg: number, lonDeg: number, utcOffsetSeconds: number): SunTimes {
  const local = unixUtc + utcOffsetSeconds;
  const dayStartUtc = local - wrap(local, 86400) - utcOffsetSeconds;
  const solve = (zenithDeg: number, sign: number): number | null => {
    let guess = dayStartUtc + 43200;
    for (let i = 0; i < 3; i++) {
      const ep = ephem(guess);
      const noonMin = 720 - 4 * lonDeg - ep.eotMin + utcOffsetSeconds / 60;
      let offsetMin = 0;
      if (sign !== 0) {
        const lat = rad(latDeg);
        const c = Math.cos(rad(zenithDeg)) / (Math.cos(lat) * Math.cos(ep.declRad)) - Math.tan(lat) * Math.tan(ep.declRad);
        if (c < -1 || c > 1) return null;
        offsetMin = sign * 4 * deg(Math.acos(c));
      }
      guess = dayStartUtc + (noonMin + offsetMin) * 60;
    }
    return Math.round(guess);
  };
  const noon = solve(0, 0), sr = solve(90.833, -1), ss = solve(90.833, 1), cd = solve(96, -1), ck = solve(96, 1);
  return {
    valid: sr !== null && ss !== null && cd !== null && ck !== null,
    solarNoon: noon ?? 0, sunrise: sr ?? 0, sunset: ss ?? 0, civilDawn: cd ?? 0, civilDusk: ck ?? 0,
  };
}
