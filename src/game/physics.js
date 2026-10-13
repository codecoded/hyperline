import { HALF_WIDTH, Track } from './track.js';

export const VMAX = 190;          // units/s at full throttle, no boost
export const BOOST_FACTOR = 1.32;
export const HOVER = 0.95;
const ACCEL = 78;
const BRAKE = 110;
const TURN = 1.3;                 // rad/s
const AIR_TURN = 0.95;
const GRIP = 4.6;
const GRAVITY = 75;
const SHIP_HALF_WIDTH = 2.2;
const SHIP_HALF_LENGTH = 2.8;
const WALL = HALF_WIDTH - SHIP_HALF_WIDTH;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const frame = Track.makeFrame();

export const makeInput = () => ({ throttle: 0, brake: 0, steer: 0, airL: 0, airR: 0, turbo: false });

/**
 * Ships live in track space: `s` along the centreline, `x` lateral offset,
 * `h` hover height. `theta` is the nose direction and `phi` the velocity
 * direction, both relative to the track tangent, so the gap between them is
 * the drift angle.
 */
export class ShipState {
  constructor(index, isPlayer) {
    this.index = index;
    this.isPlayer = isPlayer;
    this.input = makeInput();
    this.skill = 1;
    this.lane = 0;
    this.reset(0, 0);
  }

  reset(s, x) {
    this.s = s; this.x = x; this.h = HOVER; this.hv = 0;
    this.v = 0; this.theta = 0; this.phi = 0;
    this.steer = 0; this.air = 0;
    this.lap = 0; this.lapStart = 0; this.lapTimes = []; this.finishTime = null;
    this.energy = 100; this.boost = 0; this.turboOn = false;
    this.hit = 0; this.hitSide = 0; this.padHit = false; this.lapped = false;
    this.place = this.index + 1;
  }

  /** Race distance covered; comparable between ships for positions. */
  progress(track) {
    return (this.lap - 1) * track.length + this.s;
  }

  step(dt, track, time) {
    const inp = this.input;
    const f = track.frameAt(this.s, frame);
    this.hit = 0; this.padHit = false; this.lapped = false;

    const speedN = this.v / VMAX;
    const airBrake = Math.max(inp.airL, inp.airR);
    this.steer += (inp.steer - this.steer) * (1 - Math.exp(-9 * dt));
    this.air += ((inp.airR - inp.airL) - this.air) * (1 - Math.exp(-10 * dt));

    // the track frame rotates under the ship: rails don't steer for you
    const sdot = this.v * Math.cos(this.phi) / clamp(1 - f.kLat * this.x, 0.6, 1.6);
    const frameTurn = f.kLat * sdot * dt;
    const authority = clamp(this.v / 25, 0, 1);
    this.theta += (this.steer * TURN * (1 - 0.22 * speedN) + this.air * AIR_TURN) * authority * dt - frameTurn;
    this.phi -= frameTurn;

    const grip = GRIP * (1 - 0.45 * airBrake);
    const slip = this.theta - this.phi;
    this.phi += slip * (1 - Math.exp(-grip * dt));

    // thrust / drag
    this.turboOn = inp.turbo && this.energy > 5 && this.v > 20;
    if (this.turboOn) this.energy -= 14 * dt;
    else this.energy = Math.min(100, this.energy + 1.5 * dt);
    const boosting = this.boost > 0 || this.turboOn;
    this.boost = Math.max(0, this.boost - dt);
    const limp = this.energy <= 5 ? 0.88 : 1;
    const vmax = VMAX * this.skill * limp * (boosting ? BOOST_FACTOR : 1);
    let accel = inp.throttle * ACCEL * Math.cos(slip);
    if (boosting) accel += 130 * Math.max(0, 1 - this.v / vmax);
    accel -= ACCEL * (this.v / vmax) ** 2;
    accel -= inp.brake * BRAKE + (inp.airL + inp.airR) * 16 + Math.abs(Math.sin(slip)) * this.v * 0.55;
    accel -= GRAVITY * 0.45 * f.tan.y;
    this.v = Math.max(0, this.v + accel * dt);

    // integrate
    const prevS = this.s;
    this.s += sdot * dt;
    this.x += this.v * Math.sin(this.phi) * dt;

    // walls
    if (Math.abs(this.x) > WALL) {
      const side = Math.sign(this.x);
      this.x = side * WALL;
      const vn = this.v * Math.sin(this.phi) * side;
      if (vn > 0) {
        this.hit = vn;
        this.hitSide = side;
        this.phi = -this.phi * 0.3;
        this.theta = this.theta * 0.55 - side * 0.03;
        this.v *= 1 - clamp(0.012 + vn / 260, 0, 0.45);
        this.energy = Math.max(0, this.energy - vn * 0.22);
      }
    }

    // hover spring; the field only pushes, so crests can throw the ship clear
    const spring = this.h < HOVER ? 150 * (HOVER - this.h) : -Math.min(150 * (this.h - HOVER), GRAVITY);
    this.hv += (spring - 13 * this.hv - this.v * sdot * f.kVert) * dt;
    this.h += this.hv * dt;
    if (this.h < 0.3) { this.h = 0.3; this.hv = Math.max(0, this.hv); }

    // boost pads
    if (this.h < 2.2) {
      for (const pad of track.pads) {
        if (Math.abs(track.delta(pad.s, this.s)) < 7 && Math.abs(this.x - pad.x) < 4.4) {
          if (this.boost < 1.2) this.padHit = true;
          this.boost = 1.7;
        }
      }
    }

    // laps
    if (this.s >= track.length) {
      this.s -= track.length;
      this.lap++;
      if (this.lap > 1) {
        this.lapTimes.push(time - this.lapStart);
        this.energy = Math.min(100, this.energy + 30);
      }
      this.lapStart = time;
      this.lapped = true;
    } else if (this.s < 0) {
      this.s += track.length;
      this.lap--;
    }
    return prevS;
  }
}

