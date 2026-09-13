# 15. Arena app

Files: `arena.html`, `src/arena.js`, `src/sim/fly.worker.js`, `src/sim/fly.js`.

## Architecture
- The main thread loads data, writes the connectome and flyvis model into shared memory, and renders.
- Each fly runs in its own Web Worker with its own MuJoCo world and brain slot.
- Workers post poses every 16 ms of simulated time. The main thread shares other flies' positions and sexes
  so each world moves its proxies, which collide, are seen, and carry pheromone.
- The brain runs on a WebGPU kernel when `navigator.gpu` is available (see [WebGPU](27-webgpu.md));
  `?gpu=0` on the arena URL forces the WebAssembly kernel. Either way the wasm module is also instantiated,
  because the flyvis eyes run on it.
- Food consumption is summed across workers and broadcast back.

## Rendering
Three.js with flybody meshes per body part, shadows, a checkered floor and striped wall matching what the
eyes see, odour plumes as soft discs, and a brain inset showing the selected fly's activity at each soma.

`src/fly-appearance.js` supplies both `fly.html` and the arena. At macro scale it uses the 272,550-triangle
scan with approximately 35,000 procedural setae, glossy eye facets and camera-dependent pseudopupils,
sex-specific tergite bands/sex combs, and thin-film wing interference. Membranes receive reflections but
do not cast opaque shadows. Restrained room reflections, warm key and rim lights, and close-range
ambient occlusion bring out the cuticle, bristles and joints. The body uses spatially varying roughness,
Blender-baked cellular relief, low sheen and no clear coat. A small amber light-wrap term
approximates shallow scattering; it is not a measured subsurface model. Eye lenses keep smaller facet
highlights and a soft red pseudopupil, while the wing film has weaker reflections and grazing-angle
opacity. One shared 512² data texture stores relief, roughness and pigment in RGB (480 KiB PNG,
approximately 1.3 MiB GPU memory with mipmaps). Triplanar sampling follows each articulated part;
mipmaps suppress subpixel texture shimmer. The face has denser, shorter microtrichia instead of
coarse added hairs. This adds about 3,100 small hairs only in the macro tier, with no extra draw calls.
See [Blender workflow](../art/fly/README.md) for the editable Cycles scene, reference render and bake.

The arena keeps the simulated body poses and proportions. The anatomy viewer's female size adjustment
and idle animation are not applied over MuJoCo's world-space poses. Added hairs, pigment, sex combs and
thin-film thickness remain procedural approximations, not specimen measurements.

Performance is controlled by projected body size, with hysteresis at detail boundaries:

| View | Geometry and hairs |
|---|---|
| Distant (below approximately 100 px) | Existing 69,124-triangle reduced mesh; material sheen represents fine fuzz |
| Nearby (approximately 100–330 px) | Reduced body, full-resolution eyes and long bristles with simpler hair geometry |
| Macro (above approximately 330 px) | Full scan and the entire curved-hair population; half-resolution AO |

Geometry, materials and immutable hair instance buffers are shared across flies. Flight blur uses two
instanced draws per fly with thorax-local poses sampled by its worker. Articulated body matrices update
when a pose arrives. Shadows follow the camera's target with a tighter frustum, refresh at most 30 Hz,
and stop refreshing once poses and camera settle. Subpixel hairs cast no arena shadows.

The main framebuffer has a 2.4-megapixel ceiling (maximum DPR 2), with four-sample MSAA. In expensive
close views, sustained frame times above 19 ms reduce render density in 15% steps, down to DPR 0.9
(or the ceiling if lower); eight seconds of fast frames allows a gentle recovery. The scan and hair
geometry stay intact. Wide views do not lower density in response to busy simulation workers.
`src/render-resolution.js` shares this policy between both pages. The brain inset
draws at most 30 Hz and uploads colours only for new activity, selection or highlighting. Repeated
placement frees the previous environment meshes, materials and textures. Hidden tabs skip rendering
and activity polling; simulation scheduling stays under the Run/Pause control.

The anatomy page is always interactive 3D. It loads Blender's subdivided body and lens geometry
(1,169,030 triangles), Cycles diffuse irradiance and the scene's AgX display transform. Specular
reflections are evaluated live from the four macro area lights. The bake includes body/hair
occlusion and subsurface transport; the viewer skips its redundant screen-space AO pass.
The full-body and head buttons move the actual orbit camera. Sex, wing, focus and hover controls
remain available; there is no photograph mode. This is a WebGL renderer using Blender-prepared
assets, not the Cycles engine running in the browser. Baked lighting assumes the studio/rest pose;
large wing/flight pose changes and female pigmentation remain approximations.

`src/macro-focus.js` evaluates defocus at half resolution with a 13-sample disk and composites over
full-resolution colour. The anatomy viewer uses a cached 1024² filtered shadow map for soft ground
contact; the arena retains its existing 2048² shadow map, dynamic lighting and distance detail.
See [the Blender workflow](../art/fly/README.md) for asset generation and compression.

Run `node scripts/check_rendering.mjs` with the dev server running for browser interaction checks,
screenshots and warm-frame timings. Results default to `/tmp/fly-rendering/`. The harness covers both
pages, live simulation, five flies, sex differences, flight rendering, distance detail, shared buffers,
resize and placement resource cleanup. The explicit flight fixture tests rendering only; it is not a
biological takeoff test. Optional `--baseline=/path/to/sources` serves saved `fly.js` and `arena.js`
through Vite for comparison. `--gpuTimers=1` is diagnostic only: timer queries can perturb ANGLE frame
times. Rendering FPS does not measure the simulated-time/wall-time ratio of the neural/physics workers.

