# Structure Before Dynamics: What the Graph Tells You

Before any neuron fires in any model, the wiring diagram already contains a great
deal of computation-shaped information. `algo_ir.py` runs the generic passes; this
chapter surveys what they found and — equally important — where structure stops being
sufficient.

## Flow: the brain is a layered machine with deep recurrence

Ordering the DAG condensation (304 iterations to reach a stable topological layering)
splits the fly's synaptic weight into:

- **50.1% lateral** — within-layer connections. Half the brain's wiring is horizontal.
- **37.5% forward** — the sensory→motor direction.
- **12.4% feedback** — backward edges, a small but strategic minority.

Sensory neurons sit at hop 0; descending neurons are reachable in 1–3 hops from
sensory input — the fly is *shallow* in the feedforward direction. Whatever long
processing it does is done by recurrence, not depth. This is the single most
important global fact for interpreting everything else: **computation lives in the
lateral and feedback channels.**

## Sign: inhibition is nearly half the budget

61.2% of synaptic weight is excitatory, 38.2% inhibitory, 0.5% unsigned. Inhibition is
not a correction term in this brain — it is a primary computational resource. The
bilateral data sharpens this: edges that cross the midline are 44% inhibitory versus
38% for ipsilateral edges, and there are 25 pairs of left/right homologues in mutual
inhibition — the wiring pattern for hemispheric competition and comparison.

## Motifs: a canonical vocabulary

At the cell-type level (11,752 types, 473,523 strong type-level edges), the
reciprocity census gives:

- **20,816 excitatory↔inhibitory reciprocal pairs** — the dominant reciprocal motif is
  *signed*: a type excites another and is inhibited back. That is the wiring of
  feedback gain control, repeated twenty thousand times.
- 8,272 E↔E and 6,375 I↔I pairs, and only 786 mixed.
- The top recurrent excitation pairs concentrate in the optic lobe (L2↔L4, L2↔L5,
  Mi1↔T2 — the motion pathway's front end) and the mushroom body (DPM↔KCg-m,
  KCg-m↔PPL103 — memory and dopaminergic feedback).

Convergence/divergence asymmetries are extreme: sensory and intrinsic types fan out
to tens of types (median out-degree 49 for VNC sensory) while motor neurons fan in
(median in-degree 73 for VNC motor, out-degree 0). The graph's own vocabulary already
sketches the functional direction.

## Hubs and spectral structure

Degree distributions are heavy-tailed (in-degree tail exponent ~1.0, out-degree ~1.15).
The dominant eigenvector of the weighted graph has participation ratio ~50 — a small
set of neurons carries the dominant mode — and 32 eigenvalues have positive real
part: the signed wiring is *linearly unstable* at many modes, i.e., activity in the
real network is sculpted by nonlinearity and inhibition, not by passive decay.

## Region structure

The per-region passes find the canonical specializations:

- **Optic lobe** — 47 columnar types, with retinotopic weight-sharing: the same
  input-weight profile repeated across columns (a convolved front end, Chapter 4).
- **Mushroom body** — 4,064 KCs fed by 282 projection neurons (expansion ratio ~6),
  each KC sampling a median of ~56 PN inputs through ~3 claws; APL covers 100% of KCs
  and is driven by 100% of them — the textbook random-projection-plus-normalization
  architecture.
- **Central complex** — the columnar ring analyzed in Chapters 6–8; the measured
  Delta7 kernel fits a cosine at R²=0.99.

## The ceiling of structure

Everything above is obtained without simulating a single spike. But a recurring
result of the dynamical chapters is that **structure systematically overstates what
dynamics delivers**: wired kernels are realized, wired phase shifts are realized at a
third of their amplitude, wired attractors appear only in narrow gain regimes. The
graph is a hypothesis generator of high quality and limited authority — the rest of
the book is about how to test what it proposes.
