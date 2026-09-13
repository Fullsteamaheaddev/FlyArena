# Structure Before Dynamics: What the Graph Alone Tells You

Before any neuron fires in any model, the wiring diagram already contains a lot of
computation-shaped information. This chapter is about what the generic passes find, and
just as importantly, about where structure stops being enough. Everything here is
obtained without simulating a single spike.

## The brain is shallow going forward and deep going around

Do a breadth-first search from every sensory neuron over connections of 5 or more
synapses, and count how many hops each neuron is from the nearest sensor:

| hops from sensory | 0 | 1 | 2 | 3 | 4 | 5+ | unreachable |
|---|---|---|---|---|---|---|---|
| neurons | 15,912 | 27,495 | 84,711 | 35,214 | 902 | 31 | 857 |

Half the descending neurons are one hop from a sensory neuron and nearly all the rest are
two. 465 of 708 motor neurons are one hop. So the longest sensor-to-muscle chain the
wiring *needs* is three synapses, and almost every neuron in the brain is within three
hops of a sensor.

A more careful ordering uses a harmonic depth: pin sensory neurons at 0 and motor and
efferent neurons at 1, and give every other neuron the mean depth of its partners. The
superclasses then fall into a sensible order: sensory 0, antennal-lobe local neurons
0.09, projection neurons 0.15, Kenyon cells 0.19, MBONs 0.26, central-brain intrinsic
0.33, central complex 0.35, descending 0.49, VNC intrinsic 0.52, motor 1. Measured
against this order, synaptic weight splits as:

- **50% lateral**, between neurons at the same depth.
- **37% forward**, in the sensory-to-motor direction.
- **12% feedback**.

The optic lobe alone is 89,390 neurons of lateral processing. So the picture is a
feedforward skeleton three synapses deep, with most of the wiring, and therefore most of
the computation, happening sideways and backwards. If you want to interpret anything
else in this book, this is the fact to keep in mind: whatever long processing the fly
does, it does by recurrence, not by depth.

**One giant loop.** 97.2% of neurons (160,514) sit in a single strongly connected
component. Every central-brain intrinsic, descending, ascending and visual-projection
neuron is in it. Only sensory terminals, motor neurons and endocrine cells are outside.
19% of connections and 27% of synaptic weight are reciprocal, meaning both directions
exist between the same two cells.

## Inhibition is not a correction term

61% of synaptic weight is excitatory (acetylcholine 60%), 38% inhibitory (GABA 21%,
glutamate 16%, histamine 0.5%), 0.5% unsigned. The median neuron receives 44% of its
input from inhibitory cells, with a 10th to 90th percentile range of 24% to 69%.
Central-complex neurons are the most inhibited class at 54%, MBONs (14%) and Kenyon cells
(18%) the least.

Reciprocal pairs at neuron level, by sign:

| E↔I | E↔E | I↔I |
|---|---|---|
| 616,156 | 263,808 | 126,371 |

Feedback inhibition is the dominant two-cycle, more than twice as common as recurrent
excitation. The bilateral wiring sharpens this. 22% of weight crosses the midline (3% in
the optic lobe, 27% in the central brain, 44% in the VNC, 47% for descending and 62% for
ascending neurons), and crossing synapses are more often inhibitory (44%) than
ipsilateral ones (38%). The strongest left-right mutual inhibition between homologous
types is in the central complex: ER4d at 10,156 and 10,083 synapses each way, then
Delta7, ER2_c, ER5, ER4m, ER3d_b and ER3m. These are the ring neurons that carry visual
and self-motion inputs into the ellipsoid body, and they compete across hemispheres
before the heading circuit ever sees them.

Neuromodulatory neurons are broadcasters. The median octopaminergic cell contacts 27
cell types (maximum 1,462), serotonergic 50, dopaminergic 8.

## The motif vocabulary, and whether it is surprising

Condense the 165k neurons into 11,752 types and keep type-to-type edges of at least 3
synapses per target neuron and 20 in total. That leaves 473,523 type-level edges. On
that graph:

- **Feedforward inhibition is the rule, not a motif.** Of 277,512 strong excitatory type
  edges A→B, 80% have a parallel path A→I→B through an inhibitory type. The largest
  central-brain instances are EPG→Delta7→(Delta7, PEN), Kenyon cell→APL→Kenyon cell,
  ExR1→ER5→ER5/EL, and ORN_DA1→lLN2F_b→lLN2T_b.
