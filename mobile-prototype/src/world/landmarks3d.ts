// Higgsfield 3D Jutsu landmark models placed on the REAL footprints of their buildings
// (owner's request, 2026-11-13: "scale them to fit and place them").
//
// HONEST STATUS: these are STYLISED STUDIES made for a 150 m diorama. Their facades, proportions and
// massing are NOT surveyed and are not the real buildings. What IS real: the position, the
// orientation and the footprint extent (from the map data) and the height used by the game for
// that building. Each model is stretched to the minimum-area rectangle around the real footprint
// and to that height, so it covers the same ground and the collision stays the real footprint.
// The extruded footprint drawn by meshing.ts is hidden only while the model has loaded; if a GLB
// fails, the ordinary extruded building is drawn as before.
import * as THREE from 'three';
import { CHUNK_M, ORIGIN_GROUND_M } from '../core/geo';
import { loadHf } from './hfassets';
import { buildingLook, groundRange, ringArea } from './meshing';
import type { BuildingData } from './types';

type HeightFn = (east: number, north: number) => number;

export interface LandmarkModel {
  /** building id in the map data whose footprint the model replaces */
  id: string;
  file: string;
  label: string;
  /** the model's front (+Z) turns toward this point (east, north): the street or square it faces */
  faces: [number, number];
}

// Ids from data/tiles/chunks (Overture buildings). Where a landmark has several records (Blue Sky
// podium, the second Shangri-La block) only the tower record named here is replaced.
export const LANDMARK_MODELS: LandmarkModel[] = [
  { id: 'a83f3ea0', file: 'landmarks/hf-government-palace-study.glb', label: 'Засгийн газрын ордон (стилизац)', faces: [3.6, -6.9] },
  { id: '3e9c49ca', file: 'landmarks/hf-state-department-store-study.glb', label: 'Улсын их дэлгүүр (стилизац)', faces: [-845, -300] },
  { id: '04fab6dd', file: 'landmarks/hf-blue-sky-tower-study.glb', label: 'Блю скай товер (стилизац)', faces: [3.6, -6.9] },
  { id: '8a90698c', file: 'landmarks/hf-shangri-la-study.glb', label: 'Shangri-La (стилизац)', faces: [312, -560] },
  { id: '04fdf871', file: 'landmarks/hf-zaisan-memorial-study.glb', label: 'Зайсан толгой (стилизац)', faces: [-135.7, -3574] },
];
/**
 * Stylised Sukhbaatar monument study. NOT placed: it is a plain plinth with a cylinder, it would read as
 * a grey box, it has no footprint in the data, and the square centre is the player's spawn point.
 * Kept here (enabled = false) so it can be switched on once a proper statue model exists.
 */
export const SQUARE_MONUMENT_ENABLED = false;
export const SQUARE_MONUMENT = { file: 'landmarks/hf-sukhbaatar-monument-study.glb', at: [3.63, -6.9] as [number, number], faces: [3.6, 60] as [number, number] };

const byPrefix = (id: string) => LANDMARK_MODELS.find((m) => id.startsWith(m.id));

/** Minimum-area enclosing rectangle of a ring: centre, unit axis u, half extents along u and v. */
export function footprintRect(ring: [number, number][]) {
  const hull = convexHull(ring);
  let best = { area: Infinity, ce: 0, cn: 0, ue: 1, un: 0, hu: 0, hv: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 1e-6) continue;
    const ue = (b[0] - a[0]) / len, un = (b[1] - a[1]) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of hull) {
      const u = p[0] * ue + p[1] * un, v = -p[0] * un + p[1] * ue;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      best = { area, ce: uc * ue - vc * un, cn: uc * un + vc * ue, ue, un, hu: (u1 - u0) / 2, hv: (v1 - v0) / 2 };
    }
  }
  return best;
}
function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * World transform that fits a model (centred, ground at y = 0, front +Z, size `model`) onto a
 * footprint rectangle, with its front on the rectangle side that faces `faces`.
 */
