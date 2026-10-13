import * as THREE from 'three';
import { Track } from './game/track.js';
import { VMAX } from './game/physics.js';

export const TEAMS = [
  { name: 'YOU', paint: 0x0066ff, alt: 0xe8ecf2, glow: 0x19e0ff },
  { name: 'VOLKOV', paint: 0xe0102a, alt: 0x15161a, glow: 0xff5a1f },
  { name: 'AURA', paint: 0xf2f2f5, alt: 0xff2f92, glow: 0xff3fa4 },
  { name: 'KESTREL', paint: 0xffb300, alt: 0x16171c, glow: 0xffd640 },
  { name: 'NYX', paint: 0x5a16d6, alt: 0x0e0f14, glow: 0xb46bff },
  { name: 'ORIX', paint: 0x08a66a, alt: 0xe8ecf2, glow: 0x3dffb0 },
  { name: 'HALCYON', paint: 0x10c8d8, alt: 0xff7a1a, glow: 0x7af6ff },
  { name: 'TAU', paint: 0x23262e, alt: 0xd4ff3a, glow: 0xd4ff3a },
];

const flameVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const flameFragment = /* glsl */ `
uniform float uTime;
uniform float uPower;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float along = vUv.y;                       // 0 at the nozzle, 1 at the tip
  float flicker = 0.85 + 0.15 * sin(uTime * 60.0 + along * 24.0) * sin(uTime * 37.0);
  float shock = 0.75 + 0.25 * sin(along * 30.0 - uTime * 40.0);
  float falloff = clamp(1.0 - along, 0.0, 1.0);
  float body = pow(falloff, 1.6) * flicker * shock;
  vec3 col = mix(uColor, vec3(1.0), pow(falloff, 5.0)) * body * (0.45 + uPower * 0.9);
  gl_FragColor = vec4(col, 1.0);
}`;

const frame = Track.makeFrame();
const fwd = new THREE.Vector3(), left = new THREE.Vector3(), basis = new THREE.Matrix4();

export class ShipView {
  constructor(state, template, team) {
    this.state = state;
    this.team = team;
    this.group = new THREE.Group();
    this.model = template.clone(true);
    this.group.add(this.model);
    this.glowColor = new THREE.Color(team.glow);
    this.position = this.group.position;
    this.forward = new THREE.Vector3(0, 0, 1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.bob = Math.random() * 10;

    const cache = new Map();
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const name = o.material.name;
      if (!cache.has(name)) {
        const m = o.material.clone();
        if (name === 'Paint') m.color.set(team.paint);
        if (name === 'PaintAlt') m.color.set(team.alt);
        if (name === 'Glow') { m.emissive.set(team.glow); m.emissiveIntensity = 2.2; }
        if (name === 'Thruster') { m.emissive.set(0xffc890); this.thruster = m; }
        if (name === 'Paint' || name === 'PaintAlt') { m.metalness = 0.3; m.roughness = 0.3; }
        m.envMapIntensity = 0.85;
        cache.set(name, m);
      }
      o.material = cache.get(name);
    });
    this.flapL = this.model.getObjectByName('airbrake_L');
    this.flapR = this.model.getObjectByName('airbrake_R');

    // exhaust plumes
    this.flameUniforms = { uTime: { value: 0 }, uPower: { value: 0 }, uColor: { value: this.glowColor } };
    const flameMat = new THREE.ShaderMaterial({
      uniforms: this.flameUniforms, vertexShader: flameVertex, fragmentShader: flameFragment,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    const cone = new THREE.ConeGeometry(0.2, 1, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    this.flames = [];
    this.engines = [];
    for (const name of ['engine_L', 'engine_R', 'engine_C']) {
      const anchor = this.model.getObjectByName(name);
      const flame = new THREE.Mesh(cone, flameMat);
      if (name === 'engine_C') flame.scale.set(0.6, 0.6, 1);
      anchor.add(flame);
      this.flames.push(flame);
      if (name !== 'engine_C') this.engines.push(anchor);
    }
  }

  /** Places the model from track-space state. */
  update(dt, track, time) {
    const st = this.state;
    const f = track.frameAt(st.s, frame);
    this.bob += dt;
    const hover = st.h + Math.sin(this.bob * 2.3) * 0.05;
    this.up.copy(f.up);
    fwd.copy(f.tan).multiplyScalar(Math.cos(st.theta)).addScaledVector(f.right, Math.sin(st.theta));
    this.forward.copy(fwd);
    this.right.crossVectors(fwd, f.up);
    left.copy(this.right).negate();
    basis.makeBasis(left, f.up, fwd);
    this.group.quaternion.setFromRotationMatrix(basis);
    this.group.position.copy(f.pos).addScaledVector(f.right, st.x).addScaledVector(f.up, hover);

    // lean into turns, nose follows the hover spring
    const lean = st.steer * 0.42 + st.air * 0.22 + (st.theta - st.phi) * 0.8;
    const pitch = -Math.atan2(st.hv, Math.max(st.v, 40)) * 1.5;
    this.model.rotation.set(pitch, 0, THREE.MathUtils.clamp(lean, -0.8, 0.8), 'ZXY');

    const inp = st.input;
    if (this.flapL) this.flapL.rotation.x += (inp.airL * 0.95 - this.flapL.rotation.x) * Math.min(1, dt * 14);
    if (this.flapR) this.flapR.rotation.x += (inp.airR * 0.95 - this.flapR.rotation.x) * Math.min(1, dt * 14);

    const boosting = st.boost > 0 || st.turboOn;
    const power = THREE.MathUtils.clamp(inp.throttle * 0.55 + st.v / VMAX * 0.3 + (boosting ? 0.6 : 0), 0, 1.4);
    this.flameUniforms.uTime.value = time + st.index * 3.1;
    this.flameUniforms.uPower.value += (power - this.flameUniforms.uPower.value) * Math.min(1, dt * 8);
    const len = 0.6 + this.flameUniforms.uPower.value * 2.8;
    for (const flame of this.flames) flame.scale.z = len;
    if (this.thruster) this.thruster.emissiveIntensity = 0.35 + this.flameUniforms.uPower.value * 2.6;
  }
}
