# Sugar Run chaos events

Mid-race **chaos roulette** is the equal-odds wildcard layer on the Sugar Run preset
(`arena.html?env=race`, `/racehost`). The host simulates physics; spectators replay the
same cues visually. This guide lists the shipped kinds, how they plug into code, cleanup
rules, and the four GLB-backed wildcards (`meteor`, `sugarrain`, `ufo`, `spikes`).

**Code:** `src/race-chaos.js` (orchestration), `src/race-chaos-assets.js` (GLB preload),
`src/race-chaos-meteor.js` (smoke trail), `src/race-chaos-ufo-beam.js` (beam shader),
`src/race-chaos-props.js` (hand/thumb/cake meshes), `src/race-chaos-bolt.js` (lightning),
`src/race-chaos-laser.js` (laser session).
**Worker ops:** `FlyAgent.applyChaos` in `src/sim/fly.js`, messages from
`src/sim/fly.worker.js` (`type: 'chaos'`).

---

## How it works

1. **Arm** — When the race starts, `createRaceChaos().arm()` sets the first roulette time
   (about 8–15 s after start).
2. **Tick (host only)** — While `isHostLive()`, if not `busyUntil` and `now >= nextAt`,
   `pickKind()` chooses a kind (never the same as the previous kind), `buildPayload(kind)`
   fills targets and geometry, then `fire(kind, payload, true)`.
3. **Interval** — After each fire, `nextAt = now + randRange(5_000, 15_000)` ms (same range for the first event after `arm()`).
4. **Cue sync** — On host fires with `physics: true`, `setCue({ id, kind, flyId, name,
   x, y, yaw, deg, points, hitBolt, … })` runs. Match snapshots include `chaosCue`
   (`src/match.js`, `src/arena.js`). Watchers call `playCue(c)` → `fire(c.kind, c, false)`:
   toast, camera, meshes, audio; **no** kill impulses or env mutations.
   Meteor, sugar rain, cake rain, the spike trap, and the UFO frame the camera then
   re-enable orbit; thumb, boop, flip, quake punch, and puff stay locked until release.
5. **Toast** — “Luckiest Guy” copy from `COPY[kind]` in `race-chaos.js` (~2.4 s).
6. **Debug** — On the host page, `fireChaos('laser')` / `window.CHAOS_KINDS` (see
   `src/arena.js`).

`CHAOS_KINDS` is exported and must stay the single source of truth for roulette and
`debugFire`.

---

## Physics and worker ops

Chaos reaches flies via `post(f, { op, … })` on each fly worker. Important ops:

| op | Effect |
|----|--------|
| `pin` | Freeze fly (ends flight if active). |
| `spin` | Yaw spin + lift (`wz`, `turns`, `vz`). |
| `loose` | Release claws (quake / flip / tilt). |
| `ground` | End flight. |
| `bias` | Sets `chaosBias` — added to horizontal velocity **every physics substep** (walking flies included). |
| `impulse` / `flip` | Velocity kick; `flip` also sets angular rates. |
| `kill` | `dieKnockover()` — race elimination. |
| `dish` | Host dish mocap pose (quake / flip / tilt). |

**Pattern:** dish-wide events use `postAll` on live flies. Targeted events resolve
`payload.flyId`. Radial effects (e.g. **puff**) set per-fly `bias` toward the rim using
each fly’s position.

---

## FX lifecycle and cleanup

All transient visuals hang off `fxRoot` (generic props) or `dishCakeGroup()` (falling cake).
`tick()` advances tweens, dish animation, laser session, cake despawn timers, and floor
scorch paint (`paintChaosScorches`).

**`disposeAllFx()`** (winner, lobby return, `resetRace`) must clear anything a new match
could leak:

- Tweens, camera shots, shakes, scene flash, toast
- `laserSession` + `disposeLaserPool`
- Floor scorches + `repaintFloor`
- Cake: despawn timers, `stripCake()` (env food/odor tagged `chaosCake`), children of
  `dishCakeGroup`
- Dish pose reset (`resetEnvPose`)
- All `fxRoot` children
- Wind restore (`restoreWind`) after puff-like events
- Meteor smoke puffs (`disposeMeteorSmoke` in `endWildcardSessions`)

**`reset()` / `stopLive()`** also clear worker chaos state: `pin`, `spin`, `loose`, `bias`.

**Session pattern (laser):** `laserSession = { until, killed, physics, shooterId }` is
updated in `tickLaserSession`; `endLaserSession` runs from `disposeAllFx`. New long-running
kinds (sugarrain, ufo) should use the same explicit session object and end in
`disposeAllFx`.

**Env side effects:** `crumb` can add temporary `chaosCake` food/odor discs — always pair
with `stripCake` on cleanup. New kinds that touch `env` must reverse or tag for strip on
reset.

