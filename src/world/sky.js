import * as THREE from 'three';
import { COMMON } from '../shaders/common.js';
import { GROUND_Y } from '../game/track.js';

const skyFragment = /* glsl */ `
${COMMON}
uniform float uTime;
uniform float uDetail;
varying vec3 vDir;

float stars(vec3 d, float scale, float density) {
  vec3 p = d * scale;
  vec3 cell = floor(p);
  float h = hash31(cell);
  vec3 centre = cell + 0.5 + (vec3(hash31(cell + 7.1), hash31(cell + 13.7), hash31(cell + 23.3)) - 0.5) * 0.7;
  float dist = length(p - centre);
  float twinkle = 0.7 + 0.3 * sin(uTime * (1.0 + h * 4.0) + h * 40.0);
  return step(1.0 - density, h) * (1.0 - smoothstep(0.0, 0.12, dist)) * twinkle;
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);

  if (uDetail > 0.5) {
    float high = smoothstep(0.03, 0.4, d.y);
    // nebula wisps
    vec2 nuv = d.xz / (abs(d.y) + 0.35);
    float neb = fbm(nuv * 1.6 + vec2(uTime * 0.004, 0.0));
    float neb2 = fbm(nuv * 3.1 - 9.0);
    col += vec3(0.25, 0.06, 0.45) * pow(neb, 3.0) * high * 1.4;
    col += vec3(0.02, 0.22, 0.32) * pow(neb2, 4.0) * high * 1.2;
    // stars
    float st = stars(d, 150.0, 0.12) + stars(d, 260.0, 0.08) * 0.6;
    col += vec3(0.85, 0.9, 1.0) * st * high * 1.6;

    // sun: banded synth disc sitting on the horizon
    float sd = dot(d, SUN_DIR);
    float disc = smoothstep(0.9905, 0.9915, sd);
    float rel = (d.y - SUN_DIR.y) / 0.14;                       // -1..1 across the disc
    float bands = smoothstep(0.42, 0.5, fract(rel * 5.0 - uTime * 0.03) + rel * 0.55);
    vec3 sun = mix(vec3(1.0, 0.16, 0.42), vec3(1.0, 0.82, 0.3), clamp(rel * 0.5 + 0.55, 0.0, 1.0));
    col = mix(col, sun * 2.6, disc * mix(1.0, bands, step(rel, 0.25)));

    // layered ridge silhouettes
    float az = atan(d.z, d.x);
    float ridgeFar = 0.035 + 0.05 * fbm(vec2(az * 5.0, 3.0));
    float ridgeNear = 0.012 + 0.04 * fbm(vec2(az * 9.0 + 40.0, 9.0));
    vec3 hazeCol = skyBase(normalize(vec3(d.x, 0.02, d.z)));
    col = mix(col, hazeCol * 0.42, (1.0 - smoothstep(ridgeFar, ridgeFar + 0.002, d.y)));
    col = mix(col, hazeCol * 0.2, (1.0 - smoothstep(ridgeNear, ridgeNear + 0.002, d.y)));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export function createSky() {
  const uniforms = { uTime: { value: 0 }, uDetail: { value: 1 } };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(7000, 48, 24),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: skyVertex, fragmentShader: skyFragment,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    }));
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/** Low-detail copy of the sky baked into a PMREM so ship paint reflects it. */
export function createEnvironment(renderer) {
  const scene = new THREE.Scene();
  const { mesh, uniforms } = createSky();
  uniforms.uDetail.value = 0;
  mesh.scale.setScalar(0.01);
  scene.add(mesh);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
  return env;
}

const groundFragment = /* glsl */ `
${COMMON}
uniform float uTime;
varying vec3 vWorld;

float gridLine(vec2 p, float size) {
  vec2 q = p / size;
  vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-5));
  return 1.0 - min(min(g.x, g.y), 1.0);
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  vec3 col = vec3(0.012, 0.008, 0.022);

  // glossy plain: mirror the sky, rippled a touch
  vec2 ripple = vec2(vnoise(vWorld.xz * 0.02 + uTime * 0.05), vnoise(vWorld.zx * 0.02 - uTime * 0.04)) - 0.5;
  vec3 N = normalize(vec3(ripple.x * 0.08, 1.0, ripple.y * 0.08));
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
  col += skyBase(reflect(-V, N)) * (0.08 + 0.75 * fres);

  float fade = exp(-dist * 0.0011);
  float major = gridLine(vWorld.xz, 240.0);
  float minor = gridLine(vWorld.xz, 60.0);
  float pulse = 0.6 + 0.4 * sin(uTime * 0.8 - length(vWorld.xz) * 0.004);
  col += vec3(1.0, 0.1, 0.6) * major * fade * 0.9 * pulse;
  col += vec3(0.1, 0.5, 1.0) * minor * fade * fade * 0.22;

  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

export function createGround() {
  const uniforms = { uTime: { value: 0 } };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: groundFragment,
    }));
  mesh.position.y = GROUND_Y;
  return { mesh, uniforms };
}
