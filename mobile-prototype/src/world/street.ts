// Street dressing generated from the real road centre lines: raised sidewalks with curbs, zebra
// crossings where a mapped footway crosses a carriageway, and streetlight positions.
// The road alignment, class and width come from the data. Sidewalks, curbs, crossings' exact size
// and every lamp position are PROCEDURAL (the source has no such geometry) and are labelled so.
import { CHUNK_M } from '../core/geo';
import type { MeshData } from './meshing';
import type { BuildingData, RoadData } from './types';

type HeightFn = (east: number, north: number) => number;
export const ATLAS_COLS = 6;      // 0 asphalt, 1 two-way lined, 2 paving, 3 zebra, 4 wide two-way, 5 wide one-way
export const atlasU = (col: number, t: number) => (col + 0.04 + t * 0.92) / ATLAS_COLS;

const WALKED = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified']);
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const FOOT = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'steps']);
const CURB_H = 0.14;

export interface Lamp { e: number; n: number; y: number; de: number; dn: number }   // (de, dn): unit vector toward the road
export interface StreetMesh extends MeshData { lamps: Lamp[]; crossings: number; sidewalkM: number }

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

interface Seg { ae: number; an: number; be: number; bn: number; half: number; road: number }
class SegGrid {
  private cells = new Map<number, Seg[]>();
  private static C = 24;
  private key(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }
  add(s: Seg) {
    const C = SegGrid.C, pad = s.half + 1;
    const i0 = Math.floor((Math.min(s.ae, s.be) - pad) / C), i1 = Math.floor((Math.max(s.ae, s.be) + pad) / C);
    const j0 = Math.floor((Math.min(s.an, s.bn) - pad) / C), j1 = Math.floor((Math.max(s.an, s.bn) + pad) / C);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j); let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push(s);
    }
  }
  /** True when (e, n) lies on the carriageway of a road other than `self` (with `margin` metres to spare). */
  onOtherRoad(e: number, n: number, self: number, margin: number): boolean {
    const l = this.cells.get(this.key(Math.floor(e / SegGrid.C), Math.floor(n / SegGrid.C)));
    if (!l) return false;
    for (const s of l) {
      if (s.road === self) continue;
      const de = s.be - s.ae, dn = s.bn - s.an, l2 = de * de + dn * dn || 1;
      const t = Math.max(0, Math.min(1, ((e - s.ae) * de + (n - s.an) * dn) / l2));
      const d = Math.hypot(e - s.ae - de * t, n - s.an - dn * t);
      if (d < s.half + margin) return true;
    }
    return false;
  }
}

function inRing(ring: [number, number][], e: number, n: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > n) !== (b[1] > n) && e < ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Resamples a road centre line so no step is longer than `maxSeg`; returns points with tangents. */
function resample(r: RoadData, maxSeg: number) {
  const pe: number[] = [], pn: number[] = [];
  for (let i = 0; i < r.pts.length - 1; i++) {
    const a = r.pts[i], b = r.pts[i + 1];
    const parts = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxSeg));
    for (let k = 0; k < parts; k++) { pe.push(a[0] + ((b[0] - a[0]) * k) / parts); pn.push(a[1] + ((b[1] - a[1]) * k) / parts); }
  }
  const last = r.pts[r.pts.length - 1];
  pe.push(last[0]); pn.push(last[1]);
  const te: number[] = [], tn: number[] = [], dist: number[] = [];
  let d = 0;
  for (let i = 0; i < pe.length; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(pe.length - 1, i + 1);
    const l = Math.hypot(pe[i1] - pe[i0], pn[i1] - pn[i0]) || 1;
    te.push((pe[i1] - pe[i0]) / l); tn.push((pn[i1] - pn[i0]) / l);
    if (i > 0) d += Math.hypot(pe[i] - pe[i - 1], pn[i] - pn[i - 1]);
    dist.push(d);
  }
  return { pe, pn, te, tn, dist, length: d };
}

/**
 * `detail` (near chunks): sidewalks, curbs, crossings and lamps on every walked street.
 * Otherwise only lamp positions on major roads, for the distant night lights.
 */
