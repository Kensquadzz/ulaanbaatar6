// Building reconstruction (V2).
//
// REAL (from the source data, never changed here): every footprint and courtyard, its position,
//   and any height or storey count the source carries.
// SOURCE CLASSIFICATION or documented ESTIMATE (made in pipeline/ub6pipeline/enrich.py and
//   flagged per building in `arch_src` / `vis_height_src`): the architectural category and the
//   height of buildings whose source has neither height nor storeys.
// PROCEDURAL VISUAL DETAIL (made here, not data): facade pattern, colours, window layout,
//   balconies in the texture, parapets, entrances and canopies, rooftop boxes, roof pitch.
import { ShapeUtils, Vector2 } from 'three';
import { CHUNK_M, ORIGIN_GROUND_M } from '../core/geo';
import { makeCollider, type Collider } from './collision';
import type { MeshData } from './meshing';
import type { BuildingData } from './types';
import { LANDMARK_BUILDERS, type LandmarkRegistry } from './landmarks';

type HeightFn = (east: number, north: number) => number;
export type RGB = [number, number, number];
export type P2 = [number, number];
export type P3 = [number, number, number];

export const STYLE = {
  panel: 0, glass: 1, civic: 2, brick: 3, retail: 4, plain: 5, shop: 6, roof: 7, metal: 8,
  walkup: 9, tower: 10, glassDark: 11, school: 12, industrial: 13, hotel: 14, mall: 15, wood: 16, felt: 17, door: 18,
} as const;
export const STYLE_COUNT = 19;
export const TEX_CELLS = 8;
/** Metres per texture cell for each facade layer: [bay width, floor height]. */
export const CELL_M: [number, number][] = [
  [3.2, 3.0], [3.0, 3.6], [3.6, 4.2], [3.4, 2.8], [3.6, 3.4], [3.2, 3.0], [4.0, 3.8], [1, 1], [1, 1],
  [3.0, 3.0], [3.6, 3.0], [3.0, 3.7], [3.4, 3.6], [6.0, 5.0], [3.2, 3.3], [6.0, 4.5], [3.4, 2.8], [3, 1.5], [2.4, 2.6],
];

// Wall colours. Soviet-period plaster in Ulaanbaatar is typically pale yellow, pink, green or grey.
const PAL: Record<string, number[]> = {
  panel: [0xd9d2c2, 0xcfc8ba, 0xd6d3cb, 0xd4c5b4, 0xc6cfca, 0xbdbdb6, 0xc9b8a6, 0xd0d6dc],
  walkup: [0xe6d39a, 0xe3bfa6, 0xcdd9b6, 0xe9dcc0, 0xd9b9a0, 0xc9d3d6, 0xe0c890, 0xd8c7b8, 0xeadfce],
  tower: [0xe8e4dc, 0xd9d3c8, 0xe0c9b4, 0xc9d4dc, 0xd6b8a4, 0xdfe2e2, 0xcfc2ae, 0xe6dccb],
  brick: [0xb87a56, 0xa5805f, 0xc9b59a, 0x96705a, 0xb3a48f, 0xc7c2b8, 0x9f8a70],
  wood: [0xa98a63, 0x8c6f4e, 0xb89a72, 0x7d6b58, 0x9a8a78, 0xa8754f],
  felt: [0xf4f1e8, 0xebe7dc, 0xf7f5ef],
  plain: [0x9a9da2, 0xa68b76, 0x8d9195, 0xb5aea2, 0xa9a59c],
  retail: [0xd9dde0, 0xcfd3d2, 0xe2dccf, 0xc3ccd3, 0xe6e0d2, 0xd8cdbd],
  mall: [0xdcdfe2, 0xe6e1d6, 0xcfd6dc, 0xe8d9c2, 0xd6d0c8],
  civic: [0xe2d6b6, 0xd8cfbb, 0xe8dfca, 0xd9c7a4, 0xe9e6de],
  school: [0xe9dfc6, 0xdfd0b0, 0xe6e3da, 0xd9c2a8, 0xd3dcd0, 0xe8cfae],
  medical: [0xe8ece9, 0xdde6e2, 0xeeeae0, 0xd9e2e6],
  religious: [0xc9a37c, 0xe6dcc6, 0xb9896a, 0xe9e2d2],
  industrial: [0xaeb4b8, 0x9aa6ad, 0xb8b0a2, 0x8f9a94, 0xa7a199, 0x9fb0b8],
  hotel: [0xe2d8c6, 0xd6cdbf, 0xe8e2d6, 0xcbbfae],
  glass: [0xdfe9f2, 0xcfe0ee, 0xe6ecef, 0xd2dde2],
  glassDark: [0xcfe2dc, 0xd9e2ea, 0xe6dccb, 0xc9d6e2],
};
const ROOF_METAL = [0x8c3b2e, 0x3f6b4f, 0x35557a, 0x6b6f76, 0x7a4a2a, 0x9a4a3a, 0x4d7a86];

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const srgb = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export const rgb = (hex: number, k = 1): RGB => [srgb((hex >> 16) & 255) * k, srgb((hex >> 8) & 255) * k, srgb(hex & 255) * k];

