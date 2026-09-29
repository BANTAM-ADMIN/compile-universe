# Gaia experiment

Run `python3 run.py web --backend cpu --port 8768` and open http://127.0.0.1:8768/. This directory is an independent copy; `../COMPILEUNIVERSE` keeps the original feature set. After a repeated Earth-mirroring report, its legacy viewer received only an Earth longitude-direction correction. The pre-fix source and binaries are retained under `validation/original-earth-mirror-backup/`. Playback still evaluates compiled records directly into characters, with no intermediate rendered scene or frame server.

## What changed

- **Interactive terminal player:** run `./universe-terminal` or `python3 run.py terminal` alongside the browser. The same local WASM worker produces the sky; a printable-ASCII interface adds destination search, animated flights, free navigation, clickable system/moon maps, generated worlds and the Grand Tour. ANSI truecolor/256-color output uses changed cells and batched writes. See [TERMINAL.md](TERMINAL.md) for controls, display settings and exports.
- **Terminal orbit and map fixes:** movement preserves orbit mode and keeps its target centered, including rolled views and pole crossings; `O` explicitly switches to free flight. Map mode retains camera ownership after arrival. Its quieter star field, nearby labels, planet/inner/all views, clickable inner-orbit inset on wide windows, and paged multi-column list keep small and large systems readable at terminal resolutions.
- **Grand Tour:** [start the live 19-stop journey](http://127.0.0.1:8768/?tour=grand). The original nine stops now lead into Mars, Jupiter, Io, Europa, Titan, Enceladus, Neptune, Pluto, the Crab Nebula and 3C 273. Pause, skip, or take control; manual camera input cancels the guide. Phenomenon arrivals reserve eight seconds for the final approach. See [the encore sources](data/GRAND-TOUR-SOURCES.md).
- **Ship camera:** arrivals at worlds continue in a steady visual orbit. Small worlds get a final close descent; the Moon ends 2,400 km from its center (about 663 km altitude) near the terminator, then cruises toward the lit side. Hold the camera with `B` or the character-grid control; resume with another press. Browser free flight carries momentum after thrust is released, and `B` brakes or settles into orbit near a world. A far pullback steers above the Galactic plane for an oblique Milky Way view. Reduced-motion preferences begin with the orbit held. Cruise speeds and trajectories are chosen for viewing and are not physical orbital predictions.
- **All-character interface:** every visible control, menu, orbit guide, label, loading message and tour caption is composed from printable ASCII cells. Hidden HTML supplies semantics, keyboard input and accessibility. The readable UI and adaptive sky use independent character grids in one display pass, so the interface does not reduce sky detail. Selectable-text mode and text/ANSI exports flatten both into the readable UI grid.
- **System map:** the camera frames the orbital overview above a compact bottom selection panel on desktop and mobile. Clicking a world label, its marker or its list entry immediately leaves map mode and starts the camera flight. Family buttons open a planet and its moons. Closing the map returns to the original camera view.
- **Detailed worlds, consistent letters:** the Moon retains its 2048×1024 NASA LROC albedo chart and uses a 1440×720 LOLA elevation-derived normal chart. Approximate fixed tidal alignment keeps the near side toward Earth at the scene's J2000 epoch; it is not a libration model. Arrival favors the near side while retaining the scene's sunlight. Relief is exaggerated 2.4× for legibility, with an approximate lunar scattering response. The silhouette remains spherical. Four direct analytic samples per detailed surface cell reduce aliasing, then feed the same printable letter/punctuation encoder as the rest of the universe. No block glyphs or rasterized scene conversion.
- **Individual generated terrains:** each generated body's identity seeds its own 384×192 albedo and normal charts. Rocky and carbon worlds have impact basins, bowls, central peaks, bright rims and some ejecta; ice has fractures, lava has fissures, oceans have islands/clouds, and gas giants have varied belts and storms. Geography is fictional. Compilation happens once per active generated chart in the worker, using 432 KiB per world; charts outside the active registry are freed. Existing orbital layouts and body identities are preserved.
- **Compact tour controls:** destination, progress, pause/next and take-control commands share the bottom character dock. The story expands with `[+]`. Space pauses the tour while it is active, or scene time otherwise; Escape takes control. Small screens wrap the commands.
- **Persistent phenomenon destinations:** unresolved emission is registered with the atlas at each destination’s world position before selection or local-engine loading. VFTS 352 starts as a pickable point and resolves into the binary. Betelgeuse retains its existing catalog star instead of gaining a duplicate. Distant visibility uses an explicitly illustrative brightness floor, not measured apparent magnitudes; even optically obscured Sagittarius A* is deliberately locatable.
- **Earth at night:** NASA’s [2016 Black Marble](https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/) composite becomes an 11-level, 699,051-byte emission chart (about 47 KB compressed). Light follows the same geography and fades through twilight. It is a historical composite with an illustrative warm tint, not current city activity or weather.
- **Earth’s UTC orientation:** daily IAU 2006/2000A pole/origin data are compiled using ERFA; runtime advances the Earth Rotation Angle at its real rate. Opening the app uses the current UTC clock, and pause holds it. The chart covers 2000–2050 and costs 447,096 bytes (232 KiB compressed). UTC approximates UT1 and live polar motion is omitted. **Planet centers and sunlight geometry still use the fixed J2000 scene epoch.**
- **Smooth daylight and settled arrivals:** planetary character densities now follow measured font coverage with fixed spatial rounding, removing bright/dark target bands on oceans. Closeup scenes stop automatically raising text density after arrival. Sagittarius A* uses the atlas’s compact background glow; its wider halo blurs only disk emission, preserving the star field through the handoff.
- **1,000,983 catalog records:** 109,401 retained HYG records, 782,574 additional nearby Gaia DR3 sources and 109,008 LMC candidate sources. The Gaia additions have exact 64-bit identifiers, observed angles and G/BP−RP photometry. The first load downloads a larger pack; there is no regional streaming yet.
- **Three sky modes** in display settings: original HYG/context, Gaia plus context (default), and survey only. Survey only removes the authored Milky Way distribution. Our distant Milky Way remains an illustrative model in the default mode; this sample does not measure every star in the Galaxy.
- **Large Magellanic Cloud destination:** fly to the host cloud, then to VFTS 352. It is placed beyond the Milky Way because that is where it belongs. Its observed stellar distribution now provides surroundings for the flight.
- **Map as a camera maneuver:** fly above the system, turn back, and select labels over the live view. Choose Fly to depart, or close Map to return smoothly. Inner-planet and moon-family views reveal smaller scales, including Earth and its Moon. The guides represent fixed spatial layouts, not live ephemerides.
- **Stellar scale and appearance:** compact dwarfs arrive small; giants can extend beyond every edge of the view. Betelgeuse's illustrated closeup and Grand Tour arrival now stop at 1.9 model units instead of 4.5, without shrinking the arrival on portrait screens. “Frame whole star” makes an animated pullback (5.6 model units for this closeup); orbit zoom remains outside its photosphere. Temperature/size drive illustrative granulation, convection, spots, color and activity. These are visual interpretations, not observed surface maps or predictions.
- **Earth geography:** NASA Blue Marble land/topography at 1024×512, with no seabed shading mistaken for continents. Camera handedness is corrected across all engines, north is up near Earth, and controls account for camera roll.
- **Distant Sagittarius A* disk:** compiled optics extend to 8,192 Schwarzschild radii. Filtered disk emission survives below one character in size and grows into resolved sampling. The 18-second flight spends eight seconds moving continuously from 4,096 radii to 24 radii.

## Observations and assumptions

[Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3) inputs come from the [ARI TAP mirror](https://gaia.ari.uni-heidelberg.de/tap.html). Exact ADQL, cached-input hashes and independently checked `COUNT(*)` values are in `artifacts/gaia.json` and the adjacent cache query records. Downloads fail if row counts do not match; this avoids silently accepting TAP truncation.

The nearby query selects parallax >2 mas, parallax/error >10, G<12, RUWE<1.4 and known BP−RP. It returns 837,250 rows across the sky. A conservative display cross-match removes 54,676 likely HYG duplicates (2 arcsec and distances within 25%); this is not an official cross-identification. Distances are inverse parallaxes without a zero-point correction. Formal parallax errors remain in the observation pack. Angular proper motions propagate J2016.0 to J2000, holding radial distance fixed.

LMC candidates lie within six degrees of the adopted center, with G<16, parallax<0.2 mas, RUWE<1.4, known BP−RP and broad proper-motion cuts. Membership can include contaminants. Their angular positions and photometry are observed; **individual depths are reconstructed** in a disk at [49.59 kpc](https://arxiv.org/abs/1903.08096), using [34.7° inclination and 122.5° line-of-nodes](https://arxiv.org/abs/astro-ph/0105339), northeast side nearer, and deterministic ±300 pc thickness. VFTS 352 retains its published direction and the adopted [160,000-light-year distance](https://www.eso.org/public/news/eso1540/).

BP−RP maps to illustrative RGB/temperature; G-band light drives relative brightness and estimated radii. Extinction is neither removed nor recalculated from new viewpoints. The LMC has an explicit 4× artistic display exposure applied consistently to individual and grouped light. This is not calibrated photography.

The hierarchy stores summed light and weighted centroids. Distant groups blend into individual sources at character resolution. Their total stored light is conserved before exposure/clipping. Resolved individual sources can be picked and explored; collapsed groups are not separate named destinations.

The black hole remains a nonrotating Schwarzschild interpretation. Its deflected background samples the authored Galactic context; HYG/Gaia points are not individually traced along bent rays. Survey-only mode omits that authored background. The native/WASM disk uses subcell filtering; the Python reference renderer retains simpler cell-center sampling.

Earth's day chart is [NASA Blue Marble Next Generation, August 2004, land/topography](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography/). Earth orientation follows [IERS/SOFA conventions](https://www.iausofa.org/cookbooks), with the UTC/UT1 and fixed sunlight limitations above. Other bodies’ surface time and all weather remain illustrative. Source files and credits are retained in `data/sources/` and `artifacts/solar.json`.

## Rebuild and check

With NumPy, SciPy, Pillow and Emscripten available:

```bash
python3 compile_gaia.py --download  # Reuses verified caches when present.
python3 compile_solar.py
python3 compile_surfaces.py
python3 compile_systems.py
python3 compile_destinations.py
python3 native/build_atlas.py --native
python3 compile_lensing.py
python3 compile_web.py
python3 native/build_wasm.py --native
python3 native/build_phenomena.py --native
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/test_atlas_worker.mjs
node tests/test_unified_worker.mjs
node tests/test_orion_memory.mjs
node tests/glyph_sampling.mjs
node tests/system_generator.mjs
node tests/flight_route_math.mjs
node tests/earth_orientation.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768 CHECK_CORE_VISIBILITY=1 node tests/saga_flight_timing.mjs
COMPILEUNIVERSE_URL=http://127.0.0.1:8768 node tests/atlas_resilience.mjs
node validation/check-overview.mjs
node validation/check-survey.mjs
node validation/check-earth-shading.mjs
node validation/check-binary-arrival.mjs
node validation/check-giant-arrivals.mjs
node validation/check-arrival-stability.mjs after
node validation/check-grand-tour.mjs
node tests/surface_compiler.mjs
node tests/ascii_overlay.mjs
node validation/check-ascii-controls.mjs
node validation/check-ascii-map.mjs
node validation/check-ascii-fallback.mjs
```

`validation/` contains screenshots and reports from the expanded build. All 150 Python tests pass. Checks cover source counts/identifiers, photometry, hierarchy light, LMC orientation/host placement, actual Earth texture geography and camera handedness, tiny-disk visibility and flight continuity. Browser checks exercise preview-before-flight, Saturn arrival, Earth/Moon guides, exact camera return, rolled-camera movement and mobile map selection. The observed moving-Earth sample averaged 59.4 fps at 132×51 characters, with median worker cost 9.5 ms and p95 11.7 ms, in headless Chromium at 1440×1000 on this development machine (`validation/overview-result.json`). This is not a potato-hardware benchmark.

Performance depends on view, hardware and character density; the copied README's older 32 MiB atlas/60 fps results apply to the original catalog. The expanded atlas currently needs approximately 126 MiB of WASM heap before loading additional phenomenon/black-hole modules, excluding JavaScript and display memory.

The updated resilience check also passes catalog-download retry, Canvas 2D without WebGL, selectable plain text, and offline search/travel/return/export after bootstrap. Pausing freezes automatic camera leveling and the UTC Earth clock, so consecutive text and ANSI exports describe the same view. Gaia system generation hashes every digit of the source identity; large generated-body IDs use integer label transport to avoid float precision loss.

The latest pass has 150 passing Python tests. The real worker verifies that the unselected VFTS dot is pickable and that selecting it leaves its character bytes unchanged. The binary flight now enters 80 model units with about six seconds left, then resolves into the two stars. In the post-arrival Sagittarius A* sample, automatic density previously changed eight times (132×51 to 240×93); the revised scene held 132×51 for all 839 frames over 14 seconds, reusing optical geometry throughout. Worker median/p95 fell from 6.4/8.36 ms to 3.6/3.8 ms on this development machine (`validation/arrival-before.json`, `validation/arrival-after.json`); this is a stable-view comparison, not a hardware-wide FPS guarantee. The Earth orientation chart agrees with eight independent ERFA reference epochs to 0.004 arcseconds under the shared UTC≈UT1 assumption. The physical UTC/UT1 approximation is a separate accuracy limit.

The Crab-to-Orion tour departure exposed a separate memory failure at 280×118: 553,520 projected sources caused a contiguous buffer to double beyond the atlas's 256 MiB WASM limit. Projected sources now occupy reusable 4,096-record pages, so growth does not duplicate existing records. The captured frame succeeds without reducing the catalog; its native character/color bytes match the previous implementation exactly. A centered 320×160 stress view projects 782,055 sources, with combined atlas/phenomenon heap usage below 199 MiB and stable allocation on repeated frames (`validation/orion-memory-regression.log`). Such unusually dense fixed-resolution views remain more expensive than adaptive playback; this is a memory regression check, not a frame-rate guarantee. Distant-body occlusion queries also reject rays against cached conservative screen bounds before doing intersections.

Earth's vertical dark columns were amplified by undersampling narrow font strokes. The character presenter now prefilters stroke coverage and uses mip levels with continuous screen derivatives, avoiding discontinuities between glyph atlas tiles. Uniform-glyph tests cover desktop and mobile grids; desktop column variation fell from up to 28% to below 4%, and mobile variation from up to 42% to below 10%. The scene's packed ASCII and color bytes are unchanged by this display correction.

The original nine-stop Grand Tour passed at fixed 280×118 density in a 1920×1080 browser, including Orion and Sagittarius A*, with no worker or page errors (`validation/grand-tour-result.json`). All 150 native/Python checks and the unified-worker, font-sampling, and display/offline fallback checks passed at that stage. The occlusion tests include subcell stars at viewport edges.

The character-interface / terrain checks verify native sky pixels are unchanged outside occupied UI cells, deterministic and distinct seeded charts, wrapped texture seams, relief dimensions/hashes, fixed lunar near-side alignment, printable ASCII scene output, settings/search/flight/pause/text/export controls, and map bounds plus single-click arrivals at desktop and mobile sizes. NASA lunar source and elevation details: [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/). The `img2ansi` reference informed the investigation of joint shape/color fitting; this build retains its own letter-based surface encoder.

Current verification: 152 Python tests pass, along with 457 generated-system determinism checks, ten terrain-family/seam checks, native/WASM worker checks, font sampling, unchanged sky pixels outside UI cells, desktop/mobile map flights, Canvas 2D fallback, ASCII control interactions and tour controls. Screenshots in `validation/moon-letters-final.png` and `validation/generated-*-after.png` show the final letter-based style.
