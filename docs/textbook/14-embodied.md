# Running the Whole Brain in a Body

Everything so far has been about circuits of a few hundred cells. This chapter is about
what happens when you take the other route and run all 165,122 neurons at once, in a
physics-simulated body, in a browser. I think of it as the complement to the compiler:
the compiler tells you *why* a circuit works or fails, the whole-brain run tells you
*whether the wiring as a whole supports behaviour*, and each is uninterpretable without
the other.

The result, in one sentence: the raw connectome, with nine fitted global parameters,
reproduces a set of published reflexes and sensorimotor mappings, and does not by itself
produce coordinated walking, spontaneous behaviour, or the state-dependent drive that
real flies have. Everything in the second list had to be supplied by code outside the
graph, and the interesting content is the exact boundary between the lists.

## The setup

The brain is the conductance-based LIF model of Chapter 6, over all 10.5 million
connections, stepped at 0.5 ms in WebAssembly or WebGPU. The body is flybody
(Vaxenburg et al. 2024): 67 bodies, 102 joints, 78 actuators, adhesive tarsal claws,
total mass 0.98 mg, stepped by MuJoCo at 0.2 ms. The eye is flyvis (Lappalainen et al.
2024), a trained optic-lobe model on a 721-column hexagonal lattice per eye, whose
outputs drive the matching 62,000 male-CNS optic-lobe neurons by cell type and
retinotopic column. Taste, smell, touch, proprioception, wind and heat enter as Poisson
spike trains on 7,745 sensory neurons in 151 channels, at rates taken from physiology.
The motor side reads firing rates from identified descending neurons and 439 motor
neurons mapped to 170 muscle groups.

Throughput is about 0.2× real time per fly with vision, five flies at once on a 12-core
laptop. Two implementation details matter here because they are model claims, not
engineering trivia. First, an event-driven update was tried and gained almost
nothing, because about 120,000 neurons are subthreshold-active at any step. The network
is not sparse in time. Second, the WebAssembly and WebGPU kernels were checked against
each other on 1,000 identically driven steps: 10,298 against 9,580 sampled spikes, which
is within-seed agreement for a stochastic model, and a deterministic bias-driven chain
gave spike counts 16, 8, 6, 5 exactly on both.

## What had to be added to the graph before it worked at all

Each of these is a place where the connectome, as a file, is missing something a
neuron has:

| addition | why |
|---|---|
| conductance-based synapses, E_exc 0 mV, E_inh fitted to −76 mV | current-based synapses let any neuron with 150 synapses fire any target |
| PSP scaled by (volume / regional median)^−0.61 | larger neurons have lower input resistance (Pugliese et al. 2025) |
| graded signs for 3,602 neurons without a consensus transmitter | guessing "excitatory" spread odour to every glomerulus |
| sensory neurons ignore central input | their spikes start at the receptor; central synapses on their terminals cannot fire them |
| raised Kenyon-cell threshold (+10.9 mV) | KCs need coincident input from several PNs |
| lamina resting bias (+5.3 mV) | L1 to L5 are graded cells with a depolarised rest, so histaminergic photoreceptor input can modulate them |
| giant fibre to TTMn electrical synapse | absent from the chemical connectome, present in the animal, and the escape jump does not happen without it |
| octopamine as a slow modulator | octopaminergic neurons have no fast synapses; their release lowers targets' thresholds over seconds |

Three things were tried and dropped, and I list them because the dropped ones are as
informative as the kept ones. A firing-rate model of the whole CNS after Pugliese et
al. ignited to about 25,000 active neurons and gave slow waves rather than a stepping
rhythm. Spike-frequency adaptation and short-term depression stabilised activity but
killed the sugar-to-proboscis pathway, which is why the fitted adaptation is zero.
Treating unknown transmitters as excitatory flooded the antennal lobe.

## Calibration against published physiology

Nine global parameters were fitted by cross-entropy search (20 generations of 24
candidates, 12 evaluators in parallel, 2 to 4 seconds per evaluation) against a
benchmark suite of published results:

| target | source | model |
|---|---|---|
| labellar sugar drives the proboscis motor neuron MN9 | Shiu et al. 2024 | 59 Hz |
| bitter silences MN9 | Shiu et al. 2024 | 0 Hz |
| bitter vetoes sugar | Shiu et al. 2024 | 0 Hz |
| front-leg sugar drives MN9 (tarsal reflex) | | 34 Hz |
| leg sugar suppresses the walking drive | | 9.2 → 4.6 Hz |
| leg sugar does not drive backward walking | | 0.6 Hz |
| Kenyon-cell sparseness | Turner et al. 2008 | 7.4% |
| looming drives the takeoff neurons over self-motion | von Reyn 2014, Namiki 2018 | 33 vs 2 Hz |
| no giant-fibre spikes during self-motion | | pass |
| BDN2 activates leg muscle groups | Pugliese et al. 2025 | pass |
| odour specificity in KCs and PNs | | **failed every configuration** |

