// Third-person character controller on the real terrain. Works in East/North metres + world Y
// so it shares the collision code with the tests; the render object is updated from it.
import type { ColliderSet, Collider } from '../world/collision';

export interface MoveInput { x: number; y: number; run: boolean; jump: boolean }   // x right, y forward, in camera space
export const WALK = 1.7, JOG = 3.6, SPRINT = 7.0, RADIUS = 0.35, HEIGHT = 1.75, STEP_UP = 0.45;
const GRAVITY = 16, JUMP_V = 5.6;

export interface World {
  heightAt(e: number, n: number): number;
  colliders: ColliderSet;
  bounds: { minE: number; maxE: number; minN: number; maxN: number };
}

export class Player {
  e = 0; n = 0; y = 0;
  ve = 0; vn = 0; vy = 0;
  heading = 0;                 // radians, 0 = facing north, clockwise
  grounded = true;
  speed = 0;
  private scratch: Collider[] = [];
  private pos: [number, number] = [0, 0];

  place(e: number, n: number, world: World) {
    this.e = e; this.n = n; this.ve = this.vn = this.vy = 0;
    this.pos[0] = e; this.pos[1] = n;
    // if the spot is inside a building, step out of it
    world.colliders.resolve(this.pos, -1e9 + 1, 1e9, RADIUS, 0, this.scratch);
    this.e = this.pos[0]; this.n = this.pos[1];
    this.y = world.heightAt(this.e, this.n); this.grounded = true;
  }

  /** camYaw: direction the camera looks, radians clockwise from north. */
  update(dt: number, input: MoveInput, camYaw: number, world: World) {
    const mag = Math.min(1, Math.hypot(input.x, input.y));
    let te = 0, tn = 0;
    if (mag > 0.08) {
      const target = input.run ? SPRINT : mag > 0.6 ? JOG : WALK * (mag / 0.6 * 0.6 + 0.4);
      const fe = Math.sin(camYaw), fn = Math.cos(camYaw);          // forward
      const re = Math.cos(camYaw), rn = -Math.sin(camYaw);         // right
      const de = (re * input.x + fe * input.y) / mag, dn = (rn * input.x + fn * input.y) / mag;
      te = de * target; tn = dn * target;
      const want = Math.atan2(de, dn);
      let diff = want - this.heading;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      this.heading += diff * Math.min(1, dt * 12);
    }
    const accel = (this.grounded ? 14 : 4) * dt;
    const dve = te - this.ve, dvn = tn - this.vn, dl = Math.hypot(dve, dvn);
    if (dl <= accel) { this.ve = te; this.vn = tn; } else { this.ve += (dve / dl) * accel; this.vn += (dvn / dl) * accel; }
    if (input.jump && this.grounded) { this.vy = JUMP_V; this.grounded = false; }

    // sub-step so a fast frame cannot tunnel through a thin wall
    const dist = Math.hypot(this.ve, this.vn) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.25));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      const pe = this.e, pn = this.n;
      this.pos[0] = this.e + this.ve * h; this.pos[1] = this.n + this.vn * h;
      world.colliders.resolve(this.pos, this.y, this.y + HEIGHT, RADIUS, STEP_UP, this.scratch);
      const b = world.bounds;
      this.e = Math.max(b.minE, Math.min(b.maxE, this.pos[0]));
      this.n = Math.max(b.minN, Math.min(b.maxN, this.pos[1]));
      const ground = Math.max(world.heightAt(this.e, this.n), world.colliders.roofUnder(this.e, this.n, this.y, STEP_UP, this.scratch));
      if (this.grounded) {
        if (ground >= this.y - 0.6) this.y = ground;           // follow slopes and small drops
        else this.grounded = false;                            // walked off a roof or ledge
      }
      if (!this.grounded) {
        this.vy -= GRAVITY * h; this.y += this.vy * h;
        if (this.y <= ground && this.vy <= 0) { this.y = ground; this.vy = 0; this.grounded = true; }
      }
      // true speed after collision, for animation and the HUD
      this.speed = Math.hypot(this.e - pe, this.n - pn) / h;
    }
  }
}
