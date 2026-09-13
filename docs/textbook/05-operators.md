# The Operator Layer: An Instruction Set for a Brain

## From signatures to a catalogue

Chapters 3 and 4 produced a long list of structural facts. The operator layer compresses
that list into something you can actually reason about: a catalogue of candidate
**computational operators**, which the project calls a BioISA, by analogy with an
instruction set architecture. The idea is that a nervous system, like a processor, has a
small vocabulary of primitives that it composes, and the vocabulary is what you want to
extract.

Each catalogue entry has the same shape:

- a **substrate**: which cell types, and how many cells.
- a **signature**: the wiring pattern that triggered the detection.
- **semantics**: what it takes in, what state it holds, what it puts out.
- a **conventional equivalent**: the nearest thing in an engineering textbook.
- a **reduced model**: a few lines of pseudocode.
- **evidence** items with weights, **counterevidence**, and **predictions**.
- a **confidence** score.

The scanner reads the structural report and emits twelve entries. Nine are distinct:

| operator | region | confidence | substrate and signature |
|---|---|---|---|
| `ring_attractor` | central complex | 0.70 | EPG, Delta7, PEG, PEN (88 cells); columnar ring, two-hop inhibitory kernel ∝ 1 − cos θ, mirror-symmetric shifter |
| `winner_take_all` | motif, many regions | 0.60 | 6,375 I↔I reciprocal type pairs, z = 416 against the null |
| `phasor_vector_shift` | central complex | 0.55 | PFN→hΔB with −3 / +2 column offsets; hΔB fans out at +4/+5 columns to 13 target types |
| `motion_correlator` | optic lobe | 0.55 | T4/T5 subtypes with identical input composition (cosine 0.94) and spatial offsets; ON/OFF split |
| `convolution_front_end` | optic lobe | 0.55 | 47 columnar types, fixed partner counts, weight CV 0.19 to 0.47 |
| `sparse_associative_memory` | mushroom body | 0.55 | 5.9× expansion, near-random sampling, APL feedback covering 100%, DAN→KC ≫ DAN→MBON |
| `feedforward_inhibition` | motif | 0.55 | 80% of strong E edges have a parallel I path, z = 297 |
| `divisive_normalization` | antennal lobe, mushroom body | 0.50 | 30 candidate cells whose main input population equals their main output population |
| `command_funnel` | descending | 0.30 | 1,314 DNs carrying 3.7% of brain output; AN→DN loop as heavy as DN output |

The remaining three entries are low-confidence re-detections of the same motifs at
other thresholds (0.25, 0.25, and a 0.0 ring-attractor candidate that fails its own
checks). They are kept because the catalogue should show what the detector *almost*
fired on, not just what it accepted.

## What a detection means, and what it does not

I want to be careful here, because "the connectome contains a ring attractor" is the kind
of sentence that gets repeated without its qualifier.

A detection is a *signature match*. It is not a claim that the circuit computes anything.
`ring_attractor` scores 0.70 because its signature is unusually specific: a columnar
population whose two-hop inhibitory kernel fits a cosine at R² 0.99 (weight 0.35), with
contrast 0.878 (weight 0.15), a mirror-symmetric shifter at L +1.47 and R −1.45 columns
(weight 0.2), plus two dynamical checks from the whole-brain model that the kernel and
the push field are realised (0.15 each). There are not many things a circuit with that
wiring could be other than a continuous attractor with velocity input.

`command_funnel` scores 0.30 because "a lot of fan-in onto a small population" is
consistent with many computations, and the catalogue says so in its counterevidence
field: the funnel count mixes cell types with very different functions, so it may be a
bottleneck of bandwidth rather than of decisions.

The scores are hand-weighted sums of evidence items, and the weights are judgment calls.
I would not defend 0.55 versus 0.60 as meaningful. I would defend the ordering, and I
would defend the requirement that every entry lists what would prove it wrong.

## Every entry has to say what would falsify it

This is the part of the catalogue I think is most valuable, so here are the predictions
as written:

- **feedforward_inhibition**: blocking the inhibitory arm should broaden the temporal
  tuning of the target. Reduced model: `y = x[t] − g·x[t−1]`.
- **winner_take_all**: strong simultaneous drive to both sides should produce
  bistability or oscillation rather than a compromise. Reduced model: `a −= g·b; b −= g·a`.
- **convolution_front_end**: a feature learned at one eccentricity should transfer to
  every eccentricity. Counterevidence already recorded: some pairs have CV near 0.36, so
  it is not a perfect convolution.
- **sparse_associative_memory**: Kenyon cells should be sparse and decorrelated, and APL
  should implement gain control. Conventional equivalent: locality-sensitive hashing plus
  a linear readout, trained by a three-factor Hebbian rule rather than backpropagation.
  Chapter 11 is what happened when the gain-control half of that prediction was tested.
- **command_funnel**: silencing a single DN type should remove a specific motor program.
  Chapter 14 does this for several.
- **ring_attractor**: silencing Delta7 should change bump width, and unilateral PEN
  silencing should abolish integration in one direction only. Chapters 7 to 9.

## Signature versus semantics

The catalogue keeps two things apart on purpose:

- The **signature** is what the wiring looks like: a cosine kernel, a column offset, an
  expansion ratio. It is structural, measurable, and reproducible from the graph.
- The **semantics** is what the circuit computes: a heading phase, a rotated vector, an
  odour identity. It is a hypothesis, to be established dynamically.

There is also a `topology_folded` flag for cases where the graph-theoretic form hides a
geometric one. The ring attractor is *not* folded: the ring is a real ring in the wiring.
The convolution front end and the phasor shift *are* folded: the graph alone does not
show a lattice or a column axis, and you need the positional labels from the instance
names to see them.

## From an operator to an experiment

Each catalogue entry is the input to the executable stage, and the mapping is mechanical
enough to describe in one paragraph. The substrate names the populations to instantiate.
The free quantities, the gains that the wiring does not fix, become the axes of an
ensemble. The predictions and counterevidence become the perturbations. Chapters 7 to 11
follow three operators through that process by hand, and Chapter 13 describes the
machinery that makes a fourth operator a matter of writing a spec entry rather than a new
script.
