// Pure geodesy and formatting helpers (no Cesium import, so they run under `node --test`).

const A = 6378137.0;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const AUTHALIC_R = 6371007.181;

export type LonLat = [number, number];

const rad = (d: number) => (d * Math.PI) / 180;

/** Geodesic distance in metres on WGS84 (Vincenty inverse; falls back to haversine if it does not converge). */
export function geodesicDistance(a: LonLat, b: LonLat): number {
  const L = rad(b[0] - a[0]);
  const U1 = Math.atan((1 - F) * Math.tan(rad(a[1])));
  const U2 = Math.atan((1 - F) * Math.tan(rad(b[1])));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lambda = L;
  for (let i = 0; i < 200; i++) {
    const sinL = Math.sin(lambda), cosL = Math.cos(lambda);
    const sinSigma = Math.sqrt((cosU2 * sinL) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosL) ** 2);
    if (sinSigma === 0) return 0;
    const cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    const sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma;
    const cos2Alpha = 1 - sinAlpha * sinAlpha;
    const cos2SigmaM = cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda = L + (1 - C) * F * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - prev) < 1e-12) {
      const u2 = (cos2Alpha * (A * A - B * B)) / (B * B);
      const AA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
      const BB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
      const dSigma = BB * sinSigma * (cos2SigmaM + (BB / 4) * (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
        (BB / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
      return B * AA * (sigma - dSigma);
    }
  }
  return haversine(a, b);
}

export function haversine(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * AUTHALIC_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLength(points: LonLat[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += geodesicDistance(points[i - 1], points[i]);
  return d;
}

/** Area in m^2 of a simple polygon given as lon/lat ring (spherical excess on the authalic sphere). */
export function polygonArea(ring: LonLat[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = ring[i];
    const p2 = ring[(i + 1) % n];
    total += rad(p2[0] - p1[0]) * (2 + Math.sin(rad(p1[1])) + Math.sin(rad(p2[1])));
  }
  return Math.abs((total * AUTHALIC_R * AUTHALIC_R) / 2);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${m.toFixed(m < 10 ? 2 : 1)} м`;
  return `${(m / 1000).toFixed(m < 10000 ? 3 : 2)} км`;
}

export function formatArea(m2: number): string {
  if (m2 < 10000) return `${m2.toFixed(0)} м²`;
  if (m2 < 1e6) return `${(m2 / 10000).toFixed(2)} га`;
  return `${(m2 / 1e6).toFixed(3)} км²`;
}

export function formatCoord(lon: number, lat: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}`;
}

// ---- search ----

const LATIN_TO_CYR: [string, string][] = [
  ["kh", "х"], ["ts", "ц"], ["ch", "ч"], ["sh", "ш"], ["ya", "я"], ["yo", "ё"], ["yu", "ю"], ["ye", "е"],
  ["zh", "ж"], ["a", "а"], ["b", "б"], ["v", "в"], ["g", "г"], ["d", "д"], ["e", "э"], ["j", "ж"], ["z", "з"],
  ["i", "и"], ["y", "ы"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"], ["r", "р"],
  ["s", "с"], ["t", "т"], ["u", "у"], ["f", "ф"], ["h", "х"], ["q", "к"], ["w", "в"], ["x", "кс"], ["c", "ц"],
];

/** Lower-case, strip diacritics, and fold Mongolian Cyrillic letters that Latin typing cannot reach. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ө/g, "о")
    .replace(/ү/g, "у")
    .replace(/[ъь"'`.,()«»\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Rough Latin -> Mongolian Cyrillic transliteration so "zaisan" finds "Зайсан". */
export function latinToCyrillic(s: string): string {
  let out = "";
  let i = 0;
  const t = s.toLowerCase();
  while (i < t.length) {
    const pair = LATIN_TO_CYR.find(([lat]) => t.startsWith(lat, i));
    if (pair) {
      out += pair[1];
      i += pair[0].length;
    } else {
      out += t[i];
      i += 1;
    }
  }
  return out;
}

export interface SearchItem {
  n: string; // primary name (usually Mongolian)
  e?: string; // English name if the source has one
  t: string; // type: district, building, bus_stop, place category
  x: number;
  y: number;
  b?: [number, number, number, number];
}

const TYPE_BOOST: Record<string, number> = { district: 3, historic_site: 1, landmark_and_historical_building: 1 };

export function search(items: SearchItem[], query: string, limit = 12): SearchItem[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const qc = normalize(latinToCyrillic(q).replace(/й/g, "и"));
  const scored: [number, SearchItem][] = [];
  for (const it of items) {
    const names = [normalize(it.n), it.e ? normalize(it.e) : ""];
    let best = 0;
    for (const nm of names) {
      if (!nm) continue;
      const nmc = nm.replace(/й/g, "и");
      for (const cand of [q, qc]) {
        if (nm === cand || nmc === cand) best = Math.max(best, 100);
        else if (nm.startsWith(cand) || nmc.startsWith(cand)) best = Math.max(best, 60);
        else if (nm.includes(" " + cand) || nmc.includes(" " + cand)) best = Math.max(best, 40);
        else if (nm.includes(cand) || nmc.includes(cand)) best = Math.max(best, 20);
      }
    }
    if (best > 0) scored.push([best + (TYPE_BOOST[it.t] ?? 0) * 10 - it.n.length * 0.05, it]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const seen = new Set<string>();
  const out: SearchItem[] = [];
  for (const [, it] of scored) {
    const key = `${it.n}|${it.x.toFixed(3)}|${it.y.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

// ---- terrarium terrain ----

/** Decode one AWS terrarium pixel to metres. */
export function terrariumHeight(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Resample a 256x256 terrarium tile to an n x n heightmap covering the sub-square
 * (sx, sy, size) of the tile, all in tile fractions [0, 1]. Bilinear, edge-clamped.
 */
export function resampleHeights(src: Float32Array, n: number, sx = 0, sy = 0, size = 1): Float32Array {
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const fy = Math.min(255, Math.max(0, (sy + (size * j) / (n - 1)) * 256 - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(255, y0 + 1), ty = fy - y0;
    for (let i = 0; i < n; i++) {
      const fx = Math.min(255, Math.max(0, (sx + (size * i) / (n - 1)) * 256 - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(255, x0 + 1), tx = fx - x0;
      const h = (src[y0 * 256 + x0] * (1 - tx) + src[y0 * 256 + x1] * tx) * (1 - ty) +
        (src[y1 * 256 + x0] * (1 - tx) + src[y1 * 256 + x1] * tx) * ty;
      out[j * n + i] = h;
    }
  }
  return out;
}
