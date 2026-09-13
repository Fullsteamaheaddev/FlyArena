# Introduction: What Does a Wiring Diagram Actually Compute?

## The question

A few years ago, "the complete connectome of a fly" was an aspiration. Today it is a
file. The male *Drosophila* central nervous system, as reconstructed by Janelia FlyEM and
Google Research, is 165,122 neurons and 104 million synapses, and the whole graph loads
into memory on a laptop in a few seconds. So the obvious next question is: now that we
have it, what does it *compute*?

I want to be precise about what I mean by this, because there is a weak version of the
question and a strong version, and most of the interesting content is in the difference.

The weak version is: given recordings of neurons, what do they correlate with? This is a
good question and neuroscience has excellent tools for it. But it is not the question a
wiring diagram lets you ask for the first time.

The strong version is: given *only* the wiring, with no recordings at all, can you recover
the algorithm? Can you say which cell populations form a continuous attractor, which ones
rotate a vector, which ones implement an associative memory? And can you say it in the
only form that can actually be tested, namely as a prediction of what happens when you
silence a specific named cell type?

This book is about a project that tries to answer the strong version, and about what it
found. The short summary of what it found is: the wiring gets you surprisingly far, it
gets you less far than the wiring itself seems to promise, and the size of that gap is
one of the most useful numbers you can compute.

## Thinking of it as a compiler

The mental model the project uses is that of a compiler, and I think the analogy is worth
taking seriously rather than treating as a slogan.

A compiler does not understand a program by reading it once. It lowers the source into an
intermediate representation, runs a series of analysis passes over that representation,
and emits artifacts that can be executed and checked. Each stage is narrow and testable
on its own. The pipeline here does the same thing to a nervous system:

```
biology
  -> canonical neural IR
  -> motifs and structural signatures
  -> candidate operators
  -> ensembles of executable models
  -> ranked discriminating experiments
  -> validated models and reduced algorithms
  -> engineering benchmarks
```

The connectome is lowered to a species-agnostic intermediate representation (the same
loader also reads the worm). Analysis passes detect candidate *operators*: the
computational primitives the wiring appears to implement. Each operator becomes not a
model but a *family* of executable models, one per setting of the parameters the wiring
does not fix. And the disagreements inside that family become the product: a ranked list
of experiments that would tell the family members apart.

The reason the analogy matters is that it tells you where to be suspicious. A compiler
pass that silently assumes something about the source is a bug. Likewise, a dynamics stage
that silently re-imports an assumption about the structure is a bug, and a lot of the
discipline in this book is about catching that.

## Two very different ways to run the same graph

The project actually runs the connectome in two ways, and they fail in different places,
which is the point.

The first way is the compiler proper. You analyse the graph structurally, you build small
circuit-level model ensembles (tens of models, each with a few hundred to a few thousand
cells), and for one circuit you also build a continuous field model. This is Parts I to
III. It produces sharp claims about specific circuits and specific experiments.

The second way is to run the whole thing. All 165,122 neurons as conductance-based
integrate-and-fire units, inside a physics-simulated body with a compound eye, taste,
touch, smell and heat, in a web browser. This is Chapter 14. It produces a different kind
of evidence: which behaviours the raw wiring supports once it is embodied, and which
behaviours had to be supplied by code that lives outside the graph.

If you only did the first, you could fool yourself into thinking that a circuit-level
success generalises. If you only did the second, you could not tell *why* anything works
or fails. Doing both is more work but it is the only way to get an honest picture.

## Why start with the heading circuit

The first circuit worked end-to-end is the fly's heading system in the central complex:
the ring attractor formed by the EPG, Delta7, PEG and PEN neurons. The reason is simple.
It is the best-understood circuit in any complete connectome. Physiologists already know
it holds a bump of activity that encodes heading, they have imaged it, they have perturbed
it, and they have written down what happened.

That makes it a calibration instrument. The test is:

> Can the machinery recover a known computation from structure plus limited functional
> evidence, without the answer being written into the detection rules?

If it fails here, nothing else it says can be trusted. If it succeeds *and* can say where
it is uncertain, then the same machinery can be pointed at circuits nobody understands
yet, and its uncertainty statements there mean something.

## What a good answer looks like

Let me be explicit about what the pipeline is designed to output, because it is
not a simulation and it is not a single model. It is a statement like this one:

> Across the parameterizations the wiring permits, this circuit supports a
> low-dimensional heading state, but only in a narrow gain regime. Three mechanisms
> remain compatible with baseline activity. Silencing this cell type distinguishes them.

To get there, the project tracks three different kinds of agreement between models and
refuses to conflate them:

1. **Task-performance agreement.** The models solve the same problem.
2. **Neural-response agreement.** The models' population activity matches.
3. **Perturbation-prediction agreement.** The models break the same way.

Models very often agree on (1) while disagreeing completely on (3). That asymmetry is not
a nuisance, it is the resource the whole method runs on: find the perturbation where the
surviving hypotheses diverge the most, rank it, and go check it against real data.

## How the book is organised

Part I is about the data and what you can learn from the graph before running any
dynamics. Chapter 2 covers the connectome as a data structure and the intermediate
representation. Chapter 3 covers the generic structural passes: flow, sign, motifs,
spectrum, and a cross-species comparison against the worm. Chapter 4 walks through the
circuits region by region.

Part II is the method. Chapter 5 presents the operator catalogue, twelve detected
computational primitives with their evidence and their counterevidence. Chapter 6 explains
why a connectome constrains a family of models rather than a model, and how a family gets
turned into a ranked experiment list.

Part III works three circuits in detail. Chapters 7 to 9 cover the heading circuit as a
spiking ensemble, as a continuous field, and then the argument between the two, which
published data settled. Chapter 10 covers the PFN to hΔB vector shift, where the wiring
overstates. Chapter 11 covers the mushroom body, where the method returns a negative.

Part IV assesses. Chapter 12 benchmarks the decompiled heading estimator against standard
filters, with the baselines given fair parameters. Chapter 13 describes the compiler
machinery that turns an operator into an executed ensemble by writing a spec instead of a
script. Chapter 14 reports what happened when the whole connectome was run in a body.
Chapter 15 pulls the results together and lists what the connectome provably cannot tell
you.

## Three rules I would ask you to hold the book to

1. **Negative results are recorded, not tuned away.** When a mechanism fails under
   noise, or a circuit does not do what the wiring suggests, that is reported as a
   finding and left in the artifact.
2. **Baselines are matched.** A biological estimator is never declared better than a
   Kalman filter that was handicapped. Chapter 12 goes out of its way on this.
3. **Disagreement between formalisms is data.** When the spiking model and the field
   model disagree, the disagreement is written into the output file with a flag, and then
   resolved against biology, not smoothed over.

If you find a place where the book breaks one of these, that is a bug in the book.
