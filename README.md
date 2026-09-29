# COMPILEUNIVERSE

This is the separate **Gaia experiment** in `COMPILEUNIVERSE_GAIA`. The original sibling keeps its feature set, with only the subsequent Earth longitude-direction bug fix backported. Start this copy on port **8768**. See [GAIA.md](GAIA.md) for the million-record catalog, source limitations, new camera/map behavior and current validation.

**Also available in a real terminal:** run `./universe-terminal` (Node.js 18+) for the same universe with ANSI colors, interactive flights, search, system maps and tours. See [TERMINAL.md](TERMINAL.md) for controls and options. The browser and terminal versions can run simultaneously.

A navigable stellar and planetary atlas that produces **ASCII character cells directly**, with compiled gravitational lensing and close-up interpretations of real phenomena. Catalog records, surface charts and emission fields are prepared offline. A local WebAssembly worker computes glyph, foreground and background bytes for each view; a lightweight presenter stamps the resulting characters on screen.

There is no intermediate scene image to convert to ASCII, no prerecorded camera path, and no server frame request in the atlas. Changing position changes the actual view. The browser uses WebGL only to draw the already computed characters in one batch, with a Canvas 2D fallback. The atlas needs neither CUDA nor RTX. This is a compiled scene evaluator, not a claim that arbitrary views require zero computation.

## Open the experiment

From this directory, using the supplied compiled assets:

```bash
python3 -m pip install -r requirements.txt
python3 run.py web --backend cpu --port 8768
```

- **http://127.0.0.1:8768/** — the measured star atlas, beginning near Earth.
- **http://127.0.0.1:8768/?tour=grand** — the 19-stop live Grand Tour, starting with Earth at night and ending at quasar 3C 273.
- **http://127.0.0.1:8768/blackhole** — a shortcut to an animated atlas journey to Sagittarius A*.
- **http://127.0.0.1:8768/phenomena** — the atlas's real-phenomenon destination collection.

The `/blackhole` and `/phenomena` shortcuts redirect into the atlas. All seven phenomenon destinations share its canvas, free camera and animated travel; they do not open separate viewers.

Start with **Fly to Moon**, or open **Map** to choose a planet, dwarf planet, moon, asteroid or comet. Opening Map flies the camera above the system plane and turns it toward the system. Orbit guides and labels track the actual world positions. Choose a label, then Fly to leave the overview. Inner planets and moon-family views make small systems readable; the full searchable list keeps every body reachable. The circular guides illustrate the fixed layout rather than predict orbital evolution. Closing Map smoothly returns to the saved camera.

Explore a catalog star's system to generate persistent imagined planets, moons, dwarf worlds, asteroids, comets and a debris belt. Existing confirmed planets stay separately identified. Search supports stars, Solar System bodies and the seven observed-phenomenon destinations. Flights choose illuminated arrivals, preserve departure views, clear nearby bodies, and can be canceled and resumed. Small worlds now get a visible final descent. The Moon arrival ends 2,400 km from its center (about 663 km above its surface), near the day-night boundary, then cruises toward the sunlit side. After arrival at a world, the camera cruises around it at a steady viewing speed; **Hold** or `B` keeps the camera still, and another press resumes the orbit. In browser free flight, thrust with `W A S D` and release to coast; `B` brakes and settles into an orbit when close to a world. Drag to steer; scroll to change distance or thrust speed. Pull far back with the wheel to rise above the Milky Way plane and see its disk from an oblique angle. `M` opens the system map. The in-app controls describe the other shortcuts. Travel and orbital cruise are interactive visualizations at arbitrary speeds, not spacecraft or orbital dynamics simulations.

To reveal the Milky Way, stay in **Orbit** near Earth and keep scrolling outward or pinching inward. The camera moves smoothly away from Earth, with larger distance steps as the scale grows; its field of view stays fixed. Drag to change the viewing angle. In **Free flight**, scrolling adjusts movement speed instead, and the movement keys move the camera.

