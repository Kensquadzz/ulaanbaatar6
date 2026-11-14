// Landmark asset system.
//
// data/landmarks/registry.json lists each landmark, the real source footprints it is made of, what
// is VERIFIED about it (with the source) and what is an APPROXIMATION. Each part names a builder
// below. A landmark can later receive an authored 3D model: set `model` in the registry to a glTF
// file under public/landmarks/ and the procedural parts are replaced by that model (loadLandmarkModel).
//
// Every builder here starts from the real footprint at its real position. None of them is an
// accurate model of the building: they reproduce the overall mass and one or two recognisable
// features, and the registry says which.
import { CELL_M, STYLE, TEX_CELLS, centroid, rgb, type MeshWriter, type P2, type P3, type RGB } from './buildings';
import type { BuildingData } from './types';

export interface LandmarkPart { key: string; builder: string; params?: Record<string, number | string | boolean> }
export interface LandmarkExtra extends LandmarkPart { east: number; north: number }
export interface LandmarkDef {
  name: string; name_en: string; status: string; model: string | null;
  sources: string[]; verified: string[]; approximated: string[];
  parts: { building: string; builder: string; params?: LandmarkPart['params'] }[];
  extras?: { builder: string; east: number; north: number; params?: LandmarkPart['params'] }[];
}
export interface LandmarkRegistry { defs: Record<string, LandmarkDef>; byBuilding: Record<string, LandmarkPart>; extras: LandmarkExtra[] }

export function makeRegistry(json: { landmarks: Record<string, LandmarkDef> }): LandmarkRegistry {
  const reg: LandmarkRegistry = { defs: json.landmarks, byBuilding: {}, extras: [] };
  for (const [key, d] of Object.entries(json.landmarks)) {
    if (d.model) continue;                       // an authored model replaces the procedural parts
    for (const p of d.parts) reg.byBuilding[p.building] = { key, builder: p.builder, params: p.params };
    for (const x of d.extras ?? []) reg.extras.push({ key, ...x });
  }
  return reg;
}

export interface Ctx {
  w: MeshWriter; b?: BuildingData; ring: P2[]; holes: P2[][]; lo: number; street: number; h: number;
  part: LandmarkPart; def: LandmarkDef;
}
const num = (c: Ctx, k: string, d: number) => (typeof c.part.params?.[k] === 'number' ? (c.part.params[k] as number) : d);
const str = (c: Ctx, k: string, d: string) => (typeof c.part.params?.[k] === 'string' ? (c.part.params[k] as string) : d);
const dark = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const CONCRETE = rgb(0xb9b6ae), BRONZE = rgb(0x3a3128), STONE = rgb(0xd8d2c4);

/** Real footprint extruded to a stated height with a chosen facade. Used where only the mass is known. */
function prism(c: Ctx) {
  const { w, ring, holes, lo, street, h } = c;
  const H = num(c, 'height', c.b?.vis_height ?? c.b?.height ?? 10);
  const st = (STYLE as Record<string, number>)[str(c, 'style', 'glass')] ?? STYLE.glass;
  const tint = rgb(num(c, 'tint', 0xdde6ee));
  const top = street + H;
  w.collide(ring, lo - 0.5, top);
  if (street - lo > 0.4) w.facade(ring, lo - 0.5, street, STYLE.plain, [0.33, 0.33, 0.34], h, 0.8);
  const base = c.part.params?.shop && w.detail ? w.shopfront(ring, street, h, tint) : street;
  const crown = num(c, 'crown', 0);
  w.facade(ring, base, top - crown, st, tint, h, 0.9);
  for (const hole of holes) w.facade(hole, street, top - crown, st, tint, h + 7, 0.85, true);
  if (crown > 0) for (let i = 0; i < ring.length; i++) w.wall(ring[i], ring[(i + 1) % ring.length], top - crown, top, STYLE.plain, dark(tint, 0.55), 0, 0.05, 0, 0.05);
  w.cap(ring, holes, top, [0.32, 0.33, 0.35]);
}

