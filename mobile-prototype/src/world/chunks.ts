// Progressive streaming of the real 256 m chunks around the player. Only the neighbourhood is ever
// in memory: near rings in full detail (roads, footpaths, collision, shadows), far rings simplified,
// everything else released. Beyond that a coarse terrain backdrop (64 m, same source heights) shows the hills.
import * as THREE from 'three';
import { CHUNK_M } from '../core/geo';
import type { Quality } from '../config';
import { ColliderSet } from './collision';
import { paintGround } from './ground';
import type { Materials } from './materials';
import { buildBuildings, buildRoads, buildTerrain, type MeshData } from './meshing';
import { HeightField, sampleGrid } from './terrain';
import type { ChunkData, Manifest, Overview } from './types';

interface Entry {
  cx: number; cy: number; key: string;
  data: ChunkData | null; grid: Float32Array | null;
  loading: boolean; failed: number;
  group: THREE.Group | null; lod: number;      // -1 none, 0 near, 1 far
  tris: number;
}

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  if (m.color) g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
  g.setIndex(new THREE.BufferAttribute(m.position.length / 3 > 65535 ? m.index : new Uint16Array(m.index), 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

export class ChunkManager {
  readonly height: HeightField;
  readonly colliders = new ColliderSet();
  readonly root = new THREE.Group();
  private entries = new Map<string, Entry>();
  private inFlight = 0;
  private center: [number, number] = [NaN, NaN];
  private dirty = true;
  private backdrop: Backdrop | null = null;
  triangles = 0; builtChunks = 0; lastBuildMs = 0;

  constructor(private baseUrl: string, readonly manifest: Manifest, overview: Overview,
              private mats: Materials, private q: Quality) {
    this.height = new HeightField(manifest.height_grid_n);
    this.height.setOverview(overview);
    for (const c of manifest.chunks) {
      const key = c.x + ',' + c.y;
      this.entries.set(key, { cx: c.x, cy: c.y, key, data: null, grid: null, loading: false, failed: 0, group: null, lod: -1, tris: 0 });
    }
    this.backdrop = new Backdrop(overview, mats.backdrop);
    this.root.add(this.backdrop.mesh);
  }

  setQuality(q: Quality, mats: Materials) {
    this.q = q; this.mats = mats;
    this.entries.forEach((e) => this.dropGroup(e));
    if (this.backdrop) this.backdrop.mesh.material = mats.backdrop;
    this.dirty = true;
  }

  private desiredLod(e: Entry): number {
    const d = Math.max(Math.abs(e.cx - this.center[0]), Math.abs(e.cy - this.center[1]));
    return d <= this.q.nearRings ? 0 : d <= this.q.farRings ? 1 : -1;
  }
  private dist(e: Entry) { return Math.max(Math.abs(e.cx - this.center[0]), Math.abs(e.cy - this.center[1])); }

  /** Fraction (0..1) of the full-detail neighbourhood that is built. */
  nearProgress(): number {
    let want = 0, have = 0;
    this.entries.forEach((e) => { if (this.desiredLod(e) === 0) { want++; if (e.lod === 0) have++; } });
    return want ? have / want : 1;
  }
  hasTerrain(east: number, north: number) { return this.height.has(Math.floor(east / CHUNK_M), Math.floor(north / CHUNK_M)); }
  inSlice(east: number, north: number) { return this.entries.has(Math.floor(east / CHUNK_M) + ',' + Math.floor(north / CHUNK_M)); }

  /** Loaded chunk data within `rings` of the player, for the mini-map and name lookups. */
  forNearData(rings: number, cb: (d: ChunkData) => void) {
    for (let dx = -rings; dx <= rings; dx++) for (let dy = -rings; dy <= rings; dy++) {
      const e = this.entries.get(this.center[0] + dx + ',' + (this.center[1] + dy));
      if (e?.data) cb(e.data);
    }
  }

  /** Call every frame. `budgetMs` bounds mesh building so the frame rate holds while streaming. */
  update(east: number, north: number, budgetMs: number) {
    const cx = Math.floor(east / CHUNK_M), cy = Math.floor(north / CHUNK_M);
    if (cx !== this.center[0] || cy !== this.center[1]) { this.center = [cx, cy]; this.dirty = true; }
    if (!this.dirty) return;
    // 1) release what is out of range
    const keepData = this.q.farRings + 2;
    this.entries.forEach((e) => {
      const want = this.desiredLod(e);
      if (e.group && want === -1 && this.dist(e) > this.q.farRings + 1) this.dropGroup(e);
      if (e.data && this.dist(e) > keepData) { e.data = null; e.grid = null; this.height.removeChunk(e.cx, e.cy); }
    });
    // 2) fetch missing data, nearest first
    const todo: Entry[] = [];
    this.entries.forEach((e) => { if (this.desiredLod(e) !== -1) todo.push(e); });
    todo.sort((a, b) => this.dist(a) - this.dist(b));
    for (const e of todo) {
      if (this.inFlight >= 4) break;
      if (!e.data && !e.loading && e.failed < 3) this.fetch(e);
    }
    // 3) build, nearest first, within the time budget
    const t0 = performance.now();
    let pending = false, changed = false;
    for (const e of todo) {
      const want = this.desiredLod(e);
      if (e.lod === want) continue;
      if (!e.data) { pending = true; continue; }
      if (performance.now() - t0 > budgetMs) { pending = true; break; }
      this.build(e, want); changed = true;
    }
    if (changed) { this.lastBuildMs = performance.now() - t0; this.recount(); }
    this.dirty = pending || this.inFlight > 0;
  }

  private async fetch(e: Entry) {
    e.loading = true; this.inFlight++;
    try {
      const r = await fetch(`${this.baseUrl}chunks/${e.cx}_${e.cy}.json`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = (await r.json()) as ChunkData;
      e.data = d;
      e.grid = this.height.setChunk(e.cx, e.cy, d.height_grid_dm);
    } catch (err) {
      e.failed++;
      console.warn('chunk', e.key, 'failed to load', err);
    } finally { e.loading = false; this.inFlight--; this.dirty = true; }
  }

  private dropGroup(e: Entry) {
    if (!e.group) return;
    e.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      if (m.userData.ownMaterial) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.map?.dispose(); mat.dispose();
      }
    });
    this.root.remove(e.group);
    e.group = null; e.lod = -1; e.tris = 0;
    this.colliders.delete(e.key);
  }

  private build(e: Entry, lod: number) {
    this.dropGroup(e);
    const d = e.data!, grid = e.grid!, n = this.height.n;
    const e0 = e.cx * CHUNK_M, n0 = e.cy * CHUNK_M;
    const near = lod === 0;
    // Heights for road edges that poke past the chunk: neighbour terrain when loaded, else our own edge.
    const hAt = (east: number, north: number) =>
      this.height.has(Math.floor(east / CHUNK_M), Math.floor(north / CHUNK_M))
        ? this.height.heightAt(east, north)
        : sampleGrid(grid, n, (east - e0) / CHUNK_M, (north - n0) / CHUNK_M);
    const group = new THREE.Group();
    group.position.set(e0, 0, -n0);
    group.matrixAutoUpdate = false; group.updateMatrix();
    let tris = 0;
    const add = (md: MeshData, mat: THREE.Material, own: boolean, cast: boolean, receive: boolean) => {
      if (!md.index.length) return;
      const mesh = new THREE.Mesh(toGeometry(md), mat);
      mesh.userData.ownMaterial = own;
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      group.add(mesh); tris += md.index.length / 3;
    };
    const tex = paintGround(d, near ? this.q.groundTexNear : this.q.groundTexFar);
    add(buildTerrain(grid, n, e.cx, e.cy, (ee, nn) => this.height.heightAt(ee, nn)), this.mats.makeGround(tex), true, false, true);
    add(buildRoads(d.roads, e.cx, e.cy, hAt, near), this.mats.road, false, false, true);
    const b = buildBuildings(d.buildings, e.cx, e.cy, hAt);
    add(b, this.mats.building, false, near, near);
    if (near) this.colliders.set(e.key, b.colliders);
    group.updateMatrixWorld(true);
    this.root.add(group);
    e.group = group; e.lod = lod; e.tris = tris;
  }

  private recount() {
    let t = 0, c = 0;
    const built = new Set<string>();
    this.entries.forEach((e) => { if (e.group) { t += e.tris; c++; built.add(e.key); } });
    this.triangles = t; this.builtChunks = c;
    this.backdrop?.hide(built);
  }
}

