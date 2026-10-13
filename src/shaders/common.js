import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.86, 0.1, -0.42).normalize();

const SECTOR_COLORS = [
  new THREE.Color(0.05, 0.8, 1.0),
  new THREE.Color(1.0, 0.12, 0.55),
  new THREE.Color(1.0, 0.5, 0.08),
];

/** Neon colour for a lap fraction; mirrors `sectorColor` in GLSL. */
export function sectorColor(t, out = new THREE.Color()) {
  let total = 0;
  out.setRGB(0, 0, 0);
  SECTOR_COLORS.forEach((c, i) => {
    const w = (Math.cos(2 * Math.PI * (t - i / 3)) * 0.5 + 0.5) ** 3;
    out.r += c.r * w; out.g += c.g * w; out.b += c.b * w;
    total += w;
  });
  return out.multiplyScalar(1 / total);
}

/** Shared GLSL: hashing/noise, the analytic sky and distance fog into it. */
export const COMMON = /* glsl */ `
const vec3 SUN_DIR = vec3(${SUN_DIR.x.toFixed(5)}, ${SUN_DIR.y.toFixed(5)}, ${SUN_DIR.z.toFixed(5)});

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float hash31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

vec3 sectorColor(float t) {
  vec3 w = pow(cos(6.2831853 * (t - vec3(0.0, 1.0, 2.0) / 3.0)) * 0.5 + 0.5, vec3(3.0));
  vec3 c = vec3(0.05, 0.8, 1.0) * w.x + vec3(1.0, 0.12, 0.55) * w.y + vec3(1.0, 0.5, 0.08) * w.z;
  return c / (w.x + w.y + w.z);
}

// Smooth dusk gradient + sun glow; cheap enough to evaluate for reflections.
vec3 skyBase(vec3 d) {
  float y = d.y;
  vec3 col = mix(vec3(0.58, 0.17, 0.40), vec3(0.15, 0.05, 0.30), smoothstep(-0.02, 0.2, y));
  col = mix(col, vec3(0.012, 0.018, 0.065), smoothstep(0.1, 0.62, y));
  float sd = max(dot(d, SUN_DIR), 0.0);
  col += vec3(1.0, 0.42, 0.18) * (pow(sd, 5.0) * 0.3 + pow(sd, 36.0) * 0.55);
  return mix(col, vec3(0.03, 0.014, 0.06), 1.0 - smoothstep(-0.3, 0.0, y));
}

vec3 applyFog(vec3 col, vec3 worldPos) {
  vec3 toFrag = worldPos - cameraPosition;
  float dist = length(toFrag);
  float fog = 1.0 - exp(-pow(dist * 0.00055, 1.5));
  vec3 dir = toFrag / max(dist, 1e-4);
  vec3 haze = skyBase(normalize(vec3(dir.x, abs(dir.y) * 0.5 + 0.03, dir.z)));
  return mix(col, haze * 0.8, fog);
}
`;