export function ringArea(ring: P2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
export function inRing(ring: P2[], e: number, n: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > n) !== (b[1] > n) && e < ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Lowest and highest terrain under a footprint: its corners plus an 8 m lattice of interior points. */
export function groundRange(ring: P2[], hAt: HeightFn): [number, number] {
  let lo = Infinity, hi = -Infinity, e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  const take = (e: number, n: number) => { const h = hAt(e, n); if (h < lo) lo = h; if (h > hi) hi = h; };
  for (const p of ring) { take(p[0], p[1]); e0 = Math.min(e0, p[0]); e1 = Math.max(e1, p[0]); n0 = Math.min(n0, p[1]); n1 = Math.max(n1, p[1]); }
  const S = 8;
  for (let n = Math.ceil(n0 / S) * S; n <= n1; n += S) for (let e = Math.ceil(e0 / S) * S; e <= e1; e += S) if (inRing(ring, e, n)) take(e, n);
  return [lo, hi];
}
/** Counter-clockwise copy of a ring without a repeated closing point. */
export function ccw(src: P2[]): P2[] {
  let ring = ringArea(src) > 0 ? src.slice() : src.slice().reverse();
  const f = ring[0], l = ring[ring.length - 1];
  if (ring.length > 3 && Math.hypot(f[0] - l[0], f[1] - l[1]) < 0.01) ring = ring.slice(0, -1);
  return ring;
}

export interface Look {
  arch: string;
  height: number;
  /** true when the height is an estimate (anything but a height stated in the source). */
  estimated: boolean;
  style: number; pal: string;
  roof: 0 | 1 | 2;                  // 0 flat, 1 gable, 2 ger
  shop: boolean;                    // glazed ground floor
  doors: 0 | 1 | 2;                 // 0 none, 1 one entrance, 2 one per stairwell along the longest wall
  parapet: boolean;
}
/**
 * How a building is drawn. The category and height come from the data (`arch`, `vis_height`, both
 * flagged with their origin by the pipeline); only the facade choice within a category uses the
 * per-building hash, so neighbours of the same type do not look identical.
 */
export function buildingLook(b: BuildingData, area: number, corners: number): Look {
  const h = hash(b.id), u = ((h >>> 3) & 255) / 256;
  const arch = b.arch ?? 'commercial';
  const height = b.vis_height ?? b.height;
  const estimated = (b.vis_height_src ?? b.height_src) !== 'source';
  let style: number = STYLE.plain, pal = 'plain', roof: 0 | 1 | 2 = 0, shop = false, doors: 0 | 1 | 2 = 0, parapet = height >= 6;
  switch (arch) {
    case 'ger': style = STYLE.felt; pal = 'felt'; roof = 2; parapet = false; break;
    case 'house':
      if (u < 0.3) { style = STYLE.wood; pal = 'wood'; } else { style = STYLE.brick; pal = 'brick'; }
      roof = corners === 4 && area < 320 ? 1 : 0; parapet = false; break;
    case 'utility': style = STYLE.plain; pal = 'plain'; parapet = false; break;
    case 'soviet_apartment':
      if (height <= 16.5) { style = STYLE.walkup; pal = 'walkup'; } else { style = STYLE.panel; pal = 'panel'; }
      doors = 2; shop = height > 16.5 && area >= 500 && (h & 7) < 2; break;
    case 'residential':
      style = STYLE.tower; pal = 'tower'; doors = 1; shop = height >= 27 && (h & 3) < 2; break;
    case 'glass_tower': style = u < 0.5 ? STYLE.glass : STYLE.glassDark; pal = u < 0.5 ? 'glass' : 'glassDark'; shop = true; break;
    case 'hotel':
      if (height >= 40) { style = STYLE.glassDark; pal = 'glassDark'; } else { style = STYLE.hotel; pal = 'hotel'; }
      shop = height >= 12; doors = shop ? 0 : 1; break;
    case 'commercial':
      if (height >= 30) { style = STYLE.glass; pal = 'glass'; } else { style = STYLE.retail; pal = 'retail'; }
      shop = height >= 5 && area >= 60; doors = shop ? 0 : 1; break;
    case 'mall': style = STYLE.mall; pal = 'mall'; shop = true; break;
    case 'government': style = STYLE.civic; pal = 'civic'; doors = 1; break;
    case 'religious': style = STYLE.civic; pal = 'religious'; doors = 1; break;
    case 'education': style = STYLE.school; pal = 'school'; doors = 1; break;
    case 'medical': style = STYLE.school; pal = 'medical'; doors = 1; break;
    case 'industrial': style = STYLE.industrial; pal = 'industrial'; parapet = false; break;
  }
  if (area < 30 && arch !== 'ger') { style = STYLE.plain; shop = false; doors = 0; }
  return { arch, height, estimated, style, pal, roof, shop, doors, parapet };
}

export interface BuildingMesh extends MeshData { colliders: Collider[]; roofArea: number; estimatedHeights: number; landmarks: number }

/** Low-level mesh writer shared by ordinary buildings and landmark builders. Coordinates are world East/Y/North. */
export class MeshWriter {
  pos: number[] = []; nor: number[] = []; uvs: number[] = []; col: number[] = []; sty: number[] = []; idx: number[] = [];
  colliders: Collider[] = [];
  constructor(readonly e0: number, readonly n0: number, readonly hAt: HeightFn | undefined, readonly detail: boolean) {}
  vert(e: number, y: number, n: number, nx: number, ny: number, nz: number, u: number, v: number, c: RGB, k: number, st: number) {
    this.pos.push(e - this.e0, y, -(n - this.n0)); this.nor.push(nx, ny, nz); this.uvs.push(u, v); this.col.push(c[0] * k, c[1] * k, c[2] * k); this.sty.push(st);
    return this.pos.length / 3 - 1;
  }
  /** Vertical quad from p to q; the outward normal is on the right of p->q (counter-clockwise ring). */
  wall(p: P2, q: P2, y0: number, y1: number, st: number, c: RGB, u0: number, u1: number, v0: number, v1: number, kBottom = 1) {
    const de = q[0] - p[0], dn = q[1] - p[1], len = Math.hypot(de, dn) || 1;
    const nx = dn / len, nz = de / len;
    const a = this.vert(p[0], y0, p[1], nx, 0, nz, u0, v0, c, kBottom, st);
    this.vert(q[0], y0, q[1], nx, 0, nz, u1, v0, c, kBottom, st);
    this.vert(q[0], y1, q[1], nx, 0, nz, u1, v1, c, 1, st);
    this.vert(p[0], y1, p[1], nx, 0, nz, u0, v1, c, 1, st);
    this.idx.push(a, a + 1, a + 2, a, a + 2, a + 3);
  }
  /** Planar polygon ([e, y, n] points) with a computed normal; counter-clockwise seen from its front. */
  face(pts: P3[], st: number, c: RGB, uv: (p: P3) => P2 = (p) => [p[0] / 8, p[2] / 8]) {
    const [a, b, d] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = -(b[2] - a[2]), vx = d[0] - a[0], vy = d[1] - a[1], vz = -(d[2] - a[2]);
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i0 = this.pos.length / 3;
    for (const p of pts) { const t = uv(p); this.vert(p[0], p[1], p[2], nx, ny, nz, t[0], t[1], c, 1, st); }
    for (let i = 1; i < pts.length - 1; i++) this.idx.push(i0, i0 + i, i0 + i + 1);
  }
  /** Horizontal cap over a ring with optional holes. `yOf` lets a builder slope it (stadium stands). */
  cap(ring: P2[], holes: P2[][], y: number | ((p: P2, hole: boolean) => number), c: RGB, st: number = STYLE.roof) {
    const tris = ShapeUtils.triangulateShape(ring.map((p) => new Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new Vector2(p[0], p[1]))));
    const all: P2[] = ring.concat(...holes);
    const r0 = this.pos.length / 3;
    all.forEach((p, i) => this.vert(p[0], typeof y === 'number' ? y : y(p, i >= ring.length), p[1], 0, 1, 0, p[0] / 8, p[1] / 8, c, 1, st));
    for (const t of tris) {
      const a = all[t[0]], b = all[t[1]], d = all[t[2]];
      const s = (b[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (b[1] - a[1]);
      if (s >= 0) this.idx.push(r0 + t[0], r0 + t[1], r0 + t[2]); else this.idx.push(r0 + t[0], r0 + t[2], r0 + t[1]);
    }
  }
  /** Windowed walls around a ring: whole bays per wall and whole floors, so no window is ever cut. */
  facade(ring: P2[], y0: number, y1: number, st: number, c: RGB, h: number, kBottom = 1, inward = false) {
    const [bay, floorH] = CELL_M[st];
    const floors = Math.max(1, Math.round((y1 - y0) / floorH));
    const vOff = ((h >>> 4) % TEX_CELLS) / TEX_CELLS;
    let run = 0;
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const i = inward ? n - 1 - k : k;
      const p = ring[i], q = ring[inward ? (i - 1 + n) % n : (i + 1) % n];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.01) continue;
      if (st !== STYLE.plain && len >= 1.9) {
        const bays = Math.max(1, Math.round(len / bay)), uOff = ((h + i * 3) % TEX_CELLS) / TEX_CELLS;
        this.wall(p, q, y0, y1, st, c, uOff, uOff + bays / TEX_CELLS, vOff, vOff + floors / TEX_CELLS, kBottom);
      } else {
        this.wall(p, q, y0, y1, STYLE.plain, c, run / 3.2 / TEX_CELLS, (run + len) / 3.2 / TEX_CELLS, 0, (y1 - y0) / 3 / TEX_CELLS, kBottom);
      }
      run += len;
    }
  }
  /** Glazed ground floor (shop windows and doors) around a ring, one storey tall from y0. */
  shopfront(ring: P2[], y0: number, h: number, tint: RGB) {
    const top = y0 + CELL_M[STYLE.shop][1];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 0.01) continue;
      const uOff = ((h + i * 5) % TEX_CELLS) / TEX_CELLS, vOff = ((h >>> 6) % TEX_CELLS) / TEX_CELLS;
      if (len >= 2.4) this.wall(p, q, y0, top, STYLE.shop, [0.9, 0.9, 0.9], uOff, uOff + Math.max(1, Math.round(len / CELL_M[STYLE.shop][0])) / TEX_CELLS, vOff, vOff + 1 / TEX_CELLS, 0.85);
      else this.wall(p, q, y0, top, STYLE.plain, tint, 0, len / 3.2 / TEX_CELLS, 0, 1 / TEX_CELLS, 0.85);
    }
    return top;
  }
  /** Axis-aligned-to-(de,dn) box: centre, half sizes along and across, from y0 to y1. Sides and top. */
  box(ce: number, cn: number, de: number, dn: number, hw: number, hd: number, y0: number, y1: number, st: number, c: RGB, top: RGB = c, bottom = false) {
    const B: P2[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [ce + de * x - dn * y, cn + dn * x + de * y] as P2);
    for (let i = 0; i < 4; i++) this.wall(B[i], B[(i + 1) % 4], y0, y1, st, c, 0, 0.1, 0, 0.1, 0.85);
    this.face(B.map((p) => [p[0], y1, p[1]] as P3), STYLE.roof, top);
    if (bottom) this.face(B.slice().reverse().map((p) => [p[0], y0, p[1]] as P3), STYLE.plain, [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6]);
    return B;
  }
  /** Upright cylinder or cone frustum, `seg` sides. */
  drum(ce: number, cn: number, r0: number, r1: number, y0: number, y1: number, seg: number, st: number, c: RGB, uvScale = 1) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      // counter-clockwise seen from above so the right-hand side of each edge faces out
      const p0: P3 = [ce + Math.cos(a0) * r0, y0, cn + Math.sin(a0) * r0], p1: P3 = [ce + Math.cos(a1) * r0, y0, cn + Math.sin(a1) * r0];
      const q1: P3 = [ce + Math.cos(a1) * r1, y1, cn + Math.sin(a1) * r1], q0: P3 = [ce + Math.cos(a0) * r1, y1, cn + Math.sin(a0) * r1];
      const u0 = (i / seg) * uvScale, u1 = ((i + 1) / seg) * uvScale;
      const uv = (p: P3): P2 => [p === p0 || p === q0 ? u0 : u1, p === p0 || p === p1 ? 0 : 1 / TEX_CELLS];
      if (r1 < 0.01) this.face([p0, p1, q0], st, c, uv); else this.face([p0, p1, q1, q0], st, c, uv);
    }
  }
  collide(ring: P2[], base: number, top: number) { this.colliders.push(makeCollider(ring, base, top)); }
  /** Ground levels for a footprint: [lowest terrain, street level (highest terrain)]. */
  levels(ring: P2[], dataBase: number): [number, number] {
    if (!this.hAt) return [dataBase, dataBase];
    const r = groundRange(ring, this.hAt);
    return [Math.min(dataBase, r[0]), Math.max(dataBase, r[1])];
  }
}

