# The PFN→hΔB Circuit: A Wired Transform That Isn't

The second operator through the lab is `phasor_vector_shift`: PFN neurons project to
hΔB with consistent column offsets (−3 for PFNd, +2 for PFNv per the structural
histogram), suggesting the circuit implements a fixed coordinate rotation — the
"vector shift" that transforms heading into the compass frame the fan-shaped body
uses.

The first-pass lab (72 members over `{pfnGain, hdRecur, fbGain, column}`) measured
whether the realised population response reproduces the wired offsets. The deepened
workup added what the first pass missed: three dynamical mechanisms the wiring shows
but a static-offset analysis ignores.

## The connectome's hidden structure

- **PFN self-recurrence** — 7,970 synapses within PFNd alone. The shift may be
  *generated* by dynamics, not inherited from wiring.
- **hΔB→PFN feedback** — 61 edges. A recurrent loop the offset model treats as
  absent.
- **hΔB recurrence** — the return pathway, previously binary (on/off), swept
  continuously 0–2.

## The finding: the shift is not a constant fold

72 members, hypotheses `{wired_shift: 13, passthrough: 55, silent: 4}` — but the
mechanism split is the result:

| finding | implication |
|---|---|
| **0 of 13 `wired_shift` members are `wired_only`** | The −3-column wiring alone *never* produces the shift — dynamics always participates |
| column sweep never rigid | the transform is *warped* by position, not a clean linear shift |
| PFNv rarely realises +2 | arm asymmetry (20 vs 40 cells) that the structural histogram hides |
| mechanism counts spread across `needs_hdb_recur`, `needs_pfn_recur`, `needs_hd2pfn_feedback` and combinations | the shift is a *hybrid* — wiring biases, recurrence and feedback complete it |

The interpretation changed meaningfully from the first pass. "PFN→hΔB implements a
wired phase shift" is wrong; the truth is "the wiring provides a bias that recurrence
and feedback complete into a shift." A different mechanism class entirely — and one
that makes a different experimental prediction.

## Ranked discriminators

| experiment | score |
|---|---|
| `amp_scaling` | 0.424 |
| `hd_recur_off` | 0.406 |
| `hd2pfn_off` | 0.316 |
| `measure_pfnd_offset` | 0.314 |
| `pfnv_silenced` | 0.312 |
| `sweep_rigidity` | 0.282 |

The newly added feedback loop is already a top-3 discriminator — removing
hΔB→PFN feedback collapses the shift in members that need it. `amp_scaling`
top-ranks because the phasor arms' amplitude asymmetry (the 20-vs-40 cell imbalance)
is itself mechanism-dependent.

## Why this matters for the method

The phasor circuit is the project's clearest demonstration that **structure
overstates**: the wiring says "−3 shift," the dynamics say "−3 is an upper bound that
recurrence partially realizes and position-dependently warps." A naive reader of the
connectome would have published the wired offset as the circuit's function. The
ensemble says the function is a dynamical completion of a structural bias — and says
*which perturbation* proves it.
