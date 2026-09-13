# Synthesis: What We Have Got

## The result that keeps recurring

Across three circuits, three observable geometries, two model formalisms and one
whole-brain embodied run, the same thing happens:

> **Structure systematically overstates what dynamics delivers.**

- The Delta7 kernel fits the wiring at R² 0.99 and the realised inhibition at R² 0.56.
  The attractor it belongs to exists only with a tonic bias of 3 to 7 mV that the wiring
  says nothing about.
- The PFN→hΔB wiring says "shift by 3 columns." The dynamics realise a smaller, warped
  shift, and only when recurrence and feedback participate. Zero of thirteen shifted
  members do it from the projection alone.
- The mushroom-body wiring shows the canonical APL normalisation loop with 100%
  coverage. At count-calibrated weights the loop sparsens but cannot divide.
- The whole nerve cord, wired as reconstructed, cannot hold posture. The escape
  discriminator has no margin. The octopamine broadcast pushes behaviour the wrong way.

I want to argue that this is a calibration signal, not a counsel of despair. The gap
between what structure advertises and what dynamics delivers is precisely the quantity
that tells you where to look next: the missing tonic bias, the missing recurrence gain,
the missing per-synapse conductance, the missing electrical synapse, the missing
reafference gain. Each gap is a specific, locatable demand for data. And each was found
by a method that could have hidden it with a tuned parameter and chose not to.

## What the machinery can do now

In order of increasing strength:

1. **Structural analysis that transfers across species.** The same passes run on the
   worm and the fly and produce comparable numbers, including a found-not-annotated
   identification of each animal's dominant dynamical mode.
2. **Ensemble fitting.** Wire-constrained model families, classified by behaviour, with
   the free axes and their reasons written into a spec.
3. **Mechanism discrimination.** Perturbations ranked by how completely they split the
   surviving hypotheses, stable across seeds.
4. **Cross-formalism checking.** Spiking and field models compared on the same
   perturbation, with disagreement recorded in the artifact.
5. **Correction against withheld data.** Published biology used to fix a model's
   mechanism, not just to validate it, with the cost of the fix measured.
6. **Negative results as a first-class output.** "The wiring underdetermines this
   mechanism" reported as a missing hypothesis class, with the missing measurement named.
7. **Embodied validation.** The whole graph run in a body against published behaviour,
   with a written boundary between what the wiring supports and what was supplied.

## What the connectome cannot determine

The failures are catalogued as carefully as the successes, and they come in two kinds.

**Missing from the data:**

- **Per-synapse conductance.** Synapse counts are not PSPs, and the counts are nearly
  incompressible given everything else in the graph, so nothing else predicts them.
  Chapter 11 is the case study.
- **Gap junctions.** Absent from the reconstruction, present in the animal, decisive
  for the escape jump.
- **Neuromodulatory receptors.** Which cells carry which receptor for octopamine,
  dopamine or serotonin is not in the file, so a modulatory broadcast has to treat all
  12,851 targets alike.
- **Time constants, delays, adaptation, and their heterogeneity.** The models carry one
  value each where biology carries a distribution.
- **Connections under three synapses**, and any synapse the reconstruction missed.

**Missing from the method, so far:**

- **Mechanisms the ensemble does not contain.** Chapter 9 shows the failure mode and
  the fix. It does not show a general way to know when a mechanism is missing.
- **Circuits with no geometry plugin.** The motion correlator needs delays. The
  antennal lobe needs a plugin that expresses glomerular identity.
- **Behaviour that lives in dynamics the LIF model does not have.** Bout structure,
  central pattern generation, and state-dependent gain are all things the animal does
  with cells the connectome contains, and the model does not reproduce them from the
  wiring. Whether that is a missing parameter or a missing mechanism is not yet known.

The right framing is that these are the boundaries of the data and the current
method, and that the pipeline's job is to *locate* them precisely. "APL gain control
needs conductance values" and "the loom chain's weak link is upstream of octopamine
gain" are more useful outputs than either a false positive or silence.

## Open problems, in the order I would do them

1. **Derive the spec axes automatically.** Every unmeasured edge class becomes a free
   parameter, every substrate population becomes a perturbation. This removes the last
   hand-authored step in the compiler.
2. **A fourth operator with a new geometry.** The T4/T5 motion correlator needs
   synaptic delays. Antennal-lobe divisive normalisation re-asks the APL question on a
   circuit with hundreds of interneurons instead of two.
3. **Pathway-specific fitting of the escape chain.** LC4, LPLC2, giant fibre, DNp02 and
   DNp04 against loom data, the way flyvis was fitted for the optic lobe. It is the
   clearest weak link in the embodied model.
4. **Quantitative withheld validation beyond the Delta7 curve.** The width-versus-
   suppression curve is specific enough to check against imaging data point by point.
5. **Fold cross-formalism agreement into the experiment ranking.** Experiment scores
   currently weight only within-LIF disagreement. A disagreement that survives both
   formalisms should rank higher.
6. **Close the PFN→hΔB loop.** The feedback perturbation is a top-three discriminator
   and the experiment is known.
7. **A third species.** The MICrONS cortical volume has connectivity plus measured
   activity, which would make every detected operator falsifiable against real
   responses rather than against the literature.
8. **Bout structure and dopamine gating from circuits rather than rules.** The
   whole-brain model's largest remaining piece of non-connectome code.

## The claim, restated

The connectome is a compiled artifact: the output of a developmental program that built
a machine whose description is a wiring diagram. This book documents a decompiler. It
reads the diagram, proposes the computations, builds the model families the diagram
permits, and identifies the experiments that decide between them. It also runs the
whole diagram in a body to see which behaviours fall out.

It works where it should: the ring attractor is recovered, its mechanism is derived, and
its model is corrected against real data. It fails where it should: the mushroom body's
missing parameter and the nerve cord's missing rhythm are located rather than papered
over. And it reports the difference throughout, which is the only property of a method
like this that I would insist on.
