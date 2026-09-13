# The Circuits, Region by Region

Chapter 3 was about global statistics. This chapter goes through the brain region by
region and asks, for each one, what algorithm the wiring looks like it implements. The
word "looks like" is doing real work in that sentence. Everything here is a structural
signature, and Chapter 5 turns the signatures into a catalogue of operators with
confidence scores. But you cannot evaluate the catalogue without seeing the anatomy it
came from, so here it is.

## Antennal lobe: labelled lines with gain control

The olfactory input stage has 50 glomeruli, 2,562 olfactory receptor neurons (ORNs), 267
uniglomerular projection neurons (PNs) and 420 local neurons (LNs).

**Labelled lines.** 96.6% of ORN→PN weight stays inside one glomerulus. A glomerulus has a
median 35 ORNs and 4 PNs, so a 10:1 convergence. Each PN receives from a median 38 ORNs
and each ORN reaches 4 PNs. Odour identity enters the brain as "which glomeruli are
active," and the wiring keeps the channels separate at this stage.

**Normalisation.** ORNs send more synapses to LNs (537k) than to PNs (414k). The LNs are
broad, with a median 8 input glomeruli and 15 output glomeruli, and the top decile spans
more than 42 of the 50. They synapse back onto ORN terminals (169k synapses, 41% of the
ORN→PN weight), which is the presynaptic gain control that physiology attributes to
GABA_B receptors. LN→LN weight (626k) exceeds LN→PN (283k). The LNs are mixed in sign:
115 GABA, 99 glutamate, 137 acetylcholine, 67 unknown.

That last number matters later. The cholinergic LNs, and lLN1_bc in particular, make on
the order of 200,000 synapses onto projection neurons. In the whole-brain model
(Chapter 14) this is the reason odour channels bleed into each other downstream, and
odour specificity in the Kenyon cells is the one calibration target that failed every
configuration. The labelled-line picture is what the ORN→PN wiring says. The LN wiring
says something messier.

## Lateral horn: the innate pathway, at equal weight

Projection neurons split their output between the mushroom body (learnable) and the
lateral horn (innate), and the split is even: PN→lateral horn weight is 1.036 times
PN→Kenyon cell weight. The horn has 2,028 neurons in 422 types, of which 1,574 are output
cells and 454 are local interneurons that repeat the antennal lobe's normalisation
pattern. Each output cell pools a median 6 PN types, with its top PN contributing 25% of
its input, so the pooling is broader than a labelled line and narrower than the mushroom
body's near-random sampling. 99% of PNs reach the horn.

The learned and innate channels are not isolated. MBONs synapse back onto the horn, and
the horn reaches the descending bottleneck directly, most heavily onto DNp32 (2,322
synapses), pIP1 (2,072) and DNp06 (1,214).

## Mushroom body: random expansion, global feedback, gated readout

This is the circuit that reads like a machine-learning diagram, which is why
Chapter 11 tests it so carefully.

- **Expansion.** 4,064 Kenyon cells (KCs) from 686 PNs, a 5.9× expansion (15× against
  the 267 uniglomerular PNs). Each KC samples a median 5 PNs (10th to 90th percentile 3
  to 8) through its dendritic claws. 282 PNs reach the calyx, each contacting a median
  56 KCs. 283 KCs have no PN input at all: 185 γ-d and 87 αβ-p cells, the subtypes that
  take visual rather than olfactory input.
- **Near-random sampling.** The mean absolute correlation between PN types, over which
  KCs they contact, is 0.023. Shuffling the KC targets gives 0.013. So there is a small
  structured excess and the rest is random, which is what a random-projection memory
  wants.
- **Sparsening.** Every KC drives the giant interneuron APL and every KC is inhibited by
  it: KC→APL 210k synapses, APL→KC 196k, 100% coverage both ways. KC→KC axonal synapses
  (491k) actually exceed PN→KC (389k).
- **Readout.** 97 MBONs, each reading a median 313 KCs (maximum 1,680). Each KC reaches a
  median 11 MBONs. KC→MBON is 439k synapses.
- **Three-factor teaching.** About 340 dopaminergic neurons (DANs) synapse onto KC axons
  (89k) more than onto MBONs (38k), and 70% of DAN→MBON weight lands in the matching
  compartment. MBON→DAN (9k) and MBON→MBON (25k) close a loop that lets one compartment's
  output set another's teaching signal.

**Where the compartments' votes recombine.** The compartmental readout is not the end.
MBONs of different compartments and opposite valence converge on shared targets: 20
targets are fed by two or more MBON types, and a direct channel of 4,073 synapses
reaches the descending neurons. Same-sign MBONs share more of their target repertoire
(cosine 0.026) than opposite-sign pairs (0.02), so the valence channels stay separable
where they meet. The MBONs themselves are 26 glutamate, 50 acetylcholine and 21 GABA.

## Central complex: a ring with a shifter, and vector arithmetic behind it

