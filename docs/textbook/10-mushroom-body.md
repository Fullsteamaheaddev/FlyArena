# The Mushroom Body: An Honest Negative

The third circuit is the stress test the compiler was built for — an operator with no
spatial geometry at all. `sparse_associative_memory` targets the mushroom body: 4,064
Kenyon cells, the giant feedback interneuron APL, 97 MBON output neurons, and ~340
dopaminergic PPL/PAM cells. The computation is pattern separation and associative
readout — nothing like a ring or a column map.

## The circuit

The wiring (Chapter 3) reads like a textbook associative memory:

- **Expansion**: 282 PNs → 4,064 KCs (~6× ratio), each KC sampling a median of ~56 PN
  inputs through ~3 claws — the random-projection step.
- **Normalization**: APL covers 100% of KCs and is driven by 100% of them — the
  classic divisive-normalization loop.
- **Readout**: KC→MBON (44k edges, median 313 KCs per MBON).
- **Teaching**: DAN→MBON in the same compartment (70% of DAN-MBON pairs).

## The protocol

The `memory` geometry in `run_ensemble.mjs` drives two overlapping KC "odor" patterns
(200 cells, 50% shared) directly, and measures:

- **separation / expansion** — cosine similarity between the two MBON output vectors
  relative to the KC input overlap;
- **compression** — KC spike count at 2× drive vs 1× drive (the gain-control probe);
- the ensemble sweeps `{kc2mb, aplGain, mbonTonic, mbRecur}` (18 members).

## The result: gain control is not established by the wiring

18 members classified: 9 `silent`, 9 `collapsed`/`linear_passthrough` — **zero
`gain_controlled`**. The direct diagnostic is decisive:

| drive | KC spikes (400 KCs) | APL spikes |
|---|---|---|
| 60 | 4,163 | 13, 8 |
| 150 | 9,144 | 16, 11 |
| 300 | 14,338 | 16, 11 |

APL **saturates** at ~16 spikes while KC output scales 3.4×. The feedback cannot
compress because the recruitment saturates — and the structural reason is that
APL→KC is only ~4,210 edges for 4,064 KCs: **roughly one synapse per KC**. At
connectome-count weights, the divisive-normalization loop is too sparse to matter.

## What this means — and what it does not

This is the lab working as intended, and the negative result is the finding:

- **The wiring does not establish gain control.** Whether the real MB normalizes
  depends on per-synapse conductance — a parameter the connectome simply does not
  carry. The ensemble correctly reports "insufficient evidence," expressed as a
  missing hypothesis class rather than a tuned affirmative.
- **MBON readout is linear, as expected.** `expansion < 1` for 50%-overlap odors is
  correct — decorrelation happens upstream (odor→KC), not at the readout. Driving
  KCs directly bypasses the layer where the memory's actual computation lives, so
  the MBON transform being near-linear is the *right* answer, not a failure.
- **APL's sign was a real bug risk.** Early diagnostics found `nt: undefined` for
  APL — which in this simulator means *edges contribute nothing*. APL turned out to
  be correctly GABAergic (2 cells, both `gaba`), so the loop is inhibitory as it
  should be; the weakness is quantitative, not a sign error. But the check was
  necessary — a sign bug would have produced the same null result invisibly.

## The discriminating experiments

`apl_silence` and `mb_recur_off` are the perturbations; at the current
parameterization they are nearly undiscriminating (~0.53 separation, essentially a
coin flip across members) because APL is too weak for its silencing to matter. That
is itself informative: **the experiment is only discriminating where the mechanism
is present** — if a future calibration gives APL enough conductance to fire, the same
perturbation becomes the top discriminator, and the ensemble will have predicted
which measurement to make.

## The lesson

The mushroom-body chapter is the book's clearest statement of the project's core
discipline: the connectome constrains a *family*, and the family's honest output
includes "we cannot determine this from structure." The sparse-memory operator is
detected with confidence 0.55, its wiring is canonical, and its key mechanism is
provably underdetermined — three facts that coexist without contradiction.
