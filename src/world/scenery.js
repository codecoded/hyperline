import * as THREE from 'three';
import { COMMON, sectorColor } from '../shaders/common.js';
import { GROUND_Y, HALF_WIDTH, Track } from '../game/track.js';

// deterministic so the skyline is the same every run
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const instancedVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vSeed;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  // instances are scaled non-uniformly, so normals need the inverse-transpose
  mat3 im = mat3(instanceMatrix);
  vec3 scale2 = vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
  vNormal = normalize(mat3(modelMatrix) * (im * (normal / scale2)));
  vSeed = fract(instanceMatrix[3].x * 0.0137 + instanceMatrix[3].z * 0.0071);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const towerFragment = /* glsl */ `
${COMMON}
uniform float uTime;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vSeed;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float dist = length(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
  vec3 col = vec3(0.012, 0.012, 0.02) + skyBase(reflect(-V, N)) * (0.03 + 0.16 * fres);
  col += vec3(1.0, 0.4, 0.2) * max(dot(N, SUN_DIR), 0.0) * 0.05;

  vec3 accent = vSeed < 0.4 ? vec3(0.05, 0.8, 1.0) : (vSeed < 0.75 ? vec3(1.0, 0.12, 0.55) : vec3(1.0, 0.6, 0.15));

  if (abs(N.y) < 0.5) {
    // windows, laid out in world space so scaled instances keep sane proportions
    vec2 t = abs(N.x) > abs(N.z) ? vWorld.zy : vWorld.xy;
    vec2 size = vec2(6.0, 8.0);
    vec2 cell = floor(t / size), f = fract(t / size);
    float h = hash21(cell + vSeed * 91.7);
    float h2 = hash21(cell.yx * 1.7 + vSeed * 13.1);
    // whole floors go dark together so the facade reads as bands, not static
    float floorOn = step(0.35, hash11(cell.y * 0.37 + vSeed * 57.0));
    float lit = step(0.62, h) * floorOn;
    float win = step(0.14, f.x) * step(f.x, 0.86) * step(0.22, f.y) * step(f.y, 0.72);
    vec3 wcol = mix(vec3(1.0, 0.72, 0.4), accent, step(0.55, h2));
    float flicker = 0.85 + 0.15 * sin(uTime * (0.5 + h2 * 2.0) + h * 30.0);
    // far away the grid aliases, so fade towards its average brightness
    float detail = exp(-dist * 0.0003);
    col += wcol * mix(0.06, win * lit * flicker * 1.3, detail);

    // neon crown and waist bands
    float band = (1.0 - smoothstep(0.0, 0.012, abs(vLocal.y - 0.985))) + (1.0 - smoothstep(0.0, 0.006, abs(vLocal.y - (0.3 + vSeed * 0.4))));
    col += accent * band * 2.2;
  } else {
    // rooftop beacon wash
    col += accent * 0.12 * (0.5 + 0.5 * sin(uTime * 2.0 + vSeed * 40.0));
  }
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

const pylonFragment = /* glsl */ `
${COMMON}
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
  vec3 col = vec3(0.016, 0.017, 0.024) + skyBase(reflect(-V, N)) * (0.04 + 0.3 * fres);
  col += vec3(1.0, 0.4, 0.2) * max(dot(N, SUN_DIR), 0.0) * 0.06;
  float ring = 1.0 - smoothstep(0.0, 0.012, abs(vLocal.y + 0.05));
  col += vec3(1.0, 0.25, 0.2) * ring * 1.6;
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

function distanceToTrack(track, x, z) {
  let best = Infinity;
  for (let i = 0; i < track.count; i += 6) {
    const p = track.pos[i];
    best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
  }
  return Math.sqrt(best);
}

