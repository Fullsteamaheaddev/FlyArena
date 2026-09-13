# The Data and the Canonical IR

## The object

The analysis runs on the male *Drosophila* CNS connectome (maleCNS): 165,122 neurons,
10,511,038 edges, 104,213,652 synapses, annotated with predicted neurotransmitters
per neuron (acetylcholine, GABA, glutamate, dopamine, serotonin, octopamine,
histamine, or *unknown* — and unknown is carried honestly rather than guessed).

Two properties of the data matter for everything downstream:

- **Edges carry synapse counts, not conductances.** A weight of 25 means "25
  synaptic contacts were reconstructed," not "this synapse moves the postsynaptic
  potential by X millivolts." The mapping count→conductance is an assumption —
  probably the single most consequential one in the whole pipeline (Chapter 10 shows
  it failing informatively).
- **Neuron types are granular and structured.** `KCg-m`, `KCab-s`, `MBON01`–`MBON35`,
  `PPL103`, `PEN_a`/`PEN_b`, `EPG`. Populations are selected by type pattern, and
  hemispheric side (`_L`/`_R` suffixes) is preserved — the central complex analysis
  in Chapters 6–8 depends on it.

## The canonical IR

`connectome_ir.py` lowers each connectome into a species-agnostic intermediate
representation:

```python
load_fly()   # maleCNS binary dump -> IR
load_worm()  # Cook 2019 C. elegans hermaphrodite CSVs + NT map -> IR
```

The IR is deliberately minimal — enough for graph-theoretic and dynamical analysis,
nothing more:

| field | content |
|---|---|
| `N`, `edges`, `synapses` | sizes |
| `types` | per-neuron type labels |
| `meta` | side, superclass, class annotations |
| `nt` | per-neuron predicted transmitter |
| CSR adjacency | `indptr` / `indices` / `weights` |

Why an IR at all? Because the analysis passes — flow depth, motifs, sign structure,
spectral properties — should not know or care which species produced the graph. The
IR is what lets a *comparison* be meaningful rather than rhetorical.

## Cross-species calibration

Running the same IR through the same passes gives the two animals side by side:

| quantity | fly (165,122 cells) | worm (454 cells) |
|---|---|---|
| forward weight fraction | 0.375 | 0.118 |
| feedback weight fraction | 0.124 | **0.717** |
| lateral weight fraction | 0.501 | 0.165 |
| excitatory / inhibitory / unsigned | 0.612 / 0.382 / 0.005 | 0.216 / 0.168 / **0.616** |
| crossing (bilateral) weight | 0.218 | 0.374 |
| inhibitory fraction of crossing | 0.442 | 0.158 |
| cell types | 11,752 | 169 |

Read carefully, this table is a small textbook in itself:

- **The worm is a feedback machine; the fly is a layered one.** 72% of worm synaptic
  weight sits on edges that point backward in the DAG ordering, versus 12% in the
  fly. The fly's wiring is dominated by *lateral* edges (50%) — connections within a
  processing layer. Different animals, genuinely different graph regimes.
- **The worm's sign structure is mostly unknown** (62% unsigned), the fly's mostly
  known (0.5% unsigned). Any cross-species conclusion that depends on sign is
  weighted accordingly.
- **Crossing inhibition is qualitatively different.** In the fly, crossing edges are
  *more* inhibitory than ipsilateral ones (44% vs 38%) — consistent with bilateral
  comparison being done by inhibition. In the worm the pattern inverts.

This comparison does double duty. Scientifically it is interesting; methodologically
it is the sanity check that proves the passes are species-agnostic rather than
fly-shaped code that happens to run on the worm.

## Where the IR stops

The IR answers "what is wired to what, how strongly, with what sign." It cannot
answer "what does it do" — that requires dynamics, which is the subject of Chapter 5
onward. The boundary is deliberate and it is the book's central methodological
commitment: **structure first, then dynamics, and never let the dynamics stage
silently re-import structural assumptions.**

One concrete example of that discipline: the transmitter table maps each synapse's
effect sign from the *presynaptic* cell's predicted transmitter, with *unknown*
yielding no effect rather than an invented sign. When APL's entry was found to read
`undefined` in an early diagnostic, the correct response — documented in Chapter 10 —
was to trace the sign path rather than to patch it.
