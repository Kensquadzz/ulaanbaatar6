// Visual V2 "cinematic mobile" look: bloom on bright lights, a colour grade (saturation, contrast,
// warm highlights / cool shadows) and a soft vignette, plus an image-based environment so glossy
// car paint and glass pick up reflections.
//
// Cost is tied to the graphics profile:
//   HIGH   bloom (half resolution) + grade + environment reflections
//   MEDIUM bloom (quarter resolution) + grade + environment reflections
//   LOW    plain render (no extra passes), no environment map
// All of it is original shader code and the three.js example passes (MIT).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { QualityName } from '../config';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSat: { value: 1.22 }, uContrast: { value: 1.08 }, uVignette: { value: 0.32 },
    uWarm: { value: new THREE.Color(1.04, 1.0, 0.94) }, uCool: { value: new THREE.Color(0.94, 0.98, 1.06) },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  // runs on linear HDR colour, before OutputPass applies tone mapping and sRGB
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uSat, uContrast, uVignette; uniform vec3 uWarm, uCool; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(l), c.rgb, uSat);
      // contrast around a mid grey in log-ish space keeps highlights from clipping
      col = pow(max(col, 0.0), vec3(uContrast)) * pow(0.18, 1.0 - uContrast);
      col *= mix(uCool, uWarm, smoothstep(0.05, 0.6, l));
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class PostFX {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private grade: ShaderPass | null = null;
  private envTex: THREE.Texture | null = null;
  private profile: QualityName = 'medium';
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {}

  configure(profile: QualityName) {
    this.profile = profile;
    this.composer?.dispose(); this.composer = null; this.bloom = null; this.grade = null;
    if (profile !== 'low') {
      if (!this.envTex) {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
      }
      this.scene.environment = this.envTex;
    } else this.scene.environment = null;
    if (profile === 'low') return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: profile === 'high' ? 4 : 0 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const div = profile === 'high' ? 2 : 4;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / div, size.y / div), 0.55, 0.5, 0.82);
    composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.resize();
  }

  resize() {
    if (!this.composer) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x / pr, size.y / pr);
    if (this.bloom) {
      const div = this.profile === 'high' ? 2 : 4;
      this.bloom.resolution.set(size.x / div, size.y / div);
    }
  }

  /** night 0..1: lights bloom harder at night; reflections fade so dark scenes are not lit by the room probe. */
  setMood(night: number, overcast: number) {
    if (this.bloom) {
      this.bloom.strength = 0.32 + 0.6 * night;
      this.bloom.threshold = 0.9 - 0.35 * night;
    }
    if (this.grade) {
      this.grade.uniforms.uSat.value = 1.3 - 0.2 * overcast - 0.05 * night;
      this.grade.uniforms.uContrast.value = 1.12 - 0.04 * overcast;
      this.grade.uniforms.uVignette.value = 0.3 + 0.12 * night;
    }
    (this.scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity = 0.55 * (1 - 0.85 * night);
  }

  render() {
    if (this.composer && this.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