/**
 * Government Palace. Real: footprint with its six courtyards and position. Approximate: height,
 * and the 2006 colonnade on the south front (overall arrangement only: a full-width colonnade with
 * a seated Chinggis Khaan figure at the centre and a smaller figure at each end).
 */
function govPalace(c: Ctx) {
  const { w, ring, holes, lo, street, h } = c;
  const H = num(c, 'height', 22), tint = rgb(0xf1eee6);
  const top = street + H;
  w.collide(ring, lo - 0.5, top);
  w.facade(ring, lo - 0.5, street, STYLE.plain, STONE, h, 0.8);
  w.facade(ring, street, top, STYLE.civic, tint, h, 0.9);
  for (const hole of holes) w.facade(hole, street, top, STYLE.civic, tint, h + 7, 0.85, true);
  w.cap(ring, holes, top, [0.36, 0.36, 0.37]);
  // south front: fitted to the southernmost footprint vertices
  const minN = Math.min(...ring.map((p) => p[1]));
  const south = ring.filter((p) => p[1] < minN + 22);
  const west = south.reduce((a, p) => (p[0] < a[0] ? p : a)), east = south.reduce((a, p) => (p[0] > a[0] ? p : a));
  const L = Math.hypot(east[0] - west[0], east[1] - west[1]);
  const de = (east[0] - west[0]) / L, dn = (east[1] - west[1]) / L, se = dn, sn = -de;         // s = outward (south)
  const off = Math.max(...south.map((p) => (p[0] - west[0]) * se + (p[1] - west[1]) * sn));
  const at = (t: number, o: number): P2 => [west[0] + de * t + se * (off + o), west[1] + dn * t + sn * (off + o)];
  const depth = 8, ph = 1.2, colTop = top - 3;
  const mid = at(L / 2, depth / 2);
  w.box(mid[0], mid[1], de, dn, L / 2, depth / 2 + 1, lo - 0.5, street + ph, STYLE.plain, STONE, STONE);             // stepped platform
  w.box(mid[0], mid[1], de, dn, L / 2, depth / 2, colTop, top, STYLE.plain, tint, [0.36, 0.36, 0.37], true);          // entablature
  const cmid = at(L / 2, depth / 2 + 1);
  w.box(cmid[0], cmid[1], de, dn, 14, depth / 2 + 1, colTop, top + 3.5, STYLE.plain, tint, [0.36, 0.36, 0.37], true); // central pavilion
  const n = w.detail ? Math.round(L / 6.2) : Math.round(L / 12.4);
  for (let i = 0; i <= n; i++) {
    const p = at((i / n) * (L - 2) + 1, depth - 0.9);
    if (w.detail) w.drum(p[0], p[1], 0.75, 0.68, street + ph, colTop, 8, STYLE.plain, tint);
    else w.box(p[0], p[1], de, dn, 0.7, 0.7, street + ph, colTop, STYLE.plain, tint);
  }
  // seated figure at the centre and standing figures at both ends: simplified blocks, not likenesses
  const seat = (t: number, k: number) => {
    const p = at(t, depth / 2 - 1), y = street + ph;
    w.box(p[0], p[1], de, dn, 2.6 * k, 2.2 * k, y, y + 1.6 * k, STYLE.plain, STONE, STONE);
    w.box(p[0], p[1], de, dn, 1.7 * k, 1.5 * k, y + 1.6 * k, y + 4.4 * k, STYLE.plain, BRONZE, BRONZE);
    w.drum(p[0], p[1], 0.75 * k, 0.6 * k, y + 4.4 * k, y + 5.6 * k, 8, STYLE.plain, BRONZE);
  };
  seat(L / 2, 1.25);
  if (w.detail) { seat(7, 0.8); seat(L - 7, 0.8); }
}

/**
 * Blue Sky Tower. Real: footprint, position, 105 m height and 25 storeys (source data and public
 * record). Approximate: the sail profile (the footprint shrinks toward one end with height along a
 * quarter ellipse), and which end carries the tall edge.
 */