Phenomena and Sagittarius A* use the same atlas camera, flight controls, display and text/ANSI export. Their specialized local interpreters activate near the destination. The large black-hole optical pack is loaded on demand rather than during an ordinary Earth/Moon session.

## What is measured

The atlas compiler uses **HYG v4.2**, by David Nash / Astronexus, combining Hipparcos, Yale Bright Star and Gliese data. From 119,626 source rows, 10,225 distance-sentinel rows are excluded from the spatial atlas. The resulting **109,401 records include the Sun**. An unknown distance is never interpreted as a star 100,000 parsecs away. The source hash, counts, transformation notes and license travel with the compiled data.

Positions are heliocentric equatorial coordinates at **J2000.0**, in parsecs. Double-precision positions and camera subtraction preserve the transition from interstellar distances to resolved stellar surfaces. Catalog positions remain fixed as the camera travels; their proper motion, orbital evolution and light-time effects are not simulated. The illustrative binary animation and black-hole geodesic model described below do not update catalog kinematics. Catalog distances have varying uncertainties; this dataset is not a uniformly precise census of the Galaxy.

Earth's position is a **NASA/JPL Horizons DE441 snapshot at JD 2451545.0 TDB**, relative to the Sun in ICRF. The ICRF/J2000 alignment difference is negligible at character resolution. Its physical sphere uses JPL's 6,371.0084 km mean radius. Its surface chart is compiled from **NASA Earth Observatory's Blue Marble Next Generation, August 2004**. The map is sampled directly into character cells. Earth’s orientation follows the current UTC clock at its real rate, with compiled IAU precession/nutation; UTC approximates UT1 and live polar motion is omitted. Its center and sunlight geometry still use J2000. Other surface rotation, atmosphere, stellar granulation, coronae, exposure and displayed colors are illustrative. Stellar radii inferred from catalog luminosity/color are estimates, not measured surface maps.

The planetary registry contains **490 bodies**: eight planets, five recognized dwarf planets, 465 moons, six selected asteroids, two comets and four confirmed exoplanets. It includes all entries in the cached JPL planetary/Pluto moon discovery list, Earth's Moon, and the four recognized companions of Eris, Haumea and Makemake. This is source-snapshot coverage, not a promise to track future discoveries automatically.

Major Solar System centers use cached Horizons J2000 vectors. Remaining moon centers use published mean orbital elements propagated approximately to the reference epoch; two Saturn ring moonlets use published distances and illustrative phases. Forty-six moons have published mean radii, four dwarf companions have published radius estimates, and **415 poorly constrained moons use an explicitly illustrative 2 km radius**. Every record identifies its position/radius class. Phobos and Deimos use published dimension-based ellipsoids. Haumea uses a published triaxial model, its volume-equivalent reference radius and its narrow ring. Fixed positions do not evolve as an ephemeris during playback.

Vesta, Pallas, Eros, Bennu, Ryugu and Itokawa have Horizons positions and SBDB diameter provenance. Halley and 67P also have cataloged centers and sizes; their displayed coma and tails are illustrative activity, not observed J2000 outgassing. The main asteroid belt and Kuiper belt use documented approximate radial regions with seeded illustrative particles. None of those particles is presented as a cataloged asteroid.

The Moon and Mars use downsampled, credited NASA maps. Other world charts are authored illustrations. Proxima b, 51 Pegasi b, HD 209458 b and 55 Cancri e use confirmed NASA Exoplanet Archive records and matched catalog host stars. Their orbital phases, planes and appearances are illustrative; unmeasured radii are identified as estimates. No generated world is labeled as a discovery.

