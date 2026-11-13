// Lightweight animated pedestrians following real footway geometry from UB6 map tiles.
// One InstancedMesh per body part keeps the crowd inexpensive on mobile GPUs.
//
// Bodies: the two winter-clothed people from the owner's Higgsfield 3D Jutsu project (navy puffer
// and burgundy parka). Each is baked into five rigid limb groups (body, two legs, two arms) with
// vertex colours, so the whole crowd costs 10 draw calls. Limbs swing from hip and shoulder pivots;
// there is no skinning or knee bend (the source models are rigid). Until the GLBs arrive, or if
// they fail, the older capsule figures are drawn instead.
import * as THREE from 'three';
import type { ChunkData } from './types';
import { loadCharacterRig, type CharacterRig } from './hfassets';

const HF_PEOPLE = ['characters/hf-player-winter.glb', 'characters/hf-woman-winter.glb'];
type Limb = keyof CharacterRig['parts'];
const LIMBS: Limb[] = ['body', 'hip_left', 'hip_right', 'shoulder_left', 'shoulder_right'];
interface HfBody { rig: CharacterRig; meshes: Record<Limb, THREE.InstancedMesh>; scale: number }

interface Segment { a: [number, number]; b: [number, number]; length: number }
interface Agent {
  route: Segment; t: number; direction: 1 | -1; speed: number; phase: number;
  coat: number; pants: number; hat: number; skin: number;
}

const COUNT = 18;
const UP = new THREE.Vector3(0, 1, 0);
const palettes = {
  coats: [0x1c2937, 0x3d4c5a, 0x543b32, 0x263e38, 0x6a3430, 0x35313d, 0x777064, 0x26334a],
  pants: [0x202631, 0x2e343d, 0x3b3029, 0x2b3d45, 0x414246],
  hats:  [0x20242b, 0x37434c, 0x4b332b, 0x263c31, 0x6b3026],
  skin:  [0xb87c5d, 0xd1a07e, 0x9b674e, 0xc58e6c],
};

const seeded = (s: number) => {
  let x = s >>> 0;
  return () => { x = (1664525 * x + 1013904223) >>> 0; return x / 4294967296; };
};

function makeInstance(
  geometry: THREE.BufferGeometry,
  capacity: number,
  group: THREE.Group,
  name: string
) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.02, flatShading: true });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  group.add(mesh);
  return mesh;
}

export class CrowdManager {
  readonly root = new THREE.Group();
  private agents: Agent[] = [];
  private coat: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private hat: THREE.InstancedMesh;
  private legL: THREE.InstancedMesh;
  private legR: THREE.InstancedMesh;
  private armL: THREE.InstancedMesh;
  private armR: THREE.InstancedMesh;
  private bootL: THREE.InstancedMesh;
  private bootR: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private tmpBase = new THREE.Vector3();
  private scale = new THREE.Vector3(1, 1, 1);
  private baseQ = new THREE.Quaternion();
  private partQ = new THREE.Quaternion();
  private phaseClock = 0;
  private lastCenter = new THREE.Vector2(Infinity, Infinity);
  private rng = seeded(0x6b656e7a);
  private hf: HfBody[] = [];
  private capsules: THREE.InstancedMesh[] = [];

  get count() { return this.agents.length; }
  /** 'higgsfield' once the Higgsfield bodies are in use, otherwise 'capsule'. */
  get bodyStyle() { return this.hf.length ? 'higgsfield' : 'capsule'; }

