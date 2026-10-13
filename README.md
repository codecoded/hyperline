# HYPERLINE

A Wipeout-style anti-gravity racer: three.js rendering, Blender-built models, custom GLSL everywhere.

```
npm install
npm run dev        # http://localhost:5173
```

To play on a phone on the same Wi-Fi: `npm run mobile`, then open the printed Network URL. Touch controls appear automatically: thrust is automatic, drag the left thumb to steer (push far for an airbrake drift), turbo and brake under the right thumb.

## Controls

| | |
|---|---|
| `W` / `↑` | thrust |
| `A` `D` / `←` `→` | steer |
| `Q` `E` (or `Z` `C`) | left / right airbrake — tightens the turn and lets the tail slide |
| `Space` / `Shift` | turbo (burns shield energy) |
| `S` / `↓` | brake |
| `V` camera · `R` restart · `P` pause · `M` mute | |

A gamepad works too (stick, RT/A thrust, LB/RB airbrakes, B turbo, Start).
Three laps, eight ships, you start at the back. Hit the chevron pads for boost; walls drain shield, and an empty shield caps your top speed.

## How it is put together

- `tools/build_assets.py` — Blender script that models the ship, track gates and skyline towers procedurally and exports GLBs to `public/models`. Re-run with `npm run assets` (expects Blender at `/Applications/Blender.app`).
- `src/game/track.js` — the circuit as a closed spline with banking and curvature tables.
- `src/game/physics.js` — ship handling in track space (drift, airbrakes, hover spring, walls, boost) plus the AI driver.
- `src/world/` — track, sky, ground and city shaders. `src/fx/` — trails, sparks, speed lines, bloom + lens post-processing.
- `src/audio.js` — engine, effects and music, all synthesised with WebAudio.
- `npm run sim` — headless check of track geometry and AI lap times, useful when tuning handling or editing the circuit.

`?auto` in the URL lets the AI fly your ship (demo mode).