Alpha Centauri A/B, Proxima Centauri and Sirius A use published interferometric radius measurements, with uncertainties and references in `data/stellar-radii.json`. Other non-Sun stellar radii remain illustrative estimates. Apparent stellar brightness changes with camera distance using catalog absolute magnitude. This is a useful visualization model, not an extinction-corrected photometric instrument. Earth and nearby resolved stars can occult background sources. Faint points are projected onto cells, rather than relying on a cell-center ray to happen to hit a tiny star.

The seven phenomenon anchors use published positions and adopted distances. Betelgeuse retains its exact existing HYG coordinates; the other six use cached CDS/SIMBAD directions. Most distances are rounded NASA/ESO values. Sagittarius A* uses the cited GRAVITY 2022 fit, while 3C 273's public distance is used as an approximate Euclidean placement, not a cosmological distance calculation. `artifacts/phenomena-destinations.json` records the sources and separates physical quantities from visualization scales; see [the interpretation limits](data/PHENOMENA-SOURCES.md).

## Compiled data and live work

The catalog compiler creates a deterministic spatial hierarchy and a compact binary star pack. The player uses that hierarchy to reject regions outside the view and regions too faint to contribute. It evaluates visible points and nearby surfaces directly at character resolution. Adaptive character density adjusts detail toward the frame budget; the live telemetry reports the current grid and computation time. This first catalog pack is loaded into memory as a whole; regional streaming is future work.

Planetary bodies are compact records referencing shared RGB charts, usually 512×256; Earth uses a 1024×512 NASA map without seabed relief. The camera basis preserves geographic handedness and presents Earth with north up. Analytic sphere/ellipsoid queries, host-relative illumination, thin ring intersections, and small local comet particle clouds are evaluated directly in the character grid. Screen tiles bound the occlusion work. Belt particles are sparse deterministic points and fade outside the local system. Rare stellar flare episodes are seeded visual events, not solar monitoring or forecasts.

The on-demand system generator is a deterministic recipe keyed by catalog identity. It creates a bounded family of worlds and shares the existing charts. Only the departure and destination generated systems are installed in the native registry; the interface keeps a bounded cache and reconstructs evicted systems from their seeds. This is a visual orbital layout, not an N-body stability calculation.

The Milky Way context contains **60,000 finite 3D light samples**: 32,000 in an authored disk, 16,000 in a central concentration and 12,000 in a nuclear neighborhood spanning 0.1–10 pc. `galaxy-stars.bin` stores positions relative to Sagittarius A* in the atlas's ICRS axes, plus relative light weights and colors: 1.92 MB raw, about 0.982 MB gzip. Moving the camera changes each sample's direction and distance. A shared native sampler rebuilds an observer-dependent source index and applies distance-squared fading, with finite near-source softening and display clipping. Ordinary views and the black-hole background queries use these same positions; production views do not use a painted whole-sky galaxy panorama.

The Galactic source index retains faint positive contributions without a per-source brightness cutoff. Their light adds together before character selection, preserving the distant disk and arms. After that sum, a smooth, position-dependent overview exposure increases from **1× inside the Galaxy to at most 32× outside the disk**. The Solar neighborhood and inner views keep 1×. This artistic exposure affects the displayed Galactic light, leaving source coordinates and stored light weights unchanged; it is not calibrated photometry.