- **Reciprocal type pairs:** 20,816 E↔I, 8,272 E↔E, 6,375 I↔I. The strongest central E↔E
  pairs are DPM↔KCγ-m, KCγ-m↔PPL103, EPG↔PEN and KC↔PAM dopamine neurons. The strongest
  I↔I pairs, the winner-take-all candidates, are ER2_a↔ER2_c, lLN2F_b↔lLN2P_c,
  ER3a_a↔ER3m and LNO1↔LNO2. The strongest E↔I is APL with every Kenyon-cell subtype
  (79,151 and 79,270 synapses with KCγ-m alone).
- **Disinhibition:** 78,796 I→I type edges. The top central chains are
  ER2_c→ER2_a→EPG, ER2_a→ER2_c→EPG and ER3a_a→ER3m→EPG, ring-neuron chains gating the
  heading bump.
- **Feedforward loops**, A→B→C plus a direct A→C: 415,017 edges in coherent loops
  (excitatory middle, acting as delay lines and coincidence detectors) and 369,037 in
  incoherent ones (inhibitory middle, pulse shaping).
- **Normalisation cells**: inhibitory types whose main input population is also their
  main output population, so they read a population's total and feed it back. APL (90%
  in, 94% out Kenyon cells), lLN2F_b and lLN2P in the antennal lobe, Delta7 (99% in,
  100% out central complex), the ER ring neurons, and in the VNC the tactile IN01B and
  gustatory IN05B interneurons.
- **Hubs** are the same cells. The two APL neurons (119k and 113k input synapses), CT1
  (139k output), LPi21, Am1, Li39, DPM. Degree distributions have a heavy tail with
  exponent about 1.0 in and 1.15 out above 100 synapses. Median in-degree is 260, the
  99th percentile 6,301.

Now the important question: are these counts large because the wiring is organised, or
just because some types are big? The way to answer is a null model. Rewire the type graph
while keeping every type's in-degree, out-degree and the sign of each edge's source, so
that only the pairing of pre- to post-synaptic types is shuffled, and count the motifs
again. Six rewires give:

| metric | observed | null mean ± sd | z |
|---|---|---|---|
| feedforward-inhibition share of E edges | 80% | 25% ± 0.0018 | 297 |
| reciprocal E↔E | 8,272 | 526 ± 21 | 370 |
| reciprocal I↔I | 6,375 | 282 ± 15 | 416 |
| reciprocal E↔I | 21,602 | 1,194 ± 35 | 587 |
| edges in coherent feedforward loops | 415,017 | 134,573 ± 705 | 398 |
| edges in incoherent feedforward loops | 369,037 | 112,842 ± 1,510 | 170 |
| I→I edges (control) | 78,796 | 78,796 ± 0 | 0 |

Every motif is hundreds of standard deviations above chance. The I→I count is conserved
exactly by this null, which is why it is there: it is the control that shows the
shuffling is doing what it claims. So the answer is yes, the wiring concentrates feedback
inhibition, feedforward inhibition and mutual inhibition far beyond what the degree
statistics predict. This is the kind of result that a large graph makes easy to get and
easy to overinterpret, so I want to flag what the z-scores do and do not say: they say the
motifs are not degree artifacts. They do not say what the motifs compute. That is the
job of the rest of the book.

## The spectral footprint

Treat the signed synapse-count matrix as a linear operator and you get a crude bound on
what the dynamics can do. Its spectral radius is 3,771. Of the largest 40 eigenvalues, 32
have positive real part. The dominant eigenvector has a participation ratio of 49.9
cells, and 60% of it sits on one antennal-lobe local-neuron type, lLN1_bc, with the rest
on other lLN2 subtypes and a few projection neurons.

The way to read this is: the signed wiring is linearly unstable at many modes, so
activity in the real network is shaped by nonlinearity and inhibition, not by passive
decay. And the biggest single loop in the brain, as the linear algebra sees it, is local
to the antennal lobe. The source-minus-sink axis (each neuron's output weight minus its
input weight) separates the broadcasters, which are sensory, modulatory and command
cells, from the receivers, which are the motor pools and output neurons that integrate
everyone else's vote.

## Where structure stops

Everything above was obtained from the graph. A recurring result of the dynamical
chapters is that **structure systematically overstates what dynamics delivers**. Wired
inhibitory kernels are realised, but at a fraction of their structural contrast. Wired
phase shifts are realised only with help from recurrence. Wired attractors appear only in
narrow gain regimes. Wired normalisation loops sometimes cannot carry their function at
count-calibrated weights.

So the right way to think of the graph is as a hypothesis generator of high quality and
limited authority. Chapter 4 finishes the structural tour circuit by circuit. Everything
after that is about how to test what the graph proposes.
