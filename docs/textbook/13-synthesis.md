# Synthesis: What Three Circuits Taught Us

## The meta-finding

Across three circuits, three geometries, and two model formalisms, one result
recurs:

> **Structure systematically overstates what dynamics delivers.**

- The Delta7 cosine kernel fits the wiring at R²=0.99 — and the attractor exists only
  in a narrow tonic regime the wiring does not reveal.
- The PFN→hΔB wiring says "−3 column shift" — the dynamics realise it at ~1/3 amplitude,
  warped by position, and only with recurrent participation.
- The mushroom-body wiring shows the canonical APL normalization loop — and the
  counted synapses cannot carry it.

This is not a counsel of despair — it is a *calibration signal*. The gap between
what structure advertises and what dynamics delivers is exactly the quantity that
tells you where to look next: the missing tonic bias, the missing recurrence, the
missing per-synapse conductance. Each gap is a specific, locatable demand for the
data that would close it.

## What the machinery can do now

The pipeline's demonstrated capabilities, in order of increasing strength:

1. **Ensemble fitting** — wire-constrained model families, classified by behavior.
2. **Mechanism discrimination** — perturbations ranked by how completely they split
   the surviving hypotheses.
3. **Cross-formalism checking** — spiking and field models compared on the same
   perturbation, disagreement recorded.
4. **Withheld-data correction** — published biology used to fix a model, not just to
   validate it.
5. **Honest negative results** — "the wiring underdetermines this mechanism" as a
   first-class output.

## What the connectome cannot determine

The failures are as catalogued as the successes:

- **Per-synapse conductance** — synapse counts are not PSPs. The mushroom-body
  chapter is the case study.
- **Neuromodulatory state** — the dopaminergic/octopaminergic layer is largely
  invisible to a count-based model.
- **Gap junctions** — absent from the EM reconstruction, present in the animal.
- **Temporal dynamics below the synapse-count scale** — delays, time constants,
  adaptation; the LIF carries one set of values where biology carries a distribution.

The right framing: these are not deficiencies of the method — they are the
boundaries of the data, and the pipeline's job is to *locate* them precisely. "APL
gain control needs conductance values" is a more useful scientific output than
either a false positive or silence.

## Open problems, in priority order

1. **Auto-derive the spec axes.** Every unmeasured edge class → a free parameter;
   every substrate population → a perturbation. Removes the last hand-authored step.
2. **A fourth operator with a new geometry.** `motion_correlator` (T4/T5) needs
   synaptic delays; `divisive_normalization` (AL) re-tests the APL question on a
   circuit where the interneuron count is different.
3. **Quantitative withheld validation beyond the Delta7 curve.** The FWHM-vs-
   suppression curve is specific enough to check against imaging data point by
   point.
4. **Merging cross-formalism scores into the ranking itself** — experiment scores
   currently weight only within-LIF disagreement; a unified score would weight
   disagreements that survive both formalisms higher.
5. **The PFN→hΔB loop closed** — the feedback perturbation is a top-3 discriminator;
   the experiment that would resolve it is now known and ranked.

## The claim, restated

The connectome is a compiled artifact — the output of a developmental program that
produced a machine whose description is a wiring diagram. This book documents a
decompiler: a pipeline that reads the diagram, proposes the computations, builds the
model families, and identifies the experiments that decide between them. It works
where it should (the ring attractor is recovered and corrected against real data),
fails where it should (the mushroom body's missing parameter is located precisely),
and reports the difference honestly throughout.

That is what "what have we got" currently means.
