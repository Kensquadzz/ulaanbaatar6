// Government Palace (Засгийн газрын ордон), north side of Sukhbaatar Square, hand-modelled from the
// owner's reference photos (2026-11-13).
//
// HONEST STATUS: modelled by eye from photographs, not surveyed. Real: the footprint position,
// orientation and extent (map data), and the facade's composition as seen in the photos: a raised
// podium with a wide central stair, a projecting central portico with white columns and gold capitals,
// an arched niche with the seated Chinggis Khaan statue flanked by two mounted warriors, glass curtain
// walls behind colonnades on both wings, end pavilions, and concave blue-glass "ger" roofs on the
// centre and the ends. ESTIMATED: every height, the column count and spacing, the depth of each part,
// the statues' shapes, and the rear of the building (a plain block with windows). Built in the
// building's local frame: front +Z, x across the facade, ground at y = 0, facade line at z = 0.
import * as THREE from 'three';
import { bakeByMaterial, canvasTex, flagTexture, gerDome, limb, std, tiledBox } from './proc';

let M: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  const glassTex = canvasTex(512, 256, (c) => {
    // curtain wall: blue glass with a darker hall roof showing through as a wide arc (as in the photos)
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#4f7fa8'); g.addColorStop(1, '#244c74');
    c.fillStyle = g; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#18324f';
    c.beginPath(); c.moveTo(0, 256);
    c.bezierCurveTo(60, 70, 452, 70, 512, 256); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(205,215,225,0.6)'; c.lineWidth = 2;
    for (let x = 0; x <= 512; x += 21.3) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 256); c.stroke(); }
    c.lineWidth = 1.5;
    for (let y = 0; y <= 256; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
  }, false);
  const winTex = canvasTex(64, 64, (c) => {
    c.fillStyle = '#e9e2d3'; c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#3d4f5f'; c.fillRect(16, 14, 32, 36);
    c.fillStyle = '#d8d0bf'; c.fillRect(31, 14, 2, 36);
  });
  const winGlow = canvasTex(64, 64, (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#fff'; c.fillRect(16, 14, 32, 36); });
  return {
    stone: std('palace stone (lit)', 0xd6cfbf, 0.8, 0.02, {}, { color: 0xffcf8a, k: 0.22 }),
    shade: std('palace niche', 0xc9bfae, 0.85, 0),
    gold: std('palace gold', 0xc9a14a, 0.35, 0.85),
    glass: std('palace blue glass curtain', 0xc8d4e0, 0.2, 0.15, { map: glassTex }, { color: 0x5b8fd6, k: 0.5 }),
    win: std('palace window band glass', 0x2c4a63, 0.1, 0.6, {}, { color: 0xffd9a0, k: 0.6 }),
    rear: std('palace rear windows', 0xd8d2c4, 0.8, 0.02, { map: winTex, emissiveMap: winGlow }, { color: 0xffd9a0, k: 0.5 }),
    dome: std('palace dome blue glass', 0x2f6f9c, 0.1, 0.7, {}, { color: 0x4f9cff, k: 0.35 }),
    bronze: std('palace statues bronze', 0x3b3a33, 0.5, 0.7),
    flag: new THREE.MeshBasicMaterial({ map: flagTexture(), side: THREE.DoubleSide, fog: true }),
  };
}

/** Builds the palace for a footprint rectangle W wide (facade) and D deep. */
export function buildGovernmentPalace(W: number, D: number, horse: THREE.BufferGeometry | null): THREE.Group {
  M ??= makeMaterials();
  const m = M;
  const root = new THREE.Group();
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.rotation.y = ry; root.add(mesh); return mesh;
  };
  const box = (mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
    put(new THREE.BoxGeometry(Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const span = (s: number, a: number, b: number): [number, number] => (s < 0 ? [-b, -a] : [a, b]);

  const P = 2.4;                                  // podium top
  const half = W / 2, p = 0.085 * W, t = p + 0.06 * W, w = 0.40 * W;
  const Dm = Math.min(34, D * 0.4);               // depth of the detailed front range
  const column = (x: number, z: number, top: number, size = 1.3) => {
    box(m.stone, x - size / 2, x + size / 2, P, top - 1.1, z - size / 2, z + size / 2);
    box(m.gold, x - size * 0.62, x + size * 0.62, top - 1.1, top, z - size * 0.62, z + size * 0.62);
  };

  // podium, foundation skirt and the central stair
  box(m.stone, -half, half, -3, P, -D, 3);
  const sw = p + 6;
  for (let i = 0; i < 7; i++) box(m.stone, -sw, sw, -3, P - (i + 1) * 0.3, 3 + i * 1.3, 3 + (i + 1) * 1.3);
  // rear of the building: plain block with windows (ESTIMATED)
  put(tiledBox(W, 21, D - Dm, 4, 3.6), m.rear, 0, -3 + 21 / 2, -Dm - (D - Dm) / 2);

  for (const s of [-1, 1]) {
    // wings: glass curtain behind a colonnade, entablature with a gold band
    const [x0, x1] = span(s, p, w);
    box(m.stone, x0, x1, P, 19, -Dm, -6.2);
    const glass = new THREE.PlaneGeometry(x1 - x0, 16 - P);
    put(glass, m.glass, (x0 + x1) / 2, (P + 16) / 2, -6.15);
    const [c0, c1] = span(s, t, w);
    const n = Math.max(2, Math.round((c1 - c0) / 5.4));
    for (let i = 0; i < n; i++) column(c0 + ((i + 0.5) * (c1 - c0)) / n, -1.2, 16);
    box(m.stone, x0, x1, 16, 18.6, -6.2, 0);
    box(m.gold, x0, x1, 16.05, 16.55, 0, 0.12);
    box(m.stone, x0, x1, 18.6, 19.2, -6.6, 0.6);
    // raised blocks beside the portico with a window band
    const [tx0, tx1] = span(s, p, t);
    box(m.stone, tx0, tx1, 16, 23, -10, 0.3);
    box(m.win, tx0 + 0.8, tx1 - 0.8, 19.3, 22, 0.3, 0.42);
    box(m.gold, tx0, tx1, 23, 23.35, -10, 0.6);
    column(s * (p + 1.4), 0.2, 16, 1.5);
    column(s * (t - 0.9), 0.2, 16, 1.5);

    // end pavilions with a glass roof each
    const [px0, px1] = span(s, w, half);
    const pw = px1 - px0;
    box(m.stone, px0, px1, P, 21, -Dm, -3);
    put(new THREE.PlaneGeometry(pw, 16 - P), m.glass, (px0 + px1) / 2, (P + 16) / 2, -2.95);
    for (let i = 0; i < 3; i++) column(px0 + ((i + 0.5) * pw) / 3, 0.8, 16);
    box(m.stone, px0, px1, 16, 21, -3, 1.6);
    box(m.gold, px0, px1, 16.05, 16.55, 1.6, 1.72);
    box(m.stone, px0 - 0.6, px1 + 0.6, 21, 21.6, -Dm, 2.2);
    put(gerDome(pw * 0.38, 6), m.dome, (px0 + px1) / 2, 21.6, -pw * 0.5);
    // mounted warriors on pedestals beside the stair (Muqali and Boorchi; shapes ESTIMATED)
    const sx = s * (p + 1.9);
    box(m.stone, sx - 1.4, sx + 1.4, 0, P + 1.6, 4, 8.5);
    warrior(root, m, horse, sx, P + 1.6, 6.2, 3.1);
  }

  // central portico: arched niche, seated Chinggis Khaan, six columns, attic, glass dome, flag
  box(m.stone, -p, p, P, 21, -Dm, -2);
  box(m.shade, -4.6, 4.6, P, 13, -2, -1.88);
  put(new THREE.CircleGeometry(4.6, 24, 0, Math.PI), m.shade, 0, 13, -1.87);
  box(m.stone, -3.2, 3.2, P, P + 3, -1.9, 1.4);
  seatedRuler(root, m.bronze, 0, P + 3, -0.6);
  for (let i = 0; i < 6; i++) column(-p + ((i + 0.5) * 2 * p) / 6, 5, 18);
  box(m.stone, -p - 1, p + 1, 18, 21, -2, 6.2);
  box(m.gold, -p - 1, p + 1, 18.05, 18.6, 6.2, 6.32);
  box(m.stone, -p + 1, p - 1, 21, 25, -9, 4.5);
  box(m.win, -p + 3, p - 3, 22, 24.3, 4.5, 4.62);
  box(m.stone, -p - 0.5, p + 0.5, 25, 25.6, -10, 5.4);
  put(gerDome(p * 0.74, 6.2), m.dome, 0, 25.6, -2.5);
  put(limb(new THREE.Vector3(0, 31.5, -2.5), new THREE.Vector3(0, 38, -2.5), 0.09), m.gold);
  put(new THREE.PlaneGeometry(2.6, 1.3), m.flag, 1.35, 37.3, -2.5);

  const baked = bakeByMaterial(root, 'Засгийн газрын ордон (гараар загварчилсан)');
  root.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g && g !== horse) g.dispose(); });
  return baked;
}

