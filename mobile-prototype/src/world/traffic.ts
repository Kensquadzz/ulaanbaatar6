// Ambient moving traffic follows real drivable road centerlines from the UB6 map chunks.
// Car bodies come from the owner's Higgsfield 3D Jutsu project (hybrid sedan, city car, city bus)
// mixed with the bundled CC0 Kenney GLB pack; if a Higgsfield model fails, the Kenney model of the
// same slot is loaded instead. The same mobile vehicle physics is shared with the player's car.
import * as THREE from 'three';
import { Vehicle, type VehicleWorld } from '../player/vehicle';
import type { ChunkData, RoadData } from './types';
import type { CarLike } from './carcollide';

interface TrafficAgent {
  vehicle: Vehicle;
  points: [number, number][];
  index: number;
  direction: 1 | -1;
  targetSpeed: number;
  model: TrafficModel;
  /** seconds left standing still after a crash */
  stunned: number;
}
export interface TrafficModel { url: string; native?: boolean; scale?: number; fallback?: string }

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const wrapAngle = (x: number) => {
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};
// Higgsfield city car and bus are low-poly library models built small (3.1 m / 4.7 m long): they are
// scaled up uniformly to a believable 4.6 m car and a 6.4 m midi bus. The hybrid sedan is to scale.
const HF = 'higgsfield/vehicles/';
export const TRAFFIC_MODELS: TrafficModel[] = [
  { url: HF + 'hf-city-car.glb', native: true, scale: 1.5, fallback: 'taxi.glb' },
  { url: 'taxi.glb' },
  { url: HF + 'hf-city-bus.glb', native: true, scale: 1.35, fallback: 'delivery.glb' },
  { url: HF + 'hf-hybrid-sedan.glb', native: true, scale: 1, fallback: 'suv-luxury.glb' },
  { url: 'police.glb' },
  { url: HF + 'hf-city-car.glb', native: true, scale: 1.5, fallback: 'suv.glb' },
];
const MAX_AGENTS = 6;

export class TrafficManager {
  readonly root = new THREE.Group();
  private agents: TrafficAgent[] = [];
  private lastCenter = new THREE.Vector2(Infinity, Infinity);
  private lastModelIndex = 0;
  get count() { return this.agents.length; }
  /** Live traffic vehicles, for car-to-car collision. */
  get vehicles() { return this.agents.map((a) => a.vehicle); }
  /** A traffic car that was hit stops for a few seconds. */
  stun(v: Vehicle, seconds = 3) { const a = this.agents.find((x) => x.vehicle === v); if (a) a.stunned = Math.max(a.stunned, seconds); }
  /** Bus models are heavier in collisions. */
  massOf(v: Vehicle) { const a = this.agents.find((x) => x.vehicle === v); return a?.model.url.includes('bus') ? 4 : 1.4; }
  get modelStates() { return this.agents.map((a) => String(a.vehicle.root.userData.assetStatus ?? 'loading')); }
  get modelsReady() { return this.agents.filter((a) => a.vehicle.root.userData.assetStatus === 'loaded').length; }

  /** `baseUrl` is the models/ folder; Kenney files live in models/vehicles/. */
  constructor(private baseUrl: string) {
    this.root.name = 'UB6 ambient city traffic';
  }

  private candidates(chunks: ChunkData[], east: number, north: number): RoadData[] {
    const roads: RoadData[] = [];
    for (const chunk of chunks) for (const road of chunk.roads) {
      if (!road.drivable || !['primary', 'secondary', 'tertiary', 'residential', 'trunk'].includes(road.class)) continue;
      if (road.pts.length < 3) continue;
      let length = 0;
      for (let i = 0; i < road.pts.length - 1; i++) {
        length += Math.hypot(road.pts[i + 1][0] - road.pts[i][0], road.pts[i + 1][1] - road.pts[i][1]);
      }
      const mid = road.pts[Math.floor(road.pts.length / 2)];
      if (length < 55 || Math.hypot(mid[0] - east, mid[1] - north) > 250) continue;
      roads.push(road);
    }
    roads.sort((a, b) => {
      const distance = (r: RoadData) => {
        const p = r.pts[Math.floor(r.pts.length / 2)];
        return Math.hypot(p[0] - east, p[1] - north);
      };
      return distance(a) - distance(b);
    });
    return roads;
  }

  private async load(vehicle: Vehicle, model: TrafficModel) {
    const url = (model.url.startsWith('higgsfield/') ? this.baseUrl : this.baseUrl + 'vehicles/') + model.url;
    const ok = await vehicle.loadModel(url, { native: model.native, scale: model.scale });
    if (!ok && model.fallback) await vehicle.loadModel(this.baseUrl + 'vehicles/' + model.fallback);
  }

