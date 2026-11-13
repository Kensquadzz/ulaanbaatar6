// Zaisan Memorial (Зайсан толгойн дурсгал) on the summit of Zaisan hill, hand-modelled from the owner's
// reference photos (2026-11-13).
//
// HONEST STATUS: modelled by eye, not surveyed. Real: the position and the ring's size (OSM building
// footprint, a circle of about 19 m), the OSM footway round it and the long stair arriving from the
// NORTH (OSM steps), so the entrance, the soldier and the tall banner-shaped spire are put on the north
// side, as the photos also show (spire on the far side of the ring seen from the south). From the
// photos: a closed ring wall with a carved frieze and a key-pattern band outside, a large painted
// mural running round the inside, a stone soldier with a raised arm in front of a tall curved spire.
// ESTIMATED: all heights, the spire's exact shape, the opening, the soldier's form. The mural is an
// abstract colour band, not a copy of the real painting.
// Local frame: front +Z (north), ring centre at (0, 0, -D/2), ground at y = 0.
import * as THREE from 'three';
import { bakeByMaterial, canvasTex, limb, std } from './proc';

let M: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  const frieze = canvasTex(512, 64, (c) => {
    c.fillStyle = '#d8ccb2'; c.fillRect(0, 0, 512, 64);
    c.fillStyle = '#c4b69a';
    for (let x = 0; x < 512; x += 64) { c.beginPath(); c.arc(x + 32, 22, 15, 0, 7); c.fill(); }   // medallions (carved, simplified)
    c.strokeStyle = '#a99a7d'; c.lineWidth = 2;
    for (let x = 0; x < 512; x += 16) {                                                               // key (meander) band
      c.beginPath(); c.moveTo(x, 58); c.lineTo(x, 44); c.lineTo(x + 12, 44); c.lineTo(x + 12, 54); c.lineTo(x + 5, 54); c.lineTo(x + 5, 50); c.stroke();
    }
    c.fillStyle = '#b9ab8e'; c.fillRect(0, 40, 512, 2); c.fillRect(0, 62, 512, 2);
  });
  const mural = canvasTex(512, 64, (c) => {
    // abstract warm colour band standing in for the painted mural (NOT the real artwork)
    const cols = ['#9c4a2f', '#c27a3a', '#d4a64a', '#4f6f8f', '#6b4a5e', '#a8572c', '#7a3b22', '#5f7448', '#e0c08a'];
    let s = 3; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    c.fillStyle = '#b5652d'; c.fillRect(0, 0, 512, 64);
    for (let i = 0; i < 700; i++) { c.fillStyle = cols[Math.floor(r() * cols.length)]; c.globalAlpha = 0.85; c.fillRect(r() * 512, 4 + r() * 50, 2 + r() * 7, 5 + r() * 14); }
    c.globalAlpha = 1;
    c.fillStyle = '#e8d5a8'; c.fillRect(0, 0, 512, 3); c.fillRect(0, 61, 512, 3);
  });
  return {
    stone: std('zaisan stone (lit)', 0xd6cbb3, 0.85, 0.02, {}, { color: 0xffd9a0, k: 0.2 }),
    frieze: std('zaisan frieze', 0xffffff, 0.85, 0.02, { map: frieze, side: THREE.DoubleSide }, { color: 0xffd9a0, k: 0.2 }),
    mural: std('zaisan mural', 0xd8d0c4, 0.8, 0.02, { map: mural, side: THREE.BackSide }, { color: 0xffe0b0, k: 0.35 }),
    red: std('zaisan red granite', 0x8a3b2e, 0.6, 0.05),
    floor: std('zaisan floor', 0xb3aa98, 0.9, 0),
  };
}

const R = 9.3;            // ring outer radius (OSM circle ~19 m across)
const OPEN = 0.55;        // opening angle (rad) at the north entrance
const SPIRE_ANGLE = 0.58, SPIRE_DIST = 14.7;
/** OSM building drawn as part of this model (spire and soldier); its own footprint stays the collider. */
export const ZAISAN_SPIRE_ID = '3e2a1b82';

