// Real bridges and railway lines (data/tiles/bridges.json, rail.json from pipeline/ub6pipeline/build_bridges.py).
//
// WHAT IS REAL: where each bridge is (Overture's is_bridge range of the road), its centreline and
// width, and where the railway tracks run. WHAT IS ESTIMATED: the deck height. Overture has no deck
// elevation, so the deck rises from the terrain at both ends to a clearance chosen from the bridge
// length (about 7 m for the long Peace Avenue, Olympic and Sun bridges). Piers, parapets and the
// concrete look are generic, not surveyed.
//
// The deck is a real surface: cars drive up onto it and over it, people walk on it, and traffic and
// people below pass underneath (the deck colliders sit above head height there).
import { CHUNK_M } from '../core/geo';
import { makeCollider, type Collider } from './collision';
import type { MeshData } from './meshing';

export interface Bridge { ids: string[]; name: string | null; class: string; width: number; length_m: number; clearance_m: number; pts: [number, number, number][] }
interface Seg { b: Bridge; i: number; ae: number; an: number; ay: number; be: number; bn: number; by: number; half: number }
type HeightFn = (e: number, n: number) => number;

const CELL = 64;
const DECK_T = 1.0;          // slab thickness (m)
const PARAPET_H = 1.0;
const GAUGE = 1.52;          // Mongolian railways use the 1520 mm broad gauge

export class Bridges {
  bridges: Bridge[] = [];
  rail: { pts: [number, number][]; flags: string[] }[] = [];
  private grid = new Map<string, Seg[]>();
  private bridgeIds = new Set<string>();

  load(bridges: Bridge[], rail: { pts: [number, number][]; flags: string[] }[]) {
    this.bridges = bridges; this.rail = rail;
    for (const b of bridges) {
      b.ids.forEach((id) => this.bridgeIds.add(id));
      for (let i = 0; i < b.pts.length - 1; i++) {
        const [ae, an, ay] = b.pts[i], [be, bn, by] = b.pts[i + 1];
        const s: Seg = { b, i, ae, an, ay, be, bn, by, half: b.width / 2 };
        const pad = s.half + 1;
        for (let x = Math.floor((Math.min(ae, be) - pad) / CELL); x <= Math.floor((Math.max(ae, be) + pad) / CELL); x++)
          for (let y = Math.floor((Math.min(an, bn) - pad) / CELL); y <= Math.floor((Math.max(an, bn) + pad) / CELL); y++) {
            const k = x + ',' + y; let l = this.grid.get(k); if (!l) this.grid.set(k, (l = [])); l.push(s);
          }
      }
    }
  }

  /** True for a road whose segment carries a bridge (its deck heights come from here). */
  isBridgeRoad(id: string) { return this.bridgeIds.has(id); }

  /** Deck height at a point on a bridge (within its width), or null. */
  deckAt(e: number, n: number, pad = 0.3): number | null {
    const l = this.grid.get(Math.floor(e / CELL) + ',' + Math.floor(n / CELL));
    if (!l) return null;
    let best: number | null = null, bd = Infinity;
    for (const s of l) {
      const de = s.be - s.ae, dn = s.bn - s.an, l2 = de * de + dn * dn || 1;
      const t = Math.max(0, Math.min(1, ((e - s.ae) * de + (n - s.an) * dn) / l2));
      const d = Math.hypot(e - s.ae - de * t, n - s.an - dn * t);
      if (d <= s.half + pad && d < bd) { bd = d; best = s.ay + (s.by - s.ay) * t; }
    }
    return best;
  }

  /** Height to stand or drive on: the deck when coming from (or already at) deck level, else the ground. */
  surface(e: number, n: number, prevY: number, ground: number): number {
    const d = this.deckAt(e, n);
    return d !== null && d > ground + 0.2 && prevY > d - 1.6 ? d : ground;
  }