/** Whole-slice terrain at 64 m from the pipeline's own heights; cells under detailed chunks are cut out. */
class Backdrop {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  constructor(private o: Overview, mat: THREE.Material) {
    const pos = new Float32Array(o.w * o.h * 3), col = new Float32Array(o.w * o.h * 3);
    const hgt = (i: number, j: number) => o.height_dm[Math.max(0, Math.min(o.h - 1, j)) * o.w + Math.max(0, Math.min(o.w - 1, i))] / 10;
    for (let j = 0; j < o.h; j++) for (let i = 0; i < o.w; i++) {
      const k = j * o.w + i;
      pos[k * 3] = o.x0 * CHUNK_M + i * o.cell_m;
      pos[k * 3 + 1] = hgt(i, j) - 1298 - 1.5;
      pos[k * 3 + 2] = -(o.y0 * CHUNK_M + j * o.cell_m);
      // dry steppe tones; steeper ground a little darker and rockier (shading only, not land cover data)
      const slope = Math.min(1, Math.hypot(hgt(i + 1, j) - hgt(i - 1, j), hgt(i, j + 1) - hgt(i, j - 1)) / (2 * o.cell_m) / 0.45);
      col[k * 3] = 0.235 - slope * 0.07; col[k * 3 + 1] = 0.215 - slope * 0.06; col[k * 3 + 2] = 0.15 - slope * 0.035;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.hide(new Set());
    this.geo.computeVertexNormals();          // once, on the full grid, so cut-outs do not change shading
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }
  hide(built: Set<string>) {
    const o = this.o, idx: number[] = [];
    for (let cy = o.y0; cy <= o.y1; cy++) for (let cx = o.x0; cx <= o.x1; cx++) {
      if (built.has(cx + ',' + cy)) continue;
      for (let j = 0; j < o.per; j++) for (let i = 0; i < o.per; i++) {
        const a = ((cy - o.y0) * o.per + j) * o.w + (cx - o.x0) * o.per + i, b = a + 1, c = a + o.w, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    this.geo.setIndex(idx);
  }
}
