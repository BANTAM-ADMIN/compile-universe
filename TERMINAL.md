# The universe in a terminal

From this directory:

```bash
./universe-terminal
```

Or use `python3 run.py terminal`. The launcher also works from elsewhere:
`./COMPILEUNIVERSE_GAIA/universe-terminal` from the parent project directory.

The browser remains available at http://127.0.0.1:8768/ and still launches with
`python3 run.py web --backend cpu --port 8768`. Both versions can run at once.

## What you can explore

The terminal runs the same compiled WASM scene engines, catalog, detailed Moon
and Earth charts, generated terrain compiler, belts, comets, stellar activity,
nebulae, binaries and Sagittarius A* as the browser. Flights use the browser's
collision-aware routes and gradual close approaches. All 19 Grand Tour stops
are available. A system map flies the camera above the system; selecting a world
immediately leaves the map and flies there. Moon-family views reveal small orbits.

The map holds its camera after the maneuver, filters the background down to faint
stars, and keeps labels beside their objects. **Planets**, **inner**, and **all**
switch between the major planets, close orbits, and the complete set including
dwarf planets, asteroids and comets. Wide windows get an enlarged inner-orbit
inset alongside the full system. Both preserve relative positions; the inset's
magnification is labeled. Orbit guides are approximate circles through the fixed
body positions, not evolving orbital predictions. The bottom list uses multiple
columns, with page buttons for longer lists. Every map marker, label, inset world
and list entry can start a flight.

Scroll the wheel or press `+` / `-` to smoothly zoom the map. The system stays
centered above the list, and visible worlds remain clickable while zooming.
The ASCII `[-]`, `[+]` and `[fit 0]` buttons also work with a mouse. Press `0` or
Home to fit the current system or moon family again. Switching map scopes starts
with the whole new view fitted; resizing preserves your zoom level.

Everything visible is a printable ASCII character with foreground/background
color, including menus, buttons and orbit guides. Node.js hosts the existing
rendering worker and loads its assets directly from disk. There is no HTTP server,
browser, WebGL, image protocol or video playback in this frontend. The scene is
still evaluated each frame; this is an additional frontend, not a tiny standalone
executable or a pre-recorded universe.

## Controls

| Control | Action |
|---|---|
| Arrow keys / left-drag empty sky | Look around; orbit the selected body in orbit mode |
| `+`, `-` / mouse wheel | Approach / pull back; adjust speed in free flight |
| `W A S D` | Orbit: W/S approach or pull back, A/D circle the target. Free: fly forward/left/back/right |
| `R F` | Orbit above/below the target; fly up/down in free mode |
| `O` | Switch between free flight and orbit; entering orbit immediately centers the selected object |
| `B` | Hold or resume orbital cruise; settle into an orbit when close to a world in free mode |
| `/` | Search destinations; type a name, select with arrows, press Enter to fly |
| Click a visible star | Open its destination entry |
| `M` | Open/close the selected world's system map |
| Map: arrows / Enter | Select a body / fly there |
| Map: wheel / `+` / `-` | Zoom in/out; `=` also zooms in |
| Map: `0` / Home / `[fit 0]` | Fit the current system or moon family |
| Map: PgUp/PgDn or `<`/`>` page buttons | Page through the destination list |
| Map: `[` / `]` | Switch between the whole system and planet/moon families |
| `T` / `N` | Start the Grand Tour / advance to its next stop |
| Space | Pause/resume the tour, or scene animation when exploring freely |
| `H` / `I` | Fly home to Earth / inspect the selected object |
| `G` | Cycle Gaia + modeled Galaxy, survey only, and original catalog/context |
| `,` / `.` | Lower / raise exposure |
| `L` | Toggle star labels |
| `P` | Save the current interface and sky as `.txt` and `.ansi` in `artifacts/` |
| Tab / Shift-Tab / Enter | Focus and activate visible buttons |
| `?` | Open help |
| Esc | Close a panel, leave the map, cancel preparation or take over a flight |
| `Q` / Ctrl-C | Quit and restore the terminal |
| Ctrl-Z / shell `fg` | Suspend / resume on Unix |

