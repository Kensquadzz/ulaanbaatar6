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
import { buildStreet, mergeMeshes, type Lamp } from './street';
import { HeightField, sampleGrid } from './terrain';
import { StreetTrees } from './trees';
import { LandmarkModels, SQUARE_MONUMENT, SQUARE_MONUMENT_ENABLED } from './landmarks3d';
import type { ChunkData, Manifest, Overview } from './types';
import { Bridges, type Bridge } from './bridges';
import { buildSukhbaatarMonument, MONUMENT_HALF, PEDESTAL_H } from './monument';
import { buildBuddha, BUDDHA, BUDDHA_HALF } from './buddha';
import { makeCollider } from './collision';

interface Entry {
  cx: number; cy: number; key: string;
  data: ChunkData | null; grid: Float32Array | null;
  loading: boolean; failed: number;
  group: THREE.Group | null; lod: number;      // -1 none, 0 near, 1 far
  tris: number;
  lamps: Lamp[];
}

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  if (m.color) g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
  if (m.style) g.setAttribute('style', new THREE.BufferAttribute(m.style, 1));
  g.setIndex(new THREE.BufferAttribute(m.position.length / 3 > 65535 ? m.index : new Uint16Array(m.index), 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

const LAMP_H = 8.5;
let lampGeo: { pole: THREE.BufferGeometry; head: THREE.BufferGeometry; pool: THREE.BufferGeometry } | null = null;
/** Shared streetlight parts (an original, generic design): tapered pole with an arm, a head, a ground pool. */
function lampGeometry() {
  if (lampGeo) return lampGeo;
  const pole = new THREE.CylinderGeometry(0.07, 0.11, LAMP_H, 5, 1, true).translate(0, LAMP_H / 2, 0);
  const arm = new THREE.CylinderGeometry(0.045, 0.06, 1.7, 4, 1, true).rotateZ(Math.PI / 2 - 0.12).translate(0.8, LAMP_H - 0.08, 0);
  const merged = mergeGeometries([pole, arm]);
  const head = new THREE.BoxGeometry(0.75, 0.12, 0.3).translate(1.5, LAMP_H - 0.2, 0);
  const pool = new THREE.CircleGeometry(8.5, 12).rotateX(-Math.PI / 2);
  lampGeo = { pole: merged, head, pool };
  return lampGeo;
}
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const g of list) {
    const off = pos.length / 3;
    pos.push(...(g.getAttribute('position').array as Float32Array)); nor.push(...(g.getAttribute('normal').array as Float32Array)); uv.push(...(g.getAttribute('uv').array as Float32Array));
    for (const i of g.getIndex()!.array as Uint16Array) idx.push(i + off);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); out.setIndex(idx);
  return out;
}

/**
 * All streetlights in view as four draw calls in total (poles, heads, light pools, halos) instead
 * of up to four per chunk. Buffers are rewritten only when the set of built chunks changes.
 */
