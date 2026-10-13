import { VMAX } from './game/physics.js';

const $ = (id) => document.getElementById(id);

export const formatTime = (t) => {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

export class Hud {
  constructor(track, teams) {
    this.el = {
      hud: $('hud'), pos: $('pos'), posTotal: $('pos-total'), lap: $('lap'), time: $('time'), best: $('best'), last: $('last'),
      energy: $('energy'), speed: $('speed'), thrust: $('thrust'), boost: $('boost-flag'), message: $('message'),
      title: $('title'), results: $('results'), resultsTitle: $('results-title'), table: $('results-table'),
      paused: $('paused'), loading: $('loading'),
    };
    this.teams = teams;
    this.cache = {};
    this.buildMinimap(track);
  }

  set(key, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    this.el[key].textContent = value;
  }

  show(name, visible) {
    this.el[name].classList.toggle('hidden', !visible);
  }

  message(text, { small = false, hold = false } = {}) {
    const m = this.el.message;
    m.className = '';
    void m.offsetWidth; // restart the animation
    m.textContent = text;
    m.className = `${hold ? 'hold' : 'show'}${small ? ' small' : ''}`;
    this.held = hold ? text : null;
  }

  clearHeld() {
    if (!this.held) return;
    this.held = null;
    this.el.message.className = '';
  }

  buildMinimap(track) {
    this.map = $('minimap');
    const size = this.map.width, pad = 16;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.pos) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const scale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size - (maxX - minX) * scale) / 2, oz = (size - (maxZ - minZ) * scale) / 2;
    this.project = (p) => [ox + (p.x - minX) * scale, oz + (p.z - minZ) * scale];

    // the outline never changes, so draw it once
    this.mapBase = document.createElement('canvas');
    this.mapBase.width = this.mapBase.height = size;
    const ctx = this.mapBase.getContext('2d');
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < track.count; i += 4) {
        const [x, y] = this.project(track.pos[i]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    path(); ctx.strokeStyle = 'rgba(6, 10, 22, 0.8)'; ctx.lineWidth = 9; ctx.stroke();
    path(); ctx.strokeStyle = '#19e0ff'; ctx.lineWidth = 2.5; ctx.stroke();
    const [sx, sy] = this.project(track.pos[0]);
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - 2, sy - 7, 4, 14);
  }

  drawMinimap(views) {
    const ctx = this.map.getContext('2d');
    ctx.clearRect(0, 0, this.map.width, this.map.height);
    ctx.drawImage(this.mapBase, 0, 0);
    for (let i = views.length - 1; i >= 0; i--) {
      const [x, y] = this.project(views[i].position);
      const player = views[i].state.isPlayer;
      ctx.beginPath();
      ctx.arc(x, y, player ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = player ? '#fff' : hex(this.teams[i].glow);
      ctx.fill();
      if (player) { ctx.lineWidth = 2.5; ctx.strokeStyle = '#ff2f92'; ctx.stroke(); }
    }
  }

  update(player, views, raceTime, laps, bestLap) {
    this.set('pos', String(player.place));
    this.set('lap', `${Math.min(laps, Math.max(1, player.lap))}/${laps}`);
    this.set('time', formatTime(raceTime));
    this.set('best', formatTime(bestLap));
    this.set('last', formatTime(player.lapTimes[player.lapTimes.length - 1]));
    this.set('speed', String(Math.round(player.v * 3.6)).padStart(3, '0'));
    this.el.energy.style.transform = `scaleX(${(player.energy / 100).toFixed(3)})`;
    this.el.energy.classList.toggle('low', player.energy < 25);
    this.el.thrust.style.transform = `scaleX(${Math.min(1, player.v / (VMAX * 1.32)).toFixed(3)})`;
    this.el.boost.classList.toggle('on', player.boost > 0 || player.turboOn);
    this.drawMinimap(views);
  }

  showResults(order, playerPlace) {
    const suffix = ['ST', 'ND', 'RD'][playerPlace - 1] ?? 'TH';
    this.el.resultsTitle.textContent = playerPlace === 1 ? 'VICTORY' : `FINISHED ${playerPlace}${suffix}`;
    this.el.table.innerHTML = order.map((row, i) => `
      <tr class="${row.isPlayer ? 'you' : ''}">
        <td>${i + 1}</td>
        <td><span class="swatch" style="background:${hex(row.team.glow)}"></span>${row.team.name}</td>
        <td>${row.best ? `BEST ${formatTime(row.best)}` : ''}</td>
        <td>${row.time != null ? formatTime(row.time) : '—'}</td>
      </tr>`).join('');
    this.show('results', true);
  }
}
