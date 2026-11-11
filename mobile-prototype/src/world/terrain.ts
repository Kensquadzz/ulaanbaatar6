// Height queries over the real terrain grids. Coordinates here are East/North metres; the returned
// height is world Y (elevation minus ORIGIN_GROUND_M). Interpolation matches the rendered triangles
// exactly, so the player's feet and the mesh never disagree.
import { CHUNK_M, ORIGIN_GROUND_M } from '../core/geo';
import type { Overview } from './types';

export class HeightField {
  private grids = new Map<string, Float32Array>();
  private overview: Overview | null = null;
  constructor(readonly n = 17) {}

  setOverview(o: Overview) { this.overview = o; }
  has(cx: number, cy: number) { return this.grids.has(cx + ',' + cy); }
  setChunk(cx: number, cy: number, heightDm: number[]) {
    const g = new Float32Array(heightDm.length);
    for (let i = 0; i < g.length; i++) g[i] = heightDm[i] / 10 - ORIGIN_GROUND_M;
    this.grids.set(cx + ',' + cy, g);
    return g;
  }
  removeChunk(cx: number, cy: number) { this.grids.delete(cx + ',' + cy); }

  heightAt(east: number, north: number): number {
    const cx = Math.floor(east / CHUNK_M), cy = Math.floor(north / CHUNK_M);
    const g = this.grids.get(cx + ',' + cy);
    if (g) return sampleGrid(g, this.n, (east - cx * CHUNK_M) / CHUNK_M, (north - cy * CHUNK_M) / CHUNK_M);
    return this.overviewAt(east, north);
  }

  /** Coarse (64 m) fallback from the overview; 0 outside the slice. */
  overviewAt(east: number, north: number): number {
    const o = this.overview;
    if (!o) return 0;
    const gx = (east - o.x0 * CHUNK_M) / o.cell_m, gy = (north - o.y0 * CHUNK_M) / o.cell_m;
    const i = Math.max(0, Math.min(o.w - 2, Math.floor(gx))), j = Math.max(0, Math.min(o.h - 2, Math.floor(gy)));
    const fx = Math.max(0, Math.min(1, gx - i)), fy = Math.max(0, Math.min(1, gy - j));
    const h = (ii: number, jj: number) => o.height_dm[jj * o.w + ii] / 10 - ORIGIN_GROUND_M;
    return triLerp(h(i, j), h(i + 1, j), h(i, j + 1), h(i + 1, j + 1), fx, fy);
  }
}

/** Two triangles per cell split along the SW-NE diagonal: (a,b,d) and (a,d,c). */
export function triLerp(a: number, b: number, c: number, d: number, fx: number, fy: number): number {
  return fx >= fy ? a + (b - a) * fx + (d - b) * fy : a + (c - a) * fy + (d - c) * fx;
}

/** u,v in 0..1 across the chunk (u east, v north). */
export function sampleGrid(g: Float32Array, n: number, u: number, v: number): number {
  const gx = Math.max(0, Math.min(n - 1, u * (n - 1))), gy = Math.max(0, Math.min(n - 1, v * (n - 1)));
  const i = Math.min(n - 2, Math.floor(gx)), j = Math.min(n - 2, Math.floor(gy));
  return triLerp(g[j * n + i], g[j * n + i + 1], g[(j + 1) * n + i], g[(j + 1) * n + i + 1], gx - i, gy - j);
}
