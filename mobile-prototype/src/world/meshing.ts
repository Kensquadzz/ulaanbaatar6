// Pure geometry builders (typed arrays in, typed arrays out) so they run in tests without WebGL.
// Local frame of a chunk mesh: x = east - cx*256, y = world Y, z = -(north - cy*256).
import { ShapeUtils, Vector2 } from 'three';
import { CHUNK_M, ORIGIN_GROUND_M } from '../core/geo';
import { makeCollider, type Collider } from './collision';
import { atlasU } from './street';
import type { BuildingData, RoadData } from './types';

export interface MeshData {
  position: Float32Array; normal: Float32Array; uv: Float32Array; color?: Float32Array; style?: Float32Array; index: Uint32Array;
}
type HeightFn = (east: number, north: number) => number;

const SKIRT_M = 10;

/** Terrain patch from the real height grid, with a downward skirt that hides LOD seams. */
export function buildTerrain(grid: Float32Array, n: number, cx: number, cy: number, hAt: HeightFn): MeshData {
  const step = CHUNK_M / (n - 1);
  const vcount = n * n + 4 * n;
  const position = new Float32Array(vcount * 3), normal = new Float32Array(vcount * 3), uv = new Float32Array(vcount * 2);
  const e0 = cx * CHUNK_M, n0 = cy * CHUNK_M;
  const hh = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < n && j < n ? grid[j * n + i] : hAt(e0 + i * step, n0 + j * step);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    position[k * 3] = i * step; position[k * 3 + 1] = grid[k]; position[k * 3 + 2] = -j * step;
    const dhde = (hh(i + 1, j) - hh(i - 1, j)) / (2 * step), dhdn = (hh(i, j + 1) - hh(i, j - 1)) / (2 * step);
    const inv = 1 / Math.hypot(dhde, 1, dhdn);
    normal[k * 3] = -dhde * inv; normal[k * 3 + 1] = inv; normal[k * 3 + 2] = dhdn * inv;
    uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = j / (n - 1);
  }
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  // Skirts: copy each border vertex, lowered; emit both windings so no face-culling surprises.
  let v = n * n;
  const border = (pick: (t: number) => number) => {
    const start = v;
    for (let t = 0; t < n; t++, v++) {
      const k = pick(t);
      position[v * 3] = position[k * 3]; position[v * 3 + 1] = position[k * 3 + 1] - SKIRT_M; position[v * 3 + 2] = position[k * 3 + 2];
      normal[v * 3] = normal[k * 3]; normal[v * 3 + 1] = normal[k * 3 + 1]; normal[v * 3 + 2] = normal[k * 3 + 2];
      uv[v * 2] = uv[k * 2]; uv[v * 2 + 1] = uv[k * 2 + 1];
    }
    for (let t = 0; t < n - 1; t++) {
      const a = pick(t), b = pick(t + 1), c = start + t, d = start + t + 1;
      idx.push(a, b, d, a, d, c, a, d, b, a, c, d);
    }
  };
  border((t) => t); border((t) => (n - 1) * n + t); border((t) => t * n); border((t) => t * n + n - 1);
  return { position, normal, uv, index: new Uint32Array(idx) };
}