export function centroid(ring: P2[]): P2 {
  let ce = 0, cn = 0;
  for (const p of ring) { ce += p[0]; cn += p[1]; }
  return [ce / ring.length, cn / ring.length];
}

/** A ger: round felt tent on the real footprint's centre, door facing south as tradition requires. */
function ger(w: MeshWriter, ring: P2[], street: number, lo: number, A: number, tint: RGB, h: number) {
  const [ce, cn] = centroid(ring);
  const r = Math.max(2.2, Math.min(4.6, Math.sqrt(A / Math.PI)));
  const wallH = 1.5, top = street + 2.4, seg = w.detail ? 12 : 8;
  w.drum(ce, cn, r, r, lo - 0.3, street + wallH, seg, STYLE.felt, tint, 1);
  w.drum(ce, cn, r, r * 0.16, street + wallH, top, seg, STYLE.plain, [tint[0] * 0.93, tint[1] * 0.93, tint[2] * 0.9]);
  w.drum(ce, cn, r * 0.16, 0, top, top + 0.05, seg, STYLE.plain, [0.35, 0.2, 0.1]);          // crown ring (toono)
  if (w.detail) {                                                                             // painted wooden door, south side
    const dw = 0.45, c: RGB = rgb([0xb5542a, 0x9a3b24, 0x2f6a8a, 0xc27a2c][h & 3]);
    const p: P2 = [ce + dw, cn - r - 0.03], q: P2 = [ce - dw, cn - r - 0.03];
    w.wall(q, p, street, street + 1.35, STYLE.plain, c, 0, 0.05, 0, 0.05);
  }
  w.collide(ring, lo - 0.5, top);
}

