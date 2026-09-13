# The Operator Layer: A BioISA

`operators.py` scans the IR's structural report and emits the project's central
artifact: a catalogue of candidate **computational operators** — the BioISA, in the
project's metaphor, an instruction set the nervous system appears to implement. Each
entry carries a substrate (which cell types), a signature (what wiring pattern
triggered the detection), semantics (input/state/output), evidence and
counterevidence, and a confidence score.

The twelve detected operators:

| operator | region | confidence | substrate / signature |
|---|---|---|---|
| `ring_attractor` | central complex | 0.70 | EPG, Delta7, PEG, PEN (88 cells); columnar ring + 2-hop inhibitory kernel ∝ 1−cos θ + mirror-symmetric shifter |
| `winner_take_all` | motif | 0.60 | reciprocal-inhibition type pairs |
| `phasor_vector_shift` | central complex | 0.55 | PFN→hΔB; consistent −3/+2 column offsets |
| `motion_correlator` | optic lobe | 0.55 | T4/T5 dendritic input arms; Reichardt-style spatial pairing |
| `convolution_front_end` | optic lobe | 0.55 | columnar weight-sharing across 40+ types |
| `sparse_associative_memory` | mushroom body | 0.55 | 4,064 KCs, ~6× expansion, APL feedback, DAN→MBON teaching |
| `feedforward_inhibition` | motif | 0.55 | signed reciprocal pairs |
| `divisive_normalization` | antennal lobe | 0.50 | local interneuron feedback over PN pool |
| `command_funnel` | descending | 0.30 | extreme fan-in onto DNs |
| (plus low-confidence / generic re-detections of the same motifs) | | 0–0.25 | |

## What a detection means — and does not

A detection is a *signature match*, not a function claim. `ring_attractor` scores 0.70
because its signature is unusually specific: a columnar population whose
two-hop inhibitory kernel fits a cosine at R²=0.99, plus a mirror-symmetric pair of
shifted feedback populations. That combination essentially only means "continuous
attractor with velocity input." `command_funnel` scores 0.30 because "lots of fan-in"
is consistent with many computations.

Every entry also records **counterevidence** and **predictions** — the detector is
required to say what would prove it wrong. The mushroom-body entry, for example,
predicts that KCs should be sparse and decorrelated and that APL should implement
gain control; Chapter 10 shows what happened when that prediction was tested.

## Signatures vs semantics

The catalogue maintains a deliberate split:

- **Signature** — what the wiring looks like (a cosine kernel, a column offset, an
  expansion ratio). Structural, measurable, reproducible.
- **Semantics** — what the circuit computes (a heading phase, a rotated vector, an
  odor identity). A hypothesis to be established dynamically.

`topology_folded` flags cases where the graph-theoretic form hides a geometric one —
e.g., the ring attractor's recurrent connections are *not* folded: the ring is a real
ring in the wiring, not an artifact of the ordering.

## From operator to experiment

Each operator entry is the input to the pipeline's executable stage: the substrate
names the populations to instantiate, the free quantities (gains the wiring doesn't
fix) become ensemble axes, and the counterevidence predictions become perturbations.
Chapters 6–10 trace three operators end to end; Chapter 12 describes the machinery
that makes a fourth operator a matter of writing a spec entry rather than a new
script.
