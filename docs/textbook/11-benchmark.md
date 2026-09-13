# The Engineering Benchmark

A biological circuit that computes can be compared, fairly, against the algorithms an
engineer would reach for. `bench_heading.py` does that for heading estimation: noisy
angular-velocity input plus intermittent landmark observations, with occasional
corrupt landmarks — the problem every navigation system solves.

## The estimators

| estimator | what it is |
|---|---|
| dead reckoning | integrate ω; landmarks ignored |
| complementary filter | blend integrated ω and landmark at fixed α |
| Kalman (1-D) | optimal linear estimator, tuned |
| Kalman + gate | same, with an outlier-rejection gate on landmarks |
| ring scalar | the scalar phase-and-population reduction of the attractor |
| **ring field (PDE)** | the full Amari field from Chapter 7 |
| ring field + cell noise | the PDE with per-unit noise, σ=0.15 |

The matched-baseline rule is enforced: the complementary filter is run at the same
effective correction strength as the biological estimator, so a win means something
structural, not a tuned gain.

## Results

| estimator | RMS | post-outlier |
|---|---|---|
| dead reckoning | 0.679 | 0.633 |
| complementary α=0.35 | 0.701 | 1.143 |
| Kalman 1-D | 1.117 | 1.991 |
| **Kalman + gate** | **0.489** | 0.710 |
| complementary α=0.05 | 0.604 | 0.633 |
| ring scalar | 0.641 | 0.668 |
| **ring field (PDE)** | **0.449** | **0.450** |
| ring field + cell noise | 0.453 | 0.455 |

## The honest verdict

Three claims, in increasing order of interest:

1. **At the scalar level the biological estimator is not special.** Matched-strength
   complementary filtering ties the ring scalar (~0.60–0.64 both). The scalar
   algorithm the attractor implements is on the same tradeoff curve as the textbook
   ones.

2. **The advantage is in the spatial representation.** The PDE field beats every
   classical estimator including the gated Kalman — post-outlier 0.450 vs 0.710.
   The mechanism is structural: a corrupt landmark must *win a spatial competition*
   on the field — nucleate a competing bump against antipodal inhibition — rather
   than shift a point estimate. Outlier robustness is free; there is no gating
   logic to tune.

3. **Per-cell noise costs almost nothing.** σ=0.15 field noise degrades the PDE from
   0.449 to 0.453 — the continuous representation is robust to the kind of noise
   that cripples scalar estimators.

## What this does and does not claim

This is **not** "the fly beats the Kalman filter." It is: *in this regime, with
corrupt landmarks, a spatial-competition estimator is a competitive mechanism class* —
and its robustness is architectural, not tuned. That is the correct way to state a
biological engineering result, and it is the phrasing this book uses throughout.
