# Flies Armageddon chaos events

Mid-race **chaos roulette** is the equal-odds wildcard layer on the Flies Armageddon preset
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
6. **Debug** — On the host page, `fireChaos('laser')` / `fireChaos('laser', { solo: true })` / `window.CHAOS_KINDS` (see
   `src/arena.js`).

`CHAOS_KINDS` is exported and must stay the single source of truth for roulette and
`debugFire`.

---

## Physics and worker ops

Chaos reaches flies via `post(f, { op, … })` on each fly worker. Important ops:

| op | Effect |
|----|--------|
| `pin` | Freeze a walking fly (zeros horizontal velocity). Does not abort an in-progress flight. |
| `spin` | Yaw spin + lift (`wz`, `turns`, `vz`). Does not abort flight. |
| `loose` | Release claws (quake / flip / tilt). |
| `ground` | Cue still posts this; no longer ends flight. |
| `bias` | Sets `chaosBias` — added to horizontal velocity **every physics substep** (walking flies included). |
| `impulse` / `flip` | Velocity kick; `flip` also sets angular rates. Does not abort flight. |
| `kill` | `dieKnockover()` — race elimination. |
| `damage` | `hurt(amount, cause, by)` — spends `health`; kills only if it reaches 0. Optional `vx/vy/vz/wx/wy/wz` knockback. |
| `zap` | Taser lock: `pin` + twitch for `ms`, plus one `damage`. Self-releases; `pin: false` cancels it. |
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

## Shipped kinds (23)

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
| `laser` | Laser eyes | ~3.2 s session; ~50% one fly, else all; beams can kill | cue `{ solo, flyId }`; `shooterId`; `fireChaos('laser', { solo: true })` |
| `meteor` | Meteor shower | 3 slanted impacts; smoke lingers ≥5 s per impact; chunks ~15 s; ~15% targeted kill | Pull-back then orbit; `public/chaos/meteor_chunk.glb` |
| `sugarrain` | Sugar crumbs | Light crumb rain + weak impulses; no kill, no cake patches | Pull-back then orbit; `public/chaos/sugar_crumb.glb` |
| `ufo` | UFO | Shader beam + saucer GLB; lift/drop; no auto-kill | Frames then orbit; `ufo.glb` + `race-chaos-ufo-beam.js` |
| `spikes` | Spike trap | `spike_trap.glb` (+Z spikes, 1.5×); kills inside while armed | Frames the trap then orbit; AABB `half` ~1.0–1.23 |
| `holy` | Holy Hand Grenade | One fly lobs `grenade.glb` at another; mostly misses; blast kill R = 5× grenade height | Frames the arc then orbit; count 1-2-3 then boom |
| `minigun` | MINIGUN | 14 rounds at 10% each; needs a fly in front; spray widens with range | Tracer pool; rotor spin audio loop |
| `shotgun` | SHOTGUN | 9 pellets at 6.5%; needs a fly in front; cone widens fast; heavy knockback | Recoil kick, muzzle flash |
| `taser` | TASER | 55% + `zap` lock 1.2 s; needs a fly in front; 10% chains to a second fly at half | Arc tracers + borrowed light |
| `bazooka` | BAZOOKA | Needs a fly in front; rocket; **a locked direct hit kills**, splash 35%→15% | Lock-on or fixed land point, chase cam |
| `missile` | HOMING MISSILE | Same payload, locks on more often, visible weave | Lock-on or fixed land point, chase cam |
| `chicken` | RUBBER CHICKEN | **No damage.** Lobbed, then a squawk and a big radial shove | Ring flash, `loose` + impulse |

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
  (12%: 1-2-**5**-3) and explodes. Toast time plays `Grenade throw.wav`; on **1**,
  `haleluja.wav` plays. Rarely hits what it was aimed at.
- **Outcomes (host roll):** miss 40% (1.4–2.6 off), close 25% (0.4–1.1), wild 20% (anywhere
  off the sugar disc), oops 10% (at the thrower's feet), dud 5% (smoke, “A damp squib.”,
  tiny shove). Aim error ±35°, long or short; desert wind nudges 0.4–1.0.
- **Physics (host):** `pin` thrower during windup; at boom `kill` within `killR`
  (5× scaled grenade height), outward `impulse` to `impulseR`.
  The thrower is not immune.
- **Payload:** `holy: { throwerId, targetId, start, land, apexZ, flightMs, count, dud,
  outcome, wind, killR, impulseR }`. Debug: `fireChaos('holy', { outcome: 'oops', gag: true })`.
- **Session:** `holySession`; `endHoly` in `disposeAllFx` unpins and disposes grenade,
  count sprite, fireball and light.

---

---

## Fly-on-fly weapons (six)