function blueSky(c: Ctx) {
  const { w, ring, lo, street, h } = c;
  const H = num(c, 'height', 105), floors = num(c, 'floors', 25);
  let a = ring[0], b2 = ring[1], best = 0;
  for (const p of ring) for (const q of ring) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > best) { best = d; a = p; b2 = q; } }
  const northEnd = str(c, 'tall_end', 'north') === 'north';
  const anchor = (a[1] > b2[1]) === northEnd ? a : b2, far = anchor === a ? b2 : a;
  const ae = (far[0] - anchor[0]) / best, an = (far[1] - anchor[1]) / best;
  const K = w.detail ? 14 : 6;
  const level = (k: number): P2[] => {
    const u = k / K, s = u < 0.3 ? 1 : 0.3 + 0.7 * Math.sqrt(Math.max(0, 1 - ((u - 0.3) / 0.7) ** 2));
    const ws = 0.78 + 0.22 * s;
    return ring.map((p) => {
      const t = (p[0] - anchor[0]) * ae + (p[1] - anchor[1]) * an, o = (p[0] - anchor[0]) * -an + (p[1] - anchor[1]) * ae;
      return [anchor[0] + ae * t * s - an * o * ws, anchor[1] + an * t * s + ae * o * ws] as P2;
    });
  };
  const tint = rgb(0xb9d6f0);
  w.collide(ring, lo - 0.5, street + H);
  w.facade(ring, lo - 0.5, street, STYLE.plain, [0.3, 0.32, 0.35], h, 0.8);
  const [bay] = CELL_M[STYLE.glass];
  let prev = level(0);
  for (let k = 1; k <= K; k++) {
    const cur = level(k), y0 = street + (H * (k - 1)) / K, y1 = street + (H * k) / K;
    const v0 = (floors * (k - 1)) / K / TEX_CELLS, v1 = (floors * k) / K / TEX_CELLS;
    let run = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length, len = Math.hypot(prev[j][0] - prev[i][0], prev[j][1] - prev[i][1]);
      const u0 = Math.round(run / bay) / TEX_CELLS, u1 = Math.round((run + len) / bay) / TEX_CELLS;
      run += len;
      const p0: P3 = [prev[i][0], y0, prev[i][1]], p1: P3 = [prev[j][0], y0, prev[j][1]], q1: P3 = [cur[j][0], y1, cur[j][1]], q0: P3 = [cur[i][0], y1, cur[i][1]];
      w.face([p0, p1, q1, q0], STYLE.glass, tint, (p) => [p === p0 || p === q0 ? u0 : u1, p === p0 || p === p1 ? v0 : v1]);
    }
    prev = cur;
  }
  w.cap(prev, [], street + H, [0.3, 0.34, 0.4]);
}

/** National stadium: real ring-shaped stand footprint; the rake and heights are estimates. */
function stadiumBowl(c: Ctx) {
  const { w, ring, holes, lo, street, h } = c;
  const Ho = num(c, 'outer_height', 12), Hi = num(c, 'inner_height', 2);
  w.collide(ring, lo - 0.5, street + Ho);
  w.facade(ring, lo - 0.5, street + Ho, STYLE.plain, CONCRETE, h, 0.8);
  for (const hole of holes) w.facade(hole, street - 0.5, street + Hi, STYLE.plain, dark(CONCRETE, 0.9), h, 0.85, true);
  w.cap(ring, holes, (_p, hole) => street + (hole ? Hi : Ho), rgb(0x8f979c), STYLE.metal);
}