// ---- roads -------------------------------------------------------------------------------------
const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway']);
const LINED = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const ROAD_TINT: Record<string, [number, number, number]> = {
  footway: [1, 1, 1], pedestrian: [1.05, 1.03, 1], path: [0.8, 0.72, 0.6], steps: [0.9, 0.9, 0.9],
  cycleway: [1.0, 0.78, 0.74], track: [1.5, 1.25, 0.95], service: [1.12, 1.12, 1.12], residential: [1.05, 1.05, 1.05],
};
export function buildRoads(roads: RoadData[], cx: number, cy: number, hAt: HeightFn, detail: boolean): MeshData {
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], col: number[] = [], idx: number[] = [];
  const e0 = cx * CHUNK_M, n0 = cy * CHUNK_M;
  const maxSeg = detail ? 6 : 14;
  for (const r of roads) {
    const foot = FOOT.has(r.class) || !r.drivable;
    if (!detail && foot) continue;                       // far LOD keeps only carriageways
    if (r.pts.length < 2) continue;
    // Resample so the ribbon follows the terrain between source vertices.
    const pe: number[] = [], pn: number[] = [];
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const parts = Math.max(1, Math.ceil(len / maxSeg));
      for (let k = 0; k < parts; k++) { pe.push(a[0] + ((b[0] - a[0]) * k) / parts); pn.push(a[1] + ((b[1] - a[1]) * k) / parts); }
    }
    const last = r.pts[r.pts.length - 1];
    pe.push(last[0]); pn.push(last[1]);
    const wide = r.width >= 12;
    const column = foot ? 2 : !LINED.has(r.class) ? 0 : r.oneway === 0 ? (wide ? 4 : 1) : wide ? 5 : 0;
    const tint = ROAD_TINT[r.class] ?? [1, 1, 1];
    const half = Math.max(0.6, r.width / 2);
    // Major roads sit a hair above minor ones so crossings do not flicker.
    const lift = (detail ? 0.05 : 0.18) + (foot ? 0 : LINED.has(r.class) ? 0.03 : 0.015);
    const base = pos.length / 3;
    let dist = 0;
    for (let i = 0; i < pe.length; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(pe.length - 1, i + 1);
      let te = pe[i1] - pe[i0], tn = pn[i1] - pn[i0];
      const tl = Math.hypot(te, tn) || 1;
      te /= tl; tn /= tl;
      if (i > 0) dist += Math.hypot(pe[i] - pe[i - 1], pn[i] - pn[i - 1]);
      for (const side of [1, -1]) {
        const e = pe[i] - tn * half * side, n = pn[i] + te * half * side;   // side 1 = left of travel
        pos.push(e - e0, hAt(e, n) + lift, -(n - n0));
        nor.push(0, 1, 0);
        uvs.push(atlasU(column, side === 1 ? 0 : 1), dist / 8);
        col.push(tint[0], tint[1], tint[2]);
      }
    }
    for (let i = 0; i < pe.length - 1; i++) {
      const l0 = base + i * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
      idx.push(l0, r0, r1, l0, r1, l1);
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), uv: new Float32Array(uvs),
    color: new Float32Array(col), index: new Uint32Array(idx) };
}

// ---- buildings ---------------------------------------------------------------------------------
// What is real here: every footprint, its position, and any height or floor count the source carries.
// What is styling: facade type, colours, roof shape, rooftop boxes, ground-floor shopfronts, and the
// height of buildings whose source height is only a class default (see `buildingLook`).
export const STYLE = { panel: 0, glass: 1, civic: 2, brick: 3, retail: 4, plain: 5, shop: 6, roof: 7, metal: 8 } as const;
export const STYLE_COUNT = 9;
export const TEX_CELLS = 8;
/** Metres per texture cell for each facade layer: [bay width, floor height]. */
export const CELL_M: [number, number][] = [[3.2, 3.0], [3.0, 3.6], [3.6, 4.2], [3.4, 2.8], [3.6, 3.4], [3.2, 3.0], [4.0, 3.8], [1, 1], [1, 1]];

const PALETTES: Record<string, number[]> = {
  panel: [0xd9d2c2, 0xcfc8ba, 0xe0d6b4, 0xd4c5b4, 0xc6cfca, 0xdccbc0, 0xbdbdb6, 0xd8c9a8, 0xc9b8a6],
  brick: [0xb87a56, 0xa5805f, 0xc9b59a, 0x96705a, 0xb3a48f, 0xc7c2b8, 0x9f8a70],
  ger: [0xf4f1e8, 0xebe7dc],
  plain: [0x9a9da2, 0xa68b76, 0x8d9195, 0xb5aea2, 0xa9a59c],
  retail: [0xd9dde0, 0xcfd3d2, 0xe2dccf, 0xc3ccd3, 0xe6e0d2, 0xd8cdbd],
  civic: [0xe2d6b6, 0xd8cfbb, 0xe8dfca, 0xd9c7a4],
  glass: [0xdfe9f2, 0xcfe0ee, 0xe6ecef, 0xd2dde2, 0xe9e2d6],
};
const ROOF_METAL = [0x8c3b2e, 0x3f6b4f, 0x35557a, 0x6b6f76, 0x7a4a2a, 0x9a4a3a, 0x4d7a86];
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const srgb = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const rgb = (hex: number, k = 1): [number, number, number] => [srgb((hex >> 16) & 255) * k, srgb((hex >> 8) & 255) * k, srgb(hex & 255) * k];

