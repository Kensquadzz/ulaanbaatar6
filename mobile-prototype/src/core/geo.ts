// WGS84 <-> local East/North/Up metres around Sukhbaatar Square. Mirrors core/src/Geo.cpp and
// pipeline/ub6pipeline/geo.py (ECEF based, not an equirectangular shortcut).
export const ORIGIN_LAT = 47.918873;
export const ORIGIN_LON = 106.91758;
export const ORIGIN_GROUND_M = 1298.0;   // world Y = elevation - this, keeps float32 precise
export const CHUNK_M = 256;
export const UB_UTC_OFFSET_S = 8 * 3600; // Asia/Ulaanbaatar is fixed UTC+8 (no DST)

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const R = (d: number) => (d * Math.PI) / 180;

function ecef(latDeg: number, lonDeg: number, h = 0): [number, number, number] {
  const lat = R(latDeg), lon = R(lonDeg);
  const s = Math.sin(lat), c = Math.cos(lat);
  const n = A / Math.sqrt(1 - E2 * s * s);
  return [(n + h) * c * Math.cos(lon), (n + h) * c * Math.sin(lon), (n * (1 - E2) + h) * s];
}

const O = ecef(ORIGIN_LAT, ORIGIN_LON);
const sl = Math.sin(R(ORIGIN_LAT)), cl = Math.cos(R(ORIGIN_LAT));
const so = Math.sin(R(ORIGIN_LON)), co = Math.cos(R(ORIGIN_LON));
const M = [[-so, co, 0], [-sl * co, -sl * so, cl], [cl * co, cl * so, sl]];

export function geoToEnu(latDeg: number, lonDeg: number, h = 0): { east: number; north: number; up: number } {
  const p = ecef(latDeg, lonDeg, h);
  const d = [p[0] - O[0], p[1] - O[1], p[2] - O[2]];
  return {
    east: M[0][0] * d[0] + M[0][1] * d[1] + M[0][2] * d[2],
    north: M[1][0] * d[0] + M[1][1] * d[1] + M[1][2] * d[2],
    up: M[2][0] * d[0] + M[2][1] * d[1] + M[2][2] * d[2],
  };
}

export function enuToGeo(east: number, north: number, up = 0): { lat: number; lon: number; h: number } {
  const x = M[0][0] * east + M[1][0] * north + M[2][0] * up + O[0];
  const y = M[0][1] * east + M[1][1] * north + M[2][1] * up + O[1];
  const z = M[0][2] * east + M[1][2] * north + M[2][2] * up + O[2];
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - E2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat);
    const n = A / Math.sqrt(1 - E2 * s * s);
    h = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (E2 * n) / (n + h)));
  }
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI, h };
}

export const chunkOf = (east: number, north: number): [number, number] =>
  [Math.floor(east / CHUNK_M), Math.floor(north / CHUNK_M)];

/** Real Ulaanbaatar wall-clock parts for a unix time (fixed UTC+8). */
export function ubClock(unixUtc: number) {
  const d = new Date((unixUtc + UB_UTC_OFFSET_S) * 1000);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), weekday: d.getUTCDay(),
  };
}
export const hhmm = (unixUtc: number) => {
  const c = ubClock(unixUtc);
  return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
};
