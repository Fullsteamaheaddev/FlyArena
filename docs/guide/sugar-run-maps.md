# Sugar Run maps

Sugar Run (`/racehost`, `/`, `arena.html?env=race`) can race on more than one map. The
owner picks the map at `/admin`; the choice is site-wide and takes effect at the host's
next race reset. Watchers follow the map in the host's match snapshots.

| Id | Arena | Spawns | Notes |
|---|---|---|---|
| `dish` | 12.5 cm radius circular plate | 3 at 10.5 cm | The original purple plate |
| `desert` | 50 × 50 cm walled square, night | 3 at 19 cm (lanes at 90° / 210° / 330°) | Flat sand, pools, palms, ruins, lamps |

**Code:** `src/sim/world.js` (`RACE_MAPS`, `raceMap`, square branch of `buildWorldXML`),
`src/sim/maps/desert.js` (desert layout), `src/race-map-desert.js` (desert rendering),
`src/race-map-assets.js` (prop GLB loader), `src/race-wind.js` (visual wind + hawk),
`src/race-audio.js` (`startAmbience` / `setAmbience` / `stopAmbience`),
`src/race-map.js` + `netlify/functions/map.js` (site-wide choice), `src/arena.js`
(`setRaceEnv`, `fitRaceView`, `watchRaceMap`).

---

## Choosing the map

- **Admin:** `/admin` → *Race map* → *Save map*. Writes `raceMap` into the
  `sugar-run` Netlify Blobs store through `PUT /api/map`, and also saves it to
  `localStorage` `sugarRunMap`.
- **Host:** reads `/api/map` at boot and at every `resetRace`. If there's no function
  (plain `vite` dev), it falls back to `localStorage` `sugarRunMap`, then `dish`.
- **Dev override:** `?map=desert` / `?map=dish` on the host URL (dev builds only).
- **Watchers:** boot on `/api/map`, then switch whenever a snapshot's `map` differs
  (`buildMatchState` in `src/match.js` carries `map`). A switch rebuilds the scene and lets the
  next snapshot re-add the flies.

The map is swapped by replacing the contents of the shared `env` object, so workers,
chaos and senses keep the same reference. Race workers are rebuilt on every reset
anyway, so they get the new world XML at init.

---

## Desert layout (`src/sim/maps/desert.js`)

Fairness comes from symmetry. Anything a fly can touch, smell or see is written once
in lane-local coordinates (d outward, s sideways) and rotated onto all three lanes.
Features that sit between lanes are placed at 30° / 150° / 270°. Corner dressing
(`deco: true` props) is render-only: no MuJoCo geoms, so the eyes don't see it.

- **Containment:** box floor, 4 box walls (2.4 cm) and invisible clip walls up to 8 cm,
  all on the `arena` mocap body (tilt chaos still works). `arena.half = 25`;
  `arena.radius = 25` is the inscribed circle that chaos uses for placement.
- **Odor:** a centre disc (σ 1.2) plus 7 elongated blobs per lane from d = 2.5 to 18.
  Strength falls from 0.9 near the centre to 0.47 at the outermost blob, which sits just
  inside the spawn (as on the dish), so flies start inside the plume. `windRadial: 6`
  and `hungryForage` are the same as the dish.
- **Flat floor:** there are no dunes, so `env.dunes` is empty and `groundAt()` in
  `src/sim/senses.js` is 0 everywhere.
- **Water:** one pool per lane (r 1.7). It's visual and harmless. The labellum tastes
  water over a pool (`poolAt()`), but it isn't in `env.food`, so it can't end a race.
- **Colliders:** palm trunks, cacti, rocks, arch legs, broken pillars, lamp posts,
  pyramids (3 stacked boxes) and obelisks. All are `obstacles` with `collider: true`,
  contype 2, and body-only contact. Palm canopies are eye-visible ellipsoids with no
  collision.