export function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
function inRing(ring: [number, number][], e: number, n: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > n) !== (b[1] > n) && e < ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Lowest and highest terrain under a footprint: its corners plus an 8 m lattice of interior points. */
export function groundRange(ring: [number, number][], hAt: HeightFn): [number, number] {
  let lo = Infinity, hi = -Infinity, e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  const take = (e: number, n: number) => { const h = hAt(e, n); if (h < lo) lo = h; if (h > hi) hi = h; };
  for (const p of ring) { take(p[0], p[1]); e0 = Math.min(e0, p[0]); e1 = Math.max(e1, p[0]); n0 = Math.min(n0, p[1]); n1 = Math.max(n1, p[1]); }
  const S = 8;
  for (let n = Math.ceil(n0 / S) * S; n <= n1; n += S) for (let e = Math.ceil(e0 / S) * S; e <= e1; e += S) if (inRing(ring, e, n)) take(e, n);
  return [lo, hi];
}

/**
 * Approximate, NOT surveyed, hints for named landmarks whose source record is clearly wrong.
 * Government Palace is recorded as one floor (3 m); it is a multi-storey building, so it is drawn
 * at a rough 22 m with the civic facade. This is a visual estimate, not its real geometry.
 */
const LANDMARK_HINTS: Record<string, { height: number; style: number }> = {
  'Засгийн газрын ордон': { height: 22, style: STYLE.civic },
};
const SMALL = new Set(['ger', 'garage', 'garages', 'shed', 'roof', 'shelter', 'cabin', 'hut', 'kiosk', 'carport', 'toilets', 'service', 'guardhouse']);
const HOUSE = new Set(['house', 'detached', 'terrace', 'semidetached_house', 'bungalow', 'cabin']);
const HOME = new Set(['apartments', 'residential', 'dormitory']);

export interface Look {
  height: number;
  /** true when the height is a visual estimate made here (the source only had a class default). */
  visual: boolean;
  style: number; roof: 0 | 1 | 2;   // 0 flat, 1 gable, 2 cone
  shop: boolean;
}
/**
 * Decides how a building is drawn. Heights from the source (`source`, `estimated_from_floors`) are
 * kept. Where the source has only the class default (about 86 % of buildings, all 6 m), a height is
 * estimated from the footprint area and building class with a per-building hash, so the skyline is
 * not flat. That estimate is for looks only: it is never written back to the data.
 */
export function buildingLook(b: BuildingData, area: number, corners: number): Look {
  const h = hash(b.id), u = ((h >>> 12) & 1023) / 1024, u2 = ((h >>> 3) & 255) / 256;
  const cls = b.class ?? '', sub = b.subtype ?? '';
  const pick = (a: number[]) => a[Math.min(a.length - 1, Math.floor(u * a.length))];
  const hint = b.name ? LANDMARK_HINTS[b.name] : undefined;
  let height = b.height, visual = false;
  if (hint) { height = hint.height; visual = true; }
  else if (b.height_src === 'estimated_default' && !SMALL.has(cls) && !HOUSE.has(cls)) {
    let floors: number, fh = 3;
    if (sub === 'education') { floors = cls === 'university' || cls === 'college' ? pick([4, 5, 6]) : pick([2, 3, 3]); fh = 3.6; }
    else if (sub === 'medical') { floors = pick([3, 4, 5, 6]); fh = 3.6; }
    else if (sub === 'religious') { floors = pick([2, 3]); fh = 3.5; }
    else if (sub === 'industrial' || sub === 'transportation') { floors = pick([2, 2, 3]); fh = 4; }
    else if (sub === 'commercial') {
      fh = 3.6;
      floors = cls === 'hotel' || cls === 'office' ? pick([5, 6, 8, 10, 12]) : area < 200 ? pick([1, 2, 2]) : area < 1200 ? pick([2, 3, 4, 5, 7]) : pick([2, 3, 4, 6]);
    } else if (HOME.has(cls)) floors = area < 250 ? pick([2, 3, 4]) : pick([5, 5, 5, 9, 9, 12]);
    else if (area < 45) floors = 1;
    else if (area < 120) floors = pick([1, 1, 2]);
    else if (area < 300) floors = pick([2, 2, 3]);
    else if (area < 700) floors = pick([3, 4, 5, 5]);
    else if (area < 2500) floors = pick([4, 5, 5, 6, 9, 9, 12]);
    else floors = pick([2, 3, 4, 5]);
    height = floors * fh; visual = true;
  }
  let style: number;
  if (hint) style = hint.style;
  else if (SMALL.has(cls) || area < 30) style = STYLE.plain;
  else if (HOUSE.has(cls) || (!cls && !sub && area < 170 && height <= 6.5)) style = STYLE.brick;
  else if (sub === 'civic' || sub === 'education' || sub === 'medical' || sub === 'religious' || sub === 'military') style = STYLE.civic;
  else if (height >= 40) style = STYLE.glass;
  else if (sub === 'commercial') style = height >= 20 || u2 < 0.25 ? STYLE.glass : STYLE.retail;
  else if (HOME.has(cls)) style = STYLE.panel;
  else if (sub === 'industrial') style = STYLE.plain;
  else style = height >= 27 && u2 < 0.4 ? STYLE.glass : area >= 250 && u2 > 0.8 ? STYLE.retail : STYLE.panel;
  const roof = cls === 'ger' ? 2 : style === STYLE.brick && corners === 4 && area < 280 ? 1 : 0;
  const shop = height >= 7 && (style === STYLE.retail || style === STYLE.glass || (style === STYLE.panel && area >= 400 && (h & 7) < 3));
  return { height, visual, style, roof, shop };
}

