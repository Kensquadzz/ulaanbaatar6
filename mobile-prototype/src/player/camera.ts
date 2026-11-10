// Orbit camera behind the player with smoothing; it pulls in instead of clipping through
// buildings and never dips under the terrain.
import * as THREE from 'three';
import type { Collider, ColliderSet } from '../world/collision';

export class FollowCamera {
  yaw = 0;                       // direction the camera looks, radians clockwise from north
  pitch = 0.3;                   // radians above the horizontal (camera looks down by this)
  distance = 5.2;
  private cur = 5.2;
  /** Current camera distance; the character is hidden when the camera is pushed right up to it. */
  get current() { return this.cur; }
  private target = new THREE.Vector3();
  private init = false;
  private scratch: Collider[] = [];
  constructor(readonly camera: THREE.PerspectiveCamera) {}

  look(dx: number, dy: number, sensitivity: number) {
    this.yaw += dx * 0.0052 * sensitivity;
    this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch + dy * 0.004 * sensitivity));
  }
  snap() { this.init = false; }

  update(dt: number, px: number, py: number, pz: number, heightAt: (e: number, n: number) => number, colliders: ColliderSet) {
    const k = this.init ? 1 - Math.exp(-dt * 14) : 1;
    this.target.x += (px - this.target.x) * k; this.target.y += (py + 1.5 - this.target.y) * k; this.target.z += (pz - this.target.z) * k;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // unit vector from target back to the camera
    const bx = -Math.sin(this.yaw) * cp, by = sp, bz = Math.cos(this.yaw) * cp;
    // march outward and stop before the first wall or the ground
    let free = this.distance;
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const d = (this.distance * i) / steps;
      const x = this.target.x + bx * d, y = this.target.y + by * d, z = this.target.z + bz * d;
      if (colliders.inside(x, -z, y, this.scratch) || y < heightAt(x, -z) + 0.25) { free = Math.max(0.8, d - this.distance / steps - 0.15); break; }
    }
    // pull in fast, ease back out slowly
    this.cur += (free - this.cur) * (free < this.cur ? 1 : Math.min(1, dt * 3));
    if (!this.init) { this.cur = free; this.init = true; }
    const c = this.camera;
    c.position.set(this.target.x + bx * this.cur, this.target.y + by * this.cur, this.target.z + bz * this.cur);
    const floor = heightAt(c.position.x, -c.position.z) + 0.3;
    if (c.position.y < floor) c.position.y = floor;
    c.lookAt(this.target);
  }
}
