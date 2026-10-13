import { touch } from './touch.js';

const down = new Set();
const pressed = new Set();

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'ShiftLeft', 'ShiftRight']);

window.addEventListener('keydown', (e) => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (!e.repeat) pressed.add(e.code);
  down.add(e.code);
});
window.addEventListener('keyup', (e) => down.delete(e.code));
window.addEventListener('blur', () => down.clear());

const any = (...codes) => codes.some((c) => down.has(c));
let padPrev = [];

/** True once per key press; also maps gamepad buttons onto the menu keys. */
export function wasPressed(code) {
  return pressed.has(code);
}

/** Queues a one-shot press, as if the key had been tapped (touch UI, gamepad). */
export function press(code) {
  pressed.add(code);
}

export function endFrame() {
  pressed.clear();
}

/** Fills a physics input from keyboard and (if present) the first gamepad. */
export function readInput(out) {
  out.throttle = any('ArrowUp', 'KeyW') ? 1 : 0;
  out.brake = any('ArrowDown', 'KeyS') ? 1 : 0;
  out.steer = (any('ArrowRight', 'KeyD') ? 1 : 0) - (any('ArrowLeft', 'KeyA') ? 1 : 0);
  out.airL = any('KeyQ', 'KeyZ') ? 1 : 0;
  out.airR = any('KeyE', 'KeyC') ? 1 : 0;
  out.turbo = any('Space', 'ShiftLeft', 'ShiftRight');

  if (touch.enabled) {
    // auto-thrust; a hard push on the steering pad pops that side's airbrake
    const hard = Math.max(0, (Math.abs(touch.steer) - 0.82) / 0.18);
    out.throttle = touch.brake ? 0 : 1;
    out.brake = Math.max(out.brake, touch.brake ? 1 : 0);
    out.steer = Math.max(-1, Math.min(1, out.steer + touch.steer));
    out.airL = Math.max(out.airL, touch.steer < 0 ? hard : 0);
    out.airR = Math.max(out.airR, touch.steer > 0 ? hard : 0);
    out.turbo = out.turbo || touch.turbo;
  }

  const pad = navigator.getGamepads?.().find((p) => p && p.connected);
  if (pad) {
    const b = (i) => pad.buttons[i]?.value ?? 0;
    const sx = Math.abs(pad.axes[0]) > 0.12 ? pad.axes[0] : 0;
    out.throttle = Math.max(out.throttle, b(7), b(0));
    out.brake = Math.max(out.brake, b(2));
    out.steer = Math.max(-1, Math.min(1, out.steer + sx + b(15) - b(14)));
    out.airL = Math.max(out.airL, b(4));
    out.airR = Math.max(out.airR, b(5));
    out.turbo = out.turbo || b(1) > 0.5;
    // edge-detect menu buttons: start -> Enter, back -> restart, Y -> camera
    const map = { 9: 'Enter', 8: 'KeyR', 3: 'KeyV' };
    for (const [i, code] of Object.entries(map)) {
      const now = b(+i) > 0.5;
      if (now && !padPrev[i]) pressed.add(code);
      padPrev[i] = now;
    }
  }
  return out;
}
