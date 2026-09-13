# The Continuous Field: Deriving the Mechanism

The LIF ensemble answers "does the wiring support an attractor." A different question,
"what mechanism moves the bump," wants a different formalism. Instead of 46 discrete EPG
cells, model the ring as a continuous activity field on the circle, in which the bump
is a solution of a partial differential equation rather than a property of individual
neurons. This is an Amari neural field, and it is the second of the two formalisms the
project uses on the same circuit.

## The model

A ring of n units (256 by default, over 8 columns per side) carries an activity field
u(θ):

```
τ ∂t u = −u + W_d7 * f(u) + recur · K_exc * f(u)
         + pen_input + landmark_input − rn · mean(f(u))
```

The point of the model is that every term is measured or derived, not invented:

- `W_d7` is the Delta7 kernel, the fitted a − b·cos with a = 873 and b = 890.
- `K_exc` is a narrow local-excitation kernel standing for the EPG/PEG recurrence. Its
  gain, `recur`, is the one free parameter.
- `pen_input` is the velocity pathway, in several formulations discussed below.
- `landmark_input` is ring-neuron-style disinhibition: global suppression with a gap at
  the landmark bearing, which anchors the bump to a cue.
- `rn · mean(f(u))` is a second, shallow inhibitory channel that scales with total bump
  mass. It was not in the first version of the model. Chapter 9 explains why it was
  added.

`f` is a saturating nonlinearity. Without it, recurrent excitation runs away, and real
neurons have rate saturation, so the model has to as well.

## Deriving the velocity gain instead of tuning it

The PEN pathway shifts the bump during rotation. The wiring says "shift by about 1.5
columns per side." It does not say at what *gain* the shift should be applied, and
earlier versions of the project tuned that number by hand. The field model lets you
derive it.

Write the bump as a travelling profile `u*(θ − φ(t))` and the PEN arm as an extra shifted
kernel, `v · K_s * f(u)`. Because the field is translation-invariant, the bump has a
marginal direction: you can slide it around the ring at no cost. Project the PEN
perturbation onto that direction, which is the derivative of the bump profile `u*'`, and
you get the drift rate in closed form:

```
−τ φ̇ ⟨u*', u*'⟩ = v ⟨u*', K_s * f(u*)⟩
   →   φ̇ = v · ⟨u*', K_s * f(u*)⟩ / (τ ⟨u*', u*'⟩)
```

Both inner products are numbers you can compute from the kernels, so the integration
gain is a derived property of the wiring: pen_gain ≈ 0.27, and the theory predicts a
drift of about 3.7 per unit drive. There is one subtlety that mattered in practice. The
inner products have to be evaluated on an *equilibrated* bump. Calibrating on the
unrelaxed seed profile gave a wrong gain and a frozen benchmark, and it took a while to
find that.

With the literal shifted-synapse kernels at the predicted gain, the field tracks clean
velocity at about 0.85× the ideal. The 15% deficit is a second-order effect: the shifted
input also distorts the bump's shape, which the leading-order projection ignores.

## Four ways to move a bump, and which ones survive noise

The real test is fluctuating velocity, because a mechanism that integrates clean input
and falls apart under noisy, sign-flipping input is not the fly's mechanism. Four
formulations of the PEN pathway were implemented and run through the noisy benchmark on
the single-inhibition-channel model:

| mechanism | how velocity enters | noisy RMS error (rad) | what happened |
|---|---|---|---|
| `shifted` | amplitude coding: ω scales a shifted injection into EPG | 1.29 | each injection distorts the bump shape, not just its phase |
| `shifted2` | amplitude coding through a second attractor field | 1.61 | a second field does not repair it |
| `shifted3` | **position coding**: ω displaces a PEN bump, EPG is pulled toward it | 0.60 | works, and predicts an EPG-PEN phase offset |
| `advect` | idealised transport of u itself | 0.41 | the bound the mechanisms approach |

Amplitude coding fails under sign-flipping drive no matter how it is filtered (the PEN
time constant was scanned from 0.02 to 0.3 s) and no matter whether a second field is
added. Position coding halves the error and is robust, but it plateaus at about 0.60
because the EPG bump is always chasing the PEN bump with one stage of lag. Direct
advection is the limit when transport acts on the transported field itself.

Two things fall out of this that are more interesting than the ranking.

First, the 50% gap between `shifted3` and `advect` is the price of indirect transport.
The fly, if it uses position coding, pays for a real mechanism with lag.

Second, and more important, position coding makes a *measurable* prediction that
amplitude coding does not: during rotation the EPG and PEN bumps should be offset in
phase. That is what calcium imaging of the real circuit shows. So the model
discrimination is not just "one of these has lower error." It is "one of these has a
neural signature you can look for, and people have looked, and it is there."

## Why two formalisms

The LIF ensemble and the field model are not redundant, and it would be a mistake to
keep only the one that is easier to run.

The field model can express a graded curve: bump width as a continuous function of
Delta7 suppression. The LIF ensemble can only vote among classes. The LIF ensemble
respects the actual cell-level wiring, including the PEN arm asymmetry and the fact
that there are 46 EPGs and not a continuum. The field model smooths that over but
exposes the mechanism's continuous limit and lets you derive gains instead of tuning
them.

When they agree, you have agreement across model classes, which is much stronger than
agreement across parameters within one class. When they disagree, you have the subject
of the next chapter.
