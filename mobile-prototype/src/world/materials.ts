// Procedural textures and shared materials. Everything here is generated in code (original, no
// third-party art). The facade pattern is a stand-in until real building art exists.
import * as THREE from 'three';
import type { Quality } from '../config';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function facadeTextures() {
  const S = 512, N = 8, cell = S / N;
  const [cc, g] = canvas(S, S);
  const [ec, eg] = canvas(S, S);
  const r = rng(7);
  g.fillStyle = '#efefec'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {           // plaster grain
    g.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},0.035)`;
    g.fillRect(r() * S, r() * S, 2, 2);
  }
  eg.fillStyle = '#000'; eg.fillRect(0, 0, S, S);
  for (let j = 0; j < N; j++) {
    g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(0, j * cell + cell - 2, S, 2);   // floor slab line
    for (let i = 0; i < N; i++) {
      const x = i * cell + cell * 0.27, y = j * cell + cell * 0.24, w = cell * 0.46, h = cell * 0.46;
      g.fillStyle = '#d9d9d4'; g.fillRect(x - 3, y - 3, w + 6, h + 6);            // frame
      const grad = g.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, '#a3b9cb'); grad.addColorStop(1, '#5d7186');
      g.fillStyle = grad; g.fillRect(x, y, w, h);
      g.fillStyle = '#d9d9d4'; g.fillRect(x + w / 2 - 1, y, 2, h);                // mullion
      if (r() < 0.38) {                                                           // lit at night
        const warm = r();
        eg.fillStyle = warm < 0.7 ? '#ffc777' : warm < 0.9 ? '#ffe9c4' : '#bcd7ff';
        eg.globalAlpha = 0.55 + r() * 0.45;
        eg.fillRect(x, y, w, h);
        eg.globalAlpha = 1;
      }
    }
  }
  const mk = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  return { map: mk(cc), emissive: mk(ec) };
}

function roadTexture() {
  const W = 384, H = 256, col = W / 3;
  const [c, g] = canvas(W, H);
  const r = rng(11);
  g.fillStyle = '#3b3b3f'; g.fillRect(0, 0, col * 2, H);
  g.fillStyle = '#9b978f'; g.fillRect(col * 2, 0, col, H);
  for (let i = 0; i < 9000; i++) {
    const x = r() * W, v = r();
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)';
    g.fillRect(x, r() * H, 2, 2);
  }
  // column 1: centre dashes (3 m on, 5 m off over the 8 m tile). Decorative: the source data has no lane markings.
  g.fillStyle = '#e6e0c8'; g.fillRect(col + col / 2 - 1.5, 0, 3, H * (3 / 8));
  // column 2: paving joints
  g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1;
  for (let y = 0; y < H; y += 16) { g.beginPath(); g.moveTo(col * 2, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
  for (let x = col * 2; x < W; x += 32) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
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
  makeGround(map: THREE.Texture): THREE.Material;
  setNight(n: number): void; setSnow(s: number): void; dispose(): void;
}

export function createMaterials(q: Quality): Materials {
  const f = facadeTextures();
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
  const building = q.pbr
    ? new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.82, metalness: 0.02 })
    : new THREE.MeshLambertMaterial({ map: f.map, emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true });
  const roadTex = roadTexture();
  const roadOpts = { map: roadTex, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  const road = snowPatch(q.pbr ? new THREE.MeshStandardMaterial({ ...roadOpts, roughness: 0.92, metalness: 0 }) : new THREE.MeshLambertMaterial(roadOpts), 0.45);
  const backdrop = snowPatch(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.9);
  const grounds = new Set<THREE.Material>();
  return {
    building, road, backdrop,
    makeGround(map) {
      const m = groundPatch(q.pbr ? new THREE.MeshStandardMaterial({ map, roughness: 0.96, metalness: 0 }) : new THREE.MeshLambertMaterial({ map }));
      grounds.add(m);
      m.addEventListener('dispose', () => grounds.delete(m));
      return m;
    },
    setNight(n) { (building as THREE.MeshStandardMaterial).emissiveIntensity = n * 0.85; },
    setSnow(s) { snow.value = s; },
    dispose() { building.dispose(); road.dispose(); backdrop.dispose(); f.map.dispose(); f.emissive.dispose(); roadTex.dispose(); detail.value.dispose(); grounds.forEach((m) => m.dispose()); },
  };
}