These samples are statistically authored Galactic context alongside the measured HYG stars. They are not individually observed stars and have no measured names, radii or proper motions. Their positions are fixed during playback; the brightness values are aggregate light proxies, not calibrated stellar luminosities. [ESO's structural overview](https://supernova.eso.org/exhibition/1004/?lang=en) supports the broad disk/spiral/bulge context, while the exact six streams, dimensions and sample distribution are design choices. The coordinate basis follows the [ERFA/SOFA ICRS-to-Galactic convention](https://github.com/liberfa/erfa/blob/master/src/icrs2g.c). `artifacts/galaxy-stars.json` records the distinction, format, seed and hashes.

VFTS 352, Betelgeuse, the Crab Nebula, the Orion Nebula, the Crab Pulsar and 3C 273 use six local appearance models, alongside the Sagittarius A* black-hole model. These are real observed objects; their close-up geometry and motion are interpretations. There is no imminent-merger or supernova prediction. The two nebular fields are compiled into a small `64³` RGBA pack; runtime cell rays sample that field. The Crab Pulsar view also includes its surrounding parent-remnant volume. Analytic local models supply contact stars, convection, beams and accretion structures. The atlas transforms its world camera into each destination's local model coordinates and composites the resulting character cells. Visualization model scales are labeled separately from physical radii. Static nebular cell grids and masks are reused when camera, grid and exposure are unchanged, so a pulsar can animate without recomputing its surrounding remnant. Moving the camera immediately reprojects that volume.

The black-hole compiler solves Schwarzschild null geodesics offline into universal impact/phase lookup tables. Near Sagittarius A*, the worker interpolates those tables, samples the disk chart at curved-ray crossings and queries the Galactic source index in each escaping ray's deflected outgoing direction. **The same spatial light samples supply the lensed background; measured HYG/Gaia stars are not re-queried along bent rays. Survey-only mode omits the authored galactic lens background.** Captured rays remain black unless they encounter foreground disk emission. The background query uses a far-field approximation: the nearest authored nuclear sources are at 0.1 pc, roughly 30 times the outer 8,192-Schwarzschild-radius camera domain. It does not solve a separate finite-source geodesic boundary problem for each sample.

The optical model assumes a nonrotating black hole, a thin disk and a static observer within 6–8,192 Schwarzschild radii. During arrival, angular interpolation progressively applies lensing between 8,192 and 4,096 radii. The entire transition is inside the compiled domain. A filtered disk footprint keeps the disk visible below one character in size, blending into resolved cell sampling as it grows. The 18-second flight spends its final eight seconds approaching from 4,096 radii to 24 radii. Kerr rotation, physical stellar evolution and exact finite-distance source lensing are absent.

The original laboratory remains useful for comparing brute-force C++, CPU BVH and OptiX visibility queries. It contains 1,982 parent-atlas stars and an intentionally oversized fictional planet. That laboratory uses the Python frame API. Its optional RTX acceleration is independent of the browser atlas.

## Rebuild

Playback uses the generated assets and does not need the compilers or their network sources. To rebuild, install the build dependencies and activate an Emscripten SDK (`em++`), or pass its path to the build scripts.

```bash
python3 -m pip install -r requirements-build.txt
python3 compile_catalog.py
python3 compile_gaia.py --download
python3 compile_solar.py
python3 compile_surfaces.py
python3 compile_systems.py
python3 compile_phenomena.py
python3 compile_destinations.py
python3 compile_galaxy.py
python3 native/build_atlas.py --native
python3 native/build_phenomena.py --native

# Black-hole tables and appearance charts:
python3 compile_lensing.py
python3 compile_appearance.py
python3 compile_web.py
python3 native/build_wasm.py --native

# Optional original visibility laboratory:
python3 compile_scene.py
python3 native/build_cpu.py
python3 native/build_rt.py
```

The first catalog compilation downloads `data/hygdata_v42.csv.gz`; observational inputs are cached in `data/sources/`. Subsequent builds reuse those inputs. Where supported, `--refresh` refetches that compiler's remote inputs; curated numerical facts still require an explicit source update. System JSON is published atomically. Native/WASM builds and assets live entirely in this experiment directory.

## Verification

```bash
python3 -m unittest discover -s tests -v
python3 validate_wasm.py
node tests/profile_atlas.mjs
node tests/profile_phenomena.mjs
node tests/system_generator.mjs
node tests/test_atlas_worker.mjs
node tests/test_unified_worker.mjs
node tests/flight_route_math.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768 node tests/web_atlas.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768 node tests/web_systems.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768 node tests/web_phenomena.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768 node tests/web_galaxy_parallax.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768 node tests/web_galaxy_zoom.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768 node validation/check-dramatic-arrivals.mjs
CHECK_CORE_VISIBILITY=1 COMPILEUNIVERSE_URL=http://127.0.0.1:8768 node tests/saga_flight_timing.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768 node tests/atlas_resilience.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768 node tests/stress_atlas.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768/index.html node tests/web_blackhole.mjs
```

The catalog suite checks the pinned release hash, exact coordinate preservation, exclusion counts, finite records, conservative hierarchy bounds, curated radii and byte-identical offline rebuilds. The atlas renderer tests star projection, Earth occultation, close-camera precision, subcell sources, determinism and hierarchy/full-scan parity.

The Galactic tests independently check finite-source parallax against projected coordinates, exact return to the same view, summed unresolved light, and the production disk's changing size and inclination. Actual wheel-input checks cover Earth-to-Galaxy pullback and crossing the black-hole close-up boundary in both directions, including distance units and fixed field of view.

The existing black-hole suite checks lookup results against an independent integration, native/WASM parity, deterministic playback, input validation, physical shadow geometry, and exact recording reconstruction. The visibility suite compares brute/CPU/RTX results against an independent reference; unavailable RTX tests are skipped explicitly. Set `COMPILEUNIVERSE_REQUIRE_RT=1` to require that backend.

The following performance figures are **historical original-catalog baselines**, copied with this experiment. They do not characterize the expanded Gaia build; see [GAIA.md](GAIA.md) and `validation/` for its results.

The original atlas regression measured **59.9 fps near Earth and 60.0 fps across the complete 10.8-second Alpha Centauri journey**, using adaptive density starting at 240 × 83 cells in a 1440 × 900 headless Chromium viewport on this development machine. Median worker computation was 5.5 ms near Earth and 6.5 ms across that journey. Those figures do not characterize every local phenomenon model. The browser suite also checks mobile layout, reduced-motion travel, free flight, interrupted journeys, looking home without teleportation, stopped computation when paused, and text/ANSI downloads. It records zero server frame requests. See `artifacts/atlas-browser-validation.json`.

The unified phenomenon browser regression measured about **59.5–60.7 fps across its seven destination views** on this development machine, including 60.03 fps during a complete 14-second VFTS 352 flight and 59.92 fps during a 14-second Sagittarius A* flight. Adaptive density used 161–187 columns in the sampled local views. It also checks retry, preparation cancellation, redirects, mobile controls, Canvas 2D and offline use after the required assets load, with zero server frame requests. The conditions and results are recorded in `artifacts/phenomena-browser-validation.json`; these are tested views, not a performance guarantee for arbitrary camera positions or hardware.

Reprojecting the surrounding Crab remnant while turning the camera took about **23–25 ms per worker frame at a fixed 220 × 94 grid** in `artifacts/crab-pulsar-context.json`. The stationary remnant cache avoids that repeated work while the pulsar animates. Adaptive density is still needed for heavier moving views; a fixed high character density does not guarantee 60 fps.

The atlas's CPU/WASM timings, including a character-buffer copy, are in `artifacts/atlas-wasm-performance.json`. The atlas module has a **32 MiB heap**. Loading the phenomenon module adds 16 MiB and the black-hole module adds 64 MiB, for **112 MiB of WASM heaps after all three modules are loaded**. This excludes JavaScript, display buffers and other browser memory. Specialized modules load on demand and remain allocated. Shared world charts are preloaded so generated systems work offline after atlas bootstrap; a first phenomenon or black-hole visit also needs its own assets available from the network or cache.

With the finite Milky Way pack, the CPU/WASM profile at 220 × 94 cells measured median frame costs of **3.96 ms near Earth and 6.24–7.44 ms for moving external galaxy views**, including source-index rebuilds and output copies. The separate production-worker profile in `artifacts/blackhole-worker-performance.json` includes the atlas, lensing, both source queries and composition: **12.98–13.38 ms at 220 × 94**, compared with 18.09–18.70 ms at 280 × 118. Both runs use 15 warmup and 60 measured frames per case on this development machine. These CPU costs explain why adaptive character density remains useful even with compiled data.

The resilience suite verifies retry after a failed catalog download, Canvas 2D and selectable text without WebGL, and ordinary atlas navigation/export with post-bootstrap networking blocked. The unified worker tests independently check destination transforms, local visibility, departure transitions and recovery from a failed local asset load. The artificial slowdown suite adds proportional work inside the worker and separately throttles the browser's main thread; see `artifacts/atlas-artificial-stress.json`. These stress tests are **not measurements on physical low-end hardware** and do not establish a universal 60 fps guarantee.

The previous black-hole implementation also measured roughly 60 fps on this machine. Its separate artificial stress report is `artifacts/browser-artificial-stress.json`.

## ANSI and recorded playback

The atlas can export its current cell grid as `.txt` or truecolor `.ansi` directly from the browser. For terminal exploration and lossless recorded playback of the black hole or original laboratory:

```bash
python3 run.py view --scene blackhole
python3 run.py snapshot --scene blackhole --out artifacts/blackhole
python3 run.py record --scene blackhole --seconds 4 --fps 15 --out artifacts/orbit
python3 replay.py artifacts/orbit.json --verify
python3 replay.py artifacts/orbit.json
```

The standalone replay decoder reads changed-cell bitmaps and replacement glyph/colors; it has no geometry or native-engine dependency. Recordings reproduce the recorded path. Live exploration continues to use compiled scene data. The atlas browser's flight controls are not yet implemented in the terminal frontend.

## Sources and attribution

- [HYG v4.2 / Astronexus](https://www.astronexus.com/projects/hyg), David Nash, **[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**. The adapted catalog assets retain this license. [Field descriptions and distance sentinel](https://www.astronexus.com/projects/hyg-details).
- [NASA/JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) and [planetary physical parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html). The exact query and raw-response hash are in `artifacts/solar.json`.
- [NASA Earth Observatory, Blue Marble Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/), produced by Reto Stöckli. [NASA media usage guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/). The original map URL and hash are in `artifacts/solar.json`. NASA does not endorse this experiment.
- [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), NASA's Scientific Visualization Studio / Ernie Wright; [NASA Mars texture](https://science.nasa.gov/3d-resources/mars/), NASA/JPL & Caltech, from Viking imagery processed by USGS. `artifacts/surface-metadata.json` records the exact source bytes and distinguishes NASA maps from authored charts.
- [JPL satellite data](https://ssd.jpl.nasa.gov/sats/), [JPL SBDB API](https://ssd-api.jpl.nasa.gov/doc/sbdb.html), and [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/). Queries, raw hashes, numerical conventions and approximation notes are recorded in `artifacts/systems.json` and cached source documents.
- [Haumea occultation and ring model, Ortiz et al.](https://arxiv.org/abs/2006.03113). [Real phenomenon sources and interpretation limits](data/PHENOMENA-SOURCES.md).
- [CDS/SIMBAD](https://simbad.cds.unistra.fr/simbad/) supplies the six additional sky directions; the cached query retains coordinate references. [GRAVITY Collaboration (2022)](https://www.aanda.org/articles/aa/full_html/2022/01/aa42465-21/aa42465-21.html) supplies the adopted Sagittarius A* mass and distance.

This is a substantial stellar neighborhood, Solar System and interpreted-phenomenon atlas, not a complete universe. The present Gaia subset is loaded in full; regional streaming, full live ephemerides, cosmological geometry, stellar evolution and physical binary evolution remain future work. Published data, approximate placements, generated worlds and illustrative appearances are identified in the interface and metadata. The retained `/index.html` laboratory page is for component comparisons; the main experience stays in the atlas.
