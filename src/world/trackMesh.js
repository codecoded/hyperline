import * as THREE from 'three';
import { COMMON } from '../shaders/common.js';
import { HALF_WIDTH, Track } from '../game/track.js';

export const MAX_SHIPS = 8;

const worldVertex = /* glsl */ `
attribute float part;
attribute float curve;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vPart;
varying float vCurve;
void main() {
  vUv = uv;
  vPart = part;
  vCurve = curve;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const roadFragment = /* glsl */ `
${COMMON}
uniform float uTime;
uniform float uLength;
uniform vec3 uShipPos[${MAX_SHIPS}];
uniform vec3 uShipCol[${MAX_SHIPS}];
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  float x = vUv.x * 2.0 - 1.0;
  float ax = abs(x);
  float lap = vUv.y / uLength;
  vec3 neon = sectorColor(lap);
  float dist = length(cameraPosition - vWorld);

  // plating
  float rows = floor(uLength / 10.0);
  vec2 pc = vec2(x * 3.0, lap * rows);
  vec2 cell = floor(pc);
  vec2 g = abs(fract(pc) - 0.5);
  vec2 fw = max(fwidth(pc), vec2(1e-4));
  float seam = max(smoothstep(0.5 - fw.x * 1.5, 0.5, g.x), smoothstep(0.5 - fw.y * 1.5, 0.5, g.y));
  seam *= exp(-dist * 0.006);
  float id = hash21(cell);
  float grime = fbm(vWorld.xz * 0.35);
  vec3 col = mix(vec3(0.008, 0.009, 0.014), vec3(0.02, 0.022, 0.032), id) * (0.75 + 0.5 * grime);
  col *= 1.0 - seam * 0.55;

  // wet-look sky reflection
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormal);
  N = normalize(N + (vec3(vnoise(vWorld.xz * 1.7), 0.0, vnoise(vWorld.zx * 1.7 + 5.0)) - 0.5) * 0.05);
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 4.0);
  col += skyBase(reflect(-V, N)) * (0.04 + 0.45 * fres) * (0.55 + 0.45 * id);

  // edge light strips with a soft spill onto the deck
  float w = max(fwidth(ax), 1e-4);
  float strip = smoothstep(0.905 - w, 0.905 + w, ax) * (1.0 - smoothstep(0.955 - w, 0.955 + w, ax));
  col += neon * strip * 1.5;
  col += neon * 0.16 * exp(-(1.0 - ax) * 9.0);

  // lane dashes
  float lane = 1.0 - smoothstep(0.0, 0.008 + w, abs(ax - 0.3333));
  float dash = step(0.55, fract(lap * rows * 0.5));
  col += vec3(0.45, 0.55, 0.7) * lane * dash * 0.4;

  // centreline with energy pulses running ahead of the pack
  float centre = 1.0 - smoothstep(0.0, 0.006 + w, ax);
  float pulse = pow(fract(lap * 36.0 - uTime * 0.55), 10.0);
  col += neon * centre * (0.35 + 1.8 * pulse);
  col += neon * pulse * 0.1 * exp(-ax * 6.0);

  // start / finish chequer
  float ds = min(vUv.y, uLength - vUv.y);
  if (ds < 4.0 && ax < 0.9) {
    float chk = mod(floor(x * 12.0) + floor(vUv.y / 2.0), 2.0);
    col = mix(col, vec3(1.6) * chk + vec3(0.01), 0.9);
  }

  // hover-field glow under every ship
  for (int i = 0; i < ${MAX_SHIPS}; i++) {
    vec3 d = vWorld - uShipPos[i];
    col += uShipCol[i] * exp(-dot(d, d) * 0.06) * 0.3;
  }

  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

