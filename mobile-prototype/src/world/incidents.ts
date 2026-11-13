// Street incidents: what happens after the player hits a pedestrian or rams a police car.
//   * an injured person stays down; an ambulance drives to them, the crew treats them, they stand
//     up and the ambulance leaves;
//   * the player gets a police "wanted" level (0..5) shown as a badge; police cars chase, and the
//     player is caught if they stay stopped next to a police car. Losing the police for a while
//     lowers the level again.
// Original game rules and UI (no assets, names or icons from any other game). Police and ambulance
// bodies are the Kenney Car Kit models (CC0) already bundled with the prototype.
import * as THREE from 'three';
import { Vehicle, type VehicleWorld } from '../player/vehicle';

export interface IncidentHost {
  /** a point on a drivable road roughly `dist` metres from (e, n), or null */
  roadPointNear(e: number, n: number, minDist: number, maxDist: number): [number, number] | null;
  heal(id: number): void;
  toast(text: string): void;
  sound: { siren(level: number): void };
}

const BEACON = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
const beaconGeo = (() => {
  const g = new THREE.BoxGeometry(0.42, 0.14, 0.22);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([1, 1, 1], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
})();

interface Responder {
  vehicle: Vehicle; kind: 'police' | 'ambulance';
  red: THREE.Mesh; blue: THREE.Mesh;
  stuckT: number; lastE: number; lastN: number;
  // ambulance only
  victim?: { id: number; e: number; n: number }; phase?: 'drive' | 'treat' | 'leave'; phaseT?: number;
  active: boolean;
}

const wrap = (x: number) => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };

export class Incidents {
  readonly root = new THREE.Group();
  wanted = 0;
  private calmT = 0;
  private bustT = 0;
  private flash = 0;
  private police: Responder[] = [];
  private ambulance: Responder | null = null;
  private queue: { id: number; e: number; n: number; t: number }[] = [];
  private badge = document.getElementById('wanted');

  constructor(private modelsUrl: string, private host: IncidentHost) { this.root.name = 'UB6 police and ambulance'; }

  /** Every vehicle that should collide with the others. */
  get vehicles(): Vehicle[] {
    const out: Vehicle[] = [];
    for (const p of this.police) if (p.active) out.push(p.vehicle);
    if (this.ambulance?.active) out.push(this.ambulance.vehicle);
    return out;
  }
  isPolice(v: Vehicle) { return this.police.some((p) => p.vehicle === v); }

  private make(kind: 'police' | 'ambulance'): Responder {
    const vehicle = new Vehicle();
    vehicle.root.userData.kind = kind;
    const file = kind === 'police' ? 'police.glb' : 'ambulance.glb';
    void vehicle.loadModel(this.modelsUrl + file, kind === 'ambulance' ? { box: [2.1, 2.6, 5.4] } : {});
    const red = new THREE.Mesh(beaconGeo, BEACON.clone()), blue = new THREE.Mesh(beaconGeo, BEACON.clone());
    red.name = 'beacon red'; blue.name = 'beacon blue';
    vehicle.root.add(red, blue);
    this.root.add(vehicle.root);
    return { vehicle, kind, red, blue, stuckT: 0, lastE: 0, lastN: 0, active: false };
  }

  private spawnAt(r: Responder, p: [number, number], faceE: number, faceN: number, hAt: (e: number, n: number) => number) {
    r.vehicle.heading = Math.atan2(faceE - p[0], faceN - p[1]);
    r.vehicle.place(p[0], p[1], hAt(p[0], p[1]));
    r.vehicle.root.visible = true; r.active = true; r.stuckT = 0; r.lastE = p[0]; r.lastN = p[1];
  }
  private retire(r: Responder) { r.active = false; r.vehicle.root.visible = false; r.vehicle.speed = 0; }

  /** A person was knocked down by the player's car. */
  pedestrianHit(id: number, e: number, n: number) {
    this.queue.push({ id, e, n, t: 3.5 });
    this.raise(1);
    this.host.toast('Хүн дайрлаа! Түргэн тусламж дуудагдлаа. Цагдаа ирж байна.');
  }
  /** The player rammed a police car. */
  policeRammed() { this.raise(1); }
  private raise(k: number) { this.wanted = Math.min(5, this.wanted + k); this.calmT = 0; this.renderBadge(); }

  private renderBadge() {
    const b = this.badge; if (!b) return;
    b.classList.toggle('hidden', this.wanted === 0);
    b.querySelectorAll('i').forEach((pip, i) => pip.classList.toggle('on', i < this.wanted));
  }

  /** Steers a responder toward a target point. Returns the distance to it. */
  private drive(r: Responder, te: number, tn: number, stopAt: number, maxSpeedRun: boolean, dt: number, world: VehicleWorld) {
    const v = r.vehicle;
    const d = Math.hypot(te - v.east, tn - v.north);
    const delta = wrap(Math.atan2(te - v.east, tn - v.north) - v.heading);
    const reverse = Math.abs(delta) > 2.2 && d < 25;   // target right behind: back up instead of a U-turn
    const steer = Math.max(-1, Math.min(1, delta * 1.6)) * (reverse ? -1 : 1);
    const slow = d < stopAt + Math.abs(v.speed) * 0.9;
    v.update(dt, { x: steer, y: slow ? 0 : reverse ? -1 : Math.abs(delta) > 1.2 ? 0.45 : 1, run: maxSpeedRun && d > 60, brake: slow && Math.abs(v.speed) > 0.3 }, world);
    return d;
  }

