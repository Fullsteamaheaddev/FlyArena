# Appendix A: Reproducing the Numbers

Every number in this book comes from a committed script and, in most cases, a committed
artifact. The random-number generators are seeded, so rerunning a stage reproduces the
cited table. Where a stage was rerun for this draft (the benchmark in Chapter 12) the
new numbers replaced the old ones and the text says so.

## Pipeline order

```bash
# IR and generic structure (Chapters 2 to 4)
python3 scripts/algo_structures.py    # fly structural report, ~3 min -> public/data/algo_structures.json
python3 scripts/connectome_ir.py      # fly + worm -> canonical IR
python3 scripts/algo_ir.py            # IR -> generic cross-species report -> public/data/ir_generic.json
python3 scripts/check_structures.py   # fly-through-IR reproduces algo_structures.json
node scripts/validate_dynamics.mjs    # structure-vs-LIF checks -> public/data/dynamics_validation.json

# Operator detection (Chapter 5)
python3 scripts/operators.py          # structure report -> public/data/operators.json

# Ensembles (Chapters 6, 7, 10, 11)
python3 scripts/ensemble_spec.py      # operators -> public/data/ensemble_specs.json
node scripts/run_ensemble.mjs ring_attractor
node scripts/run_ensemble.mjs phasor_vector_shift
node scripts/run_ensemble.mjs sparse_associative_memory
node scripts/hypothesis_lab.mjs 42    # the hand-written ring lab, seed 42
node scripts/phasor_lab.mjs 42        # the hand-written phasor lab

# Field model and perturbations (Chapters 8, 9)
python3 scripts/ring_pde.py           # self-check: bump, integration, landmark remap
python3 scripts/perturb_pde.py        # -> public/data/perturb_pde.json

# Benchmark (Chapter 12), ~40 s
python3 scripts/bench_heading.py

# Whole-brain model (Chapter 14)
node scripts/calib_eval.mjs           # one parameter set against the benchmark suite
node scripts/calib_search.mjs         # cross-entropy search
node scripts/behavior_report.mjs      # closed-loop scenarios
node scripts/sensory_screen.mjs       # which senses drive which commands
node scripts/starvation.mjs           # the genotype table
node scripts/neuromod_calib.mjs       # modulatory-neuron resting thresholds
```

## Key artifacts

| artifact | content |
|---|---|
| `public/data/algo_structures.json` | full structural report for the fly |
| `public/data/ir_generic.json` | cross-species IR comparison |
| `public/data/dynamics_validation.json` | Delta7 kernel, PEN push field and APL sparsening in the LIF model |
| `public/data/operators.json` | the operator catalogue |
| `public/data/ensemble_specs.json` | the declarative specs |
| `public/data/hypothesis_lab.json` | ring ensemble, ranked experiments, cross-formalism block |
| `public/data/ring_attractor_lab.json` | the same circuit through the generic runner |
| `public/data/phasor_lab.json`, `phasor_vector_shift_lab.json` | PFN→hΔB ensemble, lab and runner |
| `public/data/sparse_associative_memory_lab.json` | memory ensemble |
| `public/data/perturb_pde.json` | field-model perturbation curves |
| `public/data/brain_params.json` | the fitted whole-brain parameters |

## Notation

- Ensemble *members* are parameter points. *Classes* are behaviour labels assigned by
  the probe. *Mechanisms* are the perturbation-outcome subclasses within a class.
- Separation scores are the fraction of member pairs an experiment places in different
  classes, in [0, 1]. A score near 0.5 in a two-class ensemble is a near-even split.
- Bump widths are full width at half maximum in degrees. Benchmark scores are RMS
  wrapped error in radians.
- *Wired* means read from synapse counts. *Realised* means measured in simulation.
- Column offsets in the central complex are in protocerebral-bridge glomeruli (45°
  each, 8 per side). A PEN shift of 1.5 columns is one wedge of 22.5°.
