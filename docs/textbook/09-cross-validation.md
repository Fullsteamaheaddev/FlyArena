# When the Two Models Disagree, and Biology Decides

The strongest test the project has produced did not come from a new model. It came from
a disagreement between two existing ones, resolved against data that the pipeline had
not seen. I think this chapter is the clearest demonstration in the book of why the
method is built the way it is.

## Running the LIF lab's experiments on the field model

The perturbations that the spiking ensemble ranked highest were run on the field model,
so that outcomes could be compared across formalisms:

- `d7_sweep`: graded Delta7 suppression, measuring bump width and amplitude R.
- `pen_both`, `pen_left`, `pen_right`: PEN arm gating.
- `exc_sweep`: the one free excitation gain, to find the bistability threshold.

Two of these validated the machinery cleanly. With only the left PEN arm intact the
field drifts 0.98 rad in 2 s, and with only the right arm it drifts exactly 0. Arm
selectivity is exact: unilateral PEN loss abolishes integration in one direction only,
which matches the fly experiment where PEN block stops the heading from following
turns. And the excitation sweep found the bump absent at `epg_recur` 2.6 and below and
present at 3.0, so the free parameter's operating point is now bracketed rather than
assumed.

## The Delta7 disagreement

The graded sweep produced a smooth curve:

| Delta7 gain | width (FWHM) | R |
|---|---|---|
| 1.0 | 90.5° | 0.597 |
| 0.8 | 94.1° | 0.601 |
| 0.6 | 98.1° | 0.605 |
| 0.4 | 104.6° | 0.605 |
| 0.3 | 110.1° | 0.599 |
| 0.2 | 116.1° | 0.592 |
| 0.1 | 126.8° | 0.571 |
| 0.0 | 143.1° | 0.528 |

The bump *survives* complete Delta7 block, widened from 90° to 143° and weakened, but
formed. In the LIF lab's vocabulary that is `d7_confines`, the minority class with one
member out of twelve. The majority class, eight of twelve, said the bump survives
*sharp*. So the field model and the spiking ensemble disagree, and the artifact records
it: `agrees_with_lif_majority: false`.

## Checking against data the pipeline had not seen

Turner-Evans et al. (2020) had already done the real experiment. Their finding:

> The E-PG population organizes into a single bump even if the output of the Δ7 neurons
> is reduced... the bump no longer reliably tracks the fly's movements.

The real bump survives, and tracks badly. That rules out the LIF majority. But it also
rules out the *first version* of the field model, which I have not mentioned yet. That
version attributed all surround inhibition to Delta7, and below a Delta7 gain of about
0.3 it dissolved the bump entirely. The curve above is from the corrected model.

## The correction was a mechanism, not a parameter

It would have been easy to fix the first field model by turning a knob until the bump
survived. That is not what was done, and the difference matters.

Turner-Evans et al. say, in the same paper, that "other sources of inhibition must act."
The connectome agrees: Chapter 4 lists the GABAergic ring neurons as the strongest
mutual-inhibition population in the brain, with disinhibitory chains onto EPG. So the
model was corrected by splitting inhibition into two channels:

1. the structured Delta7 cosine surround, gated by the Delta7 gain.
2. a shallow ring-neuron term, −rn · mean(f(u)), that scales with total bump mass and
   is *not* gated by Delta7.

With `rn_gain` 0.5 and `rn_depth` 0.5, the corrected model reproduces the real result
across the whole sweep: width rises monotonically from 90° to 143° as Delta7 goes to
zero, and the bump never dissolves.

There is a cost, and it is reported rather than hidden. The single-channel model scored
0.41 rad RMS on the tracking benchmark. The two-channel model scores 0.54 on the current
benchmark (Chapter 12). Matching reality cost the model precision. I think the right
reading of that is biological rather than a modelling failure: two inhibitory channels
buy the fly robustness to losing one of them, at a price in tracking precision that a
fly apparently does not need to pay for.

## What the loop proved

Laid out as a sequence:

1. The LIF ensemble split into mechanism classes under perturbation.
2. The field model produced a quantitative curve the LIF ensemble could not express.
3. The two formalisms disagreed, and the disagreement was written into the artifact
   with a flag.
4. Published biology resolved it. The field model's minority-matching outcome was right,
   but for an incomplete reason.
5. The model was corrected by adding the mechanism the data demanded, and the
   correction's cost was measured.

The refined prediction is now a quantitative width-versus-suppression curve, specific
enough to check against imaging data point by point. And the LIF majority class,
`d7_sculpts_sharp`, is disfavoured by both the corrected field model and the published
experiment.

The general lesson is the one from Chapter 6. An ensemble cannot find a mechanism it
does not contain. What it *can* do is refuse to reach a false consensus, and put its
disagreement in a place where a second formalism and a paper can settle it. The
hypothesis-lab artifact now carries a `cross_formalism` block for each ranked experiment,
with the field-model outcome, the LIF class it maps to, and the agreement flag. When you
open the file, you see the models arguing. That is what a hypothesis-testing pipeline
should look like from the inside.