  /** Swap the capsule figures for the Higgsfield people. Resolves false (capsules stay) on failure. */
  async useHiggsfield(pbr: boolean): Promise<boolean> {
    try {
      const rigs = await Promise.all(HF_PEOPLE.map((f) => loadCharacterRig(f)));
      const material = pbr
        ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 })
        : new THREE.MeshLambertMaterial({ vertexColors: true });
      this.hf = rigs.map((rig, k) => {
        const meshes = {} as Record<Limb, THREE.InstancedMesh>;
        for (const limb of LIMBS) {
          const mesh = new THREE.InstancedMesh(rig.parts[limb].geo, material, COUNT);
          mesh.name = `Higgsfield pedestrian ${k} ${limb}`;
          mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
          this.root.add(mesh); meshes[limb] = mesh;
        }
        // Higgsfield figures are 1.88-2.0 m tall with large heads; scale to ordinary 1.62-1.76 m adults
        return { rig, meshes, scale: (k === 0 ? 1.76 : 1.64) / rig.height };
      });
      this.capsules.forEach((m) => { m.visible = false; });
      this.root.userData.bodies = 'higgsfield';
      return true;
    } catch (error) {
      console.warn('Higgsfield pedestrians failed; capsule crowd stays', error);
      return false;
    }
  }

  constructor() {
    this.root.name = 'UB6 pedestrians';
    const coatGeo = new THREE.CapsuleGeometry(0.235, 0.44, 3, 7);
    const headGeo = new THREE.SphereGeometry(0.125, 9, 7);
    const hatGeo = new THREE.CylinderGeometry(0.13, 0.145, 0.10, 8);
    const legGeo = new THREE.CapsuleGeometry(0.073, 0.38, 2, 6);
    const armGeo = new THREE.CapsuleGeometry(0.052, 0.30, 2, 6);
    const bootGeo = new THREE.BoxGeometry(0.14, 0.095, 0.24);
    this.coat = makeInstance(coatGeo, COUNT, this.root, 'pedestrian coats');
    this.head = makeInstance(headGeo, COUNT, this.root, 'pedestrian heads');
    this.hat = makeInstance(hatGeo, COUNT, this.root, 'pedestrian winter hats');
    this.legL = makeInstance(legGeo, COUNT, this.root, 'pedestrian left legs');
    this.legR = makeInstance(legGeo, COUNT, this.root, 'pedestrian right legs');
    this.armL = makeInstance(armGeo, COUNT, this.root, 'pedestrian left arms');
    this.armR = makeInstance(armGeo, COUNT, this.root, 'pedestrian right arms');
    this.bootL = makeInstance(bootGeo, COUNT, this.root, 'pedestrian left boots');
    this.bootR = makeInstance(bootGeo, COUNT, this.root, 'pedestrian right boots');
    this.capsules = [this.coat, this.head, this.hat, this.legL, this.legR, this.armL, this.armR, this.bootL, this.bootR];
  }

  private candidates(chunks: ChunkData[], east: number, north: number): Segment[] {
    const out: Segment[] = [];
    const add = (a: [number, number], b: [number, number]) => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 8 || length > 120) return;
      const midE = (a[0] + b[0]) * 0.5, midN = (a[1] + b[1]) * 0.5;
      if (Math.hypot(midE - east, midN - north) > 230) return;
      out.push({ a, b, length });
    };
    for (const c of chunks) for (const r of c.roads) {
      const pedestrian = !r.drivable && ['footway', 'pedestrian', 'path', 'steps'].includes(r.class);
      if (pedestrian) {
        for (let i = 0; i < r.pts.length - 1; i++) add([r.pts[i][0], r.pts[i][1]], [r.pts[i + 1][0], r.pts[i + 1][1]]);
      }
    }
    // If a neighbourhood lacks mapped footways, create candidate walking lines offset from
    // local streets. The offset is used for movement placement only, not as new map data.
    if (out.length < COUNT) {
      for (const c of chunks) for (const r of c.roads) {
        if (!r.drivable || !['primary', 'secondary', 'tertiary', 'residential'].includes(r.class)) continue;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1];
          const dx = b[0] - a[0], dn = b[1] - a[1], len = Math.hypot(dx, dn) || 1;
          const off = Math.max(2.6, (r.width || 6) * 0.5 + 1.8);
          const oe = -dn / len * off, on = dx / len * off;
          add([a[0] + oe, a[1] + on], [b[0] + oe, b[1] + on]);
          add([a[0] - oe, a[1] - on], [b[0] - oe, b[1] - on]);
        }
      }
    }
    return out;
  }

  rebuild(chunks: ChunkData[], east: number, north: number) {
    if (Math.hypot(east - this.lastCenter.x, north - this.lastCenter.y) < 95 && this.agents.length) return;
    this.lastCenter.set(east, north);
    this.rng = seeded((Math.floor(east / 32) * 73856093) ^ (Math.floor(north / 32) * 19349663) ^ 0x6b656e7a);
    const candidates = this.candidates(chunks, east, north);
    this.agents = [];
    if (!candidates.length) {
      // A tiny fallback plaza loop only when the local tiles contain no pedestrian paths.
      candidates.push(
        { a: [east - 30, north - 10], b: [east + 30, north - 10], length: 60 },
        { a: [east + 30, north - 10], b: [east + 30, north + 20], length: 30 },
        { a: [east + 30, north + 20], b: [east - 30, north + 20], length: 60 },
        { a: [east - 30, north + 20], b: [east - 30, north - 10], length: 30 },
      );
    }
    // half of the crowd walks within ~70 m so people are actually seen around the player
    const close = candidates.filter((c) => Math.hypot((c.a[0] + c.b[0]) / 2 - east, (c.a[1] + c.b[1]) / 2 - north) < 70);
    for (let i = 0; i < COUNT; i++) {
      const pool = i % 2 === 0 && close.length ? close : candidates;
      const r = pool[Math.floor(this.rng() * pool.length)];
      this.agents.push({
        route: r, t: this.rng(), direction: this.rng() > 0.5 ? 1 : -1,
        speed: 0.55 + this.rng() * 0.55, phase: this.rng() * Math.PI * 2,
        coat: palettes.coats[Math.floor(this.rng() * palettes.coats.length)],
        pants: palettes.pants[Math.floor(this.rng() * palettes.pants.length)],
        hat: palettes.hats[Math.floor(this.rng() * palettes.hats.length)],
        skin: palettes.skin[Math.floor(this.rng() * palettes.skin.length)],
      });
    }
    const color = (mesh: THREE.InstancedMesh, values: number[]) => {
      values.forEach((v, i) => mesh.setColorAt(i, new THREE.Color(v)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.count = this.agents.length;
    };
    color(this.coat, this.agents.map(a => a.coat));
    color(this.head, this.agents.map(a => a.skin));
    color(this.hat, this.agents.map(a => a.hat));
    color(this.legL, this.agents.map(a => a.pants));
    color(this.legR, this.agents.map(a => a.pants));
    color(this.armL, this.agents.map(a => a.coat));
    color(this.armR, this.agents.map(a => a.coat));
    color(this.bootL, this.agents.map(() => 0x252321));
    color(this.bootR, this.agents.map(() => 0x252321));
  }

  update(dt: number, heightAt: (e: number, n: number) => number) {
    this.phaseClock += dt;
    const write = (
      mesh: THREE.InstancedMesh, i: number,
      east: number, groundY: number, north: number,
      lx: number, ly: number, lz: number,
      localQ: THREE.Quaternion, sx = 1, sy = 1, sz = 1
    ) => {
      this.pos.set(lx, ly, lz).applyQuaternion(this.baseQ);
      this.pos.add(this.tmpBase.set(east, groundY, -north));
      this.partQ.copy(this.baseQ).multiply(localQ);
      this.matrix.compose(this.pos, this.partQ, this.scale.set(sx, sy, sz));
      mesh.setMatrixAt(i, this.matrix);
    };
    if (this.hf.length) { this.updateHf(dt, heightAt); return; }
    const identity = new THREE.Quaternion();
    const legA = new THREE.Quaternion(), legB = new THREE.Quaternion();
    const armA = new THREE.Quaternion(), armB = new THREE.Quaternion();
    const axisX = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i], s = a.route;
      const step = (a.speed * dt) / s.length * a.direction;
      a.t += step;
      if (a.t > 1 || a.t < 0) {
        a.direction = a.direction === 1 ? -1 : 1;
        a.t = Math.max(0.02, Math.min(0.98, a.t));
      }
      const e = s.a[0] + (s.b[0] - s.a[0]) * a.t;
      const n = s.a[1] + (s.b[1] - s.a[1]) * a.t;
      const dx = (s.b[0] - s.a[0]) * a.direction;
      const dn = (s.b[1] - s.a[1]) * a.direction;
      const heading = Math.atan2(dx, dn);
      const y = heightAt(e, n);
      this.baseQ.setFromAxisAngle(UP, Math.PI + heading);
      const phase = this.phaseClock * (4.8 + a.speed * 1.4) + a.phase;
      const swing = Math.sin(phase) * 0.34;
      legA.setFromAxisAngle(axisX, swing);
      legB.setFromAxisAngle(axisX, -swing);
      armA.setFromAxisAngle(axisX, -swing * 0.8);
      armB.setFromAxisAngle(axisX, swing * 0.8);

      write(this.coat, i, e, y, n, 0, 1.08 + Math.abs(Math.sin(phase)) * 0.018, 0, identity, 1, 1.12, 0.78);
      write(this.head, i, e, y, n, 0, 1.80 + Math.abs(Math.sin(phase)) * 0.018, 0, identity, 1, 1.08, 0.95);
      write(this.hat, i, e, y, n, 0, 1.93 + Math.abs(Math.sin(phase)) * 0.018, 0, identity);
      write(this.legL, i, e, y, n, -0.105, 0.66, 0, legA);
      write(this.legR, i, e, y, n, 0.105, 0.66, 0, legB);
      write(this.armL, i, e, y, n, -0.25, 1.25, 0, armA);
      write(this.armR, i, e, y, n, 0.25, 1.25, 0, armB);
      write(this.bootL, i, e, y, n, -0.105, 0.06, 0.07, identity);
      write(this.bootR, i, e, y, n, 0.105, 0.06, 0.07, identity);
    }
    for (const m of [this.coat, this.head, this.hat, this.legL, this.legR, this.armL, this.armR, this.bootL, this.bootR]) {
      m.instanceMatrix.needsUpdate = true;
    }
  }

  private hfMat = new THREE.Matrix4();
  private hfLimb = new THREE.Matrix4();
  private hfRot = new THREE.Matrix4();
  private updateHf(_dt: number, heightAt: (e: number, n: number) => number) {
    const used = this.hf.map(() => 0);
    const base = this.hfMat, limb = this.hfLimb, rot = this.hfRot;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i], s = a.route;
      const step = (a.speed * _dt) / s.length * a.direction;
      a.t += step;
      if (a.t > 1 || a.t < 0) { a.direction = a.direction === 1 ? -1 : 1; a.t = Math.max(0.02, Math.min(0.98, a.t)); }
      const e = s.a[0] + (s.b[0] - s.a[0]) * a.t;
      const n = s.a[1] + (s.b[1] - s.a[1]) * a.t;
      const de = (s.b[0] - s.a[0]) * a.direction, dn = (s.b[1] - s.a[1]) * a.direction;
      const body = this.hf[i % this.hf.length], k = i % this.hf.length, slot = used[k]++;
      const phase = this.phaseClock * (4.8 + a.speed * 1.4) + a.phase;
      const swing = Math.sin(phase) * 0.42;
      const bob = Math.abs(Math.sin(phase)) * 0.02;
      // model faces +Z; world east = +x, north = -z, so facing (de, dn) is +Z turned by atan2(de, -dn)
      this.baseQ.setFromAxisAngle(UP, Math.atan2(de, -dn));
      base.compose(this.pos.set(e, heightAt(e, n) + bob, -n), this.baseQ, this.scale.setScalar(body.scale));
      for (const name of LIMBS) {
        const p = body.rig.parts[name].pivot;
        const angle = name === 'body' ? 0 : name === 'hip_left' ? swing : name === 'hip_right' ? -swing
          : name === 'shoulder_left' ? -swing * 0.75 : swing * 0.75;
        rot.makeRotationX(angle);
        limb.makeTranslation(p.x, p.y, p.z).multiply(rot);
        this.matrix.multiplyMatrices(base, limb);
        body.meshes[name].setMatrixAt(slot, this.matrix);
      }
    }
    this.hf.forEach((b, k) => {
      for (const name of LIMBS) { b.meshes[name].count = used[k]; b.meshes[name].instanceMatrix.needsUpdate = true; }
    });
  }
}
