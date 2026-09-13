# The Engineering Benchmark: Is the Biological Estimator Any Good?

Once you have decompiled a circuit into an algorithm, you can ask a question that
neuroscience usually cannot: is the algorithm competitive with what an engineer would
have written? This chapter does that for heading estimation, and it tries hard not to
cheat.

## The task

Track heading θ(t) from noisy angular velocity plus intermittent landmark bearings,
where 15% of the landmarks are corrupt (offset by π). Every navigation system solves a
version of this. The ground truth is 60 seconds of Ornstein-Uhlenbeck angular velocity
with saccade-like jumps, at 50 ms steps, with landmark observations every 2 s. All
estimators see identical inputs. 60 trials, seeded, so the numbers below reproduce
exactly.

## The estimators

| estimator | what it is | state |
|---|---|---|
| dead reckoning | integrate ω, ignore landmarks | 1 float |
| complementary filter, α = 0.35 | integrate ω, correct toward landmark at fixed gain | 1 float |
| complementary filter, α = 0.05 | same, at the correction strength matched to the ring model | 1 float |
| Kalman, 1-D | constant-velocity Kalman filter on the wrapped angle, tuned | 2 floats |
| Kalman with gate | same, with Mahalanobis outlier rejection of landmarks | 2 floats |
| ring, scalar | the reduced ring attractor: PEN-drive integration plus a bounded landmark snap, as an 8-wedge population code | 1 phase |
| ring field | the full Amari field of Chapter 8, two-channel inhibition, advection velocity mode | 256 units |
| ring field with cell noise | the same field with per-unit noise σ = 0.15 | 256 units |

The matched-baseline rule is the one I would ask readers to check. The α = 0.05
complementary filter exists so that the scalar ring model is compared with a classical
filter applying the same effective correction strength. Without that row, a "win" for
the ring could just be a gain choice.

## Results

Numbers are RMS wrapped error in radians over 60 trials, with the standard deviation
across trials, and the RMS error in the 5 seconds after a corrupt landmark:

| estimator | RMS | ± sd | post-outlier |
|---|---|---|---|
| dead reckoning | 0.661 | 0.285 | 0.589 |
| complementary, α = 0.35 | 0.724 | 0.196 | 1.176 |
| Kalman, 1-D | 1.159 | 0.263 | 2.044 |
| Kalman with gate | 0.546 | 0.418 | 0.784 |
| complementary, α = 0.05 | 0.622 | 0.211 | 0.630 |
| ring, scalar | 0.653 | 0.228 | 0.650 |
| ring field | 0.538 | 0.434 | 0.612 |
| ring field with cell noise | 0.521 | 0.391 | 0.588 |

These are the numbers for the corrected two-channel field model. The earlier
single-channel version scored 0.41 on this task, and the version of this table in an
earlier draft of the book showed 0.449. Matching the Delta7-block data in Chapter 9
cost about 0.1 rad. That cost is part of the result and I would rather report it than
quote the older, better-looking number.

## What the table says, in order of how much I believe it

**At the scalar level there is nothing special.** The reduced ring model (0.653) and
the matched complementary filter (0.622) are a tie within noise. The scalar algorithm
the attractor implements sits on the same trade-off curve as the textbook filters. If
you reduce the fly's heading circuit to a single phase variable, you have reinvented a
complementary filter.

**Clean tracking: the field ties the gated Kalman filter.** 0.538 against 0.546, with
standard deviations of 0.4 on both. I would not claim a win here and the table does not
support one.

**After a corrupt landmark, the field recovers better.** 0.612 against 0.784 for the
gated Kalman filter, and against 2.044 for the ungated one. The mechanism is
structural. A corrupt landmark cannot simply shift a point estimate. It has to
nucleate a competing bump on the field and win a spatial competition against the
antipodal inhibition, which a single bad observation usually cannot do. The outlier
robustness comes for free, with no gating logic and no threshold to tune. This is the
claim I think the benchmark genuinely supports.

**Per-cell noise costs nothing, and here slightly helps.** With σ = 0.15 per-unit noise
the field scores 0.521 rather than 0.538. The population representation averages
independent noise across units, which is the thing a scalar estimator cannot do. I
would treat the improvement as within noise and the absence of a penalty as the
finding.

## What this does and does not claim

This is not "the fly beats the Kalman filter." The honest statement is narrower: in
this regime, with corrupt landmarks, a spatial-competition estimator is a competitive
mechanism class, and its robustness is architectural rather than tuned.

The caveats are real. The benchmark is tuned to one noise regime. The excitatory gain
of the field is a free parameter, because the wiring shows EPG↔EPG and PEG recurrence
exist but not their strength. Real PEN neurons are graded, not the idealised advection
the best-scoring mode uses, and Chapter 8 showed that the more realistic position-coded
mechanism sits about 50% above the advection bound. Put those together and the
biological circuit, modelled faithfully, probably lands closer to the gated Kalman
filter on clean tracking while keeping its advantage after outliers. That is still an
interesting engineering result. It is just not a dramatic one, and the book should not
make it sound like one.