/**
 * Extrudes every real footprint. The terrain tiles are a surface model: in the city they bulge under
 * large buildings, so each building stands on the highest terrain under its footprint and its walls
 * reach down to the lowest. `detail` (near chunks) adds shopfronts, entrances, parapets, pitched
 * roofs and rooftop boxes. `minAreaM2` drops tiny footprints from the distant level of detail only.
 */
export function buildBuildings(buildings: BuildingData[], cx: number, cy: number, hAt?: HeightFn, detail = true, minAreaM2 = 0,
                               registry?: LandmarkRegistry): BuildingMesh {
  const w = new MeshWriter(cx * CHUNK_M, cy * CHUNK_M, hAt, detail);
  let roofArea = 0, estimatedHeights = 0, landmarks = 0;

  for (const b of buildings) {
    const h = hash(b.id);
    const lm = registry?.byBuilding[b.id];
    for (let ri = 0; ri < b.rings.length; ri++) {
      const src = b.rings[ri];
      if (src.length < 3) continue;
      const A0 = Math.abs(ringArea(src));
      if (A0 < 0.5) continue;
      const ring = ccw(src);
      const holes = ri === 0 && b.holes ? b.holes.map((x) => ccw(x)) : [];
      const A = A0 - holes.reduce((s, x) => s + Math.abs(ringArea(x)), 0);
      if (A0 < minAreaM2 && !lm) continue;     // distant LOD: sheds and gers are a few pixels at most
      roofArea += A;
      const dataBase = b.base_z - ORIGIN_GROUND_M;
      const [lo, street] = w.levels(ring, dataBase);
      if (lm && LANDMARK_BUILDERS[lm.builder]) {
        LANDMARK_BUILDERS[lm.builder]({ w, b, ring, holes, lo, street, h, part: lm, def: registry!.defs[lm.key] });
        landmarks++;
        continue;
      }
      const look = buildingLook(b, A, ring.length);
      if (look.estimated) estimatedHeights++;
      const pal = PAL[look.pal] ?? PAL.plain;
      const shade = 0.92 + ((h >>> 8) % 100) / 600;
      const tint = rgb(pal[h % pal.length], shade);
      if (look.roof === 2) { ger(w, ring, street, lo, A, tint, h); continue; }

      const topY = street + look.height, lowY = lo - 0.5;
      w.collide(ring, lowY, topY);
      const st = look.style;
      const grey: RGB = [0.33 * shade, 0.33 * shade, 0.34 * shade];
      const eave = look.roof === 1 && detail ? topY - Math.min(2.2, look.height * 0.38) : topY;
      const shop = look.shop && detail;
      const bodyFrom = street - lo > 0.4 || shop ? street : lowY;
      const shopTop = street + CELL_M[STYLE.shop][1];
      const bodyBase = shop ? shopTop : bodyFrom;
      // plinth down to the lowest ground, glazed ground floor, then the windowed body
      if (bodyFrom > lowY) w.facade(ring, lowY, bodyFrom, STYLE.plain, grey, h, 0.8);
      if (shop) w.shopfront(ring, street, h, tint);
      w.facade(ring, bodyBase, eave, st, tint, h, shop ? 1 : 0.82);
      for (const hole of holes) w.facade(hole, bodyFrom, eave, st, tint, h + 7, 0.82, true);     // courtyard walls

      // entrances with a canopy on the longest wall (one per stairwell on housing slabs)
      if (detail && look.doors && !shop) {
        let bi = 0, bl = 0;
        for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > bl) { bl = l; bi = i; } }
        if (bl >= 6) {
          const p = ring[bi], q = ring[(bi + 1) % ring.length];
          const de = (q[0] - p[0]) / bl, dn = (q[1] - p[1]) / bl, oe = dn, on = -de;                 // o = outward
          const count = look.doors === 2 ? Math.max(1, Math.min(6, Math.round(bl / 22))) : 1;
          const [dw, dh] = CELL_M[STYLE.door];
          for (let k = 0; k < count; k++) {
            const t = ((k + 0.5) / count) * bl, me = p[0] + de * t + oe * 0.07, mn = p[1] + dn * t + on * 0.07;
            const a: P2 = [me - de * dw / 2, mn - dn * dw / 2], c: P2 = [me + de * dw / 2, mn + dn * dw / 2];
            const u = ((h + k) % TEX_CELLS) / TEX_CELLS;
            w.wall(a, c, street, street + dh, STYLE.door, [0.92, 0.92, 0.92], u, u + 1 / TEX_CELLS, 0, 1 / TEX_CELLS, 0.9);
            const y0 = street + dh + 0.1, y1 = y0 + 0.18, hw = dw / 2 + 0.5, dp = 1.3;
            const A1: P2 = [me - de * hw, mn - dn * hw], B1: P2 = [me + de * hw, mn + dn * hw];
            const A2: P2 = [A1[0] + oe * dp, A1[1] + on * dp], B2: P2 = [B1[0] + oe * dp, B1[1] + on * dp];
            const cc: RGB = [tint[0] * 0.7, tint[1] * 0.7, tint[2] * 0.7];
            w.face([[A1[0], y1, A1[1]], [B1[0], y1, B1[1]], [B2[0], y1, B2[1]], [A2[0], y1, A2[1]]], STYLE.roof, cc);
            w.face([[A2[0], y0, A2[1]], [B2[0], y0, B2[1]], [B1[0], y0, B1[1]], [A1[0], y0, A1[1]]], STYLE.plain, [cc[0] * 0.6, cc[1] * 0.6, cc[2] * 0.6]);
            w.wall(A2, B2, y0, y1, STYLE.plain, cc, 0, 0.05, 0, 0.05);
          }
        }
      }

      // roof
      const rc: RGB = [0.3 + tint[0] * 0.18, 0.3 + tint[1] * 0.18, 0.31 + tint[2] * 0.18];
      if (look.roof === 1 && detail && ring.length === 4) {    // small house: gable roof in coloured sheet metal
        const k = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]) >= Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]) ? 0 : 1;
        const P = [0, 1, 2, 3].map((i) => ring[(i + k) % 4]);
        const m1: P2 = [(P[1][0] + P[2][0]) / 2, (P[1][1] + P[2][1]) / 2], m3: P2 = [(P[3][0] + P[0][0]) / 2, (P[3][1] + P[0][1]) / 2];
        const dl = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) || 1, de = (P[1][0] - P[0][0]) / dl, dn = (P[1][1] - P[0][1]) / dl;
        const metal = rgb(ROOF_METAL[(h >>> 6) % ROOF_METAL.length], 0.9);
        const muv = (v: P3): P2 => [(v[0] * de + v[2] * dn) / 3.2, (v[0] * -dn + v[2] * de) / 3.2 + v[1] / 3.2];
        w.face([[P[0][0], eave, P[0][1]], [P[1][0], eave, P[1][1]], [m1[0], topY, m1[1]], [m3[0], topY, m3[1]]], STYLE.metal, metal, muv);
        w.face([[P[2][0], eave, P[2][1]], [P[3][0], eave, P[3][1]], [m3[0], topY, m3[1]], [m1[0], topY, m1[1]]], STYLE.metal, metal, muv);
        const puv = (v: P3): P2 => [(v[0] + v[2]) / 26, v[1] / 26];
        w.face([[P[1][0], eave, P[1][1]], [P[2][0], eave, P[2][1]], [m1[0], topY, m1[1]]], STYLE.plain, tint, puv);
        w.face([[P[3][0], eave, P[3][1]], [P[0][0], eave, P[0][1]], [m3[0], topY, m3[1]]], STYLE.plain, tint, puv);
      } else {                                                 // flat roof (metal sheet colour on sheds and factories)
        const sheet = look.arch === 'industrial' || (look.arch === 'house' && detail);
        w.cap(ring, holes, topY, sheet ? rgb(ROOF_METAL[(h >>> 6) % ROOF_METAL.length], 0.8) : rc, sheet ? STYLE.metal : STYLE.roof);
        if (detail && look.parapet) {
          const pc: RGB = [tint[0] * 0.86, tint[1] * 0.86, tint[2] * 0.86];
          for (let i = 0; i < ring.length; i++) w.wall(ring[i], ring[(i + 1) % ring.length], topY, topY + 0.5, STYLE.plain, pc, 0, 0.05, 0, 0.05);
        }
        // rooftop stair/lift box on larger blocks: decorative, placed only where it fits inside the footprint
        if (detail && look.height >= 14 && A > 300 && !holes.length) {
          const [ce, cn] = centroid(ring);
          const dl = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]) || 1;
          const de = (ring[1][0] - ring[0][0]) / dl, dn = (ring[1][1] - ring[0][1]) / dl;
          const hw = 2.4 + (h % 3), hd = 2;
          const fits = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].every(([x, y]) => inRing(ring, ce + de * x - dn * y, cn + dn * x + de * y));
          if (fits) w.box(ce, cn, de, dn, hw, hd, topY, topY + 2.6, STYLE.plain, [tint[0] * 0.8, tint[1] * 0.8, tint[2] * 0.8], rc);
        }
      }
    }
  }
  // landmark features that are not buildings in the source (for example a statue on a mapped plaza)
  if (registry) for (const x of registry.extras) {
    if (Math.floor(x.east / CHUNK_M) !== cx || Math.floor(x.north / CHUNK_M) !== cy) continue;
    const fn = LANDMARK_BUILDERS[x.builder];
    if (fn) { const y = hAt ? hAt(x.east, x.north) : 0; fn({ w, ring: [[x.east, x.north]], holes: [], lo: y, street: y, h: 1, part: x, def: registry.defs[x.key] }); landmarks++; }
  }
  return { position: new Float32Array(w.pos), normal: new Float32Array(w.nor), uv: new Float32Array(w.uvs), color: new Float32Array(w.col),
    style: new Float32Array(w.sty), index: new Uint32Array(w.idx), colliders: w.colliders, roofArea, estimatedHeights, landmarks };
}
