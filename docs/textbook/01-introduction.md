# Introduction: What Does a Wiring Diagram Compute?

## The question

A complete connectome — every neuron, every synapse — is now a real object you can hold
in memory. For the male *Drosophila* central nervous system the object has 165,122
neurons and 104 million synapses. The natural question, and the one this book is about,
is what it *computes*.

Not "what does it correlate with" — neuroscience has good tools for that — but the
stronger claim: given only the wiring diagram, can we recover the algorithm? Can we say
which populations form a continuous attractor, which compute a vector rotation, which
implement a content-addressable memory — and then *prove it* in the only way a model
can be proven, by predicting what happens when you break it?

The project this book documents attempts exactly that. The working metaphor is a
**compiler**:

```
biology
  -> canonical neural IR
  -> motifs and structural signatures
  -> dynamical primitives
  -> competing executable hypotheses
  -> validated computational models
  -> compact algorithms / BioISA instructions
  -> engineering implementations and benchmarks
```

The compiler analogy is chosen carefully. A real compiler does not understand a
program by reading it once; it lowers source to an intermediate representation, runs
analysis passes over the IR, and emits artifacts that can be executed and tested.
Likewise here: the connectome is lowered to a species-agnostic IR, analysis passes
detect candidate *operators* (computational primitives), and each operator is
instantiated as an *ensemble* of executable models whose disagreements are resolved by
predicted experiments.

## The calibration target

The first circuit is the fly's heading system in the central complex — the ring
attractor formed by EPG, Delta7, PEG and PEN neurons. It is chosen for a specific
reason: it is the best-understood circuit in any complete connectome. Physiologists
already know it maintains a bump of activity encoding heading; they have recorded it,
perturbed it, and measured the consequences. That makes it a calibration instrument:

> Can the machinery recover a known computation from structural constraints and
> limited functional evidence, without the answer being written into the extraction
> rules?

If it cannot recover this circuit, it cannot be trusted anywhere. If it can — and can
also say *where it is uncertain* — the same machinery applies to the operators nobody
understands yet.

## The desired output

Not a simulation. A statement like this one:

> Across plausible parameterizations, this circuit consistently supports a
> low-dimensional heading state. Two mechanisms remain compatible with the
> observations. Perturbing this cell population under this stimulus distinguishes
> them.

Three kinds of agreement are tracked separately throughout, because conflating them is
the classic error in computational neuroscience:

- **Task-performance agreement** — models that solve the same problem.
- **Neural-response agreement** — models whose population activity matches.
- **Perturbation-prediction agreement** — models that break the same way.

Models routinely agree on the first while disagreeing entirely on the third. The whole
methodology in this book is built to exploit that asymmetry: find the perturbation
where surviving hypotheses diverge, rank it, and check it against real data.

## What this book contains

The chapters follow the pipeline order:

- **Chapter 2** — the data and the canonical IR: what a connectome looks like as a
  data structure, and how the same loader handles the fly and the worm.
- **Chapter 3** — structure before dynamics: what the graph alone tells you, and the
  cross-species comparison that calibrates which numbers are unusual.
- **Chapter 4** — the operator layer: twelve detected computational primitives, their
  evidence, and their counterevidence.
- **Chapter 5** — the ensemble method: why wiring constrains a family of models, not a
  model.
- **Chapters 6–10** — the three circuits worked in detail: the ring attractor (in both
  a spiking ensemble and a continuous field model), the PFN→hΔB vector shifter, and
  the mushroom-body memory circuit.
- **Chapter 11** — the engineering benchmark: the decompiled estimator against
  standard algorithms, honestly matched.
- **Chapter 12** — the compiler machinery itself: declarative specs and the generic
  ensemble runner.
- **Chapter 13** — synthesis: what the three circuits jointly teach, and what the
  connectome provably cannot determine.

## Honesty conventions

Three rules govern every claim in this book, and they are worth stating up front
because they are unusual:

1. **Negative results are recorded, not tuned away.** When a mechanism fails under
   noise, that failure is a finding.
2. **Baseline comparisons are matched.** A biological estimator is never declared
   superior to a Kalman filter without giving the Kalman filter its fair parameters.
3. **Formalism disagreement is data.** When the spiking model and the field model
   disagree, the disagreement is published in the artifact and resolved against
   biology — not smoothed over.

The reader should hold this book to the same standard.