---

## Shipped kinds (16)

| Kind | Toast | Host physics | Notes |
|------|-------|--------------|-------|
| `thumb` | Thumb of fate | Pin + flick one fly | Thumb mesh, cam punch |
| `spin` | Spin cycle | `spin` on one fly | Ring VFX |
| `quake` | Earthquake | 5 s dish quake, `loose`, random impulses | Dust spheres |
| `flip` | Dish flip | Hand boot, dish flip, brief `loose` | Side cam |
| `tilt` | Dish tilt | ~4 s dish tip; `loose` + `slip` (low floor friction, gravity slide on the plate) | |
| `lightning` | Lightning | 3 bolts; ~25% one bolt targets a fly → `kill` | Scorches |
| `double` | Double lightning | 6 thinner bolts; same kill odds | |
| `crumb` | Cake rain | 12 staggered drops; splat **kill** in radius; leaves vinegar cake patches | Pull-back then orbit; `race-chaos-props` slice |
| `firefly` | Firefly moment | None | Rim lights ~7 s |
| `boop` | Gentle boop | Small impulse on one fly | Finger pad; cam locked |
| `puff` | Dandelion puff | 5 s inward `windRadial` + outward per-fly `bias` | Seed meshes; cam locked |
| `laser` | Laser eyes | ~5 s session; beams can kill | `race-chaos-laser.js` pool |
| `meteor` | Meteor shower | 3 slanted impacts; smoke lingers ≥5 s per impact; chunks ~15 s; ~15% targeted kill | Pull-back then orbit; `public/chaos/meteor_chunk.glb` |
| `sugarrain` | Sugar crumbs | Light crumb rain + weak impulses; no kill, no cake patches | Pull-back then orbit; `public/chaos/sugar_crumb.glb` |
| `ufo` | UFO | Shader beam + saucer GLB; lift/drop; no auto-kill | Frames then orbit; `ufo.glb` + `race-chaos-ufo-beam.js` |
| `spikes` | Spike trap | `spike_trap.glb` (+Z spikes, 1.5×); kills inside while armed | Frames the trap then orbit; AABB `half` ~1.0–1.23 |
| `holy` | Holy Hand Grenade | One fly lobs `grenade.glb` at another; mostly misses; blast kills within 0.8, impulse to 2.2 | Frames the arc then orbit; count 1-2-3 then boom |

Reference implementations for “spectacle + optional kill”: **`crumb`** (staggered props +
env), **`laser`** (session + tick), **`lightning`** (payload `points` + `hitBolt`),
**`puff`** (all-live `bias` + env wind).

---

## Adding or changing a kind

1. Append kind string to `CHAOS_KINDS` and `COPY`.
2. Implement `playEvent` branch and `duration(kind)`.
3. Extend `buildPayload` if targets or `points[]` are needed.
4. Host-only physics in `if (physics) { … }` inside `playEvent`.
5. Register audio in `src/race-audio.js` if needed.
6. Ensure **`disposeAllFx`** (and `reset`/`stopLive` if workers hold state) clears new
   meshes, sessions, env tags, and biases.
7. Confirm watchers: cue fields must be enough for `playCue` to replay without host-only
   randomness (payload is frozen at fire time on the host).

---

## 3D studio (Blender) for new props

Do **not** build hero chaos props from Three.js primitives (except cheap particles/dust).

1. Model in **Blender** via the **Blender MCP** (`user-blender`): `get_scene_info`,
   `execute_blender_code`, `get_viewport_screenshot` to verify.
2. Export **low-poly GLB** to `public/chaos/` (e.g. `ufo.glb`, `spike_trap.glb`,
   `sugar_crumb.glb`, `meteor_chunk.glb`).
3. Load via [`src/race-chaos-assets.js`](../../src/race-chaos-assets.js) (`preloadChaosAssets`
   from `arena.js` on **host and watcher** race boot — watchers need the GLBs to replay cues).
4. Regenerate baked meshes: `node scripts/export_chaos_props.mjs` (Z-up GLBs into
   `public/chaos/`). Refine in Blender MCP + `/local/prop-studio`, then re-export.
5. Keep triangle budgets modest (arena already heavy).

All chaos GLBs use **+Z up** (saucer in XY, spikes point +Z). Hands/thumb/cake remain
procedural in `race-chaos-props.js`.

---

## Wildcards (five)

These ship in `CHAOS_KINDS` alongside the original twelve (**17 kinds**, equal roulette odds).

### `meteor`

