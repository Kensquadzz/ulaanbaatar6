// Procedural textures and shared materials. Everything here is generated in code (original, no
// third-party art). The facade pattern is a stand-in until real building art exists.
import * as THREE from 'three';
import type { Quality } from '../config';
import { ATLAS_COLS } from './street';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

// ---- facade atlas: one texture array, one layer per architectural style ---------------------------
// Row 0 of each canvas is the BOTTOM of the tile (data textures are not flipped), so "y up" below is
// world up. Each layer is 8 x 8 cells; a cell is one window bay wide and one floor tall (CELL_M).
type Painter = (g: CanvasRenderingContext2D, e: CanvasRenderingContext2D, x: number, y: number, c: number, r: () => number) => void;
const WARM = ['#ffc56e', '#ffd596', '#ffe9c4', '#ffb857', '#cfe0ff'];
function lit(e: CanvasRenderingContext2D, r: () => number, share: number, x: number, y: number, w: number, h: number) {
  if (r() >= share) return;
  const k = r();
  e.fillStyle = WARM[Math.floor(k * WARM.length)];
  e.globalAlpha = 0.5 + r() * 0.5;
  e.fillRect(x, y, w, h);
  if (r() < 0.35) { e.fillStyle = '#000'; e.globalAlpha = 0.45; e.fillRect(x, y, w * (0.3 + r() * 0.3), h); }   // curtain
  e.globalAlpha = 1;
}
function glass(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, top = '#8fa9bf', bottom = '#44576b') {
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, bottom); grad.addColorStop(1, top);
  g.fillStyle = grad; g.fillRect(x, y, w, h);
}
const PAINTERS: { base: string; grain: number; cell?: Painter }[] = [
  { base: '#ecebe6', grain: 0.03, cell: (g, e, x, y, c, r) => {                    // 0 prefab panel housing
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x, y, c, 1.5); g.fillRect(x, y, 1.5, c);            // panel joints
    const wx = x + c * 0.24, wy = y + c * 0.3, ww = c * 0.52, wh = c * 0.46;
    if (r() < 0.3) {                                                                                 // balcony
      g.fillStyle = '#cfcdc6'; g.fillRect(x + c * 0.1, y + c * 0.08, c * 0.8, c * 0.3);
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x + c * 0.1, y + c * 0.36, c * 0.8, 1.5);
      for (let i = 1; i < 6; i++) g.fillRect(x + c * 0.1 + (c * 0.8 * i) / 6, y + c * 0.08, 1, c * 0.28);
    }
    g.fillStyle = '#f6f5f1'; g.fillRect(wx - 2.5, wy - 2.5, ww + 5, wh + 5);
    glass(g, wx, wy, ww, wh);
    g.fillStyle = '#f6f5f1'; g.fillRect(wx + ww * 0.5 - 1, wy, 2, wh); g.fillRect(wx, wy + wh * 0.68, ww, 1.5);
    lit(e, r, 0.42, wx, wy, ww, wh);
  } },
  { base: '#93a4b3', grain: 0.015, cell: (g, e, x, y, c, r) => {                   // 1 glass curtain wall
    for (let i = 0; i < 2; i++) {
      const px = x + (c * i) / 2;
      const v = 0.85 + r() * 0.3;
      glass(g, px, y + c * 0.2, c / 2, c * 0.8, `rgb(${172 * v | 0},${188 * v | 0},${202 * v | 0})`, `rgb(${112 * v | 0},${128 * v | 0},${144 * v | 0})`);
      lit(e, r, 0.3, px + 2, y + c * 0.22, c / 2 - 4, c * 0.74);
    }
    g.fillStyle = '#6c7b89'; g.fillRect(x, y, c, c * 0.2);                                           // spandrel
    g.fillStyle = '#2f3b47'; g.fillRect(x, y, 2, c); g.fillRect(x + c / 2 - 1, y, 2, c); g.fillRect(x, y + c * 0.2 - 1, c, 1.5); g.fillRect(x, y, c, 1.5);
  } },
  { base: '#ece6d8', grain: 0.03, cell: (g, e, x, y, c, r) => {                    // 2 civic / government stone
    g.fillStyle = 'rgba(0,0,0,0.07)'; for (let k = 0; k < 4; k++) g.fillRect(x, y + (c * k) / 4, c, 1);   // stone courses
    g.fillStyle = '#f7f2e6'; g.fillRect(x, y, c * 0.15, c); g.fillRect(x + c * 0.85, y, c * 0.15, c);   // pilasters
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x + c * 0.15, y, 1.5, c); g.fillRect(x + c * 0.85 - 1.5, y, 1.5, c);
    g.fillStyle = '#f7f2e6'; g.fillRect(x, y + c * 0.92, c, c * 0.08);                                // cornice
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + c * 0.9, c, 1.5);
    const wx = x + c * 0.34, wy = y + c * 0.12, ww = c * 0.32, wh = c * 0.7;
    g.fillStyle = '#d9d2c0'; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
    glass(g, wx, wy, ww, wh, '#6f8496', '#34424f');
    g.fillStyle = '#d9d2c0'; g.fillRect(wx + ww / 2 - 1, wy, 2, wh); g.fillRect(wx, wy + wh * 0.5, ww, 1.5);
    lit(e, r, 0.28, wx, wy, ww, wh);
  } },
  { base: '#e6e1d8', grain: 0.05, cell: (g, e, x, y, c, r) => {                    // 3 brick / small house
    g.fillStyle = 'rgba(0,0,0,0.09)';
    for (let k = 0; k < 16; k++) { g.fillRect(x, y + (c * k) / 16, c, 1); for (let m = 0; m < 8; m++) g.fillRect(x + (c * (m + (k % 2) * 0.5)) / 8, y + (c * k) / 16, 1, c / 16); }
    if (r() < 0.55) {
      const wx = x + c * 0.33, wy = y + c * 0.36, ww = c * 0.34, wh = c * 0.38;
      g.fillStyle = '#f4f1ea'; g.fillRect(wx - 2.5, wy - 2.5, ww + 5, wh + 5);
      glass(g, wx, wy, ww, wh, '#7e95a8', '#3d4c5a');
      g.fillStyle = '#f4f1ea'; g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      lit(e, r, 0.5, wx, wy, ww, wh);
    }
  } },
  { base: '#e9e7e1', grain: 0.02, cell: (g, e, x, y, c, r) => {                    // 4 retail / office strip windows
    g.fillStyle = '#d2d0c9'; g.fillRect(x, y, c, c * 0.16);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y + c * 0.16, c, 1.5);
    const wy = y + c * 0.3, wh = c * 0.46;
    glass(g, x + 2, wy, c - 4, wh, '#8ea6ba', '#3f5165');
    g.fillStyle = '#353c44'; g.fillRect(x, wy, 2.5, wh); g.fillRect(x + c / 2 - 1, wy, 2, wh); g.fillRect(x + c - 2.5, wy, 2.5, wh);
    g.fillRect(x, wy - 1.5, c, 1.5); g.fillRect(x, wy + wh, c, 1.5);
    lit(e, r, 0.4, x + 3, wy, c / 2 - 4, wh); lit(e, r, 0.4, x + c / 2 + 1, wy, c / 2 - 4, wh);
  } },
  { base: '#e3e1dc', grain: 0.06 },                                                // 5 plain plaster / concrete
  { base: '#3a3f46', grain: 0.02, cell: (g, e, x, y, c, r) => {                    // 6 ground-floor shopfront
    g.fillStyle = '#2a2d31'; g.fillRect(x, y, c, c * 0.07);
    const gy = y + c * 0.07, gh = c * 0.6;
    glass(g, x + 3, gy, c - 6, gh, '#5d7387', '#27323d');
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(x + c * 0.15, gy); g.lineTo(x + c * 0.4, gy); g.lineTo(x + c * 0.7, gy + gh); g.lineTo(x + c * 0.45, gy + gh); g.fill();
    g.fillStyle = '#1d2024'; g.fillRect(x, y, 3, c * 0.7); g.fillRect(x + c - 3, y, 3, c * 0.7);
    const door = r() < 0.35;
    if (door) { g.fillRect(x + c * 0.36, gy, 2, gh * 0.8); g.fillRect(x + c * 0.64, gy, 2, gh * 0.8); g.fillRect(x + c * 0.36, gy + gh * 0.8, c * 0.3, 2); }
    else g.fillRect(x + c / 2 - 1, gy, 2, gh);
    const hue = Math.floor(r() * 360), sat = 25 + r() * 35;
    g.fillStyle = `hsl(${hue},${sat}%,${34 + r() * 22}%)`; g.fillRect(x + 2, y + c * 0.7, c - 4, c * 0.2);     // blank sign band (no text)
    g.fillStyle = '#c9c7c1'; g.fillRect(x, y + c * 0.92, c, c * 0.08);
    if (r() < 0.75) { e.fillStyle = WARM[Math.floor(r() * 3)]; e.globalAlpha = 0.55 + r() * 0.4; e.fillRect(x + 4, gy + 1, c - 8, gh - 2); e.globalAlpha = 1; }
    if (r() < 0.55) { e.fillStyle = `hsl(${hue},${sat + 30}%,60%)`; e.globalAlpha = 0.8; e.fillRect(x + 2, y + c * 0.7, c - 4, c * 0.2); e.globalAlpha = 1; }
  } },
  { base: '#a3a3a4', grain: 0.07, cell: (g, _e, x, y, c, r) => {                   // 7 flat roof membrane
    g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.07})`; g.fillRect(x, y, c, c);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y, c, 1);
  } },
  { base: '#d6d6d6', grain: 0.02, cell: (g, _e, x, y, c) => {                      // 8 standing-seam sheet metal
    for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + (c * k) / 4, y, 1.5, c); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + (c * k) / 4 + 1.5, y, 1.5, c); }
  } },
];

function facadeArrays() {
  const S = 512, ES = 256, N = 8, cell = S / N, L = PAINTERS.length;
  const color = new Uint8Array(S * S * 4 * L), emis = new Uint8Array(ES * ES * 4 * L);
  PAINTERS.forEach((p, layer) => {
    const [cc, g] = canvas(S, S);
    const [ec, eg] = canvas(S, S);
    const r = rng(7 + layer * 101);
    g.fillStyle = p.base; g.fillRect(0, 0, S, S);
    eg.fillStyle = '#000'; eg.fillRect(0, 0, S, S);
    if (p.cell) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) p.cell(g, eg, i * cell, j * cell, cell, r);
    for (let i = 0; i < 9000; i++) {                       // grain and light weathering
      g.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${p.grain})`;
      g.fillRect(r() * S, r() * S, 2, 2);
    }
    color.set(g.getImageData(0, 0, S, S).data, layer * S * S * 4);
    const [sc, sg] = canvas(ES, ES);
    sg.drawImage(ec, 0, 0, ES, ES);
    emis.set(sg.getImageData(0, 0, ES, ES).data, layer * ES * ES * 4);
    void cc; void sc;
  });
  const mk = (data: Uint8Array, size: number) => {
    const t = new THREE.DataArrayTexture(data, size, size, L);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
    return t;
  };
  return { map: mk(color, S), emissive: mk(emis, ES) };
}

