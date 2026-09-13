# The hypothesis lab: ensembles, discriminating experiments, and a PDE benchmark

Doc 29 built the dataset-agnostic IR and analysis layer. This doc adds the layer that answers
the actual scientific question: **which computation does the wiring support, and what would
you measure to find out?** The approach: instantiate an *ensemble* of dynamical models over the
parameters the connectome does not fix, measure the same observables on every member, classify
them into competing mechanistic hypotheses, then rank candidate perturbations by how many model
pairs they separate.

## The machinery (`scripts/lif_ensemble.mjs`)

Generic pieces any circuit lab reuses:

- seeded RNG (mulberry32 — ensemble results are reproducible; `argv[2]` selects the seed)
- `makeBuilder` — constructs a calibrated `LIFNetwork` and scales edge classes by named
  parameters (`{pre: typeOrSet, post: typeOrSet, param}`), plus tonic bias populations
- perturbation helpers (`silence` = clamped threshold), circular-mean observables
- `rankExperiments` — for each candidate experiment, the fraction of ensemble member pairs
  whose outcome class differs; the top-ranked experiment is the most informative measurement

## Lab 1: the heading bump (`scripts/hypothesis_lab.mjs`)

48 members over `{epgRecur, d7Gain, epgTonic, penGain}` — recurrence gain, Delta7 kernel gain,
tonic EPG excitability, PEN push gain. Observables per member: bump persistence after a seeded
bump is released (concentration + FWHM), realised Delta7 kernel, bump rotation under unilateral
PEN drive. Perturbations: Delta7 silence, PEG lesion, EPG excitability sweep, unilateral PEN.

**Result, stable across seeds:**

- **No free-running bump anywhere on the grid.** Every bump-sustaining member requires tonic
  EPG bias — the wiring supports the attractor geometry, but the dynamics needs an excitability
  floor. ~15–25% of the grid (recur ≈ 3–6×, tonic ≈ 3–7 mV) sustains a bump at all.
- **Among bump-sustaining members, three mechanisms produce the same baseline bump** and are
  separated by Delta7 silencing:
  - `d7_sculpts` — bump survives silencing; Delta7 sharpens it but isn't required
  - `d7_confines` — silencing releases runaway/uniform firing; Delta7 is what confines the bump
  - `d7_essential` — silencing extinguishes activity (released excitation drives adaptation
    shutdown — flagged as a possible LIF artifact, not a biological claim)
- **Ranked experiments** (consistent top-3, order shuffles across seeds): EPG excitability
  manipulation, PEG lesion, Delta7 silencing. Each maps to a real experiment: depolarize EPGs
  while imaging the ring; kill the PEG copy; silence Delta7 and watch bump width/continuity.

The literature check: real Delta7→EPG is glutamate→GluClα inhibition that suppresses EPGs
*distant* from the bump (the measured antipodal kernel), so `d7_sculpts`/`d7_confines`-style
outcomes are the plausible ones; `d7_essential` is the class real data would rule out — which
is exactly what a discriminating experiment is for.

## Lab 2: the PFN→hDeltaB phasor transform (`scripts/phasor_lab.mjs`)

Same machinery, different circuit — the test of whether the framework is generic or secretly
ring-specific. Geometry is linear FB columns (`_C<n>` tags), not the ring; the observable is a
population centroid offset, not bump persistence.

36 members over `{pfndGain, pfnvGain, hdRecur, hdTonic}`. Drive PFN column C6, measure where the
hDeltaB population responds; structure predicts PFNd −3 / PFNv +2 columns.

**Result:** realised offsets cluster at −1..+1 — **directionally consistent with the wiring but
magnitude-compressed** by dendritic integration. The transform is only partially compiled into
topology; dynamics recovers about a third of the wired shift. hDeltaB response amplitude scales
sub-linearly with PFN drive (×1.3–1.6 per 4× drive — the velocity channel exists but saturates).
Top discriminator: killing hDeltaB recurrence (0.44) — separates "offset compiled into the
projection" from "hDeltaB recurrence generates it."

**Meta-finding across both circuits: structure overstates what dynamics delivers.** Cosine
kernel → realised, phase shift → realised at ~⅓ amplitude, ring attractor → only in a narrow
tonic regime. The structure-to-dynamics gap is itself the calibration signal.

## The engineering benchmark (`scripts/bench_heading.py` + `scripts/ring_pde.py`)