/** Seated ruler figure (bronze, simple shapes), front +Z, base at (x, y, z). About 6 m tall. */
function seatedRuler(root: THREE.Group, mat: THREE.Material, x: number, y: number, z: number) {
  const add = (g: THREE.BufferGeometry, px: number, py: number, pz: number) => { const mm = new THREE.Mesh(g, mat); mm.position.set(x + px, y + py, z + pz); root.add(mm); };
  add(new THREE.BoxGeometry(3.6, 1.6, 2.8), 0, 0.8, 0);               // seat / throne
  add(new THREE.BoxGeometry(3.0, 1.0, 2.2), 0, 2.0, 0.5);             // lap and robe over the knees
  add(new THREE.CylinderGeometry(1.0, 1.35, 2.5, 12), 0, 3.6, -0.4);  // torso
  add(new THREE.SphereGeometry(0.62, 14, 10), 0, 5.25, -0.3);         // head
  add(new THREE.CylinderGeometry(0.75, 0.8, 0.28, 14), 0, 5.75, -0.3); // hat brim
  add(new THREE.CylinderGeometry(0.42, 0.62, 0.55, 14), 0, 6.1, -0.3);
  for (const s of [-1, 1]) {
    const g = limb(new THREE.Vector3(s * 1.15, 4.4, -0.4), new THREE.Vector3(s * 1.3, 2.8, 0.6), 0.32, 0.28);
    const mm = new THREE.Mesh(g, mat); mm.position.set(x, y, z); root.add(mm);
    add(new THREE.BoxGeometry(0.9, 1.6, 0.9), s * 0.85, 0.8, 1.3);    // shins
  }
}

