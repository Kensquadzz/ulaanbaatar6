// Sky dome, sun light, ambient light and fog, all driven by the real solar position for
// Ulaanbaatar (core/solar.ts) and by the observed cloud cover / visibility when weather is live.
// The colour ramps are artistic approximations keyed to sun elevation; the sun direction is exact.
import * as THREE from 'three';
import type { SunPosition } from '../core/solar';
import type { SceneWeather } from '../core/weather';

const VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w;            // always at the far plane
}`;
const FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uCloudColor;
uniform float uSunDisc, uNight, uCloud, uTime;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 90.0) * 0.5) * uSunDisc * (1.0 - uCloud * 0.8);
  col += uSunColor * smoothstep(0.99955, 0.99985, sd) * 14.0 * uSunDisc * (1.0 - uCloud);
  if (uNight > 0.01 && d.y > 0.0) {            // procedural stars (decorative, not a star catalogue)
    vec2 g = d.xz / (d.y + 0.35) * 90.0;
    vec2 c = floor(g);
    float r = hash(c);
    float star = step(0.985, r) * smoothstep(0.35, 0.0, length(fract(g) - 0.5 - (vec2(hash(c + 3.1), hash(c + 7.7)) - 0.5) * 0.5));
    col += vec3(star) * uNight * (0.6 + 0.4 * hash(c + 1.3)) * (1.0 - uCloud) * smoothstep(0.0, 0.25, d.y);
  }
  if (uCloud > 0.02 && d.y > 0.0) {
    vec2 p = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.006, uTime * 0.002);
    float n = fbm(p);
    float cover = smoothstep(1.0 - uCloud * 0.9, 1.15 - uCloud * 0.75, n + 0.35);
    cover *= smoothstep(0.0, 0.12, d.y);
    col = mix(col, uCloudColor * (0.75 + 0.35 * n), cover * 0.92);
  }
  col = mix(col, uHorizon, smoothstep(0.06, -0.02, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const C = (hex: number) => new THREE.Color(hex);
// [sun elevation in degrees, zenith, horizon]
const RAMP: [number, THREE.Color, THREE.Color][] = [
  [-18, C(0x03060f), C(0x0c1424)],
  [-10, C(0x070d20), C(0x141f3a)],
  [-4, C(0x142447), C(0x4a4466)],
  [-1, C(0x25407a), C(0xc5725a)],
  [2, C(0x3464a8), C(0xe9a070)],
  [8, C(0x3d77c2), C(0xd6c3a8)],
  [20, C(0x3a78cc), C(0xb4cbe2)],
  [60, C(0x2f6fc8), C(0xa9c6e6)],
];
function ramp(el: number, zenith: THREE.Color, horizon: THREE.Color) {
  let i = 0;
  while (i < RAMP.length - 2 && el > RAMP[i + 1][0]) i++;
  const a = RAMP[i], b = RAMP[i + 1];
  const t = Math.max(0, Math.min(1, (el - a[0]) / (b[0] - a[0])));
  zenith.copy(a[1]).lerp(b[1], t); horizon.copy(a[2]).lerp(b[2], t);
}
const NIGHT_FILL = new THREE.Color(0x9fb0de);   // cool fill so the city stays readable at night (not a modelled moon)
const NIGHT_KEY = new THREE.Color(0xb9c8f2);    // soft directional night light that gives walls shape (stylised, not the real moon)
const NIGHT_DIR = new THREE.Vector3(-0.45, 0.62, 0.64).normalize();
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class SkySystem {
  readonly dome: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x6b5f4a, 1);
  readonly fog = new THREE.FogExp2(0xffffff, 0.001);
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  night = 0; daylight = 1;
  private u = {
    uZenith: { value: C(0) }, uHorizon: { value: C(0) }, uSunDir: { value: new THREE.Vector3() },
    uSunColor: { value: C(0xffffff) }, uCloudColor: { value: C(0xffffff) },
    uSunDisc: { value: 1 }, uNight: { value: 0 }, uCloud: { value: 0 }, uTime: { value: 0 },
  };
  private grey = C(0);

  constructor(scene: THREE.Scene, private shadowMap: number) {
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.dome.scale.setScalar(1000); this.dome.frustumCulled = false; this.dome.renderOrder = 10;
    scene.add(this.dome, this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;
    this.configureShadows(shadowMap);
  }

  configureShadows(size: number) {
    this.shadowMap = size;
    this.sun.castShadow = size > 0;
    if (size > 0) {
      const s = this.sun.shadow;
      if (s.mapSize.x !== size) { s.mapSize.set(size, size); s.map?.dispose(); (s as any).map = null; }
      const cam = s.camera;
      cam.left = -60; cam.right = 60; cam.top = 60; cam.bottom = -60; cam.near = 1; cam.far = 600;
      cam.updateProjectionMatrix();
      s.bias = -0.0006; s.normalBias = 0.35;
    }
  }

  /** `viewDistance` is how far detailed chunks reach, so haze hides the streaming edge. */
  update(sun: SunPosition, w: SceneWeather, focus: THREE.Vector3, camera: THREE.Camera, viewDistance: number, timeS: number) {
    const el = sun.elevationDeg, az = (sun.azimuthDeg * Math.PI) / 180, er = (el * Math.PI) / 180;
    // azimuth is clockwise from north; world x = east, z = -north
    this.sunDir.set(Math.sin(az) * Math.cos(er), Math.sin(er), -Math.cos(az) * Math.cos(er));
    const u = this.u;
    ramp(el, u.uZenith.value, u.uHorizon.value);
    this.daylight = smooth(-6, 10, el);
    this.night = smooth(2, -8, el);
    // overcast: pull the sky toward a grey that follows the daylight level
    const greyL = 0.02 + 0.55 * this.daylight;
    this.grey.setRGB(greyL * 0.92, greyL * 0.95, greyL);
    const cloudMix = w.cloud * 0.75 + w.fog * 0.25;
    u.uZenith.value.lerp(this.grey, Math.min(1, cloudMix * 0.85));
    u.uHorizon.value.lerp(this.grey, Math.min(1, cloudMix * 0.7 + w.fog * 0.3));
    u.uCloudColor.value.setRGB(greyL * 1.25 + 0.02, greyL * 1.25 + 0.02, greyL * 1.3 + 0.03);
    u.uCloud.value = w.cloud; u.uNight.value = this.night; u.uTime.value = timeS * (1 + w.windMs);
    u.uSunDir.value.copy(this.sunDir);
    const warm = smooth(0, 22, el);
    u.uSunColor.value.setRGB(1, 0.62 + 0.36 * warm, 0.35 + 0.6 * warm);
    u.uSunDisc.value = smooth(-2, 1, el);

    const direct = smooth(-1, 12, el) * (1 - 0.8 * w.cloud) * (1 - 0.6 * w.fog);
    // After dusk the same light becomes a dim, shadowless night key so facades are not flat silhouettes.
    const nightKey = this.night * 0.9 * (1 - 0.4 * w.cloud);
    const useNight = nightKey > 3.2 * direct;
    this.sun.color.copy(useNight ? NIGHT_KEY : u.uSunColor.value);
    this.sun.intensity = useNight ? nightKey : 3.2 * direct;
    this.sun.visible = this.sun.intensity > 0.01;
    this.sun.castShadow = this.shadowMap > 0 && !useNight && direct > 0.05;
    const dir = useNight ? NIGHT_DIR : el > 1 ? this.sunDir : new THREE.Vector3(this.sunDir.x, 0.02, this.sunDir.z).normalize();
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(dir, 300);
    this.sun.target.updateMatrixWorld();

    this.hemi.color.copy(u.uZenith.value).lerp(u.uHorizon.value, 0.5);
    this.hemi.groundColor.setRGB(0.4, 0.37, 0.32).multiplyScalar(0.3 + 0.7 * this.daylight).lerp(NIGHT_FILL, 0.35 * this.night);
    // never pitch black: a cool fill keeps the city readable at night
    this.hemi.intensity = 1.0 + 1.5 * this.daylight + 0.5 * w.cloud * this.daylight + 1.0 * this.night;
    if (this.daylight < 0.3) this.hemi.color.lerp(NIGHT_FILL, 1 - this.daylight / 0.3);

    this.fog.color.copy(u.uHorizon.value);
    const reach = Math.max(350, viewDistance);
    this.fog.density = (0.95 + 2.6 * w.fog + 0.5 * Math.max(w.snow, w.rain)) / reach;
    this.dome.position.copy(camera.position);
  }
}
