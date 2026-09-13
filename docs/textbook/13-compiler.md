# The Compiler: Turning a Detected Operator into an Executed Ensemble

## The problem with three hand-written labs

The first version of the pipeline had a weakness that the circuits themselves exposed.
The ring lab, the phasor lab and the memory lab were three separate scripts, each with
its circuit's populations, observables and perturbations written into the code. That is
"we ran three analyses." It is not "the compiler compiles." If adding a fourth circuit
means writing a fourth script, then the operator catalogue of Chapter 5 is a list of
ideas rather than an input to anything.

The fix is a middle layer: a declarative spec per operator, and one generic runner that
executes any spec.

## Declarative specs

A spec generator reads the operator catalogue and emits, per detected operator, the
circuit-specific content as data. The mushroom-body spec, abbreviated:

```python
{
  "geometry": "memory",
  "operator": "sparse_associative_memory",
  "populations": {"kc": "KC*", "apl": "APL*", "mbon": "MBON*", "dan": ["PPL*", "PAM*"]},
  "roles": {"input": "kc", "output": "mbon", "control": "apl"},
  "odor_size": 200, "odor_overlap": 0.5,
  "edge_params": [
    {"pre": "KC*",   "post": "MBON*", "param": "kc2mb",   "why": "KC->MBON readout gain (44k edges; plastic in vivo)"},
    {"pre": "APL*",  "post": "KC*",   "param": "aplGain", "why": "APL feedback inhibition sets KC sparsity"},
    {"pre": "MBON*", "post": "MBON*", "param": "mbRecur", "why": "MBON->MBON recurrence (936 edges)"}],
  "tonics": [{"pop": "mbon", "param": "mbonTonic"}],
  "grid": {"kc2mb": [0.5, 1, 2], "aplGain": [0.5, 1, 2], "mbonTonic": [0, 4], "mbRecur": [1]},
  "perturbations": [
    {"name": "apl_silence",  "silence": "apl", "why": "does separation survive without feedback inhibition?"},
    {"name": "mb_recur_off", "param": "mbRecur", "set": 0}],
  "hypotheses": ["gain_controlled", "linear_passthrough", "collapsed", "silent"],
  "provenance": {"signature": "...", "evidence": [...]}
}
```

Populations resolve by type prefix, so `KC*` is every Kenyon-cell subtype. Roles name
the functional slots. Each free axis carries a `why`: the reason the wiring does not fix
it. Each perturbation carries a `why` too. And the provenance block copies over the
evidence items that justified the detection in the first place, so the artifact can be
traced from wiring to claim without opening another file.

The ring spec's axes, for comparison, are EPG→EPG recurrence ("not fixed by synapse
counts"), Delta7→EPG gain ("glutamatergic via GluClα, effective strength uncertain"),
PEN→EPG gain, and EPG tonic bias ("resting excitability unknown"). Its `d7_silence`
perturbation is annotated "top-ranked discriminator in the LIF ensemble." The spec is
where the reasoning lives, in a form a program can consume.

## The generic runner

One script executes any spec against the connectome. It handles everything that is
circuit-independent:

- population resolution, exact and by prefix.
- the ensemble grid over the free axes.
- the probe, perturb, classify and rank loop.
- mechanism attribution by ablating each dynamical element in each member.
- the JSON artifact.

What is *not* generic is the observable geometry: how you measure whether the
computation happened. That lives in a plugin per geometry class:

| geometry | operator | observable |
|---|---|---|
| `ring` | `ring_attractor` | bump phase, width and angular velocity on the circle |
| `linear` | `phasor_vector_shift` | centroid offsets on a column axis, arm by arm |
| `memory` | `sparse_associative_memory` | pattern separation and gain compression |

A fourth operator will need a fourth plugin if its geometry is new. `motion_correlator`,
for instance, needs synaptic delays and direction-selective pairing, which none of the
three plugins expresses. I actually think that is a feature: "what geometry class is
this operator" is itself a meaningful classification, and being forced to answer it is
better than pretending a ring observable applies to a filter bank.

## Does the compiled version reproduce the hand-written one?

Yes, to the precision one should expect:

| circuit | hand-written lab | spec through the runner |
|---|---|---|
| ring, seed 42 | 30 silent / 12 attractor / 6 filter, best `tonic_sweep` 0.414 | 30 / 11 / 7, best `tonic_sweep` 0.393, same top-three set |
| phasor, seed 42 | 13 shifted / 55 passthrough / 4 silent, best `amp_scaling` 0.424 | 11 / 56 / 5, best `amp_scaling` 0.461, plus the arm-coupling mechanism the lab did not test |
| memory | (first run through the runner) | 9 silent / 9 collapsed, 0 gain-controlled |

The differences are one or two members crossing a class boundary, which is the size of
discrepancy you get from two code paths sharing a graph but not a random-number stream
or an integration order. If the two had matched exactly I would have suspected shared
code rather than independent confirmation.

## What "compiled" means now

Adding the mushroom-body operator required one spec entry, about 30 lines of data, and
one geometry plugin, about 60 lines. The runner did the rest. So the compiler claim is
real, narrowly:

> detected operator + measured structure → declarative spec → executed ensemble →
> ranked experiment table, with no circuit-specific code in the loop.

The one remaining hand-authored step is the spec itself. A human still chooses the free
axes, using knowledge of which parameters the wiring leaves open. Automating that is
mechanical, and it is the first item in Chapter 15's list: every unmeasured edge class
becomes an axis, every substrate population becomes a perturbation.

## The artifact schema

Every run writes the same shape: `seed`, `summary` (ensemble size, class counts, best
experiment and its separation), `members` (parameters, baseline observables,
perturbation outcomes and mechanism label per member), `ranked_experiments`, and where
a field model exists, a `cross_formalism` block. The web viewer and the report
generator consume that one schema, so a new circuit's results are browsable the moment
they exist.
