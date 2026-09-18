# 13. Gait

## Pattern generator
Each leg joint follows off + a1·cos(φ + p1) + a2·cos(2φ + p2) + a3·cos(3φ + p3), shared by left and right
legs of a pair. A tripod couples left-front, right-middle, and left-hind, with the other three in antiphase.
Claws adhere during stance. Commands scale it:
- speed sets amplitude and frequency, from half to full; amplitude is smoothed over 150 ms so starts and
  stops do not hop
- stance duty shortens slightly at higher speed
- turning scales coxa stride per side
- negative speed reverses the phase

Parameters live in `public/body/gait.json` (7 numbers per joint). A 5-number file still walks (`a3 = 0`).
The previous 2-harmonic fit is `body/gait/gait_2h.json`.

## History
| Version | Method | Result |
|---|---|---|
| First | CMA-ES for forward distance | Rejected: hopped, 7 cm/s, airborne 24% of the time |
| Constrained | At least 3 feet down, bounce and body-contact penalties, 3 cm/s cap | 2.9 to 3.4 cm/s, stable, heading drift |
| Multi-condition | Forward, both turns, slow, backward together | Straight walking and backward walking fixed |
| Real-fly anchored, 2-harmonic | Start from FlySuite data, penalise drift from it | 12° RMS from real flies, stable |
| 3-harmonic, current | Third cosine, FlySuite re-fit, CMA-ES from the 2-harmonic gait | 8.9° RMS, stable, less lateral drift |

## Real-fly data
`scripts/gait_from_data.py` reads 100 FlySuite walking trajectories. Legs are phased from the coxa angle
with a Hilbert transform, joint angles are averaged over phase, and three harmonics are fitted.
Real flies stepped at a median 9.5 Hz and 1.7 cm/s, in a clean tripod.

## Current performance

| Condition | Result over 1.5 s |
|---|---|
| Forward | 3.7 cm, heading drift +7°, lateral 0.08 cm |
| Turn left / right | about +293° / −286° |
| Slow | 1.3 cm, stable |
| Backward | 3.2 cm back, heading drift +8° |
| Brain-like fluctuating commands | 0/8 flips in 6 s at every clamp, including 150 ms smoothing |

## Scripts
`gait_opt.py`, `gait_opt2.py`, `gait_from_data.py`, `gait_check.py`, `gait_compare.py`, `gait_stress.py`,
`gait_export.py`.