/** Zaisan memorial: a concrete ring carried on supports around the real circular footprint. */
function zaisanRing(c: Ctx) {
  const { w, ring, street } = c;
  const [ce, cn] = centroid(ring);
  const r = ring.reduce((s, p) => s + Math.hypot(p[0] - ce, p[1] - cn), 0) / ring.length;
  const y0 = street + num(c, 'band_base', 4.5), y1 = y0 + num(c, 'band_height', 3.5), th = 0.9, seg = w.detail ? 28 : 14;
  const mural = rgb(0xb0683c);
  w.drum(ce, cn, r, r, y0, y1, seg, STYLE.plain, CONCRETE);
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, ri = r - th;
    const o0: P2 = [ce + Math.cos(a0) * r, cn + Math.sin(a0) * r], o1: P2 = [ce + Math.cos(a1) * r, cn + Math.sin(a1) * r];
    const i0: P2 = [ce + Math.cos(a0) * ri, cn + Math.sin(a0) * ri], i1: P2 = [ce + Math.cos(a1) * ri, cn + Math.sin(a1) * ri];
    const k = 0.75 + 0.25 * Math.sin(i * 2.3);                                                    // uneven mosaic tone
    w.face([[i1[0], y0, i1[1]], [i0[0], y0, i0[1]], [i0[0], y1, i0[1]], [i1[0], y1, i1[1]]], STYLE.plain, dark(mural, k));   // mural faces inward
    w.face([[o0[0], y1, o0[1]], [o1[0], y1, o1[1]], [i1[0], y1, i1[1]], [i0[0], y1, i0[1]]], STYLE.roof, CONCRETE);
    w.face([[o1[0], y0, o1[1]], [o0[0], y0, o0[1]], [i0[0], y0, i0[1]], [i1[0], y0, i1[1]]], STYLE.plain, dark(CONCRETE, 0.6));
  }
  const pillars = num(c, 'supports', 6);
  for (let i = 0; i < pillars; i++) {
    const a = (i / pillars) * Math.PI * 2 + 0.3;
    w.box(ce + Math.cos(a) * (r - th / 2), cn + Math.sin(a) * (r - th / 2), -Math.sin(a), Math.cos(a), 0.9, 0.45, street - 1, y0, STYLE.plain, CONCRETE);
  }
  w.drum(ce, cn, 1.6, 1.3, street - 0.3, street + 0.9, 10, STYLE.plain, rgb(0x6f6a66));          // central flame bowl
}

/** Tapered stele on a real small footprint (Red Army soldier statue at Zaisan, 27 m in the source). */
function stele(c: Ctx) {
  const { w, ring, lo, street } = c;
  const H = num(c, 'height', c.b?.vis_height ?? 27), [ce, cn] = centroid(ring), k = num(c, 'taper', 0.6);
  const top = ring.map((p) => [ce + (p[0] - ce) * k, cn + (p[1] - cn) * k] as P2);
  w.collide(ring, lo - 0.5, street + H);
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    w.face([[ring[i][0], lo - 0.5, ring[i][1]], [ring[j][0], lo - 0.5, ring[j][1]], [top[j][0], street + H, top[j][1]], [top[i][0], street + H, top[i][1]]], STYLE.plain, CONCRETE);
  }
  w.cap(top, [], street + H, CONCRETE);
}

/** Statue on a pedestal at a stated point (simplified block figure; not a likeness). */
function pedestalStatue(c: Ctx) {
  const { w, ring, street } = c;
  const [e, n] = ring[0], ph = num(c, 'pedestal_height', 4.5);
  const B = w.box(e, n, 1, 0, 2.2, 3.4, street - 0.5, street + ph, STYLE.plain, STONE, STONE);
  w.collide(B, street - 0.5, street + ph);
  w.box(e, n, 1, 0, 0.55, 1.9, street + ph + 1.1, street + ph + 2.5, STYLE.plain, BRONZE, BRONZE, true);     // horse body
  for (const [dx, dy] of [[-0.35, -1.5], [0.35, -1.5], [-0.35, 1.5], [0.35, 1.5]]) w.box(e + dx, n + dy, 1, 0, 0.14, 0.16, street + ph, street + ph + 1.1, STYLE.plain, BRONZE);
  w.box(e, n - 1.9, 1, 0, 0.3, 0.45, street + ph + 2.2, street + ph + 3.3, STYLE.plain, BRONZE, BRONZE);      // neck and head
  w.box(e, n, 1, 0, 0.4, 0.45, street + ph + 2.5, street + ph + 4.0, STYLE.plain, BRONZE, BRONZE);            // rider
}

export const LANDMARK_BUILDERS: Record<string, (c: Ctx) => void> = {
  prism, gov_palace: govPalace, blue_sky_sail: blueSky, stadium_bowl: stadiumBowl, zaisan_ring: zaisanRing, stele, pedestal_statue: pedestalStatue,
};
