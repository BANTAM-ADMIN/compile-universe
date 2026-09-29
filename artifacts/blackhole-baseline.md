# Compiled black-hole frame benchmark

Generated: 2026-09-26T23:35:12.178977+00:00

Host: Linux-6.17.0-35-generic-x86_64-with-glibc2.39; Python 3.12.2; NumPy 2.5.1

Character grid: 220 × 94. 12 samples per scenario.

Renderer initialization and artifact loading: 128.266 ms. Initial frame: 31.423 ms.

| Scenario | Frame median ms | Frame p95 ms | Text serialization median ms | Combined median ms | Median JSON bytes |
| :--- | ---: | ---: | ---: | ---: | ---: |
| stationary camera, advancing time | 8.459 | 8.703 | 44.235 | 52.729 | 355618 |
| moving camera, fixed time | 28.071 | 29.677 | 45.066 | 73.753 | 359220 |

Stationary-camera samples advance animation time with cached curved-ray geometry. Moving-camera samples use new positions at fixed animation time, so view movement cannot be simulated by changing a prerecorded time index.

Frame wall time includes live transfer-table queries when necessary, disk/background evaluation, cell composition, bloom, and glyph/color selection. Serialization time includes color-run construction and JSON encoding. Initialization and the initial frame are reported separately.

These are CPU host wall measurements, not RT device-kernel timings. HTTP transport, browser DOM updates/layout, font rasterization, and physical display refresh are excluded. The table reports a local experiment, not browser FPS or a claim of full physical accuracy.

Run `python3 -m unittest discover -s tests -v` for independent geometry, finite output, camera/time separation, shadow, and ANSI checks.
