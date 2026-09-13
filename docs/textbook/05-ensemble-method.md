# The Ensemble Method

## Why ensembles

A connectome underdetermines a model in a specific, enumerable way. The wiring tells
you the graph — which cells connect, how many synapses, what sign the transmitter
implies. It does not tell you:

- the conductance each synapse produces (the count→PSP calibration);
- the strength of gap junctions (invisible in the EM data);
- neuromodulatory state;
- threshold, adaptation, and resting-potential heterogeneity.

So the honest object to construct is not *a* model but **the set of models consistent
with the wiring** — an ensemble spanning the free parameters — and then to ask which
conclusions survive across it. This inverts the usual logic of simulation: instead of
tuning one model to fit data, we let structure define a family and measure where the
family's members agree and where they diverge.

The divergence is the product. If two ensemble members agree on baseline behavior but
disagree about what happens when population X is silenced, then "silence X" is a
*discriminating experiment* — and it can be ranked against all others by how much it
splits the ensemble.

## The machinery

`lif_ensemble.mjs` provides the substrate:

- **`makeBuilder(D, edges, axes)`** returns a factory: parameter values → a LIF
  network over exactly the circuit's cells, with named edge classes scaled by the
  free parameters.
- **`run(net, ms)`** advances the event-driven simulation.
- **`seedRng(seed)`** makes every probe (odor patterns, noise, initial conditions)
  reproducible — ensemble comparisons are only meaningful at fixed randomness.

The LIF model itself (`src/lif.js`) is calibrated on published PSP sizes (Shiu et al.
2024): synaptic weights are count-scaled PSPs, sign comes from the presynaptic
transmitter (GABA/glutamate inhibitory, acetylcholine and modulators excitatory,
**unknown contributes nothing**), and a conductance-based option (`coba`) is
available where reversal potentials matter.

## The protocol

Each lab follows the same six-step loop:

1. **Grid** — the free axes are swept (e.g., `{epgGain × penGain × d7Gain × epgTonic}`
   = 48 members; `{kc2mb × aplGain × mbonTonic × mbRecur}` = 18 members).
2. **Probe** — each member is driven and measured with geometry-appropriate
   observables (bump phase/width on a ring; offset column vectors on a linear map;
   pattern separation and compression on a memory).
3. **Classify** — members are labeled by behavior class (`silent`, `attractor_tonic`,
   `filter`; `wired_shift`, `passthrough`; `gain_controlled`, `linear_passthrough`,
   `collapsed`).
4. **Perturb** — the same probe is repeated under each perturbation (silence a
   population, remove an edge class, scale a drive).
5. **Split** — for each experiment, the *separation score* counts how many member
   pairs it places in different outcome classes.
6. **Rank** — experiments are ordered by separation; the top experiment is the one
   where the surviving hypotheses diverge most.

The output is a JSON artifact: hypothesis counts, mechanism counts, the ranked
experiment table, and a prose claim — e.g.:

> Wiring supports a low-dimensional heading bump in a narrow gain regime (EPG
> recurrence ~3–6×, tonic EPG bias ~3–7 mV). Free-running bump without tonic drive
> was not observed at any grid point. Among bump-sustaining models, Delta7 silencing
> separates mechanisms that are indistinguishable at baseline.

Note the grammar of that claim: it is about the *ensemble*, not a model — it reports
a regime, a non-observation, and the experiment that discriminates. That phrasing is
the pipeline's deliverable.

## What the scores mean

Separation is an information-theoretic quantity wearing simple clothes: for an
experiment that sorts 48 members into outcome classes, the score is high when the
class assignment is informative about which member produced it. `tonic_sweep` scored
0.414 — the best discriminator in the ring lab — because members in different
mechanism classes answer the sweep with categorically different bump behavior.

The same machinery runs across seeds; conclusions are only trusted when the *ranking*
— not just the scores — survives reseeding.