Protocerebral-bridge glomeruli in the instance names give each EPG, PEN, PEG and Delta7
neuron a column, and the heading ring has period 8 per side.

**The cosine inhibition kernel.** Two-hop EPG→Delta7→EPG weight against column offset
(mod 8):

| offset | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| synapses | 115 | 184 | 830 | 1,510 | 1,770 | 1,560 | 828 | 190 |

Minimum at the bump, maximum opposite it. That is the 1 − cos Δθ inhibition of a ring
attractor, and it fits a − b·cos with a = 873, b = 890, R² = 0.99 and contrast 0.878.
Each Delta7 reads a median 32 EPGs and writes onto 8, and Delta7 cells are 99%
central-complex in and out. The profile holds across hemispheres too, with left
glomerulus L_k paired with R_(9−k) and R_(10−k).

**Local recurrent excitation.** EPGs of one column synapse onto each other (33 synapses
per pair at offset 0, 3 at offset ±1) and reciprocally with PEG (93 per pair at offset 0).

**The shifter.** EPG→PEN goes to column +1 and PEN→EPG returns to −1 and −2 on the same
side. Split by hemisphere the loop is asymmetric, and resolving each PEN's EPG targets
on the ring gives a clean bimodal answer:

| population | p10 | median | p90 |
|---|---|---|---|
| PEN (both types), left | +1.42 | +1.47 | +1.55 |
| PEN, right | −1.55 | −1.45 | −1.37 |

Left-hemisphere PENs write about 1.5 columns ahead, right-hemisphere PENs about 1.5
behind, and PEN1 and PEN2 agree. The pooled median is near zero only because the two
hemispheres cancel. So the two PEN populations push the bump in opposite directions,
which is angular-velocity integration. One caveat: the analysis is at glomerulus
resolution (45°), and the real shift is one wedge (22.5°), so the shift appears as an
asymmetry in the ±1 bins rather than as a clean peak.

**Ring-neuron competition.** The ER types that feed the ring show the strongest mutual
inhibition in the brain, across hemispheres and between subtypes (ER2_a↔ER2_c at 5.8k
and 6.1k synapses), plus disinhibitory chains onto EPG. Inputs compete before they reach
the attractor.

**Fan-shaped body vector shifts.** Between column-tagged FB cells, 201k synapses are in
type pairs whose peak offset is the same column, and 146k in pairs peaking 3 or more
columns away. hDelta outputs peak 4 to 5 columns away, which is half of 8 to 9 columns,
a 180° shift, onto PFL3, PFR, vDelta, FC2B, FC2C and PFGs. PFNd→hDelta peaks at −3. This
is the circuit Chapter 10 tests. The steering readout, PFL3 and PFL2, projects onto the
descending neurons DNa03 (2,039 synapses), DNb01 (753) and DNa02 (736).

## Optic lobe: convolution, ON/OFF, a filter bank, and pooling

- **Shared kernels.** 47 cell types have 600 or more copies, one per column per eye. For
  the strongest columnar type pairs, 99 to 100% of source neurons are connected, with a
  fixed number of partners and a coefficient of variation of total weight of 0.2 to 0.36.
  That is one kernel applied at every column. One-to-one kernels include L1→Mi1, L1→L5,
  L2→Tm1, L2→Tm2. Five-to-six-column kernels include L1→Tm3, Mi1→Tm3 and Mi1→T4a to d.
- **ON/OFF split.** L1 sends 142k synapses to Mi1 and 147k to Tm3 and nothing to the OFF
  cells. L2 sends 205k to Tm1, 220k to Tm2, 160k to Tm4, 158k to T1 and nothing to Mi1 or
  Tm3. The lamina output matrices are block-diagonal.
- **A direction filter bank.** The four T4 subtypes have the same input composition (Mi1
  about 32%, Tm3 13%, Mi9 10 to 12%, CT1 6 to 7%, Mi4 5 to 6%), with cosine similarity
  0.93 to 0.95 between their full input vectors. They are four copies of one kernel
  differing only in spatial offset. T5a to d likewise. CT1, the top output hub in the
  brain, gives feedforward inhibition to every T5 subtype.
- **Pooling.** Wide-field lobula-plate cells sum one subtype each. HSE, HSN and HSS each
  receive from about 400 to 540 T4a and T5a cells and no other subtype. H2 pools 760
  T4b/T5b. Thousands of local detectors feed one integrator.

**The visual feature menu.** 9,203 visual projection neurons in 346 types carry the optic
lobe's features to the central brain. Each channel is focused (median 4 target types at
5% or more) and the channels are nearly non-redundant (median pairwise target-profile
cosine 0.002, 90th percentile 0.05), but downstream they recombine: 275,710 synapses
onto descending neurons, 23,508 onto the lateral horn, 1,250 onto the compass ring
neurons.

## Escape: a three-synapse funnel

The giant fibre receives 36k input synapses. LC4 (126 neurons, 55 to 71 converging on
each giant fibre) provides 17.6% and LPLC2 (182 neurons, about 90 per giant fibre) 13.4%.
The rest is spread over hundreds of types. Photoreceptor to giant fibre is 3 hops at 5 or
more synapses. Its outputs go to GFC2 to 4, the jump motor neuron TTMn, DNp11 and PSI.

