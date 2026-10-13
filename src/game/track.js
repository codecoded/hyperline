import * as THREE from 'three';

export const HALF_WIDTH = 15;
export const GROUND_Y = -70;

// [x, y, z] control points of the closed circuit. Travel direction is the
// listed order; +Z is to the right of +X, so the lap runs clockwise from above.
const CONTROL_POINTS = [
  [-120, 0, 0],
  [260, 0, 0],
  [640, 6, 30],
  [900, 34, 230],
  [960, 66, 520],
  [800, 78, 760],
  [540, 52, 800],
  [360, 26, 640],
  [150, 22, 720],
  [-40, 48, 940],
  [-360, 84, 1010],
  [-650, 70, 820],
  [-700, 36, 540],
  [-570, 14, 350],
  [-650, 4, 140],
  [-480, 0, 0],
];

const SCALE_XZ = 1.6, SCALE_Y = 1.25;

// [fraction of lap, lateral offset]
const BOOST_PADS = [
  [0.035, 0], [0.105, -6], [0.215, 7], [0.3, -5], [0.385, 0], [0.47, 6],
  [0.56, -7], [0.655, 4], [0.74, -4], [0.83, 6], [0.93, 0],
];

const wrapIndex = (i, n) => ((i % n) + n) % n;

function blur(values, radius, passes) {
  const n = values.length;
  let src = values;
  for (let p = 0; p < passes; p++) {
    const dst = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = -radius; j <= radius; j++) sum += src[wrapIndex(i + j, n)];
      dst[i] = sum / (radius * 2 + 1);
    }
    src = dst;
  }
  return src;
}

export class Track {
  constructor() {
    const curve = new THREE.CatmullRomCurve3(
      CONTROL_POINTS.map(([x, y, z]) => new THREE.Vector3(x * SCALE_XZ, y * SCALE_Y, z * SCALE_XZ)), true, 'centripetal');
    curve.arcLengthDivisions = 6000;
    this.length = curve.getLength();
    const n = this.count = Math.round(this.length / 2.5);
    this.step = this.length / n;

    this.pos = []; this.tan = []; this.up = []; this.right = [];
    const worldUp = new THREE.Vector3(0, 1, 0);
    const flatUp = [], flatRight = [];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      this.pos.push(curve.getPointAt(t));
      const tan = curve.getTangentAt(t).normalize();
      this.tan.push(tan);
      const up = worldUp.clone().addScaledVector(tan, -worldUp.dot(tan)).normalize();
      flatUp.push(up);
      flatRight.push(new THREE.Vector3().crossVectors(tan, up));
    }

    // bank into corners in proportion to (heavily smoothed) lateral curvature
    const dTan = (i) => this.tan[wrapIndex(i + 1, n)].clone().sub(this.tan[wrapIndex(i - 1, n)])
      .multiplyScalar(1 / (2 * this.step));
    let flatK = new Float32Array(n);
    for (let i = 0; i < n; i++) flatK[i] = dTan(i).dot(flatRight[i]);
    flatK = blur(flatK, 14, 3);
    this.bank = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const bank = this.bank[i] = THREE.MathUtils.clamp(flatK[i] * 62, -0.6, 0.6);
      const up = flatUp[i].clone().multiplyScalar(Math.cos(bank)).addScaledVector(flatRight[i], Math.sin(bank));
      this.up.push(up);
      this.right.push(new THREE.Vector3().crossVectors(this.tan[i], up).normalize());
    }

    let kLat = new Float32Array(n), kVert = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = dTan(i);
      kLat[i] = d.dot(this.right[i]);
      kVert[i] = d.dot(this.up[i]);
    }
    this.kLat = blur(kLat, 3, 2);
    this.kVert = blur(kVert, 3, 2);

    this.pads = BOOST_PADS.map(([f, x]) => ({ s: f * this.length, x }));
  }

  wrap(s) {
    return ((s % this.length) + this.length) % this.length;
  }

  /** Signed shortest distance along the track from a to b. */
  delta(a, b) {
    let d = (b - a) % this.length;
    if (d > this.length / 2) d -= this.length;
    if (d < -this.length / 2) d += this.length;
    return d;
  }

  /** Interpolated frame at arc length s. `out` needs pos/tan/up/right vectors. */
  frameAt(s, out) {
    const f = this.wrap(s) / this.step;
    const i = Math.floor(f) % this.count, j = (i + 1) % this.count, t = f - Math.floor(f);
    out.pos.lerpVectors(this.pos[i], this.pos[j], t);
    out.tan.lerpVectors(this.tan[i], this.tan[j], t).normalize();
    out.up.lerpVectors(this.up[i], this.up[j], t);
    out.up.addScaledVector(out.tan, -out.up.dot(out.tan)).normalize();
    out.right.crossVectors(out.tan, out.up);
    out.kLat = this.kLat[i] + (this.kLat[j] - this.kLat[i]) * t;
    out.kVert = this.kVert[i] + (this.kVert[j] - this.kVert[i]) * t;
    return out;
  }

  curvatureAt(s) {
    return this.kLat[Math.floor(this.wrap(s) / this.step) % this.count];
  }

  static makeFrame() {
    return {
      pos: new THREE.Vector3(), tan: new THREE.Vector3(), up: new THREE.Vector3(),
      right: new THREE.Vector3(), kLat: 0, kVert: 0,
    };
  }
}