/** Road atlas, columns side by side (see ATLAS_COLS in street.ts). v tiles every 8 m along the road. */
function roadTexture() {
  const col = 128, W = col * ATLAS_COLS, H = 256;
  const [c, g] = canvas(W, H);
  const r = rng(11);
  g.fillStyle = '#3a3a3e'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#a19d95'; g.fillRect(col * 2, 0, col, H);
  // asphalt: aggregate speckle, darker wheel paths, a few sealed cracks and patches
  const asphalt = [0, 1, 3, 4, 5];
  for (const k of asphalt) {
    const x0 = k * col;
    for (let i = 0; i < 2600; i++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)'; g.fillRect(x0 + r() * col, r() * H, 1, 2 + r() * 2); }
    for (let i = 0; i < 3; i++) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.06})`; g.fillRect(x0 + r() * (col - 30), r() * H, 18 + r() * 26, 15 + r() * 35); }
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1;
    for (let i = 0; i < 2; i++) { let x = x0 + 10 + r() * (col - 20), y = r() * H; g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 6; s++) { x += (r() - 0.5) * 14; y += 5 + r() * 7; g.lineTo(Math.max(x0 + 2, Math.min(x0 + col - 2, x)), y); } g.stroke(); }
  }
  const paint = '#e9e5d6', worn = 'rgba(233,229,214,0.82)';
  const line = (x: number, w: number, y0 = 0, y1 = H, style = worn) => { g.fillStyle = style; g.fillRect(x - w / 2, y0, w, y1 - y0); };
  const dash = (x: number, w: number) => line(x, w, 0, H * (3 / 8));           // 3 m on, 5 m off
  // column 1: two-way street, centre dashes and edge lines. Decorative: the source has no lane markings.
  dash(col * 1.5, 3); line(col + 7, 2.5); line(col * 2 - 7, 2.5);
  // column 2: paving slabs
  g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 1;
  for (let y = 0; y < H; y += 16) { g.beginPath(); g.moveTo(col * 2, y + 0.5); g.lineTo(col * 3, y + 0.5); g.stroke(); }
  for (let j = 0; j < H / 16; j++) for (let x = col * 2 + (j % 2 ? 16 : 0); x < col * 3; x += 32) { g.beginPath(); g.moveTo(x + 0.5, j * 16); g.lineTo(x + 0.5, j * 16 + 16); g.stroke(); }
  for (let i = 0; i < 1800; i++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)'; g.fillRect(col * 2 + r() * col, r() * H, 2, 2); }
  // column 3: zebra bars, 0.5 m on / 0.5 m off
  for (let k = 0; k < 8; k++) { g.fillStyle = paint; g.fillRect(col * 3 + 4, (k * H) / 8 + H / 64, col - 8, H / 16); }
  // column 4: wide two-way road, double centre line, lane dashes, edge lines
  line(col * 4.5 - 3, 2.5, 0, H, paint); line(col * 4.5 + 3, 2.5, 0, H, paint);
  dash(col * 4.25, 2.5); dash(col * 4.75, 2.5); line(col * 4 + 6, 2.5); line(col * 5 - 6, 2.5);
  // column 5: wide one-way carriageway, lane dashes and edge lines
  dash(col * 5 + col / 3, 2.5); dash(col * 5 + (2 * col) / 3, 2.5); line(col * 5 + 6, 2.5); line(col * 6 - 6, 2.5);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Soft round falloff used for lamp halos and the pools of light under streetlights. */
function glowTexture() {
  const S = 64;
  const [c, g] = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.14)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tiling grey grain (mean 0.5) multiplied over the painted ground so it stays crisp up close. */
function detailTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(23);
  g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const v = r(), d = 1 + r() * 5;
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.03 + r() * 0.09})` : `rgba(255,255,255,${0.03 + r() * 0.08})`;
    g.beginPath(); g.arc(r() * S, r() * S, d, 0, 6.3); g.fill();
  }
  for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.09)'; g.fillRect(r() * S, r() * S, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