The overall score is 0.746 on the best run, 0.725 mean of six. An earlier fit without
neuromodulation scored 0.767 on one run and 0.674 mean of six, which is a useful
reminder that single-run scores on a stochastic model mean very little.

The odour-specificity failure is the calibration's cleanest negative. Chapter 4 already
gave the structural reason: cholinergic antennal-lobe local neurons make about 200,000
synapses onto projection neurons, and no global parameter setting keeps the channels
apart downstream. This is a circuit whose function is not recoverable from wiring plus
nine knobs.

Two benchmark-design bugs were found along the way and belong here because they
generalise. An objective that rewarded odour specificity was satisfied, briefly,
by a configuration in which no Kenyon cell fired. And reused WebAssembly memory carried
spike counts between evaluations until every state array was reset. Both are the kind
of thing that produces a confident wrong number.

## What the raw wiring does when you let it move

The most informative measurements are the ones made *before* any behavioural module was
added.

With the body held still, the forward-walking descending neurons were silent. Once the
body was allowed to move, footfall touch bursts drove those same neurons to 10 to 13 Hz
and the fly ran at full speed without stopping. Masking tarsal touch brought them back
to about 3 Hz. The same bursts made the steering neurons alternate, and steering was
pinned at its limit 20 to 50% of the time.

So the connectome-derived network is reactive. Its locomotor output is a function of
its own reafference, not of any internal state. Insects solve this with presynaptic
inhibition of afferents during self-generated steps, and the model does the same:
footfall bursts are scaled by 1 − 0.85 × stepping amplitude. That 0.85 is a parameter
the connectome cannot supply and behaviour demands.

A second example of the same kind: constant contact with food kept driving the walking
neurons, and the fly could not stop on it. Tactile bristles are rapidly adapting in the
animal, and once the model's were made so, it could.

A third, which I find the most striking: **the reconstructed wiring is not left-right
symmetric.** The right DNa02 and P9 receive more tonic excitation than the left, and
the left P9 receives about twice the inhibitory conductance of the right. Without a
slow adaptation (4 s time constant) on the steering readout, the fly circled right. A
bilateral-symmetry check should probably be a standard test for any connectome model.

## What the connectome supports, and what it does not

**Supported by the wiring, read out from identified descending neurons:**

- Forward walking (DNg100/BDN2, DNg97/oDN1, DNp09/P9), backward walking (MDN),
  steering (DNa02, DNa01), grooming (DNg07, DNg08, DNg12), escape (the giant fibre,
  DNp01) and takeoff (DNp02, DNp04), courtship (pIP10, DNp13).
- A sensory screen over which senses drive which commands. Dimming or looming drives
  the giant fibre and takeoff neurons. Wind on the antennae and hind-leg touch drive the
  backward-walking neuron. Many odours drive the steering neurons. The forward-walking
  neurons are driven mostly through vision.
- Courtship detection. Given a pheromone plume and a small-object visual signal at
  LC10, the connectome propagates both to pIP10 and DNp13, which roughly double their
  firing near another fly. Only the LC10 input is injected. The decision variable is
  computed by the wiring.
- Sparsening in the mushroom body, at 7.4% active Kenyon cells.

**Not supported, supplied from outside the graph:**

- **Walking itself.** No connectome-only model produces coordinated walking from the
  whole nerve cord. Pugliese et al. found rhythm in a front-leg subnetwork for about 3%
  of descending neurons. The full-connectome motor mode, where every leg muscle is
  driven by its own motor neurons through the raw VNC wiring, cannot hold posture. That
  is reported as the honest result, and a stepping-pattern generator fitted to 100 real
  walking trajectories (median 9.5 Hz step, 1.7 cm/s, 12° RMS joint-angle error) sits
  between the descending neurons and the legs instead.
- **Spontaneous behaviour.** Bout structure is not in the wiring. Walk bouts (lognormal,
  median 2.2 s), pauses (1.4 s), grooming in 20% of pauses, saccades at 0.7 per second
  walking with 65% alternation, post-feeding local search: all of this comes from an
  endogenous module with sources in the ethology literature (Maye 2007, Seeds 2014,
  Geurten 2014, Dethier 1957). It never writes actuator commands. It delivers excitatory
  conductance to identified descending neurons, so every command still passes through
  the connectome. Conductance rather than current, because the embodied network holds
  those neurons in a high-conductance state with inhibition about three times the leak,
  and 9 mV of injected current moved them by about 2 mV.