### Measured rendering (2026-09-13)

Headless Chrome 152, ANGLE Metal on Apple M4 Pro, 1400×900 at device scale 1; 180 warm frames per
scenario. Source baseline: `9d89509`. Full samples and CPU submission timings are in
[`rendering-benchmark.json`](rendering-benchmark.json). FPS below is 1000 / mean frame interval.
This table records the initial optimization, before the subsequent cuticle/lighting revision; the
revision's browser and timing results are recorded separately in the same JSON.

| Scenario | Before FPS | After FPS | Before → after mean draw calls |
|---|---:|---:|---:|
| Anatomy, resting, focus + AO | 60.1 | 60.0 | 569 → 399 |
| Anatomy, flying, dark backdrop | 50.4 | 60.1 | 678 → 388 |
| Arena, default view, paused | 60.1 | 60.3 | 182 → 116 |
| Arena, macro, paused | 60.0 | 59.2 | 180 → 270 |
| Arena, macro, running | 60.2 | 55.8 | 180 → 302 |
| Arena, wide, paused | 60.2 | 60.1 | 182 → 95 |
| Arena, five flies, paused | 60.2 | 60.1 | 826 → 489 |
| Arena, five flies, running | 37.3 | 35.8 | 791 → 667 |

The macro arena renders substantially more geometry than the former low-detail view. Its visual upgrade
costs about 1.3 ms per frame in the active single-fly sample; the five-fly simulation remains below 60 FPS
in both versions. These results establish reduced draw work and better anatomy-view flight performance,
not a universal frame-rate improvement. The active macro sample used render DPR 0.9 after adaptation,
and the following wide sample began recovering density. Other desktop rows used DPR 1. Brain-colour
uploads were zero in all settled paused samples; shadows also stayed cached, apart from a refresh when
render density changed. The resting anatomy view submitted about 53% fewer triangles across all passes.

A separate device-scale-2 check allowed five seconds for adaptation, then sampled 120 frames: anatomy
60.4 FPS and paused macro arena 60.1 FPS. Both settled at render DPR 0.997 (1396×897 drawing buffer for
a 1400×900 CSS viewport). This is adaptive raster resolution, not native Retina rendering. Full scan
and hair geometry remained enabled; front, rear, overhead and eye close-ups were also inspected.

After the cuticle/lighting revision, another 180-frame run at device scale 1 measured 60.2 FPS in both
anatomy scenarios, 58.9 FPS in the paused macro arena, 60.2 FPS with one active fly, and 37.2 FPS with
five active flies. All these samples used render DPR 1. Browser interaction and shader checks passed.
The varying active-worker results are not evidence that the material shader accelerates simulation.
The revised device-scale-2 check also held about 60 FPS after adaptation: render DPR 0.9 for anatomy
and 0.997 for the paused macro arena. Those remain reduced-density renders, not native Retina.

The subsequent Blender-baked detail revision passed the same 180-frame browser suite at about 60 FPS
in all sampled views, at DPR 1. A separate five-fly check allowed ten seconds of simulation warmup,
then measured 600 frames: 60.0 FPS, 21.9 ms p95 frame interval. Every worker's simulation timestamp
advanced during that measurement. One receding fly reached the distant detail tier. The JSON keeps
this run separate from earlier timings; active workloads vary, and rendering FPS does not establish
real-time neural/physics throughput. Blender itself rendered the 1600×1152, 256-sample reference in
36.3 seconds including scene setup on the warmed Metal cache; that is an offline render.

## Brain panel
The right-hand panel follows the selected fly. Every 120 ms the page asks that fly's worker for:
- **Eyes:** the brightness in each of the 721 columns per eye that the flyvis model receives, drawn by
  azimuth and elevation with the front of each eye towards the middle.
- **Named neuron groups:** firing rate per side in Hz of simulated time, smoothed over about 150 ms,
  for smell, taste, photoreceptors, looming detectors (LC4, LPLC2), the giant fibre, forward and backward
  walking DNs, steering DNs, grooming DNs, the courtship circuit (pIP10, DNp13), the hunger-driven
  octopamine neurons (one pooled trace) and
  feeding motor neurons. Each row keeps about 18 s of
  history. The "?" opens a short explanation. Hovering a row fades the brain inset and marks that
  group's somas.

Group membership is defined once in `src/sim/groups.js` and used by both the worker (`GroupMeter`)
and the page.

## Panels
Both side panels fold to their title bar with the chevron button, or the `[` and `]` keys. The choice is
remembered. While the brain panel is folded, the page stops polling activity and drawing the inset.

## Flight
A flying fly's wings are drawn as faint copies across the wing-beat cycle, from poses the worker computes
at startup. Its shadow on the floor shows its height. "Activate takeoff DNs" excites the selected fly's
DNp02 and DNp04.

## World presets

| Preset | Contents |
|---|---|
| Foraging arena | One fly, food with vinegar, bitter patch, hot patch, block |
| Open field | Three flies, five small food patches |
| Predator zone | Two flies, a looming threat every 6 s |
| Maze | Three walls, food at the far end |
| Social | Five flies, one food patch |
| Courtship | A male and a female |

## Controls
Run and pause, speed, add fly, add female, motor mode, follow camera, placement tools, looming threat,
takeoff DN activation, wind, light.
The panel shows each fly's behaviour label, energy, health, food eaten, distance, takeoffs and flights,
its endogenous state (walk, stop, groom, feed, search, avoiding, court, fly), AKH and insulin levels, octopamine
tone and arousal ([Neuromodulation](25-neuromodulation.md)), and live descending-neuron commands.
