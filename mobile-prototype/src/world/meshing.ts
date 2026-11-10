// Pure geometry builders (typed arrays in, typed arrays out) so they run in tests without WebGL.
// Local frame of a chunk mesh: x = east - cx*256, y = world Y, z = -(north - cy*256).
import { ShapeUtils, Vector2 } from 'three';
import { CHUNK_M, ORIGIN_GROUND_M } from '../core/geo';
import { makeCollider, type Collider } from './collision';
import type { BuildingData, RoadData } from './types';

export interface MeshData {
  position: Float32Array; normal: Float32Array; uv: Float32Array; color?: Float32Array; index: Uint32Array;
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
/** Atlas columns in the road texture (see materials.ts): 0 asphalt, 1 asphalt + centre dashes, 2 paving. */
const atlasU = (col: number, t: number) => (col + 0.06 + t * 0.88) / 3;

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
    const column = foot ? 2 : LINED.has(r.class) && r.oneway === 0 ? 1 : 0;
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
// Facade tints. These are a visual stand-in chosen per building class; the source data carries
// almost no facade colours (see docs/STATUS.md), so this is styling, not survey data.
const PALETTES: Record<string, number[]> = {
  apartments: [0xcfc6b4, 0xbdb7ab, 0xd8cfa6, 0xc9b9a8, 0xb8c2bd, 0xd2c1b8, 0xa9a9a4],
  house: [0xa8623f, 0x8f6b4e, 0xb9a48a, 0x7d5a44, 0xa39480],
  ger: [0xf2efe6, 0xe9e5da],
  garage: [0x7c7f84, 0x8a6f5c, 0x6f7377],
  commercial: [0x8fa3b5, 0x9aa7ad, 0xb7b1a5, 0x6f8799, 0xc4bcae],
  civic: [0xcbbf9f, 0xbfb6a3, 0xd6cdb9],
  tall: [0xa9bdcc, 0xb4c3cc, 0x9db3c4, 0xc2c8cc, 0xbdb7ab],
  other: [0xbfb8aa, 0xb3ada2, 0xc7bca4, 0xa7a59f, 0xc2b3a3],
};
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const srgb = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
function paletteFor(b: BuildingData): number[] {
  if (b.class === 'ger') return PALETTES.ger;
  if (b.height >= 40) return PALETTES.tall;
  if (b.class === 'apartments' || b.class === 'dormitory' || b.class === 'residential') return PALETTES.apartments;
  if (b.class === 'house' || b.class === 'terrace') return PALETTES.house;
  if (b.class === 'garage' || b.class === 'garages') return PALETTES.garage;
  if (b.subtype === 'commercial') return PALETTES.commercial;
  if (b.subtype === 'civic' || b.subtype === 'education' || b.subtype === 'medical' || b.subtype === 'religious') return PALETTES.civic;
  return PALETTES.other;
}

export const WINDOW_W = 3.2, FLOOR_H = 3.0, TEX_CELLS = 8;
export function ringArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

export interface BuildingMesh extends MeshData { colliders: Collider[]; roofArea: number }

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
 * Extrudes every real footprint to its height (source or flagged estimate).
 * The terrain tiles are a surface model: in the city they already bulge under large buildings, and a
 * building placed at its lowest corner ends up buried in that bulge. With `hAt`, each building stands
 * on the highest terrain under its footprint and its walls reach down to the lowest, so the stated
 * height is always visible above ground. Without it, the raw `base_z` from the data is used.
 */
export function buildBuildings(buildings: BuildingData[], cx: number, cy: number, hAt?: HeightFn): BuildingMesh {
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], col: number[] = [], idx: number[] = [];
  const colliders: Collider[] = [];
  const e0 = cx * CHUNK_M, n0 = cy * CHUNK_M;
  let roofArea = 0;
  for (const b of buildings) {
    const h = hash(b.id);
    const pal = paletteFor(b);
    const hex = pal[h % pal.length];
    const shade = 0.9 + ((h >>> 8) % 100) / 500;
    const cr = srgb((hex >> 16) & 255) * shade, cg = srgb((hex >> 8) & 255) * shade, cb = srgb(hex & 255) * shade;
    const isGer = b.class === 'ger';
    const windowed = !isGer && b.class !== 'garage' && b.class !== 'garages';
    const dataBase = b.base_z - ORIGIN_GROUND_M;
    const uOff = (h % TEX_CELLS) / TEX_CELLS, vOff = ((h >>> 4) % TEX_CELLS) / TEX_CELLS;
    for (const src of b.rings) {
      if (src.length < 3) continue;
      const area = ringArea(src);
      if (Math.abs(area) < 0.5) continue;
      const ring = area > 0 ? src : src.slice().reverse();      // counter-clockwise seen from above
      let baseY = dataBase, topY = dataBase + b.height;
      if (hAt) { const [lo, hi] = groundRange(ring, hAt); baseY = Math.min(dataBase, lo); topY = Math.max(dataBase, hi) + b.height; }
      const wallH = topY - baseY;
      const windows = windowed && topY - dataBase >= 4.5;
      colliders.push(makeCollider(ring, baseY - 0.5, topY));
      // walls
      let run = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const de = q[0] - p[0], dn = q[1] - p[1];
        const len = Math.hypot(de, dn);
        if (len < 0.01) continue;
        const nx = dn / len, nz = de / len;
        const v0 = pos.length / 3;
        const px = p[0] - e0, pz = -(p[1] - n0), qx = q[0] - e0, qz = -(q[1] - n0);
        pos.push(px, baseY - 0.5, pz, qx, baseY - 0.5, qz, qx, topY, qz, px, topY, pz);
        for (let k = 0; k < 4; k++) { nor.push(nx, 0, nz); col.push(cr, cg, cb); }
        if (windows) {
          const u0 = run / WINDOW_W / TEX_CELLS + uOff, u1 = (run + len) / WINDOW_W / TEX_CELLS + uOff;
          const vTop = wallH / FLOOR_H / TEX_CELLS + vOff, vBot = -0.5 / FLOOR_H / TEX_CELLS + vOff;
          uvs.push(u0, vBot, u1, vBot, u1, vTop, u0, vTop);
        } else {
          for (let k = 0; k < 4; k++) uvs.push(0.004, 0.004);    // a plain wall texel
        }
        idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        run += len;
      }
      // roof
      const contour = ring.map((p) => new Vector2(p[0], p[1]));
      const tris = ShapeUtils.triangulateShape(contour, []);
      const r0 = pos.length / 3;
      const rk = isGer ? 1.0 : 0.42;
      for (const p of ring) {
        pos.push(p[0] - e0, topY, -(p[1] - n0));
        nor.push(0, 1, 0); uvs.push(0.004, 0.004);
        col.push(cr * rk + (isGer ? 0 : 0.03), cg * rk + (isGer ? 0 : 0.03), cb * rk + (isGer ? 0 : 0.035));
      }
      for (const t of tris) {
        const a = ring[t[0]], bb = ring[t[1]], c = ring[t[2]];
        const s = (bb[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (bb[1] - a[1]);
        roofArea += Math.abs(s) / 2;
        if (s >= 0) idx.push(r0 + t[0], r0 + t[1], r0 + t[2]); else idx.push(r0 + t[0], r0 + t[2], r0 + t[1]);
      }
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), uv: new Float32Array(uvs),
    color: new Float32Array(col), index: new Uint32Array(idx), colliders, roofArea };
}
