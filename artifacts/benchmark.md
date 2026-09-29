# COMPILEUNIVERSE visibility benchmark

Generated: 2026-09-26T16:05:56.029209+00:00

Host: Linux-6.17.0-35-generic-x86_64-with-glibc2.39; Python 3.12.2; NumPy 2.5.1

GPU: NVIDIA GeForce RTX 4090, 590.48.01

Fixed seed: 20260926. 20,000 rays per scene; 3 measured repeats after one warm-up.

Half of rays aim at sphere centers, with every fifth aimed ray ending before its target; the other half use random directions. This includes deliberate hits, misses, and finite-distance visibility queries.

| Spheres | Backend | Build wall ms | Trace wall ms | Native trace ms | Wall Mray/s | Brute / wall | ID errors | Distance errors |
| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | brute | 0.045 | 0.534 | 0.177 | 37.484 | 1.00x | 0 | 0 |
| 1 | cpu | 0.015 | 0.726 | 0.364 | 27.539 | 0.73x | 0 | 0 |
| 1 | rt | 0.169 | 0.533 | 0.017 | 37.501 | 1.00x | 0 | 0 |
| 100 | brute | 0.059 | 4.174 | 3.823 | 4.791 | 1.00x | 0 | 0 |
| 100 | cpu | 0.037 | 2.759 | 2.404 | 7.250 | 1.51x | 0 | 0 |
| 100 | rt | 0.247 | 0.522 | 0.023 | 38.325 | 8.00x | 0 | 0 |
| 1000 | brute | 0.449 | 36.429 | 35.942 | 0.549 | 1.00x | 0 | 0 |
| 1000 | cpu | 0.334 | 6.777 | 6.410 | 2.951 | 5.38x | 0 | 0 |
| 1000 | rt | 0.331 | 0.525 | 0.031 | 38.119 | 69.43x | 0 | 0 |

All trace times are medians. Wall time includes Python, input/output handling, native calls, and GPU transfers/synchronization when applicable. Initialization and geometry construction are excluded from trace time and reported separately.

Native trace time means CPU traversal for cpu/brute and device launch time for rt. These columns are different timing scopes: no speedup is computed from GPU device-only time versus CPU wall time. The difference between RT wall and native time includes more than transfer cost.

Build wall time includes set_spheres and geometry upload/build when applicable. Native build time is device-only for RT and native CPU construction for cpu/brute; it and every timing sample are in the JSON. Moving geometry can require another build, so static-scene trace throughput is not whole-animation throughput.

Parity uses the brute backend on exactly the same input. Independent float64 geometry validation is provided by tests/test_visibility.py. Distance tolerance: rtol=5e-4, atol=2e-3. Exact primitive IDs must agree.

This measures visibility queries only. It does not measure character selection, ANSI encoding, terminal display, scene compilation, or full application FPS.

- brute: initialization 0.213 ms.
- cpu: initialization 0.082 ms.
- rt: initialization 178.106 ms.

Result: **PASSED**.