- **Fantasy:** Three meteors — mostly chaos, occasionally lethal.
- **VFX:** 3 GLB chunks on **slanted** paths (`slantAz`, `slantR`, spawn `h` per strike
  in `strikes[]` / `chaosCue`). Elevation from the horizon is 50°–82° (never skim, not all
  vertical). Cell-shaded grey billboard smoke (stepped procedural puff texture; per-impact
  batch sealed to linger ≥5 s after landing), chunk rests ~15 s then fades, scorch on impact.
- **Physics (host):** Impulse/kill at impact `(x,y)` as before; ~15% one strike targets a fly.
- **Payload:** `strikes: [{ x, y, slantAz, slantR, h, elev }, …]`, `hitIndex`, optional `flyId`.
- **Duration:** ~5.6 s busy window.

### `sugarrain` (sugar crumbs)

- **Fantasy:** Tiny sugar crumbs rain from above — messy and sweet, **not** cake slices,
  **no** splat-kill.
- **Toast:** e.g. “Sugar crumbs” / “It’s raining sugar.”
- **VFX:** Many small crumb GLBs (instanced or pooled), gentle spin, fade on “ground.”
  Optional subtle floor glitter (canvas or very light scorch tint — not black scorch).
- **Physics (host):** Light random `impulse` downward/outward on live flies every ~200 ms
  for ~4 s, **or** brief low `chaosBias` noise — keep weaker than quake. **Do not** call
  `kill`. **Do not** add `chaosCake` food patches (unlike `crumb`).
- **Session:** `sugarRainSession` until `until`; clear in `disposeAllFx`.
- **Duration:** ~5–6 s.

### `ufo`

- **Fantasy:** Classic abduction on **one** fly — beam, lift, optional drop; spectacle
  first, **default no auto-kill**.
- **Toast:** e.g. “UFO” / “{name} gets beamed up.”
- **VFX:** `public/chaos/ufo.glb` (horizontal saucer, +Z up); additive beam shader in
  `race-chaos-ufo-beam.js`; point light under saucer.
- **Physics (host):** `pin` during lift; optional `loose` on drop; **no** `kill` unless
  later tuned. If drop from height, use gentle `impulse` not kill.
- **Payload:** `flyId`, `name`, beam `(x,y)` at fly.
- **Session:** `ufoSession` until landed; abort in `disposeAllFx` (release pin).
- **Duration:** ~6–8 s.

### `spikes` (spike trap)

- **Fantasy:** A small square spike patch **clips up through the floor** at a random
  location; kills flies caught while armed.
- **Toast:** e.g. “Spike trap” / “Mind the floor.”
- **VFX:** `public/chaos/spike_trap.glb` (5×5 spikes along +Z, 1.5× prior size); rises on
  `position.z`; clang SFX.
- **Physics (host):** On rise (over ~400–600 ms), test live flies: thorax `(x,y)` inside
  square half-width `h` and `z` below ~0.5 → `kill`. After **armed** window (~2–2.5 s),
  retract mesh; no lingering collision in MuJoCo required (hit test in chaos tick is
  enough, like cake splat).
- **Payload:** `x`, `y`, `yaw` (optional), `half` size.
- **Cleanup:** Remove trap mesh; no env food.

### `holy` (Holy Hand Grenade)

- **Fantasy:** Worms-style lob. One fly throws, the grenade lands, wobbles, counts 1-2-3
  (12%: 1-2-**5**-3) and explodes. Rarely hits what it was aimed at.
- **Outcomes (host roll):** miss 40% (1.4–2.6 off), close 25% (0.4–1.1), wild 20% (anywhere
  off the sugar disc), oops 10% (at the thrower's feet), dud 5% (smoke, “A damp squib.”,
  tiny shove). Aim error ±35°, long or short; desert wind nudges 0.4–1.0.
- **Physics (host):** `pin` thrower during windup; at boom `kill` within `killR` 0.8
  (`cause: 'holy', by: thrower`, or `holySelf`), outward `impulse` to `impulseR` 2.2.
  The thrower is not immune.
- **Payload:** `holy: { throwerId, targetId, start, land, apexZ, flightMs, count, dud,
  outcome, wind, killR, impulseR }`. Debug: `fireChaos('holy', { outcome: 'oops', gag: true })`.
- **Session:** `holySession`; `endHoly` in `disposeAllFx` unpins and disposes grenade,
  count sprite, fireball and light.

---

## Roulette odds

All **16** kinds share the same `pickKind()` pool (no repeat of the immediate previous
kind). Re-test `disposeAllFx` after changes: finish banner, lobby countdown, `resetRace`.
Host + relay watchers should replay `chaosCue` with visuals only (`physics: false`).

---

## Related docs

- [Arena app](../15-arena.md) — Sugar Run preset, workers, UI
- [Apps](apps.md) — race URL and host/watch split