export function createTowers(track, towerScene) {
  const rand = mulberry32(1987);
  const geos = ['tower_A', 'tower_B', 'tower_C', 'tower_D'].map((n) => towerScene.getObjectByName(n).geometry);
  const box = new THREE.Box3();
  track.pos.forEach((p) => box.expandByPoint(p));
  const centre = box.getCenter(new THREE.Vector3());

  const lists = geos.map(() => []);
  const place = (x, z, w, h, d) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, GROUND_Y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.floor(rand() * 4) * Math.PI / 2 + (rand() - 0.5) * 0.3),
      new THREE.Vector3(w, h, d));
    lists[Math.floor(rand() * geos.length)].push(m);
  };
  // city blocks threaded through and around the circuit
  for (let tries = 0, placed = 0; placed < 300 && tries < 6000; tries++) {
    const x = THREE.MathUtils.lerp(box.min.x - 900, box.max.x + 900, rand());
    const z = THREE.MathUtils.lerp(box.min.z - 900, box.max.z + 900, rand());
    const w = 50 + rand() * 80, d = 50 + rand() * 80;
    const clear = distanceToTrack(track, x, z);
    if (clear < HALF_WIDTH + 55 + Math.max(w, d) * 0.75) continue;
    // taller near the circuit so the skyline towers over the racing
    const h = (140 + rand() * rand() * 620) * (clear < 400 ? 1.2 : 0.85);
    place(x, z, w, h, d);
    placed++;
  }
  // distant megastructures for the horizon
  for (let i = 0; i < 70; i++) {
    const a = rand() * Math.PI * 2, r = 2800 + rand() * 2600;
    place(centre.x + Math.cos(a) * r, centre.z + Math.sin(a) * r, 160 + rand() * 260, 500 + rand() * 1300, 160 + rand() * 260);
  }

  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: instancedVertex, fragmentShader: towerFragment });
  const group = new THREE.Group();
  geos.forEach((geo, g) => {
    const mesh = new THREE.InstancedMesh(geo, material, lists[g].length);
    lists[g].forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  return { group, uniforms };
}

export function createPylons(track) {
  const geo = new THREE.CylinderGeometry(0.5, 0.72, 1, 6, 1).translate(0, -0.5, 0);
  const every = Math.round(110 / track.step);
  const count = Math.floor(track.count / every);
  const mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
    vertexShader: instancedVertex, fragmentShader: pylonFragment,
  }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let k = 0; k < count; k++) {
    const p = track.pos[k * every];
    const top = p.y - 2.2;
    m.compose(new THREE.Vector3(p.x, top, p.z), q, new THREE.Vector3(9, top - GROUND_Y, 9));
    mesh.setMatrixAt(k, m);
  }
  mesh.frustumCulled = false;
  return mesh;
}

function makeBannerTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'italic 900 92px Orbitron, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText('HYPERLINE  ///  AG LEAGUE  ///  NEO-KYRA CIRCUIT  ///', 20, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function createBanner() {
  const uniforms = { uTime: { value: 0 }, uMap: { value: makeBannerTexture() } };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(24.4, 3.6), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float text = texture2D(uMap, vec2(vUv.x * 0.42 + uTime * 0.05, vUv.y)).r;
        float scan = 0.75 + 0.25 * sin(vUv.y * 90.0 - uTime * 6.0);
        float glitch = step(0.985, fract(sin(floor(uTime * 12.0) * 91.7) * 43758.5)) * 0.5;
        vec3 col = mix(vec3(0.05, 0.8, 1.0), vec3(1.0, 0.15, 0.6), vUv.x + glitch) * (text * 2.4 + 0.12) * scan;
        gl_FragColor = vec4(col, 1.0);
      }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  return { mesh, uniforms };
}

/** Blender-built arches placed around the lap, plus the start gantry with its holo banner. */
export function createGates(track, gateScene) {
  const group = new THREE.Group();
  const frame = Track.makeFrame();
  const left = new THREE.Vector3(), basis = new THREE.Matrix4();
  const COUNT = 16;
  let banner = null;
  for (let k = 0; k < COUNT; k++) {
    const s = (k / COUNT) * track.length;
    const src = gateScene.getObjectByName(k === 0 ? 'gate_start' : 'gate');
    const gate = src.clone(true);
    const color = sectorColor(k / COUNT);
    gate.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.name === 'GateGlow') {
        o.material = o.material.clone();
        o.material.emissive.copy(color);
        o.material.emissiveIntensity = 5;
      }
    });
    const f = track.frameAt(s, frame);
    left.copy(f.right).negate();
    basis.makeBasis(left, f.up, f.tan).setPosition(f.pos);
    gate.position.set(0, 0, 0); gate.quaternion.identity(); gate.scale.setScalar(1);
    gate.applyMatrix4(basis);
    if (k === 0) {
      banner = createBanner();
      banner.mesh.position.set(0, 10.9, 0);
      banner.mesh.rotation.y = Math.PI; // readable for ships approaching the line
      gate.add(banner.mesh);
    }
    group.add(gate);
  }
  return { group, banner };
}
