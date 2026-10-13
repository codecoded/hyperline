// On-screen controls for phones and tablets. Thrust is automatic; the left
// thumb drags to steer (pushing far engages that side's airbrake) and the
// right thumb has turbo and brake.
export const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');

export const touch = { enabled: IS_TOUCH, steer: 0, brake: false, turbo: false };

const STEER_RANGE = 64; // px of drag for full lock

// capture keeps a drag alive when the thumb slides off the element; it is an
// enhancement only, so never let a failure swallow the press itself
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* pointer already gone */ } };

export function initTouch(press) {
  if (!IS_TOUCH) return;
  document.body.classList.add('touch');
  const root = document.getElementById('touch');

  // ---- steering pad: anywhere on the left half ----
  const pad = root.querySelector('.steer-zone');
  const ring = root.querySelector('.steer-ring');
  const knob = root.querySelector('.steer-knob');
  let steerId = null, originX = 0;
  const moveKnob = (dx) => { knob.style.transform = `translate(${dx}px, 0)`; };
  pad.addEventListener('pointerdown', (e) => {
    if (steerId !== null) return;
    steerId = e.pointerId;
    originX = e.clientX;
    capture(pad, e.pointerId);
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    ring.classList.add('on');
    moveKnob(0);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== steerId) return;
    const dx = Math.max(-STEER_RANGE, Math.min(STEER_RANGE, e.clientX - originX));
    // let the origin trail the thumb so reversing direction is immediate
    originX = e.clientX - dx;
    touch.steer = dx / STEER_RANGE;
    moveKnob(dx);
    ring.classList.toggle('hard', Math.abs(touch.steer) > 0.82);
  });
  const release = (e) => {
    if (e.pointerId !== steerId) return;
    steerId = null;
    touch.steer = 0;
    ring.classList.remove('on', 'hard');
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);

  // ---- hold buttons ----
  for (const [selector, key] of [['.btn-turbo', 'turbo'], ['.btn-brake', 'brake']]) {
    const btn = root.querySelector(selector);
    const set = (on) => (e) => {
      if (on) capture(btn, e.pointerId);
      touch[key] = on;
      btn.classList.toggle('on', on);
    };
    btn.addEventListener('pointerdown', set(true));
    btn.addEventListener('pointerup', set(false));
    btn.addEventListener('pointercancel', set(false));
  }

  // ---- tap buttons ----
  for (const btn of root.querySelectorAll('[data-key]')) {
    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); press(btn.dataset.key); });
  }

  // a tap anywhere else starts / restarts the race
  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.btn')) return;
    press('Enter');
    // best effort: Android can go fullscreen + landscape, iPhone Safari cannot
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
        ?.then(() => screen.orientation?.lock?.('landscape'))
        .catch(() => {});
    }
  });

  // stop the page itself reacting to game gestures
  for (const type of ['contextmenu', 'gesturestart', 'dblclick']) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
}