const structureFragment = /* glsl */ `
${COMMON}
uniform float uTime;
uniform float uLength;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vPart;
varying float vCurve;

void main() {
  float lap = vUv.y / uLength;
  vec3 neon = sectorColor(lap);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormal);
  if (dot(N, V) < 0.0) N = -N;
  float rows = floor(uLength / 10.0);
  float v = lap * rows;
  float fres = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 3.0);
  vec3 col = vec3(0.02, 0.022, 0.03) + skyBase(reflect(-V, N)) * (0.04 + 0.3 * fres);

  if (vPart < 1.5) {
    // inner barrier face: segmented light bar; corners get chasing chevrons
    float bar = smoothstep(0.42, 0.47, vUv.x) * (1.0 - smoothstep(0.66, 0.71, vUv.x));
    float seg = smoothstep(0.04, 0.08, fract(v)) * (1.0 - smoothstep(0.92, 0.96, fract(v)));
    float corner = smoothstep(0.0022, 0.0045, abs(vCurve));
    float chase = step(0.5, fract(v * 0.5 - uTime * 3.0));
    float glow = bar * seg * mix(1.0, 0.25 + 1.75 * chase, corner);
    col += mix(neon, vec3(1.0, 0.85, 0.5), corner * 0.5) * glow * 1.35;
    col += neon * 0.07 * (1.0 - vUv.x);
  } else if (vPart < 2.5) {
    // cap rail
    col += neon * smoothstep(0.3, 0.42, vUv.x) * (1.0 - smoothstep(0.58, 0.7, vUv.x)) * 1.3;
  } else {
    // hull + underside: ribs and a thin service light
    float rib = smoothstep(0.46, 0.5, abs(fract(v * 0.5) - 0.5));
    col *= 1.0 - rib * 0.5;
    float line = 1.0 - smoothstep(0.0, 0.03, abs(vUv.x - 0.5));
    col += neon * line * (vPart > 3.5 ? 0.9 : 0.35);
  }
  gl_FragColor = vec4(applyFog(col, vWorld), 1.0);
}`;

const padFragment = /* glsl */ `
${COMMON}
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vec2 p = vUv;
  float x = abs(p.x - 0.5) * 2.0;
  // chevrons sweeping forward
  float t = fract((p.y - x * 0.32) * 3.0 - uTime * 2.2);
  float chev = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.42, 0.5, t));
  float border = max(smoothstep(0.86, 0.92, x), smoothstep(0.9, 0.97, abs(p.y - 0.5) * 2.0));
  float edgeFade = (1.0 - smoothstep(0.92, 1.0, x));
  vec3 col = mix(vec3(0.1, 0.9, 1.0), vec3(1.0), chev * 0.35) * (chev * 1.5 + border * 1.2 + 0.12) * edgeFade;
  float fog = exp(-pow(length(cameraPosition - vWorld) * 0.00055, 1.5));
  gl_FragColor = vec4(col * fog, 1.0);
}`;