**Code:** [`src/race-chaos-weapons.js`](../../src/race-chaos-weapons.js) (tuning table, aiming,
hit resolution, tracer pool, held-prop placement) plus the weapon block in `race-chaos.js`.
**Props:** `minigun`, `shotgun`, `bazooka`, `missile`, `taser` in `public/chaos/`
(baked by `node scripts/export_chaos_props.mjs <name>`); chicken uses the authored
`public/Rubberchicken.glb` (cel-shaded on clone: toon + extruded outline). Minigun is 30%
smaller than the default guns; taser is fly-body length; bazooka and shotgun are half of
default. The bazooka rocket and its smoke trail are half the missile rocket's size.
Minigun, shotgun, taser and bazooka only fire when a live fly sits in the shooter's front
hemisphere (`pickFacingDuel`); the roulette retries another kind if nobody is facing.

Unlike every earlier kind, these **wound instead of kill**. A hit posts
`{ op: 'damage', amount, cause, by }` and `FlyAgent.hurt()` spends `health`; the fly dies
through the same `dieKnockover()` path that starving uses, so the race-finish check, the
health bar and watcher snapshots all work unchanged. Only a rocket that connects posts a
real `kill`.

- **Single source of tuning:** `WEAPONS` in `race-chaos-weapons.js`. Aim error is a
  lateral offset **in cm at the target** (`jitterBase + jitterPerCm * distance`), never an
  angle — a few degrees across the dish misses a 0.14 cm fly every time. The chance a round
  connects is about `(0.14 / jitter)^2`, which falls off as the square, so `jitterPerCm`
  stays small: flies usually duel 10–20 cm apart, and a cone that widens realistically
  makes a weapon do nothing at all at that range. **Widen the jitter (or lower
  `directChance`) to make a weapon less lethal — do not nerf `damage`.** Measured totals:
  minigun ~69%→35% from point blank to across the dish, shotgun ~59%→16%.
- **Models point along +X** and are scaled by `scaleFor(kind)` from `WEAPON_SCALE` (0.9).
  From the race camera (~30 cm back) a fly is only ~9 px long, so a to-scale gun is a
  smudge. Default 0.9 reads ~30 px (~3× the fly); bazooka/shotgun use 0.45. `holdFor` and
  `weaponMuzzle` derive from the same scale so resizing moves the grip and barrel tip with
  it. Props sit in world space and are re-placed each frame by `placeHeldProp`, which maps
  local +X onto the holder's `last.yaw`. They are not parented to the thorax. Held-weapon
  shooters are **not** pinned — they keep walking (or flying).
- **Hit resolution** reuses the laser's ray casts (`castBeam` / `hitSolids`, `FLY_HIT_R`
  0.14), so bullets respect walls, the floor and desert solids.
- **Tracers need to be fat.** At ~30 px/cm a 0.02 radius is a one-pixel hairline. The
  weapon tracers run 0.04–0.055.
- **A rocket that rolls a direct hit locks on** (`weapon.lockId`): the flight tracks that
  fly's live pose and the impact kills it by identity. Geometry alone cannot work here — a
  rocket is in the air for up to 2 s, in which a fly walks ~2 cm, far outside the 0.4 cm
  `killR` around a frozen aim point, so "direct hits" would never land. Both host and
  watcher draw the chase from their own pose stream; the kill itself is host-side and
  reaches watchers through the normal pose/snapshot path. An **unlocked** rocket keeps the
  frozen `weapon.land` point (same trick as `holy`) and only splashes. The chicken never
  locks — it is always a lob.
- **Cue:** everything a watcher needs is in `payload.weapon`, which `fire()` copies into
  the cue. New weapon fields must be added to that `setCue` call.
- **Cleanup:** one `weaponSession` at a time (`beginWeapons` / `endWeapons`), ended from
  `endWildcardSessions`. `tracerPool` is disposed in `disposeAllFx`. `stopMinigunLoop()`
  runs from `stopLive()` so the rotor whine stops at the winner while delayed rocket
  booms still play.

Death causes: `minigun`, `shotgun`, `taser`, `bazooka`, `bazookaSelf`, `missile`,
`missileSelf`. `deathCauseLabel` in `arena.js` prefers `death.<cause>By` when the hit is
attributed, so the card reads "shredded by Nova's minigun".

---

## Roulette odds

All **23** kinds share the same `pickKind()` pool (no repeat of the immediate previous
kind). The six weapons are ~26% of rolls; the two lethal rockets are ~8.7%. Re-test `disposeAllFx` after changes: finish banner, lobby countdown, `resetRace`.
Host + relay watchers should replay `chaosCue` with visuals only (`physics: false`).

---

## Related docs

- [Arena app](../15-arena.md) — Flies Armageddon preset, workers, UI
- [Apps](apps.md) — race URL and host/watch split
