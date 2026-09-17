# fly-brain — agent shorthand

Upstream: [Lulzx/fly-brain](https://github.com/Lulzx/fly-brain). Browser sim of the male *Drosophila* CNS: **165,122** LIF neurons, **10.5M** synapses (≥3), flybody MuJoCo body, flyvis compound eye. Full docs live in `docs/` (index: `docs/README.md`). Design notes: `PLAN.md`. This file is the working map — do not duplicate the textbook here.

**Working rule:** do not rewrite the project or add features unless asked. Prefer the smallest local change. Data in `public/` is committed; do not regenerate unless asked.

---

## Run

```sh
npm install
npm run dev                  # Vite; COOP/COEP headers in vite.config.js
```

| URL | App |
|---|---|
| `/` | Connectome viewer (`index.html` → `src/main.js`) |
| `/arena.html` | Embodied arena (`src/arena.js`) |
| `/arena.html?gpu=0` | Force WASM brain (no WebGPU) |
| `/arena.html?env=courtship` | Preset (`foraging` default; see `PRESETS` in `src/sim/world.js`) |
| `/arena.html?env=race` | Odor race game: 12.5 cm maze, 3 named flies, Start overlay, winner = reach centre disc, 10s reset to rim |
| `/fly.html` | Anatomy / Blender fly (`src/fly.js`) |
| `/structures.html` | Algorithmic structures (`src/structures.js`) |
| `/textbook/` | Textbook reader (`src/textbook.js`) |

LAN: `npx vite --host 0.0.0.0 --port 5173`. Needs SharedArrayBuffer → isolation headers must stay. Desktop Chrome/Edge/Firefox.

Headless: `node scripts/run_fly.mjs 6 nearodor` · `node scripts/behavior_report.mjs` · `node scripts/diag_walk.mjs`. List: `docs/17-experiments.md`.

Needs Node 20+. Python/`uv` only to rebuild data (`docs/guide/pipeline.md`).

---

## Loop (1 ms sim, per fly)

One fly = one worker (`src/sim/fly.worker.js`) + own MuJoCo world + slot in **shared** WASM memory. Other flies = kinematic proxies. Connectome graph written once (`src/brainsetup.js`, `MAX_FLIES = 12`).

`FlyAgent.step()` in `src/sim/fly.js`:

1. **Senses** `src/sim/senses.js` + **vision** `src/sim/vision.js` / `src/flyvis.js` (flyvis ~50 Hz / every 20 ms). Rates → Poisson drive.
2. **Neuromod** `src/sim/neuromod.js` (hunger → AKH/insulin → octopamine).
3. **Intrinsic** `src/sim/intrinsic.js` (bouts/saccades/avoid/feed/takeoff as **synaptic input to DNs**, never actuators).
4. **Brain** 2 × 0.5 ms LIF: `src/wasm/lif.c` via `src/lifwasm.js`, or `src/lifgpu.js`. Construction: `src/brainmodel.js`.
5. **Motor** `src/sim/motor.js` — default `descending` (DN readout + gait CPG). `connectome` mode = raw MN→muscle (cannot stand).
6. **Physics** `src/sim/world.js` — flybody, ~5 × 0.2 ms (`physPerMs`). Units **cm, g, s**. Thorax z ≈ 0.13.
7. **Flight** `src/sim/flight.js` — blade-element on 218 Hz stroke after jump.
8. **Physiology** energy/health/ingestion in `fly.js`.

Worker bursts ≤8 sim-ms / 8 CPU-ms; poses to main ≤30 Hz. Groups for the inset: `src/sim/groups.js`.

---

## File map

| Path | Role |
|---|---|
| `src/arena.js`, `arena.html` | Main-thread UI, workers, render, presets, `?env=` / `?gpu=` |
| `src/arena-batches.js`, `src/render-resolution.js`, `src/wing-blur.js` | Arena draw batching / DPR / wing blur |
| `src/sim/fly.js` | Closed-loop agent |
| `src/sim/fly.worker.js` | Worker protocol: `init/run/pause/speed/env/others/mode/stimulate/takeoff/activity` |
| `src/sim/world.js` | `DEFAULT_ENV`, `PRESETS`, `buildWorldXML` |
| `src/sim/senses.js` | Taste, odour (divisive ORN gain), touch, proprio, heat, wind, cVA plume |
| `src/sim/vision.js` | flyvis → ~62k optic-lobe neurons, gain **150** |
| `src/sim/motor.js` | `DN_ROLES`, `READOUT`, gait, jump, righting, courtship wing |
| `src/sim/intrinsic.js` | Endogenous drive onto DNs |
| `src/sim/neuromod.js` | Hormones / OA |
| `src/sim/flight.js` | Takeoff, aero, land |
| `src/sim/groups.js` | Named traces shared by worker + UI |
| `src/brainsetup.js` | Shared memory, attach WASM/GPU brain + flyvis eyes |
| `src/brainmodel.js` | Calibrated LIF params + class physiology |
| `src/lif.js` / `lifwasm.js` / `lifgpu.js` / `wasm/lif.c` | Kernels |
| `src/data.js` + `src/codec/*` | Packed connectome load (`graph.flyg`, `neurons.flyn`, `skeletons.flys`) |
| `src/main.js` | Connectome viewer |
| `public/data/` | Packed brain, `bodymap.json`, `brain_params.json`, `neuromod.json` |
| `public/body/` | Physics XML + visual / Blender meshes + `gait.json` |
| `public/vision/` | flyvis model + retinotopic map |
| `scripts/` | Pipeline, calib, gait, headless assays, Playwright checks |
| `vite.config.js` | Isolation headers, data file hashes, multi-page build |

---

## Wiring vs code (do not blur)

**From the connectome:** DN commands (walk/back/steer/groom/escape/takeoff), sensory screen, courtship detection (LC10 + cVA → pIP10/DNp13), KC sparseness, sugar→MN9 / bitter veto.

**Supplied around the graph:** tripod gait CPG; endogenous bouts; reafference / escape gating (walls loom); GF→TTMn **electrical** synapse (`fly.js` `pulse` on TTMn); steering adaptation (L/R wiring imbalance); flyvis for columnar OL; hunger hormones.

**Weak:** loom escape ~2/10; obstacle/heat turn mostly intrinsic; feeding needs endogenous stop + hunger-gated MN9.

Honest lists: `docs/guide/what-the-wiring-gives.md`, `docs/19-limitations.md`.

### DN readout (`src/sim/motor.js`)

- Forward: DNg100, DNg97, DNp09 (P9), BDN2/oDN1 aliases as typed, plus weaker DNa05/07, DNp26, DNg25, DNa01/02
- Back: **MDN**
- Steer (ipsilateral): DNa02, DNa01, DNp09
- Groom: DNg07/08/12
- Escape: **DNp01** (GF); takeoff DNs DNp02/DNp04 (70 Hz and 3× baseline)
- Court: pIP10, DNp13

Jump: GF ≥ ~3–4 spikes / 50 ms **or** takeoff DNs. Muscle half-max ~17 Hz.

Motor modes: `descending` (default, use this) vs `connectome` (experimental, fly falls).

---

## Brain model facts (when editing LIF / calib)

`src/brainmodel.js` + `PLAN.md`: conductance synapses (E_exc 0, E_inh ≈ −70); PSP ∝ (volume/median)^−α; min 5 synapses; transmitter signs; sensory cells receptor-only; raised KC threshold; lamina resting depolarisation; GF→TTMn added in the loop not the graph.

Params: `public/data/brain_params.json`. Search: `scripts/calib_search.mjs`. Eval: `scripts/calib_eval.mjs`.

WebGPU when available; flyvis **always** WASM (`fv_step`). `?gpu=0` sets `brainParams.gpu = false`.

---

## Body / map / vision

- Body: flybody (67 bodies, 102 joints, 78 actuators, adhesive claws). Prep: `scripts/prep_body.py`.
- Map: `public/data/bodymap.json` from `scripts/prep_bodymap.py` — 439 MNs, 7745 sensory in 151 channels, 4107 photoreceptors. Unmapped: abdominal/neck/haltere MNs.
- Legs vs walls: claws/labella/legs contact **floor only**; head/thorax/abdomen/wings hit walls/obstacles/flies (stops wall-climbing with legs).
- Food touch: labellum within ~0.65 mm when extended (weak flybody proboscis).
- flyvis: 65 types × 721 columns/eye; ~410 columns used by real eye; OL neurons driven by flyvis and masked from recurrence; LC/LPLC and everything central is the spiking CNS.

---

## Where to change what

| Goal | First files |
|---|---|
| Arena UI / presets / URL | `src/arena.js`, `src/sim/world.js` `PRESETS` |
| Closed-loop behaviour | `src/sim/fly.js` then senses/motor/intrinsic |
| Walking / jump / DN weights | `src/sim/motor.js` `DN_ROLES` `READOUT`; gait `public/body/gait.json` |
| Spontaneous bouts | `src/sim/intrinsic.js` (`docs/23-behaviour.md`) |
| Hunger / OA | `src/sim/neuromod.js`, `public/data/neuromod.json` |
| Flight | `src/sim/flight.js` (`docs/24-flight.md`) |
| Vision gain / mapping | `src/sim/vision.js`, worker `gain: 150` |
| Brain equations / params | `src/brainmodel.js`, `src/wasm/lif.c`, `public/data/brain_params.json` |
| Shared memory / GPU fallback | `src/brainsetup.js` |
| Packed data / hashes | `src/codec/*`, `vite.config.js` `DATA_FILES`, `scripts/pack_data.mjs` |
| Headless assay | `scripts/run_fly.mjs`, `diag_walk.mjs`, `behavior_report.mjs` |

Roadmap (do not start unless asked): `docs/20-roadmap.md` — loom/feeding pathway fits, wall gait, dopamine gating, share GPU across flies.

---

## Gotchas

- Isolation headers are load-bearing. Serving without COOP/COEP breaks SharedArrayBuffer.
- Vite `optimizeDeps.exclude: ['@mujoco/mujoco']` — keep it.
- Proxies: 11 cached collision bodies; unused parked off-arena. Do not shrink below max population.
- `connectome` motor mode is a negative result, not a bug.
- Starved OA on the wiring **reduces** walking (more OA onto steer/back than forward). Bout lengthening is still rules.
- MN9 leaks from olfaction → walking with proboscis out is known.
- Physics XML masses/inertias are exact; visual meshes are decimated separately.
- Worker `foodEaten` is a delta each pose; main thread must broadcast consumption back.
- Odor race (`?env=race`) is a game shell: hides `#panel` and `#brainpanel`, Start overlay, winner = thorax inside centre food disc, then 10s in-page respawn at rim spots. Do not treat it as a lab preset.

---

## Docs cheat sheet

Guide: `docs/guide/{what-this-is,run,loop,apps,what-the-wiring-gives,pipeline,experiments}.md`  
Numbered: `01` overview … `30` hypothesis lab. Highest-traffic: `05` brain, `08` body, `12` motor, `15` arena, `19` limits, `23` behaviour, `24` flight, `25` neuromod, `26` courtship, `27` WebGPU.
