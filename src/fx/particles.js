import * as THREE from 'three';

const TRAIL_POINTS = 40;
const TRAIL_LIFE = 0.05; // seconds

const trailMaterialBase = {
  vertexShader: /* glsl */ `
    attribute float age;
    varying float vAge;
    varying vec2 vUv;
    void main() {
      vAge = age; vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uPower;
    varying float vAge;
    varying vec2 vUv;
    void main() {
      float across = clamp(1.0 - abs(vUv.x * 2.0 - 1.0), 0.0, 1.0);
      float fade = pow(clamp(1.0 - vAge, 0.0, 1.0), 2.5);
      vec3 col = mix(uColor, vec3(1.0), pow(across, 4.0) * fade * 0.6);
      gl_FragColor = vec4(col * pow(across, 1.5) * fade * (0.2 + uPower * 0.8), 1.0);
    }`,
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
};

/** Fading ribbon behind one engine. */
export class Trail {
  constructor(color) {
    this.points = [];
    this.uniforms = { uColor: { value: color }, uPower: { value: 0 } };
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(TRAIL_POINTS * 6);
    this.ages = new Float32Array(TRAIL_POINTS * 2);
    const uv = new Float32Array(TRAIL_POINTS * 4);
    const index = [];
    for (let i = 0; i < TRAIL_POINTS; i++) {
      uv[i * 4] = 0; uv[i * 4 + 2] = 1;
      if (i < TRAIL_POINTS - 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('age', new THREE.BufferAttribute(this.ages, 1));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ ...trailMaterialBase, uniforms: this.uniforms }));
    this.mesh.frustumCulled = false;
  }

  clear() { this.points.length = 0; }

  update(time, pos, right, width, power) {
    this.uniforms.uPower.value = power;
    this.points.unshift({ t: time, p: pos.clone(), r: right.clone() });
    while (this.points.length > TRAIL_POINTS || (this.points.length && time - this.points[this.points.length - 1].t > TRAIL_LIFE)) {
      this.points.pop();
    }
    const n = this.points.length;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const pt = this.points[Math.min(i, n - 1)];
      const age = Math.min(1, (time - pt.t) / TRAIL_LIFE);
      const w = width * (1 - age * 0.6);
      const o = i * 6;
      this.positions[o] = pt.p.x - pt.r.x * w; this.positions[o + 1] = pt.p.y - pt.r.y * w; this.positions[o + 2] = pt.p.z - pt.r.z * w;
      this.positions[o + 3] = pt.p.x + pt.r.x * w; this.positions[o + 4] = pt.p.y + pt.r.y * w; this.positions[o + 5] = pt.p.z + pt.r.z * w;
      this.ages[i * 2] = this.ages[i * 2 + 1] = i >= n ? 1 : age;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.age.needsUpdate = true;
  }
}

/** Pooled additive sparks for wall scrapes and ship contact. */
export class Sparks {
  constructor(count = 500) {
    this.count = count;
    this.cursor = 0;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.color = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(this.color, 3));
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float life;
        attribute vec3 color;
        varying float vLife;
        varying vec3 vColor;
        void main() {
          vLife = life; vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = life > 0.0 ? (90.0 * (0.4 + life)) / -mv.z : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vLife;
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = 1.0 - smoothstep(0.0, 0.5, d);
          gl_FragColor = vec4(mix(vColor, vec3(1.0), a * a) * a * vLife * 5.0, 1.0);
        }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.points.frustumCulled = false;
  }

  emit(origin, baseVel, normal, count, color) {
    for (let k = 0; k < count; k++) {
      const i = this.cursor = (this.cursor + 1) % this.count;
      const o = i * 3;
      this.pos[o] = origin.x; this.pos[o + 1] = origin.y; this.pos[o + 2] = origin.z;
      const spread = 16;
      this.vel[o] = baseVel.x + normal.x * (8 + Math.random() * 22) + (Math.random() - 0.5) * spread;
      this.vel[o + 1] = baseVel.y + normal.y * (8 + Math.random() * 22) + Math.random() * spread;
      this.vel[o + 2] = baseVel.z + normal.z * (8 + Math.random() * 22) + (Math.random() - 0.5) * spread;
      this.life[i] = 0.5 + Math.random() * 0.5;
      this.color[o] = color.r; this.color[o + 1] = color.g; this.color[o + 2] = color.b;
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      const o = i * 3;
      this.life[i] = Math.max(0, this.life[i] - dt * 1.6);
      this.vel[o + 1] -= 45 * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.life.needsUpdate = true;
  }
}

/** Camera-space speed lines that stretch and brighten with velocity. */
export function createStreaks(count = 110) {
  const position = new Float32Array(count * 6), end = new Float32Array(count * 2), seed = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 16;
    const x = Math.cos(a) * r * 1.5, y = Math.sin(a) * r * 0.8 + 1.5, z = Math.random();
    position.set([x, y, z, x, y, z], i * 6);
    end.set([0, 1], i * 2);
    seed.set([Math.random(), Math.random()], i * 2);
    seed[i * 2 + 1] = seed[i * 2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('end', new THREE.BufferAttribute(end, 1));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { uTime: { value: 0 }, uSpeed: { value: 0 }, uColor: { value: new THREE.Color(0.6, 0.85, 1.0) } };
  const lines = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float end;
      attribute float seed;
      uniform float uTime;
      uniform float uSpeed;
      varying float vAlpha;
      void main() {
        // position.z is a phase; lines fly from far ahead to behind the camera
        float phase = fract(position.z + uTime * (0.9 + seed * 0.8) * (0.4 + uSpeed));
        float z = mix(-140.0, 8.0, phase) + end * (4.0 + uSpeed * 16.0);
        vAlpha = smoothstep(0.0, 0.15, phase) * (1.0 - end * 0.9) * (0.35 + seed * 0.65);
        gl_Position = projectionMatrix * vec4(position.xy, z, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uSpeed;
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float k = smoothstep(0.7, 1.4, uSpeed);
        gl_FragColor = vec4(uColor * vAlpha * k * 0.35, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
  }));
  lines.frustumCulled = false;
  lines.renderOrder = 5;
  return { lines, uniforms };
}
