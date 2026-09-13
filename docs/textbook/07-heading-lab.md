# The Heading Circuit as a Spiking Ensemble

The first operator to go end-to-end is `ring_attractor`. It is the best-understood
computation in any connectome, which is why it goes first: if the method cannot
recover a known answer, its answers elsewhere are worthless.

## The circuit

88 cells in five populations:

- **EPG** (46 cells): the ring population. Bump position encodes heading.
- **Delta7** (42): the inhibitory surround. Each reads a median 32 EPGs and writes onto
  8, and the two-hop EPG→Delta7→EPG kernel is the cosine from Chapter 4.
- **PEG** (18): a copy population, reciprocally wired with EPG in the same column.
- **PEN_a and PEN_b** (20 and 22): the shifter. EPG→PEN goes one column ahead, PEN→EPG
  returns one to two columns behind, and the net push resolves to about +1.5 columns for
  left-hemisphere PENs and −1.5 for right. They carry the angular-velocity signal.

Structurally this is the Amari ring recipe almost verbatim: local excitation, a cosine
surround, and a mirror-symmetric shifter. The kernel fits a − b·cos at R² 0.99 with
contrast 0.878. The question is whether the dynamics deliver what the structure
advertises.

## The ensemble

Four free axes, 48 members:

| axis | what it scales | why it is free | grid |
|---|---|---|---|
| `epgRecur` | EPG→EPG | recurrence gain is not fixed by synapse counts | 1, 3, 4, 6 |
| `d7Gain` | Delta7→EPG | Delta7 inhibition is glutamatergic via GluClα; effective strength uncertain | 0.5, 1.0, 1.3 |
| `epgTonic` | tonic EPG bias (mV) | resting excitability is unknown | 0, 3, 5, 7 |
| `penGain` | PEN→EPG | shifted-feedback gain | 1 |

Each member is given a seeded bump, released, and measured for persistence
(concentration and full width at half maximum), for the realised Delta7 kernel, and for
bump rotation under unilateral PEN drive. Perturbations: silence Delta7, lesion PEG,
sweep EPG tonic excitability, drive one PEN arm.

## Finding one: the attractor exists, but only in a corner of the grid

| class | members | meaning |
|---|---|---|
| `silent` | 30 | no sustained bump at any drive |
| `attractor_tonic` | 12 | bump persists, but only with tonic EPG bias of 3 to 7 mV |
| `filter` | 6 | activity follows the input, no self-sustained bump |
| `attractor_free` | 0 | bump persists with no tonic drive |

That last row is the one to look at. A free-running bump, the thing the textbook picture
of a ring attractor promises, was not observed at *any* grid point. Every bump-sustaining
member needs a depolarising bias to cross into the bistable regime, and the viable region
is recurrence 3 to 6× count-calibrated strength with 3 to 7 mV of tonic bias, roughly 15
to 25% of the grid.

So the wiring supports the attractor's geometry, but the dynamics need an excitability
floor the wiring does not provide. The fly's heading system, on this evidence, is
something that must be switched on rather than something that is always on. That is
consistent with the whole-brain model, where the calibrated LIF also fails to sustain a
free bump without external drive (Chapter 4).

## Finding two: Delta7's role splits the survivors

Among the 12 attractors, silencing Delta7 gives three different outcomes:

| mechanism class | members | what silencing Delta7 does |
|---|---|---|
| `d7_sculpts_sharp` | 8 | bump survives and stays sharp; Delta7 sharpens but is not required |
| `d7_essential` | 3 | activity extinguishes |
| `d7_confines` | 1 | bump survives but widens |

All twelve look the same at baseline. You cannot tell them apart by imaging a fly that
is walking normally. You can tell them apart by one perturbation. This is the
discriminating-experiment logic doing what it was built for.

One caveat that the artifact carries and I want to repeat: the `d7_essential` outcome,
where released excitation drives an adaptation shutdown, is flagged as a possible LIF
artifact rather than a biological prediction. The literature also argues against it.
Real Delta7→EPG inhibition is glutamate acting on GluClα and suppresses EPGs *far from*
the bump, which is the antipodal kernel we measured, so the sculpting and confining
outcomes are the plausible ones. That makes `d7_essential` the class real data should
rule out, which is what a discriminating experiment is for.

## The ranked experiments

Separation scores at seed 42:

| experiment | score | what it discriminates |
|---|---|---|
| `tonic_sweep` | 0.414 | attractor versus filter versus silent: the regime boundary |
| `peg_lesion` | 0.370 | whether the PEG copy pathway is load-bearing |
| `d7_silence` | 0.351 | the three Delta7 mechanism classes |
| `unilateral_pen_R` | 0.284 | PEN arm gating, velocity direction |
| `unilateral_pen_L` | 0.120 | the two PEN arms are not equivalent |

The top three are stable across seeds, though their order shuffles. Each maps to a real
experiment: depolarise EPGs while imaging the ring, kill the PEG copy, silence Delta7
and watch bump width. The asymmetry between the two PEN arms in the last two rows is
real in the wiring (the left-through-PEN loop weight ratio is 1.7:1 and the right 1.3:1)
and the ensemble picks it up.

## The generic runner reproduces this

When the same circuit was later run through the declarative spec machinery of Chapter
13 instead of the hand-written lab, seed 42 gave 30 silent, 11 attractor-tonic and 7
filter members against the lab's 30, 12 and 6, with the same best experiment
(`tonic_sweep`, separation 0.393 versus 0.414) and the same top-three set. One member
moved across a class boundary. I mention the discrepancy because it is the size
of discrepancy you should expect when two implementations share a graph but not a code
path, and because "the compiler reproduces the lab" should mean this and not something
vaguer.

## What the ensemble could not say

Here is the honest limit. The LIF members classified Delta7 as either essential or
sculpting. Eight of twelve said the bump survives silencing *sharp*. Only one said it
survives *widened*, and Chapter 9 will show that the widened outcome is the one the
published data supports.

The ensemble did not fail, exactly. It reported a split rather than a false consensus,
and its minority class was right. But its majority was wrong, and the reason is the
limit stated in Chapter 6: the family only contained one inhibitory channel. The missing
mechanism, a second inhibitory source that is not Delta7, was found by the field model
and by the literature, not by more grid points.