  /** Deck slabs, parapets, piers and railway tracks whose centre lies in this chunk, plus their colliders. */
  build(cx: number, cy: number, hAt: HeightFn): { mesh: MeshData; colliders: Collider[] } {
    const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
    const colliders: Collider[] = [];
    const e0 = cx * CHUNK_M, n0 = cy * CHUNK_M;
    const inChunk = (e: number, n: number) => Math.floor(e / CHUNK_M) === cx && Math.floor(n / CHUNK_M) === cy;
    const quad = (p: number[][], c: [number, number, number]) => {
      // p: four world points [e, y, n]; normal from the first triangle
      const ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], az = -(p[1][2] - p[0][2]);
      const bx = p[2][0] - p[0][0], by = p[2][1] - p[0][1], bz = -(p[2][2] - p[0][2]);
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const base = pos.length / 3;
      for (const q of p) { pos.push(q[0] - e0, q[1], -(q[2] - n0)); nor.push(nx, ny, nz); col.push(c[0], c[1], c[2]); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const box = (ce: number, cn: number, ue: number, un: number, hu: number, hv: number, y0: number, y1: number, c: [number, number, number]) => {
      const ve = -un, vn = ue;
      const P = (su: number, sv: number, y: number) => [ce + ue * hu * su + ve * hv * sv, y, cn + un * hu * su + vn * hv * sv];
      const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let k = 0; k < 4; k++) {
        const [su0, sv0] = corners[k], [su1, sv1] = corners[(k + 1) % 4];
        quad([P(su0, sv0, y0), P(su1, sv1, y0), P(su1, sv1, y1), P(su0, sv0, y1)], c);
      }
      quad([P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1)], c);
    };
    const CONCRETE: [number, number, number] = [0.52, 0.5, 0.47], UNDER: [number, number, number] = [0.27, 0.26, 0.25], PARAPET: [number, number, number] = [0.62, 0.6, 0.56];

    for (const b of this.bridges) {
      const half = b.width / 2;
      let sinceP = 0;
      for (let i = 0; i < b.pts.length - 1; i++) {
        const [ae, an, ay] = b.pts[i], [be, bn, by] = b.pts[i + 1];
        const len = Math.hypot(be - ae, bn - an) || 1;
        sinceP += len;
        if (!inChunk((ae + be) / 2, (an + bn) / 2)) continue;
        const ue = (be - ae) / len, un = (bn - an) / len, ve = -un, vn = ue;
        const L = (e: number, n: number, s: number) => [e + ve * half * s, n + vn * half * s];
        const [al, anl] = L(ae, an, 1), [ar, anr] = L(ae, an, -1), [bl, bnl] = L(be, bn, 1), [br, bnr] = L(be, bn, -1);
        const top = -0.06;   // the road ribbon is drawn on the deck top
        // underside, both sides of the slab
        quad([[ar, ay - DECK_T, anr], [br, by - DECK_T, bnr], [bl, by - DECK_T, bnl], [al, ay - DECK_T, anl]], UNDER);
        quad([[al, ay - DECK_T, anl], [bl, by - DECK_T, bnl], [bl, by + top, bnl], [al, ay + top, anl]], CONCRETE);
        quad([[br, by - DECK_T, bnr], [ar, ay - DECK_T, anr], [ar, ay + top, anr], [br, by + top, bnr]], CONCRETE);
        // parapets (both edges), 0.3 m thick
        for (const s of [1, -1]) {
          const oe = ve * (half - 0.15) * s, on = vn * (half - 0.15) * s;
          // sloped wall that follows the deck (inner face, outer face, top)
          const w = (side: number, y: number, top: number) => [
            [ae + oe + ve * 0.15 * side, ay + y + (top ? PARAPET_H : -0.05), an + on + vn * 0.15 * side],
            [be + oe + ve * 0.15 * side, by + y + (top ? PARAPET_H : -0.05), bn + on + vn * 0.15 * side]];
          const [i0, i1] = w(-1, 0, 0), [i2, i3] = w(-1, 0, 1), [o0, o1] = w(1, 0, 0), [o2, o3] = w(1, 0, 1);
          quad([i0, i1, i3, i2], PARAPET); quad([o1, o0, o2, o3], PARAPET); quad([i2, i3, o3, o2], PARAPET);
          const ring: [number, number][] = [[ae + oe - ve * 0.15, an + on - vn * 0.15], [be + oe - ve * 0.15, bn + on - vn * 0.15], [be + oe + ve * 0.15, bn + on + vn * 0.15], [ae + oe + ve * 0.15, an + on + vn * 0.15]];
          colliders.push(makeCollider(ring, Math.min(ay, by) - DECK_T, Math.max(ay, by) + PARAPET_H));
        }
        // deck colliders in 1.5 m pieces so walking up the ramp is a series of small steps
        const parts = Math.max(1, Math.ceil(len / 1.5));
        for (let k = 0; k < parts; k++) {
          const t0 = k / parts, t1 = (k + 1) / parts;
          const pe0 = ae + (be - ae) * t0, pn0 = an + (bn - an) * t0, pe1 = ae + (be - ae) * t1, pn1 = an + (bn - an) * t1;
          const y = ay + (by - ay) * t1;
          if (y - hAt((pe0 + pe1) / 2, (pn0 + pn1) / 2) < 0.25) continue;      // at grade: the terrain carries you
          const c = makeCollider([[pe0 + ve * half, pn0 + vn * half], [pe1 + ve * half, pn1 + vn * half], [pe1 - ve * half, pn1 - vn * half], [pe0 - ve * half, pn0 - vn * half]],
            Math.max(ay, by) - DECK_T, Math.max(ay + (by - ay) * t0, y));
          c.deck = true;
          colliders.push(c);
        }
        // piers about every 30 m where the deck is clearly off the ground
        if (sinceP >= 30) {
          const me = (ae + be) / 2, mn = (an + bn) / 2, my = (ay + by) / 2, g = hAt(me, mn);
          if (my - DECK_T - g > 2.2) {
            sinceP = 0;
            box(me, mn, ve, vn, Math.min(half * 0.7, 6), 0.7, g - 0.5, my - DECK_T + 0.02, CONCRETE);
            const pw = Math.min(half * 0.7, 6);
            colliders.push(makeCollider([[me + ve * pw - ue * 0.7, mn + vn * pw - un * 0.7], [me + ve * pw + ue * 0.7, mn + vn * pw + un * 0.7], [me - ve * pw + ue * 0.7, mn - vn * pw + un * 0.7], [me - ve * pw - ue * 0.7, mn - vn * pw - un * 0.7]], g - 1, my - DECK_T));
          }
        }
      }
    }

