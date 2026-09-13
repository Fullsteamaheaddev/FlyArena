# The Heading Circuit: A Spiking Ensemble

The first operator taken end-to-end is `ring_attractor` — the best-understood
computation in any connectome and therefore the calibration target for the whole
method.

## The circuit

88 cells in five populations:

- **EPG** (46) — the ring population; bump position encodes heading.
- **Delta7** (42) — all-to-all inhibition among EPGs with a cosine profile.
- **PEG** (18) — EPG recurrence onto itself, offset by one column.
- **PEN_a / PEN_b** (20 + 22) — mirror-symmetric shifter populations, each wired to
  EPG with a ±3-column offset; carry the angular-velocity signal.

The measured two-hop EPG→Delta7→EPG kernel fits `a − b·cos(Δθ)` with R²=0.99 and
contrast 0.878 — inhibition minimal at the bump, maximal opposite. Structurally this
is the Amari ring recipe almost verbatim; the question is whether the *dynamics*
deliver what the structure advertises.

## The ensemble

`hypothesis_lab.mjs` sweeps four free axes — EPG recurrent gain, PEN gain, Delta7
gain, and a tonic EPG bias — over 48 members, drives each with a velocity profile
plus a landmark cue, and measures the bump: existence, width, velocity tracking, and
survival under perturbation.

## The finding: a narrow attractor regime

| class | members | meaning |
|---|---|---|
| `silent` | 30 | no sustained bump at any drive |
| `attractor_tonic` | 12 | bump exists — **only with tonic EPG bias ~3–7 mV** |
| `filter` | 6 | activity follows input without self-sustained bump |

Two conclusions the wiring alone could not give:

1. **The attractor is gated.** Free-running bump without tonic drive was not observed
   at *any* grid point — the wiring needs a depolarizing bias to cross into the
   bistable regime. The fly's heading system is a structure that must be switched on,
   not one that is always on.
2. **Delta7's role splits the surviving members.** Among the 12 attractors, silencing
   Delta7 produces three distinct outcomes — bump collapses (`d7_essential`, 3),
   bump survives but *widens* (`d7_confines`, 1), bump survives *sharp*
   (`d7_sculpts_sharp`, 8). Same baseline behavior, different perturbation answers.

## The ranked experiments

Separation scores at seed 42:

| experiment | score | discriminates |
|---|---|---|
| `tonic_sweep` | 0.414 | attractor vs filter vs silent — the regime boundary |
| `peg_lesion` | 0.370 | whether the offset recurrence sustains the bump |
| `d7_silence` | 0.351 | the three Delta7-mechanism classes |
| `unilateral_pen_R` | 0.284 | PEN arm gating (velocity direction) |
| `unilateral_pen_L` | 0.120 | asymmetric — the two PEN arms are not equivalent |

The headline: the ensemble cannot distinguish the Delta7 mechanisms at baseline —
everyone's bump looks the same — but `d7_silence` and `tonic_sweep` split them
completely. That is the discriminating-experiment logic working as designed: the
wiring gives you a family; perturbations tell you which member the fly is.

## What the ensemble could not say

The LIF members classified Delta7's role as either essential or sculpting — none
predicted the *survives-but-widens* outcome that (Chapter 8 will show) the real data
supports. The ensemble is only as good as its mechanisms; the missing one — a second,
non-Delta7 inhibitory channel — was found by the field model and by published
biology, not by more grid points. The ensemble's honest answer was "we don't know,"
expressed as a mechanism split rather than a false consensus.
