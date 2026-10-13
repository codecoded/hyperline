// Headless sanity check: prints track stats and AI lap times for a range of skills.
import { Track } from '../src/game/track.js';
import { ShipState, driveAI, VMAX } from '../src/game/physics.js';

const track = new Track();
let kMax = 0, kvMin = 0, kvMax = 0, bankMax = 0;
for (let i = 0; i < track.count; i++) {
  kMax = Math.max(kMax, Math.abs(track.kLat[i]));
  kvMin = Math.min(kvMin, track.kVert[i]); kvMax = Math.max(kvMax, track.kVert[i]);
  bankMax = Math.max(bankMax, Math.abs(track.bank[i]));
}
console.log(`length ${track.length.toFixed(0)}  samples ${track.count}`);
console.log(`min corner radius ${(1 / kMax).toFixed(0)}  crest radius ${(-1 / kvMin).toFixed(0)}  dip radius ${(1 / kvMax).toFixed(0)}  max bank ${(bankMax * 57.3).toFixed(0)}deg`);

// closest approach between non-adjacent parts of the circuit (self-intersection check)
let closest = Infinity;
for (let i = 0; i < track.count; i += 4) {
  for (let j = i + 4; j < track.count; j += 4) {
    const along = Math.min(j - i, track.count - (j - i)) * track.step;
    if (along < 200) continue;
    closest = Math.min(closest, track.pos[i].distanceTo(track.pos[j]));
  }
}
console.log(`closest non-adjacent approach ${closest.toFixed(0)}`);

for (const skill of [0.84, 0.9, 0.96, 1.0]) {
  const ship = new ShipState(0, false);
  ship.skill = skill;
  ship.reset(track.length - 30, 0);
  const dt = 1 / 120;
  let t = 0, hits = 0, vTop = 0, vMin = Infinity, air = 0;
  while (ship.lap < 4 && t < 400) {
    driveAI(ship, track, [ship]);
    ship.step(dt, track, t);
    if (ship.hit > 0) { hits++; if (process.argv.includes('--hits')) console.log(`  hit at ${(ship.s / track.length).toFixed(3)} side ${ship.hitSide} vn ${ship.hit.toFixed(1)} v ${ship.v.toFixed(0)}`); }
    if (ship.lap >= 2) { vTop = Math.max(vTop, ship.v); vMin = Math.min(vMin, ship.v); air = Math.max(air, ship.h); }
    t += dt;
  }
  console.log(`skill ${skill}: laps ${ship.lapTimes.map((l) => l.toFixed(2)).join(' ')}  wall hits ${hits}  v ${vMin.toFixed(0)}..${vTop.toFixed(0)} (vmax ${VMAX})  max hover ${air.toFixed(2)}`);
}

if (process.argv.includes('--corners')) {
  for (let i = 0; i < track.count; i++) {
    const k = Math.abs(track.kLat[i]);
    const prev = Math.abs(track.kLat[(i - 1 + track.count) % track.count]), next = Math.abs(track.kLat[(i + 1) % track.count]);
    if (k > prev && k >= next && k > 1 / 400) {
      const p = track.pos[i];
      console.log(`corner at ${(i / track.count).toFixed(3)}  radius ${(1 / k).toFixed(0)} ${track.kLat[i] > 0 ? 'R' : 'L'}  pos ${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}`);
    }
  }
}
