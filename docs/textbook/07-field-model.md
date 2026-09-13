# The Continuous Field: Deriving the Mechanism

The LIF ensemble answers "does the wiring support an attractor." A different question
— "what mechanism moves the bump" — wants a different formalism: an **Amari neural
field**, a PDE on the ring in which the bump is an emergent solution of a continuous
equation, not a property of 46 discrete cells. `ring_pde.py` implements it.

## The model

A ring of `n` units (n=256 default, 32 columns) carries an activity field `u(θ)`:

```
τ ∂_t u = −u + W_d7 * f(u) + recur · K_exc * f(u) + pen_input + landmark_input − rn·mean(f(u))
```

where each term is measured, not invented:

- `W_d7` — the Delta7 kernel, the fitted `a − b·cos` (a=873, b=890);
- `K_exc` — a narrow local-excitation kernel, the EPG/PEG recurrence term (the one
  free gain);
- `pen_input` — the velocity pathway, in several formulations (below);
- `landmark_input` — ring-neuron-style disinhibition anchoring the bump to a cue;
- `rn·mean(f(u))` — the second inhibitory channel, added after withheld-data
  correction (Chapter 8).

`f` is a saturating nonlinearity — without it, recurrent excitation runs away;
biology has rate saturation, and the model must too.

## Deriving the velocity gain

The PEN pathway shifts the EPG bump during rotation. Naively, the wiring says "shift
by ±s columns" — but at what *gain*? Earlier versions tuned it by hand; the field
model derives it.

A bump `u*(θ − φ(t))` subject to shifted feedback `v·K_s * f(u)` moves by
translation-mode projection — projecting the perturbation onto the bump's marginal
(Goldstone) direction `u*'`:

```
−τ φ̇ ⟨u*', u*'⟩ = v ⟨u*', K_s * f(u*)⟩
   →   φ̇ = v · ⟨u*', K_s * f(u*)⟩ / τ⟨u*', u*'⟩
```

The inner products are evaluated on an *equilibrated* reference bump (a subtlety that
mattered: calibrating on the unrelaxed seed profile gave a wrong gain and a frozen
benchmark). The computed `pen_gain ≈ 0.27` then makes the drift rate a **derived
property of the kernels**, deterministic and parameter-free — the theory predicts
φ̇ ≈ ±3.7 per unit drive, and the model tracks it.

## The mechanism comparison

Four PEN mechanisms were implemented and run through the noisy benchmark:

| mechanism | form | noisy RMS | verdict |
|---|---|---|---|
| `shifted` | literal shifted-synapse feedback, single field | 1.29 | distorts the bump under fluctuating ω |
| `shifted2` | amplitude-coded second field | 1.61 | worse — a second attractor doesn't repair it |
| `shifted3` | **position-coded**: ω displaces a PEN bump, EPG is pulled toward it | 0.60 | works — and predicts an EPG–PEN phase offset |
| `advect` | spectral transport of the field (first-order equivalent of shifted feedback) | 0.41 | the bound the mechanisms approach |

The important result is not the ranking — it is the **mechanism discrimination**.
Amplitude coding fails under noise in every formulation; position coding works at
half the idealized cost and, crucially, predicts a *measurable* signature the
amplitude model does not: the EPG and PEN bumps should be phase-offset during
rotation — which is exactly what the fly literature reports.

The residual gap between `shifted3` (0.60) and `advect` (0.41) is itself a finding:
indirect transport costs ~50% over the theoretical bound — the fly pays for a real
mechanism with lag. And `shifted`'s failure is a falsifiable modeling claim: the
single-field reduction drops something the real two-population PEN circuit needs.

## Why two formalisms

The LIF ensemble and the field model are not redundant — they answer different
questions and disagree informatively (Chapter 8). The field model can express a
graded bump-width curve; the LIF ensemble can only vote among classes. The LIF model
respects the actual cell-level wiring (including PEN arm asymmetry the field model
smooths over); the field model exposes the mechanism's continuous limit. Using both
is the method.