    // railway: ballast bed plus two steel rails, following the terrain
    const BALLAST: [number, number, number] = [0.11, 0.095, 0.085], STEEL: [number, number, number] = [0.7, 0.7, 0.74];
    for (const r of this.rail) {
      if (r.flags.includes('is_tunnel')) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ae, an] = r.pts[i], [be, bn] = r.pts[i + 1];
        const len = Math.hypot(be - ae, bn - an); if (len < 0.1) continue;
        const parts = Math.max(1, Math.ceil(len / 8));
        const ue = (be - ae) / len, un = (bn - an) / len, ve = -un, vn = ue;
        for (let k = 0; k < parts; k++) {
          const t0 = k / parts, t1 = (k + 1) / parts;
          const pe0 = ae + (be - ae) * t0, pn0 = an + (bn - an) * t0, pe1 = ae + (be - ae) * t1, pn1 = an + (bn - an) * t1;
          if (!inChunk((pe0 + pe1) / 2, (pn0 + pn1) / 2)) continue;
          const y0 = hAt(pe0, pn0) + 0.04, y1 = hAt(pe1, pn1) + 0.04;
          quad([[pe0 - ve * 1.7, y0, pn0 - vn * 1.7], [pe1 - ve * 1.7, y1, pn1 - vn * 1.7], [pe1 + ve * 1.7, y1, pn1 + vn * 1.7], [pe0 + ve * 1.7, y0, pn0 + vn * 1.7]], BALLAST);
          for (const s of [-1, 1]) {
            const o = s * GAUGE / 2;
            const a0 = [pe0 + ve * (o - 0.04), y0 + 0.14, pn0 + vn * (o - 0.04)], a1 = [pe1 + ve * (o - 0.04), y1 + 0.14, pn1 + vn * (o - 0.04)];
            const b0 = [pe0 + ve * (o + 0.04), y0 + 0.14, pn0 + vn * (o + 0.04)], b1 = [pe1 + ve * (o + 0.04), y1 + 0.14, pn1 + vn * (o + 0.04)];
            quad([a0, a1, b1, b0], STEEL);
          }
        }
      }
    }
    return {
      mesh: { position: new Float32Array(pos), normal: new Float32Array(nor), uv: new Float32Array((pos.length / 3) * 2), color: new Float32Array(col), index: new Uint32Array(idx) },
      colliders,
    };
  }
}
