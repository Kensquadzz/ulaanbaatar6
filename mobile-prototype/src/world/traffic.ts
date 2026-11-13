// Ambient moving traffic follows real drivable road centerlines from the UB6 map chunks.
// Car bodies use the bundled CC0 Kenney GLB pack; the same mobile vehicle physics is shared
// with the player-controlled sedan.
import * as THREE from 'three';
import { Vehicle, type VehicleWorld } from '../player/vehicle';
import type { ChunkData, RoadData } from './types';

interface TrafficAgent {
  vehicle: Vehicle;
  points: [number, number][];
  index: number;
  direction: 1 | -1;
  targetSpeed: number;
  model: string;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const wrapAngle = (x: number) => {
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};
const MODEL_SET = ['taxi.glb', 'suv-luxury.glb', 'delivery.glb', 'police.glb'];

export class TrafficManager {
  readonly root = new THREE.Group();
  private agents: TrafficAgent[] = [];
  private lastCenter = new THREE.Vector2(Infinity, Infinity);
  private lastModelIndex = 0;
  get count() { return this.agents.length; }
  get modelStates() { return this.agents.map((a) => String(a.vehicle.root.userData.assetStatus ?? 'loading')); }
  get modelsReady() { return this.agents.filter((a) => a.vehicle.root.userData.assetStatus === 'loaded').length; }

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
      if (chosen.length === 4) break;
    }

    // Reuse old vehicle objects and swap their route/model assignment instead of duplicating
    // static city geometry whenever the player crosses a chunk boundary.
    const wanted = Math.min(4, chosen.length);
    while (this.agents.length < wanted) {
      const vehicle = new Vehicle();
      this.root.add(vehicle.root);
      this.agents.push({
        vehicle, points: [], index: 0, direction: 1,
        targetSpeed: 4.5, model: MODEL_SET[this.lastModelIndex++ % MODEL_SET.length],
      });
      const agent = this.agents[this.agents.length - 1];
      void vehicle.loadModel(this.baseUrl + agent.model);
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
      agent.vehicle.place(here[0], here[1], heightAt(here[0], here[1]));
      agent.vehicle.root.visible = true;
      agent.vehicle.root.userData.traffic = true;
    });
  }

  update(dt: number, world: VehicleWorld, snow: number, rain: number) {
    for (const agent of this.agents) {
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
      agent.vehicle.update(dt, {
        x: steering,
        y: throttle * (agent.direction === 1 ? 1 : -1),
        run: false,
        brake: braking,
      }, world, snow, rain);
    }
  }
}