- **Escape gating.** Without it the fly jumped repeatedly into walls, because a wall
  you walk into looms on the eye, and so do your own grooming legs. Real flies separate
  these by touch, matched optic flow and efference copy.
- **The escape jump and righting**, as explicit motor programs. The jump lands upright
  in 24 of 24 trials. Leg-only righting never works because the legs cannot reach the
  floor from the back, and the wing-assisted program rights the fly in 4 of 6 inverted
  starts.

**Weakly supported, and reported as such:**

- Looming escape is intermittent: 2 of 10 test looms produced an escape. The takeoff
  neurons reach their 70 Hz trigger during self-motion and grooming, and real looms
  reach only 70 to 100 Hz, so the discriminator has essentially no margin. Pathway-
  specific fitting of the LC4, LPLC2, giant fibre, DNp02 and DNp04 chain is the top
  open item.
- Turning away from touched obstacles and from heat. The connectome responds to both
  senses but steers away only weakly.
- Feeding completes only with an endogenous stop and hunger-gated MN9 drive. The
  model's own sugar-stop pathway is too weak on its own.

## Neuromodulation: two negatives worth more than a positive

The most instructive part of the whole-brain work is the octopamine chain, because it
was built faithfully and did not do what the literature says it should.

The chain runs as follows. Sugar level sets AKH, which is secreted outside the CNS and
so is not in the connectome, and insulin, from 16 insulin-producing cells that are. AKH
excites and insulin inhibits 17 octopaminergic cells (Yu et al. 2016). 37 octopamine
neurons release in proportion to their firing, and release lowers the spike threshold of all 12,851 of their targets by
up to 2 mV. Receptor types per cell are not in the connectome, so all targets are
treated alike.

Three model changes were needed to make this work at all. Octopamine's fast synapses
were removed from the LIF graph, since the cells have none. A slow
afterhyperpolarisation (threshold up 0.5 mV per Hz of the last 2 s) was added, because
without it the modulatory neurons switched between silence and 100 Hz for small
changes in input. And their resting thresholds were calibrated so a fed fly's
octopamine cells sit at 2 Hz instead of the 100 to 200 Hz the raw wiring produced.

Then the genotype experiment, matching Yang et al. 2015 and Lee and Park 2004:

| genotype | fraction moving, fed | starved | octopamine Hz, fed → starved |
|---|---|---|---|
| wild type | 0.55 | 0.73 | 3.0 → 13.4 |
| Tβh null (no octopamine synthesis) | 0.51 | 0.56 | 1.8 → 10.7 |
| AKHR null | 0.64 | 0.65 | 2.5 → 7.4 |
| direct (modulation on, bout rules blind to it) | 0.60 | 0.57 | 3.0 → 13.2 |

The wild type and the two knockouts match the published phenotypes. The fourth row is
the negative. When octopamine acts on the connectome but the bout rules are not allowed
to read arousal, starved flies walk *less* (1.1 versus 1.3 cm/s). The wiring gives a
reason: among the descending neurons the octopamine cells contact, the steering and
backward-walking neurons receive more octopamine synapses than the forward-walking ones.
A correctly wired, correctly calibrated modulatory broadcast produces the wrong sign of
behavioural change, because the target distribution favours turning over forward drive.

The second negative concerns the loom. Removing octopamine's fast synapses cost the
giant fibre its response to a tethered loom (0.8 spikes → 0) and dropped the takeoff
neurons from 45 to 25 Hz, apparently because the optic-lobe octopamine cells had been
adding visual gain through synapses that should have been modulatory. Refitting
recovered the takeoff neurons (about 30 Hz against 2 Hz for self-motion) but not the
giant fibre. Implementing the real mechanism, a locomotor corollary discharge that
raises optic-lobe octopamine release 2 to 3× during walking (Suver et al. 2012), also
did not bring it back. So the weak link in the loom chain is upstream of, or parallel
to, the octopamine gain, and the model can say that much precisely.

## What this chapter adds to the compiler's picture

The circuit-level chapters found that structure overstates dynamics in three circuits.
The whole-brain run finds the same thing at the level of behaviour, and adds a list of
what fills the gap: nine fitted scalars, one missing electrical synapse, a reafference
gain, an adaptation time constant, a bout-statistics module, and a stepping generator.
Every item on that list is a measurement the connectome does not contain and a
behaviour depends on. That is not an argument against connectomes. It is the most
specific statement I know of about what to measure next.