## The descending funnel

1,314 descending neurons (DNs) receive only 3.7% of all brain output synapses. The median
DN gets 1,722 synapses from 87 types (10th to 90th percentile 335 to 7,883 synapses, 26
to 253 types). DNs talk to each other: 31,993 connections, 6,801 of them reciprocal. Only
6% of DN output goes directly to motor neurons. Half goes to VNC interneurons. And the
return path is as heavy as the command: ascending neurons send 527k synapses back onto
DNs against 381k DN→AN. The largest DNs by input are DNp103, DNa02, DNp06, DNg16, the
giant fibre DNp01, pIP1 and DNg100.

## Motor pools

708 motor neurons. The median one has 143 premotor neurons and 2,464 premotor synapses,
44% of them inhibitory, 88% from VNC interneurons, 9% from descending neurons, 2% from
sensory. Motor neurons of one type and side share premotor partners with a median Jaccard
of 0.03 against 0.002 for random pairs, a 15× excess: these are pools. 43% of VNC weight
crosses the midline and 53% of that is inhibitory. The strongest reciprocal inhibitory
type pairs (IN16B049↔INXXX217, IN13A001↔IN19A001, IN08A002↔IN19A011) are half-centre
candidates.

## State cells are threaded through, not layered on top

A small set of identified cells carries brain state: 40 circadian clock neurons (DN1a,
DN1p, s-LNv, LNd, LPN), 49 sleep-need cells (ER5, ExR1, ExR2, hDeltaC), 37 octopamine
and 8 serotonin broadcasters, and 53 peptidergic cells. They are few, but their wiring
is dense where it matters:

| link | synapses |
|---|---|
| central complex → state | 111,308 |
| state → central complex | 101,159 |
| state → state | 37,036 |
| state → descending neurons | 8,686 |
| state → MBON | 3,392 |

The two largest flows are a two-way loop with the compass. State is not a layer above
the fast circuits. It is wired into them, which is one reason Chapter 14's
neuromodulation results come out the way they do.

## The summary table

| structure | where | evidence |
|---|---|---|
| labelled lines plus divisive normalisation | antennal lobe | 97% within-glomerulus, broad LNs, LN→ORN presynaptic inhibition |
| random expansion plus global feedback sparsening | mushroom body | 5.9× expansion, 5 claws, near-random sampling, APL 100% coverage |
| compartmental readout with three-factor plasticity | mushroom body | 97 MBONs × 313 KCs, DAN→KC ≫ DAN→MBON, 70% compartment match |
| ring attractor with cosine inhibition | ellipsoid body and bridge | Delta7 profile 115 → 1,770 → 190 over half a turn |
| angular-velocity integrator | PEN | ±1.5-column push through left and right PENs |
| vector arithmetic by half-ring shift | fan-shaped body | hDelta outputs 4 to 5 columns away |
| shared convolution kernels | optic lobe | 47 columnar types, fixed partner counts, CV 0.2 to 0.36 |
| parallel ON/OFF channels | lamina to medulla | block-diagonal L1/L2 output |
| direction filter bank plus wide-field pooling | T4/T5 to lobula plate | four identical kernels, HS pools only subtype a |
| feedforward inhibition everywhere | whole CNS | 80% of strong E edges have a parallel I path |
| winner-take-all inputs | ring neurons, antennal-lobe LNs | strongest I↔I pairs, cross-hemisphere mutual inhibition |
| sensorimotor bottleneck with loops | descending neurons | 1,314 DNs, 3.7% of brain output, AN→DN ≈ DN→AN |
| motor pools with commissural inhibition | VNC | 15× shared premotor input, 53% inhibitory crossing |

## Does the structure survive dynamics? A first check

Chapters 7 to 11 do this properly, but there is a cheap version to show now. Take
the calibrated whole-brain LIF model of Chapter 14, with the same graph and sign
conventions, and probe three of the structures above:

| probe | structural claim | measured in the LIF model |
|---|---|---|
| Delta7 kernel | cosine, R² 0.99 | fire each Delta7 and read the inhibitory conductance on the ring: minimum at the bump wedge, maximum opposite, cosine R² 0.56 |
| PEN shifter | ±1.5 columns | drive one column's PENs: EPG wedges depolarise +1.52 columns for left PENs, −1.48 for right |
| APL sparsening | global feedback | same PN drive, APL silenced: active KC fraction 0.15 → 0.72, mean rate 0.87 → 5.08 Hz |

All three pass in sign. But notice the Delta7 number: the kernel that fits the wiring at
R² 0.99 fits the realised inhibition at R² 0.56. Same graph, same cells. The shape
survives, the precision does not, and the calibrated LIF does not sustain a freely
rotating bump at all without external drive. That gap between 0.99 and 0.56 is a
preview of the book's main theme.