/** Side-swipes and nudges between ships, resolved in track space. */
export function resolveCollisions(ships, track) {
  for (let i = 0; i < ships.length; i++) {
    for (let j = i + 1; j < ships.length; j++) {
      const a = ships[i], b = ships[j];
      const ds = track.delta(a.s, b.s), dx = b.x - a.x;
      const overlapS = SHIP_HALF_LENGTH * 2 - Math.abs(ds), overlapX = SHIP_HALF_WIDTH * 2 - Math.abs(dx);
      if (overlapS <= 0 || overlapX <= 0 || Math.abs(a.h - b.h) > 1.6) continue;
      if (overlapX < overlapS) {
        const push = overlapX * 0.5 * (dx >= 0 ? 1 : -1);
        a.x -= push; b.x += push;
        const bump = 0.04 * (dx >= 0 ? 1 : -1);
        a.phi -= bump; b.phi += bump;
      } else {
        // rear ship loses a little speed to the one in front
        const [rear, front] = ds > 0 ? [a, b] : [b, a];
        const dv = Math.max(0, rear.v - front.v);
        rear.v -= dv * 0.6 + 1; front.v += dv * 0.35;
        rear.s = track.wrap(rear.s - overlapS * 0.5);
      }
      a.bumped = b.bumped = true;
    }
  }
}

/** Racing-line driver; used for rivals, the attract mode and the cooldown lap. */
export function driveAI(ship, track, ships) {
  const inp = ship.input;
  const look = 26 + ship.v * 0.42;
  const kHere = track.curvatureAt(ship.s);
  const kAhead = track.curvatureAt(ship.s + look);

  // hug the inside of whatever is coming, plus this driver's preferred lane
  let targetX = clamp(kAhead * 700, -1, 1) * (WALL - 5) + ship.lane * (1 - Math.min(1, Math.abs(kAhead) * 400));
  // steer around slower traffic directly ahead
  for (const other of ships) {
    if (other === ship) continue;
    const ds = track.delta(ship.s, other.s);
    if (ds > 0 && ds < 14 + ship.v * 0.25 && Math.abs(other.x - ship.x) < 5.5 && other.v < ship.v + 4) {
      targetX += (ship.x >= other.x ? 1 : -1) * 7;
    }
  }
  targetX = clamp(targetX, -(WALL - 1.5), WALL - 1.5);

  const thetaTarget = clamp(Math.atan2(targetX - ship.x, look * 0.7), -0.45, 0.45);
  const wantRate = kHere * ship.v + 3.2 * (thetaTarget - ship.theta);
  const capacity = TURN * (1 - 0.22 * ship.v / VMAX);
  inp.steer = clamp(wantRate / capacity, -1, 1);
  const excess = clamp((Math.abs(wantRate) / capacity - 0.95) * 2.5, 0, 1);
  inp.airR = wantRate > 0 ? excess : 0;
  inp.airL = wantRate < 0 ? excess : 0;

  // slow for the tightest corner inside the braking distance
  let kMax = Math.abs(kHere);
  for (let d = 20; d <= 60 + ship.v * 0.9; d += 20) kMax = Math.max(kMax, Math.abs(track.curvatureAt(ship.s + d)));
  const vSafe = (capacity + AIR_TURN * 0.3) / Math.max(kMax, 1e-4);
  inp.throttle = ship.v < vSafe ? 1 : 0;
  inp.brake = ship.v > vSafe * 1.12 ? 0.7 : 0;
  inp.turbo = false;
}