Click buttons with the mouse, including world labels in a map. Search fields
accept bracketed paste. `Q` types normally while searching; Ctrl-C always quits.
Keyboard movement uses the terminal's key-repeat behavior; mouse drag gives finer
continuous steering. Space holds tour travel as well as scene time during a tour;
outside a tour it holds animation while navigation remains available.
World views cruise steadily around the selected body until held with `B`; scene-time pause remains separate. Small-world flights finish with a close descent. The Moon ends 2,400 km from its center (about 663 km altitude), near the day-night boundary, and its cruise moves into sunlight. Pulling far back tilts above the Galactic plane to show the Milky Way disk. These camera paths are visual choices rather than orbital predictions. Movement preserves orbit mode until you explicitly switch with `O`. Orbit turns
use the camera's screen axes, including rolled views and passes over the poles,
while keeping the target centered and preserving distance. W/S and the wheel
change the orbit distance smoothly.

## Display and performance

Requires Node.js 18+ (tested with 22), the existing compiled `artifacts/` and
`web/` assets, and a VT-compatible terminal. No npm install or Python packages
are needed for the terminal player. Use a dark background and RGB color for the
intended appearance. The interactive minimum is 60 columns by 20 rows. The engine
supports up to 320 by 160 cells; shrinking the terminal font increases detail.
Font shape and cell proportions affect the appearance; the camera assumes cells
about 1.8 times as tall as they are wide.

```bash
./universe-terminal --fps 60
./universe-terminal --destination 'Sagittarius A*'
./universe-terminal --tour
./universe-terminal --colors 256 --cols 120 --rows 42
./universe-terminal --no-mouse
```

The default limit is 30 updates per second. The scene worker runs separately from
input/UI, with at most one requested frame in flight. The writer compares glyphs
and both colors, emits changed cells, batches cursor/color commands into one
write, and respects output backpressure. Actual speed depends on scene, grid size
and terminal throughput. `--fps 60` raises the cap; reducing the grid lowers both
scene work and terminal traffic. `--sync` enables synchronized drawing (DEC 2026)
for terminals that support it. `--colors none` gives monochrome output.

The browser uses separate sky and UI grids; a terminal has one physical grid.
Menus necessarily occupy those same character cells. Zoom in on a world or use
a smaller font for more terrain detail. Existing scientific/illustrative limits
are unchanged; see [GAIA.md](GAIA.md). Earth rotation follows UTC, while planet
positions and sunlight retain the scene's fixed epoch.

## Export and checks

Export a frame without a TTY:

```bash
./universe-terminal --destination Moon --cols 160 --rows 60 --snapshot artifacts/moon-terminal
```

This writes a plain text document and a complete colored ANSI frame. `--frames N`
exits after N rendered frames for interactive diagnostics. Run the checks with:

```bash
node tests/terminal.mjs
node tests/terminal_camera_map.mjs
node tests/terminal_map_zoom.mjs
python3 tests/terminal_pty.py -v
```

They exercise the real shared engine, exact scene-byte parity, all phenomena,
tour navigation, generated worlds, map framing at multiple terminal sizes,
click-to-fly, input parsing, cancellation and delta output. Unix pseudo-terminal
tests cover live search/mouse input, resize, color output, signal/error exits and
restoration of terminal settings. Reports and scene exports go into `validation/`.
Camera/map regression checks cover target lock, distance preservation, rolled
views, pole crossings, mode transitions, map stability after a pending zoom,
five viewport shapes (including 150×26), readable labels, inset clicks, and
generated moon flights. The terminal integration test also drives the actual
150×26 interface through orbit, map scopes, moon families, wheel/button zoom and
click-to-fly. Zoom checks cover smooth camera movement, center anchoring, orbit
clipping, extreme magnifications, fit/reset, resize and zoomed map selection.