export interface Materials {
  building: THREE.Material; road: THREE.Material; backdrop: THREE.Material;
  lampPole: THREE.Material; lampHead: THREE.MeshBasicMaterial; lampPool: THREE.MeshBasicMaterial; lampHalo: THREE.PointsMaterial;
  makeGround(map: THREE.Texture): THREE.Material;
  setNight(n: number): void; setSnow(s: number): void; dispose(): void;
}

export function createMaterials(q: Quality): Materials {
  const f = facadeArrays();
  const snow = { value: 0 };
  // Real snow depth (from the weather observation) whitens upward-facing ground; never invented.
  const snowPatch = (m: THREE.Material, amount: number) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uSnow = snow;
      sh.fragmentShader = 'uniform float uSnow;\n' + sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.95), uSnow * ${amount.toFixed(2)});`);
    };
    m.customProgramCacheKey = () => 'snow' + amount;
    return m;
  };
  const detail = { value: detailTexture() };
  const groundPatch = (m: THREE.Material) => {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uSnow = snow; sh.uniforms.uDetail = detail;
      sh.fragmentShader = 'uniform float uSnow;\nuniform sampler2D uDetail;\n' + sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float dA = texture2D(uDetail, vMapUv * 19.0).r, dB = texture2D(uDetail, vMapUv * 3.1).r;
         diffuseColor.rgb *= (0.45 + 1.1 * dA) * (0.88 + 0.24 * dB);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.95) * (0.9 + 0.2 * dA), uSnow * 0.9);`);
    };
    m.customProgramCacheKey = () => 'ground';
    return m;
  };
  const lit = { value: 0 }, facade = { value: f.map }, facadeE = { value: f.emissive };
  const building: THREE.Material = q.pbr
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  // One draw call per chunk for every facade style: the style index is a vertex attribute that
  // selects a layer of the texture array (WebGL2, available in Safari 15+).
  building.onBeforeCompile = (sh) => {
    sh.uniforms.uFacade = facade; sh.uniforms.uFacadeE = facadeE; sh.uniforms.uLit = lit;
    sh.vertexShader = 'attribute float style;\nvarying float vStyle;\nvarying vec2 vFUv;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vStyle = style; vFUv = uv;');
    sh.fragmentShader = 'uniform mediump sampler2DArray uFacade;\nuniform mediump sampler2DArray uFacadeE;\nuniform float uLit;\nvarying float vStyle;\nvarying vec2 vFUv;\n' +
      sh.fragmentShader
        .replace('#include <map_fragment>', 'float fLayer = floor(vStyle + 0.5);\n diffuseColor *= texture(uFacade, vec3(vFUv, fLayer));')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += texture(uFacadeE, vec3(vFUv, fLayer)).rgb * uLit;');
  };
  building.customProgramCacheKey = () => 'facade';
  const roadTex = roadTexture();
  const roadOpts = { map: roadTex, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  // Ground and roads are matte, so the cheaper Lambert model looks the same on every profile.
  const road = snowPatch(new THREE.MeshLambertMaterial(roadOpts), 0.45);
  const backdrop = snowPatch(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.9);
  // Streetlights: unlit poles, a glowing head, an additive pool on the ground and a halo sprite.
  // No real light sources are created, so the cost does not grow with the number of lamps.
  const glow = glowTexture();
  const LAMP = new THREE.Color(0xffc98a);
  const lampPole = new THREE.MeshLambertMaterial({ color: 0x3b3f45 });
  const lampHead = new THREE.MeshBasicMaterial({ color: 0x55585c });
  const lampPool = new THREE.MeshBasicMaterial({ map: glow, color: LAMP, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12, fog: true });
  const lampHalo = new THREE.PointsMaterial({ map: glow, color: LAMP, size: 5.5, sizeAttenuation: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
  lampPool.visible = lampHalo.visible = false;
  const grounds = new Set<THREE.Material>();
  return {
    building, road, backdrop, lampPole, lampHead, lampPool, lampHalo,
    makeGround(map) {
      const m = groundPatch(new THREE.MeshLambertMaterial({ map }));
      grounds.add(m);
      m.addEventListener('dispose', () => grounds.delete(m));
      return m;
    },
    setNight(n) {
      lit.value = n * 1.5;
      const on = Math.min(1, n * 1.6);                     // lamps switch on through dusk
      lampPool.opacity = 0.6 * on; lampHalo.opacity = on;
      lampPool.visible = lampHalo.visible = on > 0.02;
      lampHead.color.setRGB(0.1 + 1.9 * on, 0.1 + 1.45 * on, 0.1 + 0.85 * on);
    },
    setSnow(s) { snow.value = s; },
    dispose() { building.dispose(); road.dispose(); lampPole.dispose(); lampHead.dispose(); lampPool.dispose(); lampHalo.dispose(); glow.dispose(); f.emissive.dispose(); backdrop.dispose(); f.map.dispose(); f.emissive.dispose(); roadTex.dispose(); detail.value.dispose(); grounds.forEach((m) => m.dispose()); },
  };
}