export interface BuildingMesh extends MeshData { colliders: Collider[]; roofArea: number; visualHeights: number }

/**
 * Extrudes every real footprint. The terrain tiles are a surface model: in the city they bulge under
 * large buildings, and a building placed at its lowest corner ends up buried in that bulge. With
 * `hAt`, each building stands on the highest terrain under its footprint and its walls reach down to
 * the lowest. `detail` adds ground-floor shopfronts, pitched roofs and rooftop boxes (near chunks).
 * `minAreaM2` drops tiny footprints from the distant level of detail only.
 */
export function buildBuildings(buildings: BuildingData[], cx: number, cy: number, hAt?: HeightFn, detail = true, minAreaM2 = 0): BuildingMesh {
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], col: number[] = [], sty: number[] = [], idx: number[] = [];
  const colliders: Collider[] = [];
  const e0 = cx * CHUNK_M, n0 = cy * CHUNK_M;
  let roofArea = 0, visualHeights = 0;
  const vert = (e: number, y: number, n: number, nx: number, ny: number, nz: number, u: number, v: number, c: [number, number, number], k: number, st: number) => {
    pos.push(e - e0, y, -(n - n0)); nor.push(nx, ny, nz); uvs.push(u, v); col.push(c[0] * k, c[1] * k, c[2] * k); sty.push(st);
    return pos.length / 3 - 1;
  };
  /** Vertical quad from p to q (outward normal on the right of p->q for a CCW ring). */
  const wall = (p: [number, number], q: [number, number], y0: number, y1: number, st: number, c: [number, number, number],
                u0: number, u1: number, v0: number, v1: number, kBottom: number) => {
    const de = q[0] - p[0], dn = q[1] - p[1], len = Math.hypot(de, dn) || 1;
    const nx = dn / len, nz = de / len;
    const a = vert(p[0], y0, p[1], nx, 0, nz, u0, v0, c, kBottom, st);
    vert(q[0], y0, q[1], nx, 0, nz, u1, v0, c, kBottom, st);
    vert(q[0], y1, q[1], nx, 0, nz, u1, v1, c, 1, st);
    vert(p[0], y1, p[1], nx, 0, nz, u0, v1, c, 1, st);
    idx.push(a, a + 1, a + 2, a, a + 2, a + 3);
  };
  /** Planar polygon (3 or 4 points, [e, y, n]) with a computed normal, wound to face up/outward. */
  const face = (pts: [number, number, number][], st: number, c: [number, number, number], uv: (p: [number, number, number]) => [number, number]) => {
    const [a, b, d] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = -(b[2] - a[2]), vx = d[0] - a[0], vy = d[1] - a[1], vz = -(d[2] - a[2]);
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i0 = pos.length / 3;
    for (const p of pts) { const t = uv(p); vert(p[0], p[1], p[2], nx, ny, nz, t[0], t[1], c, 1, st); }
    for (let i = 1; i < pts.length - 1; i++) idx.push(i0, i0 + i, i0 + i + 1);
  };

  for (const b of buildings) {
    const h = hash(b.id);
    for (const src of b.rings) {
      if (src.length < 3) continue;
      const area = ringArea(src);
      if (Math.abs(area) < 0.5) continue;
      let ring = area > 0 ? src.slice() : src.slice().reverse();      // counter-clockwise seen from above
      const f = ring[0], l = ring[ring.length - 1];
      if (ring.length > 3 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.01) ring = ring.slice(0, -1);
      const A = Math.abs(area);
      if (A < minAreaM2) continue;             // distant LOD: sheds and gers are a few pixels at most
      roofArea += A;
      const look = buildingLook(b, A, ring.length);
      if (look.visual) visualHeights++;
      const dataBase = b.base_z - ORIGIN_GROUND_M;
      let lo = dataBase, street = dataBase;
      if (hAt) { const r = groundRange(ring, hAt); lo = Math.min(dataBase, r[0]); street = Math.max(dataBase, r[1]); }
      const topY = street + look.height, lowY = lo - 0.5;
      colliders.push(makeCollider(ring, lowY, topY));

      const st = look.style;
      const palKey = (Object.keys(STYLE) as (keyof typeof STYLE)[])[st] as string;
      const pal = b.class === 'ger' ? PALETTES.ger : PALETTES[palKey] ?? PALETTES.plain;
      const shade = 0.92 + ((h >>> 8) % 100) / 600;
      const tint = rgb(pal[h % pal.length], shade);
      const grey: [number, number, number] = [0.33 * shade, 0.33 * shade, 0.34 * shade];
      const eave = look.roof === 2 ? topY - Math.min(1, look.height * 0.4) : look.roof === 1 && detail ? topY - Math.min(2.2, look.height * 0.38) : topY;
      const shop = look.shop && detail;
      const bodyFrom = street - lo > 0.4 || shop ? street : lowY;
      const shopTop = street + CELL_M[STYLE.shop][1];
      const [bay, floorH] = CELL_M[st];
      const bodyBase = shop ? shopTop : bodyFrom;
      const floors = Math.max(1, Math.round((eave - bodyBase) / floorH));
      const vOff = ((h >>> 4) % TEX_CELLS) / TEX_CELLS;
      let run = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 0.01) continue;
        const pu0 = run / 3.2 / TEX_CELLS, pu1 = (run + len) / 3.2 / TEX_CELLS;
        run += len;
        if (bodyFrom > lowY) wall(p, q, lowY, bodyFrom, STYLE.plain, grey, pu0, pu1, 0, (bodyFrom - lowY) / 3 / TEX_CELLS, 0.8);
        const uOff = ((h + i * 3) % TEX_CELLS) / TEX_CELLS;
        if (shop) {
          const bays = Math.max(1, Math.round(len / CELL_M[STYLE.shop][0]));
          if (len >= 2.4) wall(p, q, street, shopTop, STYLE.shop, [0.9, 0.9, 0.9], uOff, uOff + bays / TEX_CELLS, vOff, vOff + 1 / TEX_CELLS, 0.85);
          else wall(p, q, street, shopTop, STYLE.plain, tint, pu0, pu1, 0, 1 / TEX_CELLS, 0.85);
        }
        const windowed = st !== STYLE.plain && len >= 1.9;
        if (windowed) {
          const bays = Math.max(1, Math.round(len / bay));
          wall(p, q, bodyBase, eave, st, tint, uOff, uOff + bays / TEX_CELLS, vOff, vOff + floors / TEX_CELLS, shop ? 1 : 0.82);
        } else {
          wall(p, q, bodyBase, eave, STYLE.plain, tint, pu0, pu1, 0, (eave - bodyBase) / 3 / TEX_CELLS, shop ? 1 : 0.82);
        }
      }

      // roof
      if (look.roof === 2) {                                   // ger: low cone
        let ce = 0, cn = 0;
        for (const p of ring) { ce += p[0]; cn += p[1]; }
        ce /= ring.length; cn /= ring.length;
        const c: [number, number, number] = [tint[0] * 0.92, tint[1] * 0.92, tint[2] * 0.9];
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          face([[p[0], eave, p[1]], [q[0], eave, q[1]], [ce, topY, cn]], STYLE.plain, c, (v) => [v[0] / 26, v[2] / 26]);
        }
      } else if (look.roof === 1 && detail) {                  // small house: gable roof in sheet metal
        const k = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]) >= Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]) ? 0 : 1;
        const P = [0, 1, 2, 3].map((i) => ring[(i + k) % 4]);
        const m1: [number, number] = [(P[1][0] + P[2][0]) / 2, (P[1][1] + P[2][1]) / 2], m3: [number, number] = [(P[3][0] + P[0][0]) / 2, (P[3][1] + P[0][1]) / 2];
        const dl = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) || 1, de = (P[1][0] - P[0][0]) / dl, dn = (P[1][1] - P[0][1]) / dl;
        const metal = rgb(ROOF_METAL[(h >>> 6) % ROOF_METAL.length], 0.9);
        const muv = (v: [number, number, number]): [number, number] => [(v[0] * de + v[2] * dn) / 3.2, (v[0] * -dn + v[2] * de) / 3.2 + v[1] / 3.2];
        face([[P[0][0], eave, P[0][1]], [P[1][0], eave, P[1][1]], [m1[0], topY, m1[1]], [m3[0], topY, m3[1]]], STYLE.metal, metal, muv);
        face([[P[2][0], eave, P[2][1]], [P[3][0], eave, P[3][1]], [m3[0], topY, m3[1]], [m1[0], topY, m1[1]]], STYLE.metal, metal, muv);
        const puv = (v: [number, number, number]): [number, number] => [(v[0] + v[2]) / 26, v[1] / 26];
        face([[P[1][0], eave, P[1][1]], [P[2][0], eave, P[2][1]], [m1[0], topY, m1[1]]], STYLE.plain, tint, puv);
        face([[P[3][0], eave, P[3][1]], [P[0][0], eave, P[0][1]], [m3[0], topY, m3[1]]], STYLE.plain, tint, puv);
      } else {                                                 // flat roof
        const contour = ring.map((p) => new Vector2(p[0], p[1]));
        const tris = ShapeUtils.triangulateShape(contour, []);
        const rc: [number, number, number] = [0.3 + tint[0] * 0.18, 0.3 + tint[1] * 0.18, 0.31 + tint[2] * 0.18];
        const r0 = pos.length / 3;
        for (const p of ring) vert(p[0], topY, p[1], 0, 1, 0, p[0] / 8, p[1] / 8, rc, 1, STYLE.roof);
        for (const t of tris) {
          const a = ring[t[0]], bb = ring[t[1]], c = ring[t[2]];
          const s = (bb[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (bb[1] - a[1]);
          if (s >= 0) idx.push(r0 + t[0], r0 + t[1], r0 + t[2]); else idx.push(r0 + t[0], r0 + t[2], r0 + t[1]);
        }
        // rooftop stair/lift box on larger blocks: decorative, placed only where it fits inside the footprint
        if (detail && look.height >= 14 && A > 300) {
          let ce = 0, cn = 0;
          for (const p of ring) { ce += p[0]; cn += p[1]; }
          ce /= ring.length; cn /= ring.length;
          const dl = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]) || 1;
          const de = (ring[1][0] - ring[0][0]) / dl, dn = (ring[1][1] - ring[0][1]) / dl;
          const hw = 2.4 + (h % 3), hd = 2;
          const box: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [ce + de * x - dn * y, cn + dn * x + de * y] as [number, number]);
          if (box.every((p) => inRing(ring, p[0], p[1]))) {
            const bh = topY + 2.6, bc: [number, number, number] = [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8];
            for (let i = 0; i < 4; i++) wall(box[i], box[(i + 1) % 4], topY, bh, STYLE.plain, bc, 0, 0.1, 0, 0.1, 0.85);
            face(box.map((p) => [p[0], bh, p[1]] as [number, number, number]), STYLE.roof, rc, (v) => [v[0] / 8, v[2] / 8]);
          }
        }
      }
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), uv: new Float32Array(uvs), color: new Float32Array(col),
    style: new Float32Array(sty), index: new Uint32Array(idx), colliders, roofArea, visualHeights };
}