  rebuild(chunks: ChunkData[], east: number, north: number, heightAt: (e: number, n: number) => number) {
    if (Math.hypot(east - this.lastCenter.x, north - this.lastCenter.y) < 110 && this.agents.length) return;
    this.lastCenter.set(east, north);
    const roads = this.candidates(chunks, east, north);
    const chosen: RoadData[] = [];
    for (const road of roads) {
      const mid = road.pts[Math.floor(road.pts.length / 2)];
      if (chosen.some((r) => {
        const p = r.pts[Math.floor(r.pts.length / 2)];
        return Math.hypot(p[0] - mid[0], p[1] - mid[1]) < 38;
      })) continue;
      chosen.push(road);
      if (chosen.length === MAX_AGENTS) break;
    }

    // Reuse old vehicle objects and swap their route/model assignment instead of duplicating
    // static city geometry whenever the player crosses a chunk boundary.
    const wanted = Math.min(MAX_AGENTS, chosen.length);
    while (this.agents.length < wanted) {
      const vehicle = new Vehicle();
      this.root.add(vehicle.root);
      this.agents.push({
        vehicle, points: [], index: 0, direction: 1,
        targetSpeed: 4.5, model: TRAFFIC_MODELS[this.lastModelIndex++ % TRAFFIC_MODELS.length], stunned: 0,
      });
      const agent = this.agents[this.agents.length - 1];
      void this.load(vehicle, agent.model);
    }
    while (this.agents.length > wanted) {
      const agent = this.agents.pop()!;
      this.root.remove(agent.vehicle.root);
      agent.vehicle.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const materials = Array.isArray(m.material) ? m.material : [m.material];
        materials.forEach((material) => material.dispose());
      });
    }

    chosen.forEach((road, i) => {
      const agent = this.agents[i];
      agent.points = road.pts.map((p) => [p[0], p[1]] as [number, number]);
      agent.direction = 1;
      agent.index = Math.max(1, Math.min(agent.points.length - 2, Math.floor(agent.points.length * 0.35)));
      // Different, conservative speeds keep the cars from looking like a synchronized convoy.
      agent.targetSpeed = road.class === 'trunk' || road.class === 'primary' ? 6.4 + (i % 3) * 0.7 : 4.2 + (i % 2) * 0.8;
      const here = agent.points[agent.index], next = agent.points[agent.index + 1];
      agent.vehicle.heading = Math.atan2(next[0] - here[0], next[1] - here[1]);
      // a route on a bridge starts on its deck, not on the ground underneath
      const onBridge = road.flags?.includes('is_bridge') && Vehicle.surface;
      agent.vehicle.place(here[0], here[1], onBridge ? Vehicle.surface!(here[0], here[1], 1e9) : heightAt(here[0], here[1]));
      agent.vehicle.root.visible = true;
      agent.vehicle.root.userData.traffic = true;
    });
  }

  /** `obstacles`: other cars (the player's, police...) that traffic brakes for instead of driving into. */
  update(dt: number, world: VehicleWorld, snow: number, rain: number, obstacles: CarLike[] = []) {
    for (const agent of this.agents) {
      agent.stunned = Math.max(0, agent.stunned - dt);
      const route = agent.points;
      if (route.length < 3) continue;
      const target = route[agent.index];
      const d = Math.hypot(target[0] - agent.vehicle.east, target[1] - agent.vehicle.north);
      if (d < 7) {
        const next = agent.index + agent.direction;
        if (next < 1 || next >= route.length - 1) agent.direction = agent.direction === 1 ? -1 : 1;
        else agent.index = next;
      }

      const p = route[agent.index];
      const desired = Math.atan2(p[0] - agent.vehicle.east, p[1] - agent.vehicle.north);
      const delta = wrapAngle(desired - agent.vehicle.heading);
      const steering = clamp(delta * 1.8, -1, 1);
      const braking = Math.abs(delta) > 1.3 && Math.abs(agent.vehicle.speed) > 3;
      const throttle = d < 5 ? 0.28 : 1;
      // brake for any car (player, police, other traffic) in the lane ahead
      const v = agent.vehicle, fe = Math.sin(v.heading), fn = Math.cos(v.heading);
      let blocked = agent.stunned > 0;
      for (const o of obstacles) {
        if (o === v) continue;
        const de = o.east - v.east, dn = o.north - v.north;
        const along = de * fe + dn * fn, side = Math.abs(-de * fn + dn * fe);
        if (along > 0 && along < 7 + v.halfLength + o.halfLength && side < 2.4) { blocked = true; break; }
      }
      agent.vehicle.update(dt, {
        x: steering,
        y: blocked ? 0 : throttle * (agent.direction === 1 ? 1 : -1),
        run: false,
        brake: braking || (blocked && Math.abs(v.speed) > 0.2),
      }, world, snow, rain);
    }
  }
}
