# The Compiler: Specs and the Generic Runner

The pipeline's first version had a weakness the circuits themselves exposed: the
three labs were hand-written scripts, each encoding its circuit's populations,
observables, and perturbations in bespoke code. That is "we ran three analyses," not
"the compiler compiles." The fix is the missing middle layer.

## Declarative specs

`ensemble_spec.py` emits a spec for each detected operator — the circuit-specific
content as data:

```python
{
  "geometry": "memory",          # which plugin interprets the observables
  "operator": "sparse_associative_memory",
  "populations": {"kc": "KC*", "apl": "APL*", "mbon": "MBON*", "dan": ["PPL*","PAM*"]},
  "roles": {"input": "kc", "output": "mbon", "control": "apl"},
  "odor_size": 200, "odor_overlap": 0.5,
  "free": {"kc2mb": [...], "aplGain": [...], "mbonTonic": [...], "mbRecur": [...]},
  "perturbations": {"apl_silence": {...}, "mb_recur_off": {...}},
}
```

Populations resolve by type prefix (`KC*` → all Kenyon-cell types); roles name the
functional slots; `free` lists the gain axes the wiring does not fix; perturbations
are named interventions. The spec carries *provenance* — each axis is annotated with
why it is free (count→conductance calibration, tonic bias unknown, etc.).

## The generic runner

`run_ensemble.mjs` executes a spec against the connectome. It handles the parts that
are circuit-independent:

- population resolution (exact and prefix patterns);
- the ensemble grid over free axes;
- the probe/perturb/rank loop;
- hypothesis classification and mechanism counting;
- JSON artifact output.

What is *not* generic is the observable geometry — how "did the computation happen"
is measured. Three geometry plugins exist:

| geometry | used by | observable |
|---|---|---|
| `ring` | `ring_attractor` | bump phase, width, angular velocity on S¹ |
| `linear` | `phasor_vector_shift` | offset column vectors, phasor transforms |
| `memory` | `sparse_associative_memory` | pattern separation, gain compression |

A fourth operator (e.g. `motion_correlator`, which needs synaptic delays and
direction-selective pairing) will require a new plugin — and the design question
becomes "what geometry class is this," which is itself a meaningful classification.

## What "compiled" now means

Adding the mushroom-body operator required: one spec entry (~30 lines of declarative
data) plus one geometry plugin (~60 lines). The runner did everything else. That is
the compiler claim made real — narrowly, but really:

> The detected operator + measured structure → a declarative spec → an executed
> ensemble → a ranked experiment table, without circuit-specific code in the loop.

The remaining hand-authoring is the spec itself — the free axes are still chosen by a
human who knows which parameters the wiring leaves open. Automating that (every
unmeasured edge class becomes an axis; every substrate population becomes a
perturbation) is mechanical and is the natural next step.

## The artifact schema

Every run emits the same JSON shape: `seed`, `summary` (ensemble size, class counts,
best experiment), `members` (per-parameter outcomes), `ranked_experiments`, and —
where applicable — `cross_formalism` blocks. Downstream tooling (the web viewer, the
report generator) consumes a uniform schema; a new circuit's artifact is
automatically consumable the moment it exists.
