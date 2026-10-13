import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/rajdhani/500.css';
import '@fontsource/rajdhani/600.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Track, HALF_WIDTH } from './game/track.js';
import { ShipState, driveAI, resolveCollisions, VMAX, HOVER } from './game/physics.js';
import { SUN_DIR } from './shaders/common.js';
import { createSky, createGround, createEnvironment } from './world/sky.js';
import { createTrackMeshes, MAX_SHIPS } from './world/trackMesh.js';
import { createTowers, createPylons, createGates } from './world/scenery.js';
import { ShipView, TEAMS } from './shipView.js';
import { Trail, Sparks, createStreaks } from './fx/particles.js';
import { createPost } from './fx/post.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { readInput, wasPressed, endFrame, press } from './input.js';
import { IS_TOUCH, initTouch } from './touch.js';

const LAPS = 3;
const FIXED_DT = 1 / 120;
const AUTOPILOT = new URLSearchParams(location.search).has('auto'); // demo mode: AI flies the player ship
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

async function boot() {
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, powerPreference: 'high-performance',
    preserveDrawingBuffer: AUTOPILOT, // lets demo-mode frames be captured
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 1.75)); // phones: fewer pixels to fill
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x2a0f33, 0.0004); // only affects the lit (GLB) materials
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.3, 16000);
  scene.add(camera);

  const loader = new GLTFLoader();
  const [shipGltf, gateGltf, towerGltf] = await Promise.all([
    loader.loadAsync(`${import.meta.env.BASE_URL}models/ship.glb`),
    loader.loadAsync(`${import.meta.env.BASE_URL}models/gates.glb`),
    loader.loadAsync(`${import.meta.env.BASE_URL}models/towers.glb`),
    document.fonts.load('italic 900 92px Orbitron'),
  ]);

  // ---- world ----
  const track = new Track();
  const sky = createSky();
  const ground = createGround();
  const trackMeshes = createTrackMeshes(track);
  const towers = createTowers(track, towerGltf.scene);
  const gates = createGates(track, gateGltf.scene);
  scene.add(sky.mesh, ground.mesh, trackMeshes.group, towers.group, createPylons(track), gates.group);
  scene.environment = createEnvironment(renderer);
  const sun = new THREE.DirectionalLight(0xffa878, 1.5);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sun, new THREE.HemisphereLight(0x8a90ff, 0x1a0818, 0.7));

  // ---- ships ----
  const states = [], views = [], trails = [];
  for (let i = 0; i < MAX_SHIPS; i++) {
    const state = new ShipState(i, i === 0);
    const view = new ShipView(state, shipGltf.scene, TEAMS[i]);
    states.push(state); views.push(view);
    scene.add(view.group);
    const pair = [new Trail(view.glowColor), new Trail(view.glowColor)];
    pair.forEach((t) => scene.add(t.mesh));
    trails.push(pair);
  }
  const player = states[0], playerView = views[0];

  const sparks = new Sparks();
  const streaks = createStreaks();
  scene.add(sparks.points, streaks.lines);
  const post = createPost(renderer, scene, camera, { lowPower: IS_TOUCH });
  post.setSize(window.innerWidth, window.innerHeight);
  const hud = new Hud(track, TEAMS);
  const audio = new GameAudio();
  // browsers (iOS especially) only unlock audio inside the gesture handler itself
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => audio.start());
  initTouch(press);

  // ---- game state ----
  const game = {
    mode: 'title', // title | countdown | race | finished
    paused: false,
    raceTime: 0, countdown: 0, lastBeep: 0, bestLap: null,
    finishedAt: 0, resultsShown: false, resultsRefresh: 0,
    camMode: 0, shake: 0, hitFlash: 0, wrongWay: false,
  };
  const cam = { dist: 10, x: 0, theta: 0, fov: 72, orbit: 0 };

  function gridStart() {
    states.forEach((st, i) => {
      // player starts at the back of a 2-wide grid
      const slot = st.isPlayer ? MAX_SHIPS - 1 : i - 1;
      st.reset(track.length - 16 - slot * 11, slot % 2 ? 5 : -5);
      st.baseSkill = st.isPlayer ? 1 : 0.945 - (i - 1) * 0.016;
      st.skill = st.baseSkill;
      st.lane = st.isPlayer ? 0 : ((i * 37) % 13) - 6;
      st.place = slot + 1;
    });
    trails.flat().forEach((t) => t.clear());
    game.raceTime = 0;
    game.resultsShown = false;
    cam.x = player.x; cam.theta = 0;
  }

  function startRace() {
    gridStart();
    game.mode = 'countdown';
    game.countdown = 3.6;
    game.lastBeep = 4;
    hud.show('title', false); hud.show('results', false); hud.show('hud', true);
    hud.clearHeld();
    audio.start();
    audio.setMusic(true);
  }

  function showTitle() {
    gridStart();
    game.mode = 'title';
    hud.show('hud', false); hud.show('results', false); hud.show('title', true);
  }

  function results() {
    const rows = states.map((st, i) => ({
      isPlayer: st.isPlayer, team: TEAMS[i], time: st.finishTime,
      best: st.lapTimes.length ? Math.min(...st.lapTimes) : null, progress: st.progress(track),
    }));
    rows.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || b.progress - a.progress);
    return rows;
  }

  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();
  const sparkColor = new THREE.Color(1.0, 0.55, 0.15);

  function onShipEvents(st, view) {
    if (st.hit > 0) {
      tmp.copy(view.position).addScaledVector(view.right, st.hitSide * 2.2);
      tmp2.copy(view.forward).multiplyScalar(st.v * 0.7);
      tmp3.copy(view.right).multiplyScalar(-st.hitSide);
      sparks.emit(tmp, tmp2, tmp3, Math.min(36, 5 + st.hit * 1.3), sparkColor);
      if (st.isPlayer) {
        game.shake = Math.min(1.2, game.shake + 0.25 + st.hit * 0.03);
        game.hitFlash = Math.min(1, game.hitFlash + 0.25 + st.hit * 0.03);
        audio.hit(st.hit);
      }
    }
    if (st.bumped) {
      st.bumped = false;
      sparks.emit(view.position, tmp2.copy(view.forward).multiplyScalar(st.v * 0.8), view.up, 4, view.glowColor);
      if (st.isPlayer) { game.shake = Math.min(1, game.shake + 0.15); audio.hit(4); }
    }
    if (st.isPlayer && st.padHit) { audio.boost(); game.shake = Math.min(1, game.shake + 0.3); }
    if (st.lapped && game.mode !== 'title') {
      if (st.lap > LAPS && st.finishTime == null) st.finishTime = game.raceTime;
      if (!st.isPlayer || st.lap < 2) return;
      const last = st.lapTimes[st.lapTimes.length - 1];
      const record = game.bestLap == null || last < game.bestLap;
      if (record) game.bestLap = last;
      if (st.lap > LAPS) {
        game.mode = 'finished';
        game.finishedAt = game.raceTime;
        hud.message('FINISH');
      } else {
        hud.message(st.lap === LAPS ? 'FINAL LAP' : record ? 'LAP RECORD' : `LAP ${st.lap}`, { small: true });
      }
      audio.lap();
    }
  }

  function simulate(dt) {
    if (game.mode === 'countdown') {
      game.countdown -= dt;
      const n = Math.ceil(game.countdown);
      if (n !== game.lastBeep && n <= 3) {
        game.lastBeep = n;
        if (n > 0) { hud.message(String(n)); audio.beep(false); } else { hud.message('GO!'); audio.beep(true); game.mode = 'race'; }
      }
      readInput(player.input); // lets the engine rev on the line
      return;
    }
    game.raceTime += dt;

    for (const st of states) {
      const ai = !st.isPlayer || AUTOPILOT || game.mode !== 'race';
      if (ai) {
        driveAI(st, track, states);
        if (!st.isPlayer) {
          // light rubber-banding keeps the pack within reach of the player
          const gap = player.progress(track) - st.progress(track);
          st.skill = st.baseSkill + THREE.MathUtils.clamp(gap / 900, -0.035, 0.05);
        }
        if (st.finishTime != null) st.input.throttle *= 0.75;
      } else {
        readInput(st.input);
      }
      st.step(dt, track, game.raceTime);
    }
    resolveCollisions(states, track);
    states.forEach((st, i) => onShipEvents(st, views[i]));

    const order = [...states].sort((a, b) => b.progress(track) - a.progress(track));
    order.forEach((st, i) => { st.place = i + 1; });
  }

  // ---- cameras ----
  const camFrame = Track.makeFrame(), aheadFrame = Track.makeFrame();
  const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();

  function updateCamera(dt) {
    let fovTarget = 62;
    if (game.mode === 'title') {
      // slow orbit around the leader
      const lead = views[[...states].sort((a, b) => a.place - b.place)[0].index];
      cam.orbit += dt * 0.22;
      camPos.copy(lead.position)
        .addScaledVector(lead.forward, Math.cos(cam.orbit) * 13)
        .addScaledVector(lead.right, Math.sin(cam.orbit) * 13)
        .addScaledVector(lead.up, 3.6 + Math.sin(cam.orbit * 0.7) * 1.6);
      camTarget.copy(lead.position).addScaledVector(lead.forward, 2);
      camera.up.copy(lead.up);
    } else {
      const st = player, speedN = st.v / VMAX, boosting = st.boost > 0 || st.turboOn;
      fovTarget = 62 + 15 * Math.min(speedN, 1.3) + (boosting ? 9 : 0);
      cam.dist = damp(cam.dist, 6.8 + speedN * 1.6 + (boosting ? 1.8 : 0), 3, dt);
      cam.x = damp(cam.x, st.x, 8, dt);
      cam.theta = damp(cam.theta, st.theta, 5, dt);
      if (game.camMode === 1) {
        camPos.copy(playerView.position).addScaledVector(playerView.up, 0.8).addScaledVector(playerView.forward, 0.4);
        camTarget.copy(camPos).addScaledVector(playerView.forward, 30);
        camera.up.copy(playerView.up).addScaledVector(playerView.right, -st.steer * 0.12).normalize();
        fovTarget += 8;
      } else {
        // sit on the track behind the ship so the camera follows the ribbon, not a straight line
        const f = track.frameAt(st.s - cam.dist, camFrame);
        const lateral = THREE.MathUtils.clamp(cam.x - Math.sin(cam.theta) * cam.dist * 0.55, -(HALF_WIDTH - 1.5), HALF_WIDTH - 1.5);
        camPos.copy(f.pos).addScaledVector(f.right, lateral).addScaledVector(f.up, 2.9 + (st.h - HOVER) * 0.6);
        const a = track.frameAt(st.s + 14, aheadFrame);
        camTarget.copy(a.pos).addScaledVector(a.right, cam.x * 0.9 + Math.sin(cam.theta) * 7).addScaledVector(a.up, 1.3);
        camera.up.copy(f.up).add(a.up).normalize();
      }
    }
    if (game.shake > 0.001) {
      camPos.x += (Math.random() - 0.5) * game.shake * 0.5;
      camPos.y += (Math.random() - 0.5) * game.shake * 0.5;
      camPos.z += (Math.random() - 0.5) * game.shake * 0.5;
    }
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    cam.fov = damp(cam.fov, fovTarget, 4, dt);
    if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  }

  // ---- frame ----
  const lens = { speed: 0, boost: 0 };
  let last = performance.now(), acc = 0, time = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
  }

  function update(dt, draw = true) {

    if (wasPressed('Enter') && (game.mode === 'title' || game.resultsShown)) startRace();
    if (wasPressed('KeyR') && game.mode !== 'title') startRace();
    if (wasPressed('KeyV')) game.camMode = (game.camMode + 1) % 2;
    if (wasPressed('KeyM')) audio.toggleMute();
    if ((wasPressed('KeyP') || wasPressed('Escape')) && game.mode === 'race') {
      game.paused = !game.paused;
      hud.show('paused', game.paused);
    }
    endFrame();

    if (!game.paused) {
      time += dt;
      acc += dt;
      while (acc >= FIXED_DT) { simulate(FIXED_DT); acc -= FIXED_DT; }
    }
    const fdt = game.paused ? 0 : dt;

    // ships, trails, particles
    playerView.model.visible = !(game.camMode === 1 && game.mode !== 'title');
    views.forEach((view, i) => {
      view.update(fdt, track, time);
      view.group.updateMatrixWorld(true);
      const st = view.state;
      const power = THREE.MathUtils.clamp(st.v / VMAX * 0.55 + (st.boost > 0 || st.turboOn ? 0.6 : 0), 0, 1.3);
      view.engines.forEach((anchor, k) => {
        anchor.getWorldPosition(tmp);
        if (!game.paused) trails[i][k].update(time, tmp, view.right, 0.2, power);
      });
      trackMeshes.uniforms.uShipPos.value[i].copy(view.position).addScaledVector(view.up, -st.h);
      trackMeshes.uniforms.uShipCol.value[i].copy(view.glowColor).multiplyScalar(0.5 + power);
    });
    sparks.update(fdt);
    updateCamera(fdt);
    game.shake *= Math.exp(-fdt * 6);
    game.hitFlash *= Math.exp(-fdt * 5);

    // shader clocks
    const racing = game.mode !== 'title';
    const boosting = racing && (player.boost > 0 || player.turboOn);
    lens.speed = damp(lens.speed, racing ? player.v / VMAX : 0.35, 4, dt);
    lens.boost = damp(lens.boost, boosting ? 1 : 0, boosting ? 10 : 3, dt);
    for (const u of [sky.uniforms, ground.uniforms, trackMeshes.uniforms, towers.uniforms, gates.banner.uniforms, streaks.uniforms, post.uniforms]) {
      u.uTime.value = time;
    }
    sky.mesh.position.copy(camera.position);
    streaks.uniforms.uSpeed.value = lens.speed + lens.boost * 0.4;
    post.uniforms.uSpeed.value = lens.speed;
    post.uniforms.uBoost.value = lens.boost;
    post.uniforms.uHit.value = game.hitFlash;
    post.bloom.strength = 0.6 + lens.boost * 0.2;

    document.body.classList.toggle('racing', racing && !game.resultsShown); // gates the touch controls

    // HUD + audio
    if (racing) {
      hud.update(player, views, game.mode === 'finished' ? game.finishedAt : game.raceTime, LAPS, game.bestLap);
      const wrongWay = game.mode === 'race' && Math.cos(player.theta) < -0.3 && player.v > 8;
      if (wrongWay && !game.wrongWay) hud.message('WRONG WAY', { small: true, hold: true });
      if (!wrongWay && game.wrongWay) hud.clearHeld();
      game.wrongWay = wrongWay;
      if (game.mode === 'finished' && game.raceTime - game.finishedAt > 2.2 && time > game.resultsRefresh) {
        game.resultsShown = true;
        game.resultsRefresh = time + 1;
        hud.showResults(results(), results().findIndex((r) => r.isPlayer) + 1);
      }
    }
    const revving = game.mode === 'countdown' ? player.input.throttle * 0.35 : 0;
    audio.setEngine(Math.max(player.v / VMAX, revving), player.input.throttle, boosting, racing && !game.paused);
    audio.update();

    if (draw) post.render(dt);
  }

  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  hud.show('loading', false);
  window.__hyperline = {
    game, states, track, startRace, camera, renderer, post, scene,
    /** Fast-forwards the whole game loop; handy for demos and tests. */
    advance(seconds) {
      for (let t = 0; t < seconds; t += 1 / 60) update(1 / 60, false);
      update(1 / 60);
    },
  };
  if (AUTOPILOT) startRace(); else showTitle();
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('loading').innerHTML = `<div class="press">FAILED TO LOAD — ${err.message}</div>`;
});