export function buildZaisanMemorial(_W: number, D: number): THREE.Group {
  M ??= makeMaterials();
  const m = M;
  const root = new THREE.Group();
  const cz = -D / 2;
  const put = (g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => { const mm = new THREE.Mesh(g, mat); mm.position.set(x, y, z); root.add(mm); return mm; };
  // floor disc and a low step round it
  put(new THREE.CylinderGeometry(R + 1.6, R + 2.0, 0.6, 40), m.floor, 0, -0.3, cz);
  put(new THREE.CylinderGeometry(R + 0.6, R + 0.6, 0.35, 40), m.floor, 0, 0.17, cz);
  // ring wall: lower plain band, carved frieze above; mural on the inside; open towards the north (+Z)
  // CylinderGeometry theta is measured from +Z toward +X, so the gap is centred on theta = 0
  const start = OPEN / 2, len = Math.PI * 2 - OPEN;
  put(new THREE.CylinderGeometry(R, R, 1.6, 48, 1, true, start, len), m.stone, 0, 0.35 + 0.8, cz);
  put(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 2.6, 48, 1, true, start, len), m.frieze, 0, 1.95 + 1.3, cz);
  put(new THREE.CylinderGeometry(R - 0.7, R - 0.7, 4.0, 48, 1, true, start, len), m.mural, 0, 0.35 + 2.0, cz);
  // wall top and the two end faces at the opening
  const top = new THREE.RingGeometry(R - 0.75, R + 0.15, 48, 1, start - Math.PI / 2, len);
  top.rotateX(-Math.PI / 2);
  put(top, m.stone, 0, 4.36, cz);
  for (const a of [start, start + len]) {
    const g = new THREE.BoxGeometry(0.3, 4.0, 0.8);
    const mm = put(g, m.stone, Math.sin(a) * (R - 0.35), 2.35, cz + Math.cos(a) * (R - 0.35));
    mm.rotation.y = a;
  }
  // eternal-flame bowl in the middle (simple)
  put(new THREE.CylinderGeometry(0.9, 0.6, 0.9, 16), m.red, 0, 0.8, cz);

  // spire: tall curved blade on the real OSM footprint "Red Army Soldier Statue" (height 27 m in the
  // source), 14.7 m from the ring centre, bearing ~33 degrees east of north
  // facing north the local +X axis points WEST, so east is -X
  const sa = -SPIRE_ANGLE, sx = Math.sin(sa) * SPIRE_DIST, sz = cz + Math.cos(sa) * SPIRE_DIST;
  const shape = new THREE.Shape();
  shape.moveTo(-1.6, 0); shape.lineTo(1.6, 0);
  shape.bezierCurveTo(2.0, 8, 1.6, 18, 0.5, 26);
  shape.lineTo(-0.5, 24.6);
  shape.bezierCurveTo(-0.9, 16, -1.5, 7, -1.6, 0);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 1.3, bevelEnabled: false });
  blade.translate(0, 0, -0.65);
  const bm = put(blade, m.stone, sx, 0, sz); bm.rotation.y = sa + Math.PI / 2;
  put(new THREE.BoxGeometry(4.6, 1.2, 3.4), m.red, sx, 0.6, sz).rotation.y = sa;
  // stone soldier in front of the spire, facing north, right arm raised to the banner (forms ESTIMATED)
  const sol = new THREE.Group(); sol.position.set(sx - 0.4, 1.2, sz + 2.0); root.add(sol);
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number) => { const mm = new THREE.Mesh(g, m.stone); mm.position.set(x, y, z); sol.add(mm); return mm; };
  add(new THREE.CylinderGeometry(0.75, 0.95, 3.4, 12), 0, 1.7, 0);             // greatcoat
  add(new THREE.CylinderGeometry(0.62, 0.72, 1.7, 12), 0, 4.2, 0);             // chest
  add(new THREE.SphereGeometry(0.45, 12, 10), 0, 5.4, 0.05);                   // head
  add(new THREE.SphereGeometry(0.52, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 5.55, 0);   // helmet
  add(new THREE.CylinderGeometry(0.7, 0.7, 0.06, 14), 0, 5.55, 0);             // helmet brim
  const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c);
  sol.add(new THREE.Mesh(limb(V(0.6, 4.8, 0), V(0.9, 6.3, -0.4), 0.22, 0.19), m.stone));
  sol.add(new THREE.Mesh(limb(V(0.9, 6.3, -0.4), V(0.85, 7.6, -0.9), 0.19, 0.16), m.stone));
  sol.add(new THREE.Mesh(limb(V(-0.62, 4.8, 0), V(-0.75, 3.4, 0.25), 0.22, 0.19), m.stone));

  const baked = bakeByMaterial(root, 'Зайсан толгойн дурсгал (зургаас загварчилсан)');
  root.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); });
  return baked;
}

/** Walls the player cannot pass, local (x, z) rings with their top: ring wall pieces and the spire. */
export function zaisanSolids(_W: number, D: number) {
  const cz = -D / 2, out: { ring: [number, number][]; top: number }[] = [];
  const n = 18, start = OPEN / 2, len = Math.PI * 2 - OPEN;
  for (let i = 0; i < n; i++) {
    const a0 = start + (i * len) / n, a1 = start + ((i + 1) * len) / n;
    const p = (a: number, r: number): [number, number] => [Math.sin(a) * r, cz + Math.cos(a) * r];
    out.push({ ring: [p(a0, R - 0.8), p(a1, R - 0.8), p(a1, R + 0.2), p(a0, R + 0.2)], top: 4.4 });
  }
  return out;   // the spire's collider is its own OSM footprint
}
