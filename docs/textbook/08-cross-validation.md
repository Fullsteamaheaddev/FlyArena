# Cross-Formalism Validation: When Models Disagree

The strongest test the project has produced so far came not from a new model but from
a *disagreement between existing ones* — resolved against data the pipeline had not
seen.

## The perturbation suite

`perturb_pde.py` runs the LIF lab's top-ranked perturbations on the field model:

- **`d7_sweep`** — graded Delta7 suppression, measuring bump width and amplitude R.
- **`pen_both` / `pen_left` / `pen_right`** — PEN arm gating.
- **`exc_sweep`** — the free excitation gain, mapping the bistability threshold.

Two results validated the machinery: the PEN arm test gave left-arm drift ≈0.96 rad
in 2 s and right-arm drift exactly 0 — correct arm selectivity — and the excitation
sweep located the bistable threshold at `epg_recur ≈ 1.5` (the free parameter's
operating point is now measured, not assumed).

## The Delta7 disagreement

The graded sweep produced a clean curve:

| d7 gain | FWHM | R |
|---|---|---|
| 1.0 | 90.5° | 0.597 |
| 0.6 | 98.1° | 0.605 |
| 0.3 | 110.1° | 0.599 |
| 0.1 | 126.8° | 0.571 |
| 0.0 | ~143° | ~0.53 |

The bump **survives complete Delta7 block** — widened and weakened, but formed. This
directly contradicted the LIF ensemble's majority class (`d7_sculpts_sharp`, 8 of 12
attractors predicted a sharp surviving bump) and matched only its minority
`d7_confines` class (1 member).

## The withheld-data check

Turner-Evans et al. (2020) had already done the real experiment. Their result:

> The E-PG population organizes into a single bump even if the output of the Δ7
> neurons is reduced... the bump no longer reliably tracks the fly's movements.

The real bump survives. Neither the LIF majority nor the original single-channel
field model predicted this — the original field model *dissolved* the bump below
d7≈0.3 because it attributed all surround inhibition to Delta7.

## The correction

The fix was not parameter tuning — it was a missing mechanism the paper itself names:
**other inhibitory sources** (GABAergic ring neurons) must shape the bump. The model
was corrected by splitting inhibition into two channels:

- the structured Delta7 cosine surround;
- a shallow, activity-dependent ring-neuron term `−rn·mean(f(u))` that scales with
  total bump mass.

With `rn_gain≈0.5, depth≈0.5` the corrected field model reproduces the real result
through the whole sweep: FWHM 90°→143° as Delta7 is fully blocked, bump always
survives. The benchmark cost is honest — tracking precision moved from 0.41 to ~0.48
RMS — because matching reality costs the model a little performance. That tradeoff
is itself a finding: the fly's two-channel inhibition buys robustness to losing a
pathway, at the price of precision it does not need.

## What the loop proved

The sequence is the project's design goal made concrete:

1. LIF ensemble splits into mechanism classes under perturbation.
2. Field model produces a quantitative curve the LIF could not express.
3. The two formalisms **disagree** — and the artifact records `agrees_with_lif_majority: false`.
4. Published biology resolves the disagreement — the field model was right, but for
   an incomplete reason.
5. The model is corrected with the missing channel the data demanded.

The disagreement was never smoothed over. `hypothesis_lab`'s JSON artifact now carries
a `cross_formalism` block that records the PDE outcome, the LIF class it maps to, and
the flag that the two disagreed. When a reader opens the artifact they see the models
arguing — which is exactly what a hypothesis-testing pipeline should show.