export function fitTransform(rect: ReturnType<typeof footprintRect>, model: THREE.Vector3, faces: [number, number], y0: number, y1: number) {
  // candidate fronts: +u, -u, +v, -v; pick the one pointing most toward `faces`
  const de = faces[0] - rect.ce, dn = faces[1] - rect.cn;
  const ve = -rect.un, vn = rect.ue;
  const cands = [
    { fe: rect.ue, fn: rect.un, depth: rect.hu, width: rect.hv },
    { fe: -rect.ue, fn: -rect.un, depth: rect.hu, width: rect.hv },
    { fe: ve, fn: vn, depth: rect.hv, width: rect.hu },
    { fe: -ve, fn: -vn, depth: rect.hv, width: rect.hu },
  ];
  const c = cands.reduce((a, b) => (b.fe * de + b.fn * dn > a.fe * de + a.fn * dn ? b : a));
  const scale = new THREE.Vector3((c.width * 2) / model.x, Math.max(0.5, y1 - y0) / model.y, (c.depth * 2) / model.z);
  // three.js: x = east, z = -north. Model +Z must point along (fe, -fn) in xz.
  const yaw = Math.atan2(c.fe, -c.fn);
  return { position: new THREE.Vector3(rect.ce, y0, -rect.cn), yaw, scale };
}

const shared = (root: THREE.Object3D) => root.traverse((o) => { o.userData.shared = true; });

export class LandmarkModels {
  /** building ids currently drawn as Higgsfield models instead of extrusions */
  readonly ready = new Set<string>();
  private models = new Map<string, THREE.Group>();
  private sizes = new Map<string, THREE.Vector3>();
  onReady: () => void = () => {};

  constructor() {
    for (const m of [...LANDMARK_MODELS.map((l) => l.file), ...(SQUARE_MONUMENT_ENABLED ? [SQUARE_MONUMENT.file] : [])]) {
      loadHf(m).then((scene) => {
        this.models.set(m, scene);
        this.sizes.set(m, new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()));
        for (const l of LANDMARK_MODELS) if (l.file === m) this.ready.add(l.id);
        this.onReady();
      }).catch((err) => console.warn('Higgsfield landmark failed; extruded footprint stays', m, err));
    }
  }

  /** True when this building should be drawn by `place` instead of the extruder. */
  replaces(b: BuildingData) { const m = byPrefix(b.id); return !!m && this.ready.has(m.id); }

  /** Adds the models for this chunk's replaced buildings (and the square monument) to `group`. */
  place(buildings: BuildingData[], cx: number, cy: number, group: THREE.Group, hAt: HeightFn) {
    const e0 = cx * CHUNK_M, n0 = cy * CHUNK_M;
    const put = (file: string, label: string, pos: THREE.Vector3, yaw: number, scale: THREE.Vector3) => {
      const src = this.models.get(file); if (!src) return;
      const m = src.clone(true);
      shared(m);
      m.name = label; m.userData.kind = 'higgsfield landmark (stylised)';
      m.position.set(pos.x - e0, pos.y, pos.z + n0);
      m.rotation.y = yaw; m.scale.copy(scale);
      m.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
      m.updateMatrix(); m.updateMatrixWorld(true);
      group.add(m);
    };
    for (const b of buildings) {
      const l = byPrefix(b.id);
      if (!l || !this.ready.has(l.id)) continue;
      const ring = b.rings[0]; if (!ring || ring.length < 3) continue;
      const area = Math.abs(ringArea(ring));
      const look = buildingLook(b, area, ring.length);
      const dataBase = b.base_z - ORIGIN_GROUND_M;
      const [lo, hi] = groundRange(ring, hAt);
      const low = Math.min(dataBase, lo) - 0.5, top = Math.max(dataBase, hi) + look.height;
      const fit = fitTransform(footprintRect(ring), this.sizes.get(l.file)!, l.faces, low, top);
      put(l.file, l.label, fit.position, fit.yaw, fit.scale);
    }
    const [me, mn] = SQUARE_MONUMENT.at;
    if (SQUARE_MONUMENT_ENABLED && Math.floor(me / CHUNK_M) === cx && Math.floor(mn / CHUNK_M) === cy && this.models.has(SQUARE_MONUMENT.file)) {
      const yaw = Math.atan2(SQUARE_MONUMENT.faces[0] - me, -(SQUARE_MONUMENT.faces[1] - mn));
      put(SQUARE_MONUMENT.file, 'Сүхбаатарын хөшөө (стилизац)', new THREE.Vector3(me, hAt(me, mn) - 0.05, -mn), yaw, new THREE.Vector3(1, 1, 1));
    }
  }
}