/** Mounted warrior on a pedestal, front +Z; `len` is the horse length. Simple shapes if no horse model. */
function warrior(root: THREE.Group, m: NonNullable<typeof M>, horse: THREE.BufferGeometry | null, x: number, y: number, z: number, len: number) {
  const g = new THREE.Group(); g.position.set(x, y, z); root.add(g);
  let back = len * 0.62, k = len / 2.4;
  if (horse) {
    horse.computeBoundingBox();
    const b = horse.boundingBox!, sz = b.getSize(new THREE.Vector3()), s = len / sz.z;
    const mesh = new THREE.Mesh(horse, m.bronze);
    mesh.scale.setScalar(s);
    mesh.position.set(-(b.min.x + b.max.x) / 2 * s, -b.min.y * s, -(b.min.z + b.max.z) / 2 * s);
    g.add(mesh);
    back = sz.y * s * 0.6; k = len / 2.4;
  } else {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35 * k, len * 0.5, 4, 8), m.bronze);
    body.rotation.x = Math.PI / 2; body.position.y = back - 0.2 * k; g.add(body);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * k, 0.07 * k, back - 0.2 * k, 6), m.bronze);
      leg.position.set(sx * 0.18 * k, (back - 0.2 * k) / 2, sz * len * 0.33); g.add(leg);
    }
  }
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * k, 0.24 * k, 0.75 * k, 8), m.bronze);
  torso.position.set(0, back + 0.4 * k, -0.1 * k); g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12 * k, 8, 6), m.bronze);
  head.position.set(0, back + 0.9 * k, -0.08 * k); g.add(head);
  const helm = new THREE.Mesh(new THREE.ConeGeometry(0.14 * k, 0.28 * k, 8), m.bronze);
  helm.position.set(0, back + 1.08 * k, -0.08 * k); g.add(helm);
  const spear = new THREE.Mesh(limb(new THREE.Vector3(0.3 * k, back - 0.4 * k, 0), new THREE.Vector3(0.34 * k, back + 2.0 * k, 0.1 * k), 0.025 * k), m.bronze);
  g.add(spear);
}
