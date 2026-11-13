// Car-to-car collision for every vehicle in the game (player car, traffic, police, ambulance).
// Each car is a capsule along its heading (a segment plus the half width as radius). Overlapping
// capsules are pushed apart by mass and exchange speed along the contact normal with a small bounce;
// because the car physics only moves along the heading, the result is projected back onto it.
// Original, simple 2D physics in East/North metres.

export interface CarLike {
  east: number; north: number; heading: number; speed: number;
  halfLength: number; halfWidth: number;
}
export interface CarBody { car: CarLike; mass: number; /** parked/static bodies are pushed only by mass ratio */ }
export interface CarHit { a: number; b: number; impact: number; e: number; n: number }

const RESTITUTION = 0.25;

/** Closest points between segments p1-q1 and p2-q2 (2D). Returns [s, t] parameters in 0..1. */
export function closestSegSeg(p1e: number, p1n: number, q1e: number, q1n: number, p2e: number, p2n: number, q2e: number, q2n: number): [number, number] {
  const d1e = q1e - p1e, d1n = q1n - p1n, d2e = q2e - p2e, d2n = q2n - p2n;
  const re = p1e - p2e, rn = p1n - p2n;
  const a = d1e * d1e + d1n * d1n, e = d2e * d2e + d2n * d2n, f = d2e * re + d2n * rn;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  if (a < 1e-9 && e < 1e-9) return [0, 0];
  if (a < 1e-9) return [0, clamp(f / e)];
  const c = d1e * re + d1n * rn;
  if (e < 1e-9) return [clamp(-c / a), 0];
  const b = d1e * d2e + d1n * d2n, denom = a * e - b * b;
  let s = denom > 1e-9 ? clamp((b * f - c * e) / denom) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
  return [s, t];
}

function axis(c: CarLike) {
  const fe = Math.sin(c.heading), fn = Math.cos(c.heading), h = Math.max(0, c.halfLength - c.halfWidth);
  return { fe, fn, pe: c.east - fe * h, pn: c.north - fn * h, qe: c.east + fe * h, qn: c.north + fn * h };
}

/** Resolves every overlapping pair once. Returns the contacts with their closing speed (m/s). */
export function resolveCars(bodies: CarBody[], out: CarHit[] = []): CarHit[] {
  out.length = 0;
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const A = bodies[i].car, B = bodies[j].car;
    const reach = A.halfLength + B.halfLength;
    if (Math.abs(A.east - B.east) > reach || Math.abs(A.north - B.north) > reach) continue;
    const a = axis(A), b = axis(B);
    const [s, t] = closestSegSeg(a.pe, a.pn, a.qe, a.qn, b.pe, b.pn, b.qe, b.qn);
    const ae = a.pe + (a.qe - a.pe) * s, an = a.pn + (a.qn - a.pn) * s;
    const be = b.pe + (b.qe - b.pe) * t, bn = b.pn + (b.qn - b.pn) * t;
    let ne = be - ae, nn = bn - an;
    const d = Math.hypot(ne, nn), r = A.halfWidth + B.halfWidth;
    if (d >= r) continue;
    if (d < 1e-6) { ne = -a.fn; nn = a.fe; } else { ne /= d; nn /= d; }   // normal from A to B
    const ma = bodies[i].mass, mb = bodies[j].mass, inv = 1 / ma + 1 / mb;
    const push = r - d;
    A.east -= ne * push * (1 / ma) / inv; A.north -= nn * push * (1 / ma) / inv;
    B.east += ne * push * (1 / mb) / inv; B.north += nn * push * (1 / mb) / inv;
    // velocities along each heading
    const vae = a.fe * A.speed, van = a.fn * A.speed, vbe = b.fe * B.speed, vbn = b.fn * B.speed;
    const closing = (vae - vbe) * ne + (van - vbn) * nn;
    if (closing > 0) {
      const jImp = ((1 + RESTITUTION) * closing) / inv;
      const nae = vae - (jImp / ma) * ne, nan = van - (jImp / ma) * nn;
      const nbe = vbe + (jImp / mb) * ne, nbn = vbn + (jImp / mb) * nn;
      A.speed = nae * a.fe + nan * a.fn;
      B.speed = nbe * b.fe + nbn * b.fn;
      out.push({ a: i, b: j, impact: closing, e: (ae + be) / 2, n: (an + bn) / 2 });
    }
  }
  return out;
}

/** Pushes a circle (a person on foot) out of every car. Returns true when it moved. */
export function pushCircleFromCars(pos: [number, number], radius: number, cars: CarLike[]): boolean {
  let hit = false;
  for (const c of cars) {
    if (Math.abs(pos[0] - c.east) > c.halfLength + radius || Math.abs(pos[1] - c.north) > c.halfLength + radius) continue;
    const a = axis(c);
    const de = a.qe - a.pe, dn = a.qn - a.pn, l2 = de * de + dn * dn;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((pos[0] - a.pe) * de + (pos[1] - a.pn) * dn) / l2)) : 0;
    const ce = a.pe + de * t, cn = a.pn + dn * t;
    let ne = pos[0] - ce, nn = pos[1] - cn;
    const d = Math.hypot(ne, nn), r = c.halfWidth + radius;
    if (d >= r) continue;
    if (d < 1e-6) { ne = a.fn; nn = -a.fe; } else { ne /= d; nn /= d; }
    pos[0] = ce + ne * r; pos[1] = cn + nn * r; hit = true;
  }
  return hit;
}
