# Iron Rain — Fleet Command

A real-time strategy game set in Pierce Brown's *Red Rising* universe (Iron Gold era, 753 PCE): a week-by-week campaign for the Solar System, fought out in real-time space battles and ground battles. A personal, non-commercial fan project.

**Play:** https://claude.ai/artifact/YBkNrJD7qLpjpE8wujuzt1 (the published build)

## Running it

No build step. Serve the folder and open `index.html`:

```
bash tests/serve.sh            # http://127.0.0.1:8773/index.html
```

Rendering is three.js r187 on WebGPU, falling back to WebGL2 automatically (add `#webgl` to the URL to force WebGL2). F9 shows the frame meter and backend; F10 opens the graphics menu.

## Layout

| Path | What it is |
|---|---|
| `index.html`, `style.css` | The page, HUD and all UI styling |
| `js/main.js` | Boot, main loop, fixed 1/60 s simulation step |
| `js/sim.js` | Space-battle simulation: ships, weapons, missiles, boarding |
| `js/enemyai.js` | Space-battle AI: fleet postures, target allocation, abilities |
| `js/tactics.js`, `js/battle.js`, `js/morale.js`, `js/abilities.js` | Battle flow, HUD, closing speed, morale and doctrine, commander abilities |
| `js/render.js`, `js/hulls.js`, `js/planetgen.js`, `js/gfx.js`, `js/gfxmenu.js` | Renderer (TSL shaders), procedural hulls and worlds, graphics settings |
| `js/sensors.js`, `js/terrain.js`, `js/ops.js` | Sensors and contacts, battlefield hazards, orbital operations |
| `js/camp.js`, `js/stratview.js`, `js/economy.js`, `js/politics.js`, `js/story.js`, `js/solar.js` | Campaign: turns, map, economy, politics, story, the worlds |
| `js/ground.js`, `js/groundview.js`, `js/groundmodels.js` | Ground battles |
| `vendor/` | three.js (MIT, see `vendor/three/LICENSE.txt`) and the Cinzel font |
| `tests/` | Headless tests (below) |

## Tests

Needs Python 3 with Playwright (`pip install playwright && playwright install chromium`), and the game served (`bash tests/serve.sh`).

- `python3 tests/smoke.py` plays 12 campaign turns with auto-resolved battles. Fails on any page error.
- `bash tests/run_tournament.sh` runs the space-battle AI (`js/enemyai.js`) against the previous version (`tests/baseline/enemyai_v1.js`) across the standard scenarios and prints a summary. `SEEDS=` and `JOBS=` control the size. Takes around 15–20 minutes.

Headless Chrome renders through SwiftShader on WebGL2, so the tests check behaviour, not looks. Graphics need checking on a real GPU.

## Working on it

- `main` is the version that gets published. Work happens on branches (`space/...`, `ground/...`, `campaign/...`) and merges into `main` when the tests pass.
- Publishing copies the files on `main` to the claude.ai artifact above. Only publish from `main`, and only the files that changed.
- See `CLAUDE.md` for the rules every Claude session follows in this repository.