  /** Respawns a responder that has been stuck against a building. */
  private unstick(r: Responder, dt: number, tE: number, tN: number, hAt: (e: number, n: number) => number, near = 25, far = 70) {
    const moved = Math.hypot(r.vehicle.east - r.lastE, r.vehicle.north - r.lastN);
    r.lastE = r.vehicle.east; r.lastN = r.vehicle.north;
    r.stuckT = moved < 0.4 * dt * 10 ? r.stuckT + dt : 0;
    if (r.stuckT > 2.5) {
      const p = this.host.roadPointNear(tE, tN, near, far);
      if (p) this.spawnAt(r, p, tE, tN, hAt);
      r.stuckT = 0;
    }
  }

  /** Returns true on the frame the player is caught. */
  update(dt: number, player: { e: number; n: number; speed: number }, world: VehicleWorld, hAt: (e: number, n: number) => number): boolean {
    this.flash += dt;
    const on = Math.floor(this.flash * 6) % 2 === 0;
    for (const r of [...this.police, ...(this.ambulance ? [this.ambulance] : [])]) {
      const top = r.vehicle.height + 0.05;
      r.red.position.set(-0.25, top, 0); r.blue.position.set(0.25, top, 0);
      (r.red.material as THREE.MeshBasicMaterial).color.setRGB(on ? 3 : 0.4, 0.05, 0.05);
      (r.blue.material as THREE.MeshBasicMaterial).color.setRGB(0.05, 0.15, on ? 0.4 : 3);
    }

    // ---- ambulance ----
    for (const q of this.queue) q.t -= dt;
    if ((!this.ambulance || !this.ambulance.active) && this.queue.length && this.queue[0].t <= 0) {
      const v = this.queue.shift()!;
      const p = this.host.roadPointNear(v.e, v.n, 45, 110);
      if (p) {
        this.ambulance ??= this.make('ambulance');
        this.spawnAt(this.ambulance, p, v.e, v.n, hAt);
        this.ambulance.victim = v; this.ambulance.phase = 'drive'; this.ambulance.phaseT = 0;
      } else this.host.heal(v.id);
    }
    const amb = this.ambulance;
    if (amb?.active && amb.victim) {
      amb.phaseT! += dt;
      if (amb.phase === 'drive') {
        const d = this.drive(amb, amb.victim.e, amb.victim.n, 6, true, dt, world);
        this.unstick(amb, dt, amb.victim.e, amb.victim.n, hAt, 10, 35);
        if (d < 9 && Math.abs(amb.vehicle.speed) < 0.6) { amb.phase = 'treat'; amb.phaseT = 0; this.host.toast('Түргэн тусламжийн баг эмчилж байна…'); }
        if (amb.phaseT! > 45) { amb.phase = 'treat'; amb.phaseT = 0; }
      } else if (amb.phase === 'treat') {
        amb.vehicle.update(dt, { x: 0, y: 0, run: false, brake: true }, world);
        if (amb.phaseT! > 7) { this.host.heal(amb.victim.id); amb.phase = 'leave'; amb.phaseT = 0; this.host.toast('Эмчлүүлсэн хүн босож явлаа.'); }
      } else {
        amb.vehicle.update(dt, { x: 0.15, y: 1, run: false, brake: false }, world);
        if (amb.phaseT! > 14) { this.retire(amb); amb.victim = undefined; }
      }
    }

    // ---- police ----
    const want = Math.min(3, this.wanted);
    let near = Infinity;
    for (let i = 0; i < 3; i++) {
      let r = this.police[i];
      if (i < want && (!r || !r.active)) {
        const p = this.host.roadPointNear(player.e, player.n, 60, 140);
        if (p) { r ??= this.police[i] = this.make('police'); this.spawnAt(r, p, player.e, player.n, hAt); }
      }
      if (!r?.active) continue;
      if (this.wanted === 0) {
        // drive off, then disappear
        r.vehicle.update(dt, { x: 0, y: 0.6, run: false, brake: false }, world);
        if (Math.hypot(r.vehicle.east - player.e, r.vehicle.north - player.n) > 120) this.retire(r);
        continue;
      }
      const d = this.drive(r, player.e, player.n, 3.5, true, dt, world);
      this.unstick(r, dt, player.e, player.n, hAt);
      if (d > 220) { const p = this.host.roadPointNear(player.e, player.n, 70, 140); if (p) this.spawnAt(r, p, player.e, player.n, hAt); }
      near = Math.min(near, d);
    }
    this.host.sound.siren(this.wanted > 0 || amb?.phase === 'drive' ? Math.max(0, 1 - Math.min(near, amb?.active ? Math.hypot(amb.vehicle.east - player.e, amb.vehicle.north - player.n) : Infinity) / 160) : 0);

    if (this.wanted > 0) {
      // caught: stopped next to a police car
      if (near < 7 && player.speed < 2) this.bustT += dt; else this.bustT = Math.max(0, this.bustT - dt);
      if (this.bustT > 2.2) {
        this.bustT = 0; this.wanted = 0; this.renderBadge();
        this.host.toast('ЦАГДААД БАРИГДЛАА! Торгууль ногдууллаа.');
        return true;
      }
      // escaping: no police within 80 m for a while lowers the level
      this.calmT = near > 80 ? this.calmT + dt : 0;
      if (this.calmT > 18) { this.calmT = 0; this.wanted--; this.renderBadge(); if (!this.wanted) this.host.toast('Цагдаагаас зугтлаа.'); }
    }
    return false;
  }
}