The decompiled estimator vs. standard algorithms on one task: track heading from noisy angular
velocity + sparse landmarks with 15% outliers (±π corruption). `RingField` is an Amari-type
field on S¹ with measured parameters — Delta7 surround kernel (a−b·cos), EPG local recurrence
(the gain wiring doesn't fix), PEN shifted-feedback advection, and landmark anchoring via
ring-neuron-style disinhibition (global suppression with a gap at the landmark bearing).

| estimator | RMS err (rad) | post-outlier |
|---|---|---|
| dead reckoning | 0.679 | 0.633 |
| complementary α=0.35 | 0.701 | 1.143 |
| Kalman 1-D | 1.117 | 1.991 |
| Kalman + outlier gate | 0.489 | 0.710 |
| complementary α=0.05 (matched) | 0.604 | 0.633 |
| ring attractor (scalar reduced) | 0.641 | 0.668 |
| **ring field (PDE, advect mode)** | **0.408** | **0.494** |
| ring field + per-cell noise σ=0.15 | 0.410 | 0.494 |

### The velocity pathway, done properly

The PEN shifted-feedback mechanism was derived rather than hand-tuned. Writing the bump as
u*(θ−φ(t)) and the PEN arm as an extra shifted kernel K in τ∂_t u = −u + W∗f(u) + v·K∗f(u),
projecting the perturbation onto the translation mode u*' (the marginal direction of the
translation-invariant field) gives the integration gain in closed form:

    phi_dot = v · ⟨u*', K∗f(u*)⟩ / (τ ⟨u*', u*'⟩)   →   pen_gain = 1/coef ≈ 0.27

With the literal shifted-synapse kernels at that predicted gain, the field tracks clean
velocity linearly at ~0.85× (the 15% deficit is the second-order correction — the shifted
input also distorts the bump profile, which the leading-order projection ignores). Under
fluctuating velocity, however, the literal mechanism degrades badly: each shifted injection
distorts the bump shape, not just its phase.

**Two-population PEN models discriminated how the real circuit must work.** Three
mechanisms were implemented and benchmarked under identical noisy drive:

| pen_mode | mechanism | noisy RMS |
|---|---|---|
| `shifted` | amplitude coding: om scales shifted-arm injection into EPG | 1.29 |
| `shifted2` | amplitude coding through a second attractor field | 1.61 |
| `shifted3` | **position coding**: om displaces the PEN bump; EPG pulled toward it | **0.60** |
| `advect` | idealized transport of u itself (reduced algorithm) | 0.41 |

Amplitude coding fails under sign-flipping drive regardless of filtering (τ_pen 0.02–0.3
scanned) or of a second field. Position coding — velocity displaces the PEN bump and the
summed shifted projections drag EPG toward it — halves the error and is robust, but
plateaus at ~0.60 because u always chases v with a stage of lag. Direct advection of u
(0.41) is the bound when transport acts on the transported field itself. The ~50% gap
between `shifted3` and `advect` is the price of indirect transport — and position coding
carries a testable neural signature the amplitude models lack: an EPG–PEN phase offset
during rotation, which is what calcium imaging of the fly circuit actually shows.

### Cross-formalism perturbation check (`scripts/perturb_pde.py`)

The same manipulations the LIF lab ranked were run on the field model, so outcomes can be
compared across formalisms. Agreement across model classes is stronger evidence than
agreement across parameters within one class.

**Delta7 suppression, graded (the LIF lab's #1 discriminator).** The field predicts a
monotonic FWHM curve — 99° → 104° → 116° → 138° → 165° as d7_gain goes 1.0 → 0.3 — followed
by dissolution into uniform saturated firing below ~0.2 (R→0, peak rate stays high: the
`confines` endpoint, not silence). This disagrees with the LIF majority class
(`d7_sculpts_sharp`, survives sharp) and refines the minority `confines` class with a
quantitative intermediate curve. The published fly result — Delta7 silencing widens and
destabilizes the bump — sits inside the field model's graded regime. A FWHM measurement
under graded Delta7 suppression now discriminates all three claims at once.

**PEN arm gating.** With only the om>0 arm intact the field integrates +om at ~unity gain
and is indifferent to -om; the converse for the other arm. Arm selectivity is exact —
unilateral PEN silencing should abolish integration in one direction only, matching the
fly result (PEN block → heading no longer follows turns).

**Local excitation sweep.** The bump is bistable above epg_recur ≈ 1.5 and absent below —
the one free gain of the field model has a measured viability threshold, and the observed
bump width (~100° FWHM) is stable across the viable range (94°–107°).

Two honest points:

1. **At the scalar level there is no magic** — a weakly-corrected complementary filter matches
   the reduced ring model. The biological advantage is not a better scalar filter.
2. **The advantage lives in the spatial representation.** A corrupt landmark must *win a
   competition* on the field, not just shift a point estimate — outlier robustness emerges
   without gating logic, and per-cell noise is corrected collectively by the attractor. The PDE
   model beats even the gated Kalman filter post-outlier while carrying no outlier-detection
   machinery at all.

Caveats: tuned to one noise regime; the excitatory gain is a free parameter (the wiring shows
EPG↔EPG/PEG recurrence exists but not its strength); real PEN dynamics are graded neurons, not
pure advection. The claim is "this mechanism class is competitive in this regime," not "the fly
beats Kalman filters."

## What's next

- Third circuit candidate: KC/APL sparse coding under ensemble gains — does the sparse-memory
  hypothesis survive dynamics, or does the code densify?
- Withheld-prediction closure: find the specific measured bump-width change under Delta7
  perturbation in the literature and check which mechanism class it selects.
- Provenance: each lab JSON records params, observables, perturbation outcomes, mechanism
  class, and seed — the inspectable chain from wiring to claim.
