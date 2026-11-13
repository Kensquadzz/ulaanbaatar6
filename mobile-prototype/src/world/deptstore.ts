// State Department Store (Улсын их дэлгүүр), Peace Avenue, hand-modelled from the owner's reference
// photo (2026-11-13).
//
// HONEST STATUS: modelled by eye from one photograph, not surveyed. Real: the footprint position,
// orientation and extent (map data), and the front's composition in the photo: a ground floor of
// shop windows under a deep canopy with a yellow ornamental railing, five floors of a regular
// window grid between two solid cream end blocks, a glass top floor set back under a flat roof, and
// flagpoles on the roof. ESTIMATED: heights, bay count, depths, the sign, and the other three sides
// (the window grid is continued round them). Advertising banners in the photo are left out.
// Local frame: front +Z, x across the front, ground at y = 0, front line at z = 0.
import * as THREE from 'three';
import { bakeByMaterial, canvasTex, flagTexture, limb, std, tiledBox } from './proc';

let M: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  const win = canvasTex(64, 64, (c) => {
    c.fillStyle = '#d9cfb9'; c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#bfb49c'; c.fillRect(0, 0, 4, 64); c.fillRect(60, 0, 4, 64);
    c.fillStyle = '#3c4952'; c.fillRect(8, 8, 48, 44);
    c.fillStyle = '#d9cfb9'; c.fillRect(30, 8, 4, 44); c.fillRect(8, 28, 48, 3);
  });
  const winGlow = canvasTex(64, 64, (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#fff'; c.fillRect(8, 8, 48, 44); c.fillStyle = '#000'; c.fillRect(30, 8, 4, 44); });
  const shop = canvasTex(128, 64, (c) => {
    c.fillStyle = '#6b3a2c'; c.fillRect(0, 0, 128, 64);
    c.fillStyle = '#c9a75a'; c.fillRect(0, 0, 128, 6);
    c.fillStyle = '#9fb7c4'; c.fillRect(8, 12, 112, 48);
    c.fillStyle = '#6b3a2c'; c.fillRect(62, 12, 4, 48);
  });
  const shopGlow = canvasTex(128, 64, (c) => { c.fillStyle = '#000'; c.fillRect(0, 0, 128, 64); c.fillStyle = '#fff'; c.fillRect(8, 12, 112, 48); });
  const rail = canvasTex(256, 32, (c) => {
    // yellow railing with a red repeating pattern (pattern drawn by eye, ESTIMATED)
    c.fillStyle = '#f0c419'; c.fillRect(0, 0, 256, 32);
    c.strokeStyle = '#c0392b'; c.lineWidth = 3;
    for (let x = 0; x < 256; x += 32) { c.strokeRect(x + 6, 8, 20, 16); c.beginPath(); c.moveTo(x + 16, 8); c.lineTo(x + 16, 24); c.stroke(); }
    c.fillStyle = '#b8861b'; c.fillRect(0, 0, 256, 4); c.fillRect(0, 28, 256, 4);
  });
  const sign = canvasTex(512, 64, (c) => {
    c.clearRect(0, 0, 512, 64);
    c.fillStyle = '#d42a2a'; c.font = 'bold 50px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('УЛСЫН ИХ ДЭЛГҮҮР', 256, 34);
  }, false);
  return {
    body: std('store window grid', 0xe6e0d4, 0.8, 0.02, { map: win, emissiveMap: winGlow }, { color: 0xffe2b0, k: 0.55 }),
    cream: std('store cream stone (lit)', 0xd9cfb9, 0.8, 0.02, {}, { color: 0xffd8a0, k: 0.12 }),
    shop: std('store shop windows retail', 0xffffff, 0.3, 0.2, { map: shop, emissiveMap: shopGlow }, { color: 0xffe6b8, k: 0.9 }),
    rail: std('store yellow railing', 0xffffff, 0.6, 0.1, { map: rail }, { color: 0xffd040, k: 0.25 }),
    glass: std('store top floor glass', 0x5d7f99, 0.08, 0.6, {}, { color: 0xbfe0ff, k: 0.4 }),
    dark: std('store roof', 0x8d8a83, 0.9, 0.05),
    pole: std('store flag poles', 0xd8d8d8, 0.4, 0.8),
    sign: new THREE.MeshStandardMaterial({ name: 'store sign letters', map: sign, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, emissive: 0xff2a2a, emissiveIntensity: 0.3 }),
    flag: new THREE.MeshBasicMaterial({ map: flagTexture(), side: THREE.DoubleSide, fog: true }),
  };
}

export function buildStateDepartmentStore(W: number, D: number): THREE.Group {
  M ??= makeMaterials();
  const m = M;
  const root = new THREE.Group();
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); root.add(mesh); return mesh;
  };
  const box = (mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
    put(new THREE.BoxGeometry(Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const half = W / 2, G = 4.6, TOP = 19.6, endW = Math.min(12, W * 0.17);

  // main body: five floors of windows above a shop floor, all sides (sides ESTIMATED)
  put(tiledBox(W, TOP - G, D, 3.2, 3.0), m.body, 0, G + (TOP - G) / 2, -D / 2);
  put(tiledBox(W, G + 3, D, 6.4, G + 3), m.shop, 0, (G - 3) / 2, -D / 2);
  // solid cream end blocks on the front, slightly proud of the window grid
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -half - 0.2 : half - endW, x1 = s < 0 ? -half + endW : half + 0.2;
    box(m.cream, x0, x1, G, TOP + 1.6, -D * 0.25, 0.7);
  }
  box(m.cream, -half - 0.2, half + 0.2, TOP, TOP + 0.6, -D - 0.2, 0.3);       // roof edge
  // canopy over the shop windows with the yellow railing and the name in red letters
  box(m.cream, -half - 0.5, half + 0.5, G, G + 0.55, 0, 3.4);
  put(new THREE.PlaneGeometry(W + 1, 1.3), m.rail, 0, G + 0.55 + 0.65, 3.42);
  for (const s of [-1, 1]) {
    const side = new THREE.PlaneGeometry(3.4, 1.3); side.rotateY(s * Math.PI / 2);
    put(side, m.rail, s * (half + 0.5), G + 1.2, 1.7);
  }
  put(new THREE.PlaneGeometry(Math.min(26, W * 0.42), 3.2), m.sign, 0, G + 2.6, 2.2);
  // glass top floor set back under a thin flat roof, flagpoles on the front edge
  const gw = W - 2 * endW - 1, gz0 = -D * 0.62, gz1 = -2.2;
  box(m.glass, -gw / 2, gw / 2, TOP + 0.6, TOP + 4.2, gz0, gz1);
  box(m.dark, -gw / 2 - 1, gw / 2 + 1, TOP + 4.2, TOP + 4.6, gz0 - 1, gz1 + 1.4);
  for (let i = 0; i < 4; i++) {
    const x = -gw / 2 + ((i + 0.5) * gw) / 4;
    put(limb(new THREE.Vector3(x, TOP + 4.6, gz1 + 0.8), new THREE.Vector3(x, TOP + 10, gz1 + 0.8), 0.06), m.pole);
    put(new THREE.PlaneGeometry(1.6, 0.8), m.flag, x + 0.82, TOP + 9.5, gz1 + 0.8);
  }

  const baked = bakeByMaterial(root, 'Улсын их дэлгүүр (гараар загварчилсан)');
  root.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); });
  return baked;
}
