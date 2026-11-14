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

export * from './buildings';