function ringBuilder() {
  const data = { position: [], normal: [], uv: [], part: [], curve: [], index: [] };
  return {
    data,
    /** Appends a two-vertex ring; quads are stitched between consecutive rings of the same strip. */
    push(a, b, n, ua, ub, s, part, curve) {
      data.position.push(a.x, a.y, a.z, b.x, b.y, b.z);
      data.normal.push(n.x, n.y, n.z, n.x, n.y, n.z);
      data.uv.push(ua, s, ub, s);
      data.part.push(part, part);
      data.curve.push(curve, curve);
    },
    geometry(ringsPerStrip, strips) {
      for (let k = 0; k < strips; k++) {
        for (let i = 0; i < ringsPerStrip - 1; i++) {
          const a = (i * strips + k) * 2, b = ((i + 1) * strips + k) * 2;
          data.index.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
      geo.setAttribute('part', new THREE.Float32BufferAttribute(data.part, 1));
      geo.setAttribute('curve', new THREE.Float32BufferAttribute(data.curve, 1));
      geo.setIndex(data.index);
      return geo;
    },
  };
}

export function createTrackMeshes(track) {
  const W = HALF_WIDTH;
  const uniforms = {
    uTime: { value: 0 },
    uLength: { value: track.length },
    uShipPos: { value: Array.from({ length: MAX_SHIPS }, () => new THREE.Vector3(0, -9999, 0)) },
    uShipCol: { value: Array.from({ length: MAX_SHIPS }, () => new THREE.Color(0, 0, 0)) },
  };

  // cross-section in (right, up) coordinates: [x0, y0, x1, y1, part, mirrored]
  const sections = [
    [W, 0, W + 0.9, 1.9, 1, true],          // inner barrier
    [W + 0.9, 1.9, W + 1.7, 1.9, 2, true],  // cap rail
    [W + 1.7, 1.9, W + 1.7, -0.9, 3, true], // outer hull
    [W + 1.7, -0.9, W * 0.4, -2.8, 3, true],
    [W * 0.4, -2.8, -W * 0.4, -2.8, 4, false], // keel
  ];
  const strips = [];
  for (const [x0, y0, x1, y1, part, mirrored] of sections) {
    strips.push({ x0, y0, x1, y1, part });
    if (mirrored) strips.push({ x0: -x0, y0, x1: -x1, y1, part });
  }

  const road = ringBuilder(), body = ringBuilder();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  const at = (i, x, y, out) => out.copy(track.pos[i]).addScaledVector(track.right[i], x).addScaledVector(track.up[i], y);
  for (let r = 0; r <= track.count; r++) {
    const i = r % track.count, s = r * track.step;
    road.push(at(i, -W, 0, a), at(i, W, 0, b), track.up[i], 0, 1, s, 0, track.kLat[i]);
    for (const st of strips) {
      at(i, st.x0, st.y0, a); at(i, st.x1, st.y1, b);
      // outward normal of the section edge (rotated +90deg in the right/up plane)
      const dx = st.x1 - st.x0, dy = st.y1 - st.y0, len = Math.hypot(dx, dy);
      const flip = st.x0 + st.x1 >= 0 ? 1 : -1;
      n.set(0, 0, 0).addScaledVector(track.right[i], (-dy / len) * flip).addScaledVector(track.up[i], (dx / len) * flip);
      body.push(a, b, n, 0, 1, s, st.part, track.kLat[i]);
    }
  }

  const roadMesh = new THREE.Mesh(road.geometry(track.count + 1, 1), new THREE.ShaderMaterial({
    uniforms, vertexShader: worldVertex, fragmentShader: roadFragment, side: THREE.DoubleSide,
  }));
  const bodyMesh = new THREE.Mesh(body.geometry(track.count + 1, strips.length), new THREE.ShaderMaterial({
    uniforms, vertexShader: worldVertex, fragmentShader: structureFragment, side: THREE.DoubleSide,
  }));

  // boost pads: short strips that follow the surface
  const pads = ringBuilder();
  const frame = Track.makeFrame();
  const PAD_LEN = 14, PAD_HALF = 4.2, SEGS = 8;
  for (const pad of track.pads) {
    for (let k = 0; k <= SEGS; k++) {
      const f = track.frameAt(pad.s + (k / SEGS - 0.5) * PAD_LEN, frame);
      a.copy(f.pos).addScaledVector(f.right, pad.x - PAD_HALF).addScaledVector(f.up, 0.07);
      b.copy(f.pos).addScaledVector(f.right, pad.x + PAD_HALF).addScaledVector(f.up, 0.07);
      pads.push(a, b, f.up, 0, 1, k / SEGS, 0, 0);
    }
  }
  const padGeo = pads.geometry(SEGS + 1, 1);
  // the builder stitches one strip; drop the quads that would bridge separate pads
  const idx = [];
  for (let p = 0; p < track.pads.length; p++) {
    for (let k = 0; k < SEGS; k++) {
      const i0 = (p * (SEGS + 1) + k) * 2, i1 = i0 + 2;
      idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
  }
  padGeo.setIndex(idx);
  const padMesh = new THREE.Mesh(padGeo, new THREE.ShaderMaterial({
    uniforms, vertexShader: worldVertex, fragmentShader: padFragment,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));

  for (const m of [roadMesh, bodyMesh, padMesh]) m.frustumCulled = false;
  const group = new THREE.Group();
  group.add(roadMesh, bodyMesh, padMesh);
  return { group, uniforms };
}
