# The Data, and the Intermediate Representation

## What the object actually is

Before talking about what the connectome computes let me be very concrete about
what it *is*, because a lot of the later conclusions come down to properties of the data
structure.

The analysis runs on the male *Drosophila* CNS connectome, version 1.0. As a graph it is:

| quantity | value |
|---|---|
| neurons | 165,122 |
| connections (3 or more synapses) | 10,511,038 |
| synapses | 104,213,652 |
| cell types | 11,752 |
| per-connection synapse count range | 3 to 2,591 |

Each neuron carries a type label, a hemisphere, a superclass, a predicted
neurotransmitter, and a volume. Each connection carries a synapse count. That is it. Notice
how little annotation this is relative to the raw data: the
neurotransmitter predictions come from a 2.7 GB table of per-synapse probabilities, and
the neuron volumes come from a 4.3 GB neuron table that is otherwise unused. Only a
handful of scalars per neuron turned out to be load-bearing.

Three properties of the data drive everything downstream.

**Edges carry synapse counts, not strengths.** A weight of 25 means "25 synaptic contacts
were reconstructed between these two cells." It does not mean "this connection moves the
postsynaptic potential by 25 of anything." The mapping from count to conductance is an
assumption, and it turns out to be the single most consequential assumption in the whole
pipeline. Chapter 11 is essentially a case study of it failing informatively. There is
also a nice information-theoretic hint about this: when the graph is compressed for the
browser, the synapse counts cost 4.04 bits each on their own and 3.95 bits with the best
context model found. In other words, knowing everything else about the graph tells you
almost nothing about a connection's count. Counts carry information the rest of the
structure does not predict.

**Signs are predictions, and some are graded.** Each synapse's effect sign comes from the
presynaptic cell's predicted transmitter: acetylcholine excitatory, GABA and glutamate
inhibitory, histamine inhibitory, monoamines treated as modulatory. For 3,602 neurons
there is no consensus call, and rather than guess, their sign is taken as a graded value,
P(ACh plus monoamines) minus P(GABA plus glutamate plus histamine), from the per-synapse
predictions. Only 0.5% of synaptic weight ends up unsigned. A cell whose transmitter is
unknown contributes nothing in the dynamical models. This sounds like a small technical
choice and it is not: an early version that treated unknown as excitatory spread odour
activity to every glomerulus in the antennal lobe.

**Types are fine-grained and structured.** Labels like `KCg-m`, `MBON01` to `MBON35`,
`PPL103`, `PEN_a`, `EPG` let you select populations by pattern. Instance names go
further: `EPG(PB08)_L4` encodes a protocerebral-bridge glomerulus and a side,
`hDeltaB_08_C7` encodes a fan-shaped-body column, `ORN_DA1` encodes a glomerulus. The
central-complex analysis in Chapters 7 to 10 is only possible because these positional
labels exist. Keep this in mind when thinking about other datasets: the compiler
needs geometry, and here the geometry arrives through the naming scheme.

## What the graph leaves out

Just as important is what is *not* in the file:

- **Gap junctions.** Electrical synapses are invisible in this EM reconstruction. The
  one that turned out to matter for behaviour, giant fibre to the jump motor neuron
  TTMn, had to be added by hand in the whole-brain model (Chapter 14).
- **Connections under 3 synapses.** They were dropped when the graph was packed. The
  motif census uses 3 per target neuron. The whole-brain model, after calibration, uses
  connections of 6 or more.
- **Anything about strength, time constants, adaptation, or neuromodulatory state.**
  Chapter 6 enumerates these because they become the axes of the ensembles.
- **Locality is real, though.** When the neurons were renumbered by cell type and then
  by the 3D position of their skeleton centroid, the entropy of "which neuron does this
  one connect to" fell from 11.8 bits to 8.2 bits per connection, and 28% of a neuron's
  targets also appeared in the target list of the neuron numbered just before it. Type
  and position predict roughly 3.6 bits of each connection. That is the stereotypy that
  makes the type-level analyses in Chapter 3 meaningful.

## The intermediate representation

Everything that follows runs on a species-agnostic IR rather than on the fly's native
tables. The IR is deliberately small:

| field | meaning |
|---|---|
| `names`, `types`, `scn`, `cln` | cell name, cell type (bilateral homologues share one), superclass, class |
| `side` | 1 left, 2 right, 3 midline, 0 unknown |
| `sign` | +1 excitatory, −1 inhibitory, 0 unknown or modulatory |
| `sensory`, `motor` | pins for the flow-depth computation (sensors 0, outputs 1) |
| `indptr`, `indices`, `weights` | the chemical graph in CSR form, weight = synapse count |
| `gap_indptr`, `gap_indices`, `gap_weights` | the electrical graph, symmetric, empty where absent |
| `meta` | provenance, sign convention, per-dataset thresholds |

