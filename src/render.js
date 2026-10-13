// 渲染管线：世界 -> 第一人称武器层 -> 泛光 -> 屏幕特效 -> 输出
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FXShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uDamage: { value: 0 }, uLowHP: { value: 0 },
    uFlash: { value: 0 }, uVignette: { value: 0.28 }, uDeath: { value: 0 }, uScope: { value: 0 },
    uProtect: { value: 0 }, uUnderRoof: { value: 0 }, uGrain: { value: 0.018 }, uHurt: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uDamage, uLowHP, uFlash, uVignette, uDeath, uScope, uProtect, uGrain, uHurt;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      // uHurt 统一缩放"受击/残血"带来的屏幕干扰（色差、红边、脉动）：晕 3D 的人可以整条拉低
      float dmg = uDamage * uHurt, low = uLowHP * uHurt;
      // 受伤时轻微色差
      float ca = dmg * 0.004 + uDeath * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      float r = length(c * vec2(1.0, 0.8));
      // 暗角
      col *= 1.0 - smoothstep(0.35, 0.95, r) * uVignette;
      // 受击红边
      float edge = smoothstep(0.25, 0.8, r);
      col = mix(col, vec3(0.55, 0.02, 0.0), edge * clamp(dmg, 0.0, 1.0) * 0.75);
      // 低血量去饱和 + 脉动
      float g = dot(col, vec3(0.299, 0.587, 0.114));
      float pulse = 0.5 + 0.5 * sin(uTime * 7.0);
      col = mix(col, vec3(g) * vec3(1.08, 0.92, 0.9), low * 0.55);
      col = mix(col, vec3(0.5, 0.0, 0.0), low * edge * (0.25 + 0.2 * pulse));
      // 死亡：灰暗
      col = mix(col, vec3(g) * 0.6, uDeath * 0.8);
      // 出生保护：淡蓝边
      col = mix(col, vec3(0.35, 0.6, 1.0), uProtect * edge * 0.18);
      // 闪白
      col += uFlash;
      // 胶片颗粒
      col += (h(uv * 1000.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Renderer {
  // 收的是"生效画质值"（档位预设 + 手动微调 + 自动降载），不再是三档字符串
  constructor(canvas, gfx) {
    this.gfx = gfx || {};
    const q = this.gfx.tex || 'high';
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 1.5 : q === 'medium' ? 1.15 : 1));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.75;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false; // 由主循环隔帧触发 needsUpdate，太阳静止、仅士兵移动，隔帧滞后可忽略
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.05, 60000);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 50);
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.samples = this.gfx.msaa == null ? (q === 'low' ? 0 : q === 'medium' ? 2 : 4) : this.gfx.msaa;
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.samples });
    this.composer = new EffectComposer(r, rt);
    this.worldPass = new RenderPass(this.scene, this.camera);
    this.vmPass = new RenderPass(this.vmScene, this.vmCamera);
    this.vmPass.clear = false; this.vmPass.clearDepth = true;
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.vmPass);
    // 辉光通道始终建好，开关只是 pass.enabled —— 这样"关辉光"能实时生效，不必重建整条管线
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.14, 0.35, 3.2);
    this.composer.addPass(this.bloom);
    this.fx = new ShaderPass(FXShader);
    this.composer.addPass(this.fx);
    this.composer.addPass(new OutputPass());
    this.resize();
    this.applyQuality(this.gfx);
    window.addEventListener('resize', () => this.resize());
  }
  // 内部渲染分辨率 = 窗口 CSS 尺寸 × res%。低于 100% 时最后一级 pass 负责放大回画布。
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const k = (this.gfx.res || 100) / 100;
    const rw = Math.max(2, Math.round(w * k)), rh = Math.max(2, Math.round(h * k));
    this.composer.setSize(rw, rh);
    if (this.bloom) this.bloom.setSize(rw / 2, rh / 2);
    this.rtW = rw; this.rtH = rh;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
  }
  // MSAA 采样数长在 render target 上，改不了只能换掉两块 RT（pass 只按引用取用，无需重建）
  setSamples(n) {
    if (n === this.samples) return;
    this.samples = n;
    const w = this.composer.renderTarget1.width, h = this.composer.renderTarget1.height;
    const mk = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: n });
    for (const key of ['renderTarget1', 'renderTarget2']) {
      const old = this.composer[key];
      this.composer[key] = mk();
      old.dispose();
    }
  }
  applyQuality(e) {
    if (!e) return;
    this.gfx = e;
    this.setSamples(e.msaa | 0);
    this.renderer.shadowMap.enabled = e.shadow > 0;
    if (this.bloom) {
      this.bloom.enabled = !!e.bloom;
      this.bloom.strength = e.bloomStrength;
      this.bloom.threshold = e.bloomThreshold;
    }
    const u = this.fx.uniforms;
    u.uVignette.value = e.vignette;
    u.uGrain.value = e.grain;
    u.uHurt.value = e.hurtFx == null ? 1 : e.hurtFx;
    this.resize();
  }
  render() { this.composer.render(); }
}
