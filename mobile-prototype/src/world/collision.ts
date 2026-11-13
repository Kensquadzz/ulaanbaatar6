// Building collision in the horizontal plane (East/North metres) plus roof heights.
// Buildings are prisms over their real footprints; the player is a vertical capsule (circle in 2D).
export interface Collider {
  ring: Float32Array;        // e0,n0,e1,n1,... (not closed)
  minE: number; maxE: number; minN: number; maxN: number;
  base: number; top: number; // world Y
  /** bridge deck slab: people walk on it; cars ignore it (they drive on the deck surface instead) */
  deck?: boolean;
}

export function makeCollider(ring: [number, number][], base: number, top: number): Collider {
  const r = new Float32Array(ring.length * 2);
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  ring.forEach((p, i) => {
    r[i * 2] = p[0]; r[i * 2 + 1] = p[1];
    minE = Math.min(minE, p[0]); maxE = Math.max(maxE, p[0]); minN = Math.min(minN, p[1]); maxN = Math.max(maxN, p[1]);
  });
  return { ring: r, minE, maxE, minN, maxN, base, top };
}

export function pointInRing(ring: Float32Array, e: number, n: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ei = ring[i], ni = ring[i + 1], ej = ring[j], nj = ring[j + 1];
    if (ni > n !== nj > n && e < ((ej - ei) * (n - ni)) / (nj - ni) + ei) inside = !inside;
  }
  return inside;
}

/** Pushes a circle out of one footprint. Returns true when it moved. `pos` is [e, n]. */
export function pushOut(c: Collider, pos: [number, number], radius: number): boolean {
  const e = pos[0], n = pos[1];
  if (e < c.minE - radius || e > c.maxE + radius || n < c.minN - radius || n > c.maxN + radius) return false;
  const ring = c.ring;
  let best = Infinity, be = 0, bn = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ae = ring[j], an = ring[j + 1], de = ring[i] - ae, dn = ring[i + 1] - an;
    const len2 = de * de + dn * dn;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((e - ae) * de + (n - an) * dn) / len2)) : 0;
    const pe = ae + de * t, pn = an + dn * t;
    const d2 = (e - pe) * (e - pe) + (n - pn) * (n - pn);
    if (d2 < best) { best = d2; be = pe; bn = pn; }
  }
  const inside = pointInRing(ring, e, n);
  const d = Math.sqrt(best);
  if (!inside && d >= radius) return false;
  let ne = e - be, nn = n - bn;
  if (d < 1e-6) { ne = 1; nn = 0; } else { ne /= d; nn /= d; }
  if (inside) { ne = -ne; nn = -nn; }       // nearest edge point lies ahead: leave through it
  pos[0] = be + ne * radius; pos[1] = bn + nn * radius;
  return true;
}

export class ColliderSet {
  private byChunk = new Map<string, Collider[]>();
  set(key: string, list: Collider[]) { this.byChunk.set(key, list); }
  delete(key: string) { this.byChunk.delete(key); }
  get count() { let c = 0; this.byChunk.forEach((l) => (c += l.length)); return c; }

  /** Colliders whose box is within `pad` of the point. Buildings live in the chunk of their centroid,
   *  so the 3x3 neighbourhood is searched. */
  near(e: number, n: number, pad: number, out: Collider[]): Collider[] {
    out.length = 0;
    const cx = Math.floor(e / 256), cy = Math.floor(n / 256);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const l = this.byChunk.get(cx + dx + ',' + (cy + dy));
      if (!l) continue;
      for (const c of l) {
        if (e >= c.minE - pad && e <= c.maxE + pad && n >= c.minN - pad && n <= c.maxN + pad) out.push(c);
      }
    }
    return out;
  }

  /** Resolves the circle against every solid building at this height. */
  resolve(pos: [number, number], feetY: number, headY: number, radius: number, stepUp: number, scratch: Collider[], skipDeck = false): boolean {
    let hit = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const c of this.near(pos[0], pos[1], radius + 0.5, scratch)) {
        if (feetY >= c.top - stepUp || headY <= c.base || (skipDeck && c.deck)) continue;   // on the roof, below it, or a deck for cars
        if (pushOut(c, pos, radius)) { moved = true; hit = true; }
      }
      if (!moved) break;
    }
    return hit;
  }

  /** Highest roof under the point that the feet may rest on (at or below feetY + stepUp), or -Infinity. */
  roofUnder(e: number, n: number, feetY: number, stepUp: number, scratch: Collider[]): number {
    let y = -Infinity;
    for (const c of this.near(e, n, 0, scratch)) {
      if (c.top <= feetY + stepUp && c.top > y && pointInRing(c.ring, e, n)) y = c.top;
    }
    return y;
  }

  /** True when the point is inside a building volume (used to keep the camera out of walls). */
  inside(e: number, n: number, y: number, scratch: Collider[]): boolean {
    for (const c of this.near(e, n, 0, scratch)) {
      if (y < c.top && y > c.base - 2 && pointInRing(c.ring, e, n)) return true;
    }
    return false;
  }
}
