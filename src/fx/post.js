import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Runs in linear HDR before tone mapping: radial speed blur, chromatic
// aberration, boost flash, vignette and grain.
const LensShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uBoost: { value: 0 },
    uHit: { value: 0 },
    uFade: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uSpeed, uBoost, uHit, uFade;
    varying vec2 vUv;

    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

    void main() {
      vec2 c = vUv - vec2(0.5, 0.46);
      float r2 = dot(c, c);
      float r = sqrt(r2);

      // radial blur grows toward the frame edge so the vanishing point stays crisp
      float amount = (uSpeed * uSpeed * 0.016 + uBoost * 0.03) * smoothstep(0.12, 0.65, r);
      float jitter = hash(gl_FragCoord.xy + uTime);
      vec3 col = vec3(0.0);
      float total = 0.0;
      for (int i = 0; i < TAPS; i++) {
        float t = (float(i) + jitter) / float(TAPS);
        float w = 1.0 - t * 0.6;
        vec2 uv = vUv - c * amount * t;
        // chromatic split along the same radial direction
        float ca = (0.002 + uBoost * 0.005 + uHit * 0.012) * r;
        col += vec3(texture2D(tDiffuse, uv + c * ca).r,
                    texture2D(tDiffuse, uv).g,
                    texture2D(tDiffuse, uv - c * ca).b) * w;
        total += w;
      }
      col /= total;

      col += vec3(0.1, 0.5, 0.7) * uBoost * 0.05 * smoothstep(0.25, 0.75, r);
      col = mix(col, col * vec3(1.0, 0.4, 0.3) + vec3(0.25, 0.02, 0.0) * r, uHit * 0.6);
      col *= 1.0 - smoothstep(0.25, 0.95, r) * 0.6;
      // gentle grade: lift contrast, cool the shadows
      col = pow(max(col, 0.0), vec3(1.06)) * 1.08;
      col += vec3(-0.004, 0.0, 0.008);
      col += (hash(gl_FragCoord.xy * 0.7 + fract(uTime) * 91.0) - 0.5) * 0.018;
      gl_FragColor = vec4(max(col, 0.0) * uFade, 1.0);
    }`,
};

// A single NaN/inf texel would be smeared across the whole frame by the bloom
// blur, so scrub the HDR buffer first.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: LensShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      gl_FragColor = vec4(clamp(c, 0.0, 40.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { lowPower = false } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: lowPower ? 2 : 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(SanitizeShader));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.6, 0.6, 0.9);
  composer.addPass(bloom);
  const lens = new ShaderPass({ ...LensShader, defines: { TAPS: lowPower ? 5 : 10 } });
  composer.addPass(lens);
  composer.addPass(new OutputPass());
  return {
    composer, bloom, uniforms: lens.uniforms,
    setSize(w, h) { composer.setSize(w, h); },
    render(dt) { composer.render(dt); },
  };
}