export function buildStreet(roads: RoadData[], buildings: BuildingData[], cx: number, cy: number, hAt: HeightFn, detail: boolean): StreetMesh {
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], col: number[] = [], idx: number[] = [];
  const lamps: Lamp[] = [];
  const e0 = cx * CHUNK_M, n0 = cy * CHUNK_M;
  let crossings = 0, sidewalkM = 0;
  const grid = new SegGrid();
  roads.forEach((r, ri) => {
    if (!r.drivable) return;
    for (let i = 0; i < r.pts.length - 1; i++) grid.add({ ae: r.pts[i][0], an: r.pts[i][1], be: r.pts[i + 1][0], bn: r.pts[i + 1][1], half: Math.max(0.6, r.width / 2), road: ri });
  });
  const boxes = buildings.map((b) => {
    let a = Infinity, c = -Infinity, d = Infinity, f = -Infinity;
    for (const p of b.rings[0] ?? []) { a = Math.min(a, p[0]); c = Math.max(c, p[0]); d = Math.min(d, p[1]); f = Math.max(f, p[1]); }
    return [a, c, d, f] as const;
  });
  const inBuilding = (e: number, n: number, pad: number) => {
    for (let i = 0; i < buildings.length; i++) {
      const b = boxes[i];
      if (e < b[0] - pad || e > b[1] + pad || n < b[2] - pad || n > b[3] + pad) continue;
      if (pad > 0) return true;
      if (inRing(buildings[i].rings[0], e, n)) return true;
    }
    return false;
  };
  const inChunk = (e: number, n: number) => e >= e0 && e < e0 + CHUNK_M && n >= n0 && n < n0 + CHUNK_M;
  const V = (e: number, y: number, n: number, nx: number, ny: number, nz: number, u: number, v: number, k: number) => {
    pos.push(e - e0, y, -(n - n0)); nor.push(nx, ny, nz); uvs.push(u, v); col.push(k, k, k * 0.98);
    return pos.length / 3 - 1;
  };

  roads.forEach((r, ri) => {
    if (!r.drivable || r.pts.length < 2 || !WALKED.has(r.class)) return;
    const major = MAJOR.has(r.class);
    if (!detail && !major) return;
    const half = Math.max(0.6, r.width / 2);
    const h = hash(r.id);

    // streetlights: procedural spacing, alternating sides on major roads
    const spacing = major ? 34 : 46;
    const c = resample(r, 4);
    let next = (h % 1000) / 1000 * spacing * 0.8 + 4, side = h & 1 ? 1 : -1;
    for (let i = 0; i < c.pe.length; i++) {
      if (c.dist[i] < next) continue;
      next += spacing;
      const sides = major && r.width >= 12 ? [1, -1] : [side];
      side = -side;
      for (const s of sides) {
        const e = c.pe[i] - c.tn[i] * (half + 0.7) * s, n = c.pn[i] + c.te[i] * (half + 0.7) * s;
        if (!inChunk(e, n) || grid.onOtherRoad(e, n, ri, 0.4) || inBuilding(e, n, 0)) continue;
        lamps.push({ e, n, y: hAt(e, n), de: c.tn[i] * s, dn: -c.te[i] * s });
      }
    }
    if (!detail) return;

    // sidewalks with a curb face, both sides, broken wherever another carriageway passes
    const w = major ? 2.6 : 1.7;
    const tint = major ? 1.0 : 0.94;
    const sw = resample(r, 5);
    for (const s of [1, -1]) {
      let prev = -1;           // index of the previous cross-section's first vertex, or -1 after a gap
      for (let i = 0; i < sw.pe.length; i++) {
        const ie = sw.pe[i] - sw.tn[i] * half * s, inn = sw.pn[i] + sw.te[i] * half * s;                 // curb line
        const oe = sw.pe[i] - sw.tn[i] * (half + w) * s, on = sw.pn[i] + sw.te[i] * (half + w) * s;       // back of sidewalk
        const me = (ie + oe) / 2, mn = (inn + on) / 2;
        if (grid.onOtherRoad(me, mn, ri, 0.2) || grid.onOtherRoad(ie, inn, ri, -0.2)) { prev = -1; continue; }
        const yi = hAt(ie, inn), yo = hAt(oe, on);
        const v = sw.dist[i] / 8;
        const a = V(ie, yi + 0.06, inn, sw.tn[i] * s, 0, sw.te[i] * s, atlasU(2, 0.02), v, 0.62 * tint);   // curb foot
        V(ie, yi + CURB_H, inn, sw.tn[i] * s, 0, sw.te[i] * s, atlasU(2, 0.08), v, 0.8 * tint);            // curb top (side face)
        V(ie, yi + CURB_H, inn, 0, 1, 0, atlasU(2, 0.08), v, 1.06 * tint);                                    // kerbstone, lighter
        V(ie - sw.tn[i] * 0.3 * s, yi + CURB_H, inn + sw.te[i] * 0.3 * s, 0, 1, 0, atlasU(2, 0.16), v, 1.06 * tint);
        V(ie - sw.tn[i] * 0.3 * s, yi + CURB_H, inn + sw.te[i] * 0.3 * s, 0, 1, 0, atlasU(2, 0.16), v, 0.92 * tint);
        V(oe, yo + CURB_H * 0.6, on, 0, 1, 0, atlasU(2, 1), v, 0.92 * tint);
        if (prev >= 0) {
          for (const k of [0, 2, 4]) {
            const p0 = prev + k, p1 = prev + k + 1, q0 = a + k, q1 = a + k + 1;
            if (s === 1) idx.push(p0, q0, q1, p0, q1, p1); else idx.push(p0, q1, q0, p0, p1, q1);
          }
          sidewalkM += sw.dist[i] - sw.dist[i - 1];
        }
        prev = a;
      }
    }
  });

  // zebra crossings: a mapped footway that crosses a carriageway
  if (detail) {
    const done: [number, number][] = [];
    for (const f of roads) {
      if (f.drivable || !FOOT.has(f.class) || f.class === 'steps') continue;
      for (let i = 0; i < f.pts.length - 1; i++) {
        const a = f.pts[i], b = f.pts[i + 1];
        for (const r of roads) {
          if (!r.drivable || !WALKED.has(r.class)) continue;
          for (let j = 0; j < r.pts.length - 1; j++) {
            const c = r.pts[j], d = r.pts[j + 1];
            const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
            const den = rx * sy - ry * sx;
            if (Math.abs(den) < 1e-6) continue;
            const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            const xe = a[0] + rx * t, xn = a[1] + ry * t;
            if (!inChunk(xe, xn) || done.some((p) => Math.hypot(p[0] - xe, p[1] - xn) < 6)) continue;
            const sl = Math.hypot(sx, sy) || 1, te = sx / sl, tn = sy / sl;
            const cross = Math.abs((rx * tn - ry * te) / (Math.hypot(rx, ry) || 1));
            if (cross < 0.5) continue;                     // footway runs along the road, not across it
            done.push([xe, xn]); crossings++;
            const half = Math.max(1.5, r.width / 2) - 0.25, hw = 2;
            const corners: [number, number, number, number][] = [[-hw, -half, 0, 0], [hw, -half, 1, 0], [hw, half, 1, 1], [-hw, half, 0, 1]];
            const v0 = pos.length / 3;
            for (const [al, ac, tu, tv] of corners) {
              const e = xe + te * al - tn * ac, n = xn + tn * al + te * ac;
              V(e, hAt(e, n) + 0.1, n, 0, 1, 0, atlasU(3, tu), (tv * half * 2) / 8, 1);
            }
            idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
          }
        }
      }
    }
  }
  return { position: new Float32Array(pos), normal: new Float32Array(nor), uv: new Float32Array(uvs), color: new Float32Array(col),
    index: new Uint32Array(idx), lamps, crossings, sidewalkM };
}

export function mergeMeshes(a: MeshData, b: MeshData): MeshData {
  const cat = (x: Float32Array, y: Float32Array) => { const o = new Float32Array(x.length + y.length); o.set(x); o.set(y, x.length); return o; };
  const off = a.position.length / 3;
  const index = new Uint32Array(a.index.length + b.index.length);
  index.set(a.index);
  for (let i = 0; i < b.index.length; i++) index[a.index.length + i] = b.index[i] + off;
  return { position: cat(a.position, b.position), normal: cat(a.normal, b.normal), uv: cat(a.uv, b.uv),
    color: a.color && b.color ? cat(a.color, b.color) : undefined, index };
}
