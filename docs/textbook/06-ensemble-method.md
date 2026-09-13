# The Ensemble Method: Why the Wiring Gives You a Family, Not a Model

## The underdetermination is specific and enumerable

Here is the basic problem. A connectome tells you the graph: which cells connect, with
how many synapses, and what sign the presynaptic transmitter implies. It does not tell
you:

1. the conductance each synapse produces, meaning the count-to-PSP calibration.
2. the strength or even the existence of gap junctions.
3. the neuromodulatory state, which changes thresholds over seconds.
4. thresholds, adaptation, and resting-potential heterogeneity across cells.
5. synaptic delays and time constants beyond a single global value.

The naive approach is to pick values for all of these, tune them until the model does
something reasonable, and publish the model. The problem with the naive approach is that
the tuning is where the answer gets smuggled in. If you tune the heading circuit until it
holds a bump, you have not learned that the wiring supports a bump. You have learned that
you can make it hold one.

The alternative, which is what the project does, is to construct **the set of models
consistent with the wiring**: an ensemble that spans the free parameters on a grid, with
every member sharing the exact same graph. Then ask which conclusions hold across the
whole family, and where the family splits. This inverts the usual logic. Instead of
fitting one model to data, structure defines the family and you measure agreement.

The disagreement is the product. If two members agree at baseline but disagree about
what happens when population X is silenced, then "silence X" is a *discriminating
experiment*, and you can rank it against every other candidate experiment by how much of
the family it splits.

## The neuron model, and where its numbers come from

Every ensemble member is a network of leaky integrate-and-fire (LIF) neurons over
exactly the circuit's cells. The model follows Shiu et al. 2024: rest −52 mV, threshold
−45 mV, membrane time constant 20 ms, synaptic time constant 5 ms, 0.5 ms steps, 1.8 ms
synaptic delay. Synapses are conductance-based, with excitatory reversal at 0 mV and
inhibitory reversal fitted near −76 mV, because current-based synapses let any neuron
with 150 synapses fire any target and that is not how membranes work.

The global parameters that the whole-brain model of Chapter 14 fitted against published
behaviour are inherited here:

| parameter | searched range | fitted |
|---|---|---|
| synaptic strength per synapse | 0.2 to 1.2 mV | 0.55 mV |
| neuron-size exponent (PSP ∝ (volume / regional median)^−α) | 0 to 1 | 0.61 |
| Kenyon-cell threshold offset | 0 to 30 mV | 10.9 mV |
| inhibitory gain | 0.5 to 5 | 0.61 |
| inhibitory reversal | −85 to −55 mV | −76.4 mV |
| minimum synapses per connection | 3 to 10 | 6 |
| adaptation | 0 to 3 mV | 0 |
| refractory period | 2 to 6 ms | 3.8 ms |

Sign comes from the presynaptic transmitter, and unknown contributes nothing. The
ensemble then scales named *edge classes* (EPG→EPG, Delta7→EPG, and so on) by its free
parameters on top of this base. So a member with `epgRecur = 4` has EPG recurrence at
four times the count-calibrated strength. The base calibration fixes the units. The
ensemble explores the multipliers the wiring leaves open.

## The machinery

Three generic pieces are shared by every circuit lab:

- **A builder.** Given the circuit's cells, its edges, and a set of named parameter
  axes, the builder returns a factory from parameter values to a LIF network. Edge
  classes are specified as `{pre: type or set, post: type or set, param: name}`, and
  tonic bias populations as `{pop, param}`.
- **A seeded random number generator** (mulberry32). Every probe, whether an odour
  pattern, a noise trace, or an initial bump, is reproducible from the seed. Ensemble
  comparisons are only meaningful at fixed randomness, and conclusions are only trusted
  when the *ranking* of experiments survives reseeding, not just the scores.
- **Perturbation helpers**: silencing a population by clamping its threshold, zeroing an
  edge class, scaling a drive.

## The protocol

Every lab follows the same six steps.

1. **Grid.** Sweep the free axes. The ring lab uses
   `epgRecur ∈ {1,3,4,6} × d7Gain ∈ {0.5,1,1.3} × epgTonic ∈ {0,3,5,7} × penGain = 1`,
   which is 48 members. The memory lab uses
   `kc2mb ∈ {0.5,1,2} × aplGain ∈ {0.5,1,2} × mbonTonic ∈ {0,4} × mbRecur = 1`, 18 members.
2. **Probe.** Drive every member with the same stimulus and measure observables that fit
   the circuit's geometry. On a ring that is bump phase, width and persistence. On a
   column map it is centroid offset. On a memory it is pattern separation and gain
   compression.
3. **Classify.** Label each member with a hypothesis class. For the ring: `silent`,
   `attractor_tonic`, `attractor_free`, `filter`, `frozen`. For the shift: `wired_shift`,
   `passthrough`, `silent`. For the memory: `gain_controlled`, `linear_passthrough`,
   `collapsed`, `silent`.
4. **Perturb.** Repeat the probe under each perturbation: silence a population, remove an
   edge class, sweep a drive.
5. **Split.** For each experiment, compute the *separation score*: the fraction of
   member pairs the experiment places in different outcome classes.
6. **Rank.** Order experiments by separation. The top one is where the surviving
   hypotheses disagree most, so it is the measurement most worth making.

The output is a JSON artifact with the seed, the grid, every member's parameters and
outcomes, the class counts, the mechanism counts, the ranked experiment table, and a
one-paragraph claim. The claim for the ring lab reads:

> Wiring supports a low-dimensional heading bump in a narrow gain regime (EPG
> recurrence ~3 to 6×, tonic EPG bias ~3 to 7 mV). Free-running bump without tonic
> drive was not observed at any grid point. Among bump-sustaining models, Delta7
> silencing separates mechanisms that are indistinguishable at baseline.

Notice the grammar. It is a claim about the *ensemble*, not about a model. It reports a
regime, a non-observation, and the experiment that discriminates. That sentence shape is
the deliverable of the whole pipeline.

## What a separation score is

The score is simple to compute and better understood than treated as a black box. For an experiment that sorts 48 members into outcome classes, count the pairs of
members that land in different classes and divide by the total number of pairs. If every
member responds the same way the score is 0. If the members split evenly between two
classes it is 0.5. With three or more balanced classes it can go higher.

The consequence is that a score near 0.5 on a small ensemble is close to the maximum,
and a score near 0.53 in the mushroom-body lab with only two occupied classes
(Chapter 11) is a near-even split, not evidence of a rich mechanism landscape. The
scores are only comparable within one ensemble. `tonic_sweep` scored 0.414 in the ring
lab because members in different mechanism classes answer a tonic-drive sweep with
categorically different bump behaviour. That is what "best discriminator" means: not
the biggest effect, but the most informative outcome about which member you are looking
at.

## What the method cannot do

An ensemble is only as good as the mechanisms it contains. If the family of models
lacks a mechanism the real circuit has, no amount of grid points will find it. The
family will split into classes that are all wrong in the same way, and the ranked
experiment will discriminate between wrong answers. Chapter 9 is a worked example of
this, and of how the missing mechanism was found: not by more members, but by a
second formalism and by published data.