- **Lamps:** `env.lamps` is `{x, y, h, light}`. Every entry gets a post collider (except
  the render-only corner ones) and lamp geometry; `light: true` also gets a real
  `PointLight` in the renderer. Six lanes/between-lane lamps carry lights.

Distances are about 1.8× the dish, so races take a bit longer.

---

## Desert rendering (`src/race-map-desert.js`)

`buildDesertScene(envGroup, env, { renderer, scene, sun, hemi, rim })` returns
`{ floor, floorPaint, update(nowMs, wind, tSec), dispose }`. `rebuildEnv()` calls it
instead of drawing the dish floor and wall.

- **Floor:** one 2048² canvas spanning exactly ±25 cm, so chaos scorches line up (the
  base paint is cached and redrawn under scorches), plus a tiled sand-ripple normal map.
  The night paint is dark, with a warm pool composited under every lamp.
- **Walls:** sandstone block texture, coping, merlons and corner towers. The inner face
  sits exactly at ±25.
- **Water:** glassy pools with scrolling normals, ripple rings, reeds and lily pads.
- **Odor trails:** one ribbon per lane, draped on the ground, with vertex alpha and
  wisps that flow toward the sugar. There's also a pulsing glow over the plaza.
- **Lamps:** stone post, iron bowl, an unlit flame cone, an additive ember and a halo
  sprite per lamp, plus a `PointLight` on the six `light: true` ones. One flicker term
  per lamp drives the flame scale, the ember, the halo opacity and the light intensity.
- **Props:** GLBs in `public/maps/desert/`, baked by `node scripts/export_desert_props.mjs`.
  They're unit-normalised and scaled at placement. There's one `InstancedMesh` per template
  mesh, about 16 draw calls in all.
- **Motion:** palms, reeds and lily pads sway through an `onBeforeCompile` vertex patch that
  reads the baked `_sway` attribute (bend weight, flutter flag). A matching depth material
  keeps the shadows in step. Tumbleweeds roll along the wall bands. There are dust motes and
  a hawk shadow.
- **Sky:** night dome with stars and a low moon (outside `envGroup`, so they don't tilt),
  dark fog, dim blue moonlight and a warm rim. Everything is restored on `dispose()`.

Wind is `windField(t)` in `src/race-wind.js`: a deterministic function of wall-clock
seconds (`Date.now()`), so the host and every watcher sway and hear the same gusts
with no network traffic. It's visual and audio only; physics wind is `windRadial` and
the `puff` chaos.

---

## Ambience (`src/race-audio.js`)

`startAmbience()` runs while the desert is up (it starts after the audio unlock).
`setAmbience({ wind, water, hawk, t })` is called every frame and throttled to 10 Hz.
All of it is synthesised from noise and oscillators into the duck bus:

- a wind bed with a gust whistle;
- frond rustle and sand hiss;
- water trickle and drips, scaled by how close the camera target is to a pool;
- a cicada chorus that swells and rests;
- a hawk cry when a hawk pass starts (`hawkAt(t)`).

Optional WAV overrides: pass `ambWind` / `ambHawk` URLs in `createRaceAudio`'s extra URLs.

---

## Chaos on a big square

- Tilt angle is scaled so the rim rises as far as it does on the dish (`tiltDeg`).
- Scorch radii are 1.5× on the square (`scorchScale`).
- The laser ray-casts against the square walls (`raySquareWallT`).
- The rim bounce in flight and wall clearance use `wallGap()` (circle or square).

## Adding a map

1. Write `src/sim/maps/<id>.js` exporting spots plus an env builder. Keep features
   rotationally symmetric across the spawns.
2. Register it in `RACE_MAPS` (`src/sim/world.js`), in `KNOWN` (`src/race-map.js`) and in
   `MAPS` (`netlify/functions/map.js`), and add an `<option>` in `admin.html`.
3. Branch `rebuildEnv()` on `env.map` for any custom rendering.