class LampField {
  readonly group = new THREE.Group();
  private pole: THREE.InstancedMesh; private head: THREE.InstancedMesh; private pool: THREE.InstancedMesh; private halo: THREE.Points;
  private cap = 0; private haloCap = 0;
  triangles = 0;
  constructor(private mats: Materials) {
    this.pole = this.head = this.pool = null as unknown as THREE.InstancedMesh; this.halo = null as unknown as THREE.Points;
    this.alloc(512, 2048);
  }
  private alloc(cap: number, haloCap: number) {
    const L = lampGeometry();
    if (this.pole) { for (const m of [this.pole, this.head, this.pool]) { this.group.remove(m); m.dispose(); } this.group.remove(this.halo); this.halo.geometry.dispose(); }
    const mk = (g: THREE.BufferGeometry, mat: THREE.Material, kind: string) => {
      const m = new THREE.InstancedMesh(g, mat, cap);
      m.count = 0; m.frustumCulled = false; m.matrixAutoUpdate = false; m.userData.kind = kind;
      this.group.add(m); return m;
    };
    this.pole = mk(L.pole, this.mats.lampPole, 'lamp poles'); this.head = mk(L.head, this.mats.lampHead, 'lamp heads'); this.pool = mk(L.pool, this.mats.lampPool, 'lamp pools');
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(haloCap * 3), 3));
    hg.setDrawRange(0, 0);
    this.halo = new THREE.Points(hg, this.mats.lampHalo);
    this.halo.frustumCulled = false; this.halo.matrixAutoUpdate = false; this.halo.userData.kind = 'lamp halos';
    this.group.add(this.halo);
    this.cap = cap; this.haloCap = haloCap;
  }
  setMaterials(mats: Materials) {
    this.mats = mats;
    this.pole.material = mats.lampPole; this.head.material = mats.lampHead; this.pool.material = mats.lampPool; this.halo.material = mats.lampHalo;
  }
  set(near: Lamp[], all: Lamp[], hh: HeightField) {
    if (near.length > this.cap || all.length > this.haloCap) {
      this.alloc(Math.max(this.cap, Math.ceil(near.length * 1.5)), Math.max(this.haloCap, Math.ceil(all.length * 1.5)));
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s1 = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), nrm = new THREE.Vector3();
    near.forEach((l, i) => {
      q.setFromAxisAngle(up, Math.atan2(l.dn, l.de));       // local +x points toward the road
      m.compose(p.set(l.e, l.y, -l.n), q, s1);
      this.pole.setMatrixAt(i, m); this.head.setMatrixAt(i, m);
      // light pool lies on the terrain under the head, tilted to the local slope
      const ce = l.e + l.de * 1.5, cn = l.n + l.dn * 1.5;
      nrm.set(hh.heightAt(ce - 2, cn) - hh.heightAt(ce + 2, cn), 4, hh.heightAt(ce, cn + 2) - hh.heightAt(ce, cn - 2)).normalize();
      q.setFromUnitVectors(up, nrm);
      m.compose(p.set(ce, hh.heightAt(ce, cn) + 0.16, -cn), q, s1);
      this.pool.setMatrixAt(i, m);
    });
    for (const im of [this.pole, this.head, this.pool]) { im.count = near.length; im.instanceMatrix.needsUpdate = true; }
    const pos = this.halo.geometry.getAttribute('position') as THREE.BufferAttribute, a = pos.array as Float32Array;
    all.forEach((l, i) => { a[i * 3] = l.e + l.de * 1.5; a[i * 3 + 1] = l.y + LAMP_H - 0.25; a[i * 3 + 2] = -(l.n + l.dn * 1.5); });   // head hangs 1.5 m toward the road
    pos.needsUpdate = true;
    this.halo.geometry.setDrawRange(0, all.length);
    const L = lampGeometry();
    this.triangles = (near.length * (L.pole.index!.count + L.head.index!.count + L.pool.index!.count)) / 3;
  }
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
  triangles = 0; builtChunks = 0; lastBuildMs = 0; worstBuildMs = 0; lampCount = 0;
  private lampField: LampField;
  /** Higgsfield landmark models drawn on the real footprints of their buildings (stylised). */
  readonly landmarks = new LandmarkModels();
  /** Higgsfield street trees on estimated sidewalk positions */
  readonly trees = new StreetTrees();
  /** Real bridge decks (estimated heights) and railway tracks */
  readonly bridges = new Bridges();
  private bridgeMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  /** Call once the bridge data has arrived; chunks already built are rebuilt with their bridges. */
  setBridges(bridges: Bridge[], rail: { pts: [number, number][]; flags: string[] }[]) {
    this.bridges.load(bridges, rail);
    this.entries.forEach((e) => { if (e.group) this.dropGroup(e); });
    this.dirty = true;
  }
  /** Sukhbaatar statue (stylised), placed at the centre of the square once built */
  private monument: THREE.Group | null = null;
  /** golden Buddha in Buddha Park, built on first use */
  private buddha: THREE.Group | null = null;
  /** Height to stand or drive on (bridge deck or terrain), given the previous height. */
  surfaceAt(e: number, n: number, prevY: number) { return this.bridges.surface(e, n, prevY, this.height.heightAt(e, n)); }
  /** True while chunks are still being fetched or built for the current position. */
  get streaming() { return this.dirty; }

  constructor(private baseUrl: string, readonly manifest: Manifest, overview: Overview,
              private mats: Materials, private q: Quality) {
    this.height = new HeightField(manifest.height_grid_n);
    this.height.setOverview(overview);
    for (const c of manifest.chunks) {
      const key = c.x + ',' + c.y;
      this.entries.set(key, { cx: c.x, cy: c.y, key, data: null, grid: null, loading: false, failed: 0, group: null, lod: -1, tris: 0, lamps: [] });
    }
    this.backdrop = new Backdrop(overview, mats.backdrop);
    this.root.add(this.backdrop.mesh);
    this.lampField = new LampField(mats);
    this.root.add(this.lampField.group);
    this.root.add(this.trees.root);
    void buildSukhbaatarMonument().then((m) => {
      m.traverse((o) => { o.userData.shared = true; });
      this.monument = m;
      const [me, mn] = SQUARE_MONUMENT.at;
      const e = this.entries.get(Math.floor(me / CHUNK_M) + ',' + Math.floor(mn / CHUNK_M));
      if (e?.group) { this.dropGroup(e); this.dirty = true; }
    });
    // when a landmark GLB arrives, rebuild the chunks that already drew its building as an extrusion
    this.landmarks.onReady = () => {
      this.entries.forEach((e) => {
        const monument = SQUARE_MONUMENT_ENABLED && e.cx === Math.floor(SQUARE_MONUMENT.at[0] / CHUNK_M) && e.cy === Math.floor(SQUARE_MONUMENT.at[1] / CHUNK_M);
        if (e.group && (monument || e.data?.buildings.some((b) => this.landmarks.replaces(b)))) { this.dropGroup(e); }
      });
      this.dirty = true;
    };
  }

  setQuality(q: Quality, mats: Materials) {
    this.q = q; this.mats = mats;
    this.entries.forEach((e) => this.dropGroup(e));
    if (this.backdrop) this.backdrop.mesh.material = mats.backdrop;
    this.lampField.setMaterials(mats);
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
      const b0 = performance.now();
      this.build(e, want); changed = true;
      this.worstBuildMs = Math.max(this.worstBuildMs, performance.now() - b0);
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
      if (!m.isMesh || m.userData.shared) return;      // shared Higgsfield GLB geometry stays cached
      m.geometry.dispose();
      if (m.userData.ownMaterial) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.map?.dispose(); mat.dispose();
      }
    });
    this.root.remove(e.group);
    e.group = null; e.lod = -1; e.tris = 0; e.lamps = [];
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
    const add = (md: MeshData, mat: THREE.Material, own: boolean, cast: boolean, receive: boolean, kind = 'other') => {
      if (!md.index.length) return;
      const mesh = new THREE.Mesh(toGeometry(md), mat);
      mesh.userData.ownMaterial = own; mesh.userData.kind = kind + (near ? '' : ' (far)');
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      group.add(mesh); tris += md.index.length / 3;
    };
    // far chunks: carriageways are painted into the ground texture instead of being a second mesh
    const tex = paintGround(d, near ? this.q.groundTexNear : this.q.groundTexFar, !near);
    add(buildTerrain(grid, n, e.cx, e.cy, (ee, nn) => this.height.heightAt(ee, nn)), this.mats.makeGround(tex), true, false, true, 'terrain');
    // bridge roads are drawn on their deck (no sidewalks or lamps on the ground underneath)
    const onBridge = (r: { id: string }) => this.bridges.isBridgeRoad(r.id);
    const groundRoads = d.roads.filter((r) => !onBridge(r)), bridgeRoads = d.roads.filter(onBridge);
    const deckH = (east: number, north: number) => this.bridges.deckAt(east, north, 0.6) ?? hAt(east, north);
    const street = buildStreet(groundRoads, d.buildings, e.cx, e.cy, hAt, near);
    if (near) add(mergeMeshes(mergeMeshes(buildRoads(groundRoads, e.cx, e.cy, hAt, true), buildRoads(bridgeRoads, e.cx, e.cy, deckH, true)), street), this.mats.road, false, false, true, 'roads');
    const br = this.bridges.build(e.cx, e.cy, hAt);
    if (br.mesh.index.length) add(br.mesh, this.bridgeMat, false, near, near, 'bridges');
    e.lamps = street.lamps;
    const replaced = d.buildings.filter((x) => this.landmarks.replaces(x));
    const drawn = replaced.length ? d.buildings.filter((x) => !replaced.includes(x)) : d.buildings;
    const b = buildBuildings(drawn, e.cx, e.cy, hAt, near, near ? 0 : this.q.farMinAreaM2);
    add(b, this.mats.building, false, near, near, 'buildings');
    // replaced landmarks keep the collision of their real footprint
    if (near) {
      const custom = replaced.map((x) => this.landmarks.solidsFor(x, hAt));
      const plain = replaced.filter((_, i) => !custom[i]);
      this.colliders.set(e.key, b.colliders.concat(plain.length ? buildBuildings(plain, e.cx, e.cy, hAt, false).colliders : [], ...custom.filter((c): c is NonNullable<typeof c> => !!c), br.colliders));
    }
    this.landmarks.place(replaced, e.cx, e.cy, group, hAt);
    const [me, mn] = SQUARE_MONUMENT.at;
    if (this.monument && Math.floor(me / CHUNK_M) === e.cx && Math.floor(mn / CHUNK_M) === e.cy) {
      // the horse faces EAST (owner's reference photos, 2026-11-13); +Z front turned by +90 degrees
      const y = hAt(me, mn) - 0.05;
      this.monument.position.set(me - e0, y, -(mn - n0));
      this.monument.rotation.y = Math.PI / 2;
      group.add(this.monument);
      if (near) {
        // the ring of stone lions and chains is the barrier (square, so the turn does not matter)
        const hx = MONUMENT_HALF.z + 0.6, hz = MONUMENT_HALF.x + 0.6;
        this.colliders.set(e.key, [...this.colliders.get(e.key)!,
          makeCollider([[me - hx, mn - hz], [me + hx, mn - hz], [me + hx, mn + hz], [me - hx, mn + hz]], y - 1, y + PEDESTAL_H + 6)]);
      }
    }
    const [be, bn] = BUDDHA.at;
    if (Math.floor(be / CHUNK_M) === e.cx && Math.floor(bn / CHUNK_M) === e.cy) {
      // golden Buddha, Buddha Park (hand-modelled from a photo; faces north, see buddha.ts)
      this.buddha ??= (() => { const g = buildBuddha(); g.traverse((o) => { o.userData.shared = true; }); return g; })();
      const y = hAt(be, bn) - 0.05;
      this.buddha.position.set(be - e0, y, -(bn - n0));
      this.buddha.rotation.y = Math.atan2(BUDDHA.faces[0] - be, -(BUDDHA.faces[1] - bn));
      group.add(this.buddha);
      if (near) {
        const hx = BUDDHA_HALF.x, hz = BUDDHA_HALF.z;   // faces north: x across = east, z depth = north
        this.colliders.set(e.key, [...this.colliders.get(e.key)!,
          makeCollider([[be - hx, bn - hz], [be + hx, bn - hz], [be + hx, bn + hz], [be - hx, bn + hz]], y - 1, y + 40)]);
      }
    }
    group.updateMatrixWorld(true);
    this.root.add(group);
    e.group = group; e.lod = lod; e.tris = tris;
  }

  private recount() {
    let t = 0, c = 0;
    const built = new Set<string>();
    this.entries.forEach((e) => { if (e.group) { t += e.tris; c++; built.add(e.key); } });
    this.backdrop?.hide(built);
    // every streetlight of every built chunk goes into four shared draw calls
    const near: Lamp[] = [], all: Lamp[] = [];
    this.entries.forEach((e) => { if (!e.group) return; for (const l of e.lamps) { all.push(l); if (e.lod === 0) near.push(l); } });
    this.lampField.set(near, all, this.height);
    this.trees.set(near, this.height, this.colliders);
    this.triangles = t + this.lampField.triangles; this.builtChunks = c; this.lampCount = all.length;
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