Two loaders exist. `load_fly()` reads the packed male-CNS tables and was checked to
reproduce every generic number in the fly's own structural report exactly. `load_worm()`
reads the Cook et al. 2019 adult hermaphrodite *C. elegans* connectome from the
Netzschleuder CSV dumps, assigns signs from the OpenWorm cell table (acetylcholine +1,
GABA and glutamate −1, monoamines 0, covering 179 of 302 neurons, with the unassigned
remainder almost entirely pharyngeal), and folds bilateral pairs and serial numbers into
classes: `AVAL/AVAR` become `AVA`, `DA01` to `DA09` become `DA`, giving 169 types over
454 cells. The worm's gap junctions are kept as a second, symmetric graph, which is a
real edge type the fly IR lacks.

Why bother with an IR at all? Because the analysis passes in Chapter 3 (flow depth,
motifs, sign structure, spectral properties) should not know which species produced the
graph. If they did, a cross-species comparison would be rhetoric. With the IR it is a
measurement.

## What the worm tells you about the fly

Running both animals through the same passes gives this table:

| measure | worm (Cook 2019) | fly (male CNS) |
|---|---|---|
| cells / connections / synapses | 454 / 4,879 / 28,113 | 165,122 / 10.5 M / 104 M |
| forward / feedback / lateral weight | 12% / 72% / 16% | 37% / 12% / 50% |
| giant strongly connected component | 61% of cells | 97% of cells |
| reciprocal weight | 29% | 27% |
| dominant neuron-level two-cycle | I↔I (371 pairs) | E↔I (616,156 pairs) |
| midline-crossing weight | 37% | 22% |
| feedforward-inhibition share of strong E edges | 17% (z 3.7) | 80% (z 297) |
| spectral radius of the signed weight matrix | 136 | 3,771 |
| dominant-eigenvector participation | 10.8 cells | 49.9 cells |
| where the dominant mode lives | RMD, RIA, SMD (head steering) | lLN1/lLN2 antennal-lobe local neurons |
| hub tail exponent, in / out | 2.6 / 1.9 | 1.0 / 1.15 |
| unsigned weight | 62% | 0.5% |

Some of what this says:

1. **The worm is a feedback machine and the fly is a layered one.** 72% of the worm's
   synaptic weight runs backward in the depth ordering, against 12% in the fly. Half the
   fly's weight is lateral, meaning between neurons at the same depth. These are
   genuinely different graph regimes, not the same regime at different scale.
2. **The characteristic loop is different in kind.** The fly's dominant two-cycle is
   feedback inhibition, a cell that excites another and is inhibited back. The worm's is
   mutual inhibition, which is the command-interneuron rivalry that worm locomotion is
   known for. At type level the worm's mutual-inhibition enrichment washes out (z about
   −0.4) because worm motor classes are single cells, so the motif only exists at neuron
   resolution. That is itself a lesson: the right resolution for a motif census depends
   on the animal.
3. **The dominant dynamical mode identifies itself.** On the worm, the leading
   eigenvector of the signed weight matrix lands on RMD, RMDV, RIA and SMD, the
   head-steering circuit that oscillates during foraging. Nobody told the analysis that.
   The same measurement on the fly lands on the lateral antennal-lobe local neurons. I
   find this the most encouraging single result of the cross-species pass, because it is
   a "found, not annotated" outcome.
4. **The worm's sign structure is mostly unknown.** 62% of its weight is unsigned
   against 0.5% for the fly, so any sign-conditioned conclusion about the worm is weaker
   by construction. The null model in Chapter 3 swaps about 100 edges per rewire on a
   330-edge type graph, so the worm's z-scores should be read as directional.

The comparison does double duty. Scientifically it is interesting. Methodologically it is
the check that the passes are actually species-agnostic rather than fly-shaped code that
happens to run on a worm.

## Where the IR stops

The IR answers "what is wired to what, how strongly, with what sign." It cannot answer
"what does it do." That needs dynamics, which is Chapter 6 onward. The boundary is
deliberate and it is the book's core methodological commitment: structure first, then
dynamics, and never let the dynamics stage quietly re-import a structural assumption.

A small example of what that discipline looks like in practice. The transmitter table
maps each synapse's sign from the presynaptic cell, and unknown yields zero effect rather
than a guessed sign. When an early diagnostic found the mushroom-body interneuron APL
reading `undefined` for its transmitter, the right response, and the one taken (Chapter
11), was to trace the sign path and find out, not to patch APL to inhibitory because
"everyone knows APL is GABAergic." It is GABAergic. But the check had to be made, because
a sign bug would have produced the same null result invisibly.
