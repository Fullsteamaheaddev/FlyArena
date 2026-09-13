# The Mushroom Body: When the Wiring Cannot Answer

The third circuit is the stress test the compiler was built for. `sparse_associative_memory`
has no spatial geometry at all. There is no ring, no column axis, nothing to take a
centroid of. The computation is pattern separation and associative readout, and the
observables are similarity and gain. If the method only works where there is a
coordinate system, this is where it shows.

The result is a negative, and I think it is the most important negative in the book.

## The circuit

From Chapter 4, the wiring reads like a diagram of a random-projection memory:

- **Expansion.** 282 projection neurons reach 4,064 Kenyon cells, about 6×. Each KC
  samples a median 5 PNs, and the PN-to-KC sampling is near-random (correlation 0.023
  against 0.013 shuffled).
- **Normalisation.** Two APL cells cover 100% of KCs and are driven by 100% of them, with
  196k APL→KC synapses over 4,210 connections. That is one connection per KC, carrying
  about 48 synapses on average.
- **Readout.** 97 MBONs, a median 313 KCs each, 439k synapses.
- **Teaching.** About 340 dopaminergic neurons, 70% of whose MBON contacts are in the
  matching compartment.

## The protocol

The `memory` geometry drives two overlapping KC odour patterns directly (200 cells,
50% shared) and measures:

- **separation** and **expansion**: the cosine similarity of the two MBON output vectors
  relative to the KC input overlap. Expansion above 1 means the readout decorrelates.
- **compression**: KC spike count at 2× drive divided by count at 1× drive. Divisive
  normalisation should make this well below 2.

The ensemble sweeps `kc2mb ∈ {0.5, 1, 2} × aplGain ∈ {0.5, 1, 2} × mbonTonic ∈ {0, 4}`
with `mbRecur = 1`, 18 members. The free axes come with their reasons: KC→MBON gain is
plastic in vivo, APL feedback sets KC sparsity, and MBON→MBON recurrence exists (936
edges) but its role is unknown. Perturbations: silence APL, zero MBON recurrence.

## The result

18 members: 9 `silent`, 9 `collapsed`. Zero `gain_controlled`. Zero `linear_passthrough`.
The mechanism table is empty, because no member showed the mechanism.

The direct diagnostic explains why. Drive 400 KCs at increasing strength and count
spikes:

| drive | KC spikes | APL spikes (two cells) |
|---|---|---|
| 60 | 4,163 | 13, 8 |
| 150 | 9,144 | 16, 11 |
| 300 | 14,338 | 16, 11 |

APL saturates at about 16 spikes in 200 ms while KC output scales 3.4×. The feedback
cannot compress because APL's recruitment saturates, and two cells firing at 80 Hz
through count-calibrated conductances cannot divide the output of thousands of KCs.

The ranked experiments confirm the picture from the other side. `baseline_gain_control`
and `apl_silence` both score 0.529, and they sort the members identically: 9 silent and
9 uncontrolled, with or without APL. When silencing a population changes nothing, the
population is not doing anything at this parameterization. Chapter 6 warned that a
score near 0.5 in a two-class ensemble is a near-even split rather than a rich
landscape, and this is that case.

## What this means, and what it does not

There are three claims here and they need to be kept separate.

**The wiring does not establish gain control.** Whether the real APL divides KC output
depends on the conductance per synapse, which the connectome does not carry. Synapse
counts got the loop's existence, its coverage and its sign right. They could not get
its strength. The lab reports this as a missing hypothesis class rather than as a tuned
affirmative, which is the honest output.

**The readout being linear is correct, not a failure.** Expansion below 1 for 50%
overlapping odours is what you expect when decorrelation happens upstream, at odour→KC,
and the probe drives KCs directly and so skips that layer. The MBON transform is
supposed to be near-linear. The memory's separation step lives in the expansion, and the
probe did not exercise it.

**The sign had to be checked.** Early diagnostics found `nt: undefined` for APL. In this
simulator, an undefined transmitter means the cell's edges contribute nothing, which
would produce the same null result as above for a completely different reason. APL
turned out to be correctly labelled: two cells, both GABAergic, and the loop is
inhibitory as it should be. The weakness is quantitative, not a sign error. But had the
check not been made, a bug and a finding would have been indistinguishable.

## The same loop, in the whole brain

There is a result from the whole-brain model that looks like it contradicts this
chapter, so let me explain why it does not.

In the full 165k-neuron LIF network (Chapter 14), driving Kenyon cells through their
projection neurons and then silencing APL raises the fraction of active KCs from 0.15
to 0.72 and the mean KC rate from 0.87 to 5.08 Hz. APL is plainly doing something
there.

Both results are true and they measure different things. The whole-brain probe asks
whether APL keeps the KC code *sparse* under physiological PN input, where most KCs sit
just below threshold and a small inhibitory conductance is enough to keep them there.
The ensemble probe asks whether APL *divides* the output of KCs that are being driven
hard and directly, where the same conductance is a small fraction of the drive. APL can
be a thresholding sparsener without being a divisive normaliser. The catalogue
predicted both. The wiring supports the first. It cannot decide the second.

## The lesson

The connectome constrains a family of models, and the family's honest output sometimes
includes "this cannot be determined from structure." The sparse-memory operator is
detected with confidence 0.55, its wiring is canonical, its sparsening is realised, and
its gain-control mechanism is underdetermined. Those facts coexist. And the failure is
located precisely: "APL gain control needs per-synapse conductance values" is a more
useful scientific output than either a false positive or silence, because it says
which measurement would close the gap. If a future calibration gives APL enough
conductance to matter, the `apl_silence` experiment stops being a coin flip and becomes
the top discriminator, and the pipeline will already have said so.
