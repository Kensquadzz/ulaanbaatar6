// Orbit camera behind the player with smoothing; it pulls in instead of clipping through
// buildings and never dips under the terrain.
import * as THREE from 'three';
import type { Collider, ColliderSet } from '../world/collision';

export class FollowCamera {
  yaw = 0;                       // direction the camera looks, radians clockwise from north
  pitch = 0.3;                   // radians above the horizontal (camera looks down by this)
  distance = 4.9;
  private cur = 4.9;
  /** Current camera distance; the character is hidden when the camera is pushed right up to it. */
  get current() { return this.cur; }
  private target = new THREE.Vector3();
  private look_ = new THREE.Vector3();
  private sYaw = 0; private sPitch = 0.3;      // smoothed angles actually used for the view
  private boost = 0;                           // 0..1, eases in while sprinting (wider view, camera a little further back)
  private init = false;
  private scratch: Collider[] = [];
  private baseFov = 62;
  constructor(readonly camera: THREE.PerspectiveCamera) {}

  look(dx: number, dy: number, sensitivity: number) {
    this.yaw += dx * 0.0052 * sensitivity;
    this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch + dy * 0.004 * sensitivity));
  }
  snap() { this.init = false; }
  setBaseFov(fov: number) { this.baseFov = fov; }

  update(dt: number, px: number, py: number, pz: number, heightAt: (e: number, n: number) => number, colliders: ColliderSet, speed = 0) {
    if (!this.init) { this.sYaw = this.yaw; this.sPitch = this.pitch; }
    // a short, frame-rate independent ease removes finger jitter without feeling laggy
    const ka = 1 - Math.exp(-dt * 26);
    this.sYaw += (this.yaw - this.sYaw) * ka; this.sPitch += (this.pitch - this.sPitch) * ka;
    this.boost += ((speed > 5 ? 1 : 0) - this.boost) * (1 - Math.exp(-dt * 3));
    const k = this.init ? 1 - Math.exp(-dt * 14) : 1, ky = this.init ? 1 - Math.exp(-dt * 9) : 1;
    // follow the chest; height eases a little slower so steps and curbs do not shake the view
    this.target.x += (px - this.target.x) * k; this.target.y += (py + 1.45 - this.target.y) * ky; this.target.z += (pz - this.target.z) * k;
    const cp = Math.cos(this.sPitch), sp = Math.sin(this.sPitch);
    // unit vector from target back to the camera, and the camera's right vector
    const bx = -Math.sin(this.sYaw) * cp, by = sp, bz = Math.cos(this.sYaw) * cp;
    const rx = Math.cos(this.sYaw), rz = Math.sin(this.sYaw);
    const want = this.distance + 0.7 * this.boost;
    // march outward on three rays (centre and both edges of the view) and stop before the first wall or the ground
    let free = want;
    const steps = 14;
    outer: for (let i = 1; i <= steps; i++) {
      const d = (want * i) / steps;
      for (const side of [0, -0.32, 0.32]) {
        const x = this.target.x + bx * d + rx * side, y = this.target.y + by * d, z = this.target.z + bz * d + rz * side;
        if (colliders.inside(x, -z, y, this.scratch) || y < heightAt(x, -z) + 0.3) { free = Math.max(0.8, d - want / steps - 0.2); break outer; }
      }
    }
    // pull in fast, ease back out slowly
    this.cur += (free - this.cur) * (free < this.cur ? 1 - Math.exp(-dt * 40) : 1 - Math.exp(-dt * 3));
    if (!this.init) { this.cur = free; this.init = true; }
    const c = this.camera;
    // slight over-the-shoulder offset that shrinks as the camera is pushed in
    const sh = 0.28 * Math.min(1, this.cur / this.distance);
    c.position.set(this.target.x + bx * this.cur + rx * sh, this.target.y + by * this.cur, this.target.z + bz * this.cur + rz * sh);
    const floor = heightAt(c.position.x, -c.position.z) + 0.35;
    if (c.position.y < floor) c.position.y = floor;
    this.look_.set(this.target.x + rx * sh, this.target.y + 0.12, this.target.z + rz * sh);
    c.lookAt(this.look_);
    const fov = this.baseFov + 5 * this.boost;
    if (Math.abs(c.fov - fov) > 0.05) { c.fov = fov; c.updateProjectionMatrix(); }
  }
}
