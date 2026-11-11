# Rules for Claude sessions in this repository

This repository is the master copy of Iron Rain. The claude.ai artifact (slug `fc8b77cf-d69b-4cca-9154-8fb1d1a64fd2`) is only where the game is published.

## Branches
- Never commit straight to `main`. Make a branch per piece of work: `space/<topic>` (orbit, fleets, space battles), `ground/<topic>` (ground battles), `campaign/<topic>` (map, economy, politics, story), `gfx/<topic>`.
- Before starting, `git fetch origin main` and branch from it. Before merging, rebase on the latest `main`.
- Merge into `main` only after the tests pass (below). Several chats work on this game at once: keep each branch to its own area, and do not edit files another area owns unless the change needs it.

## Code
- No build step: ES modules loaded directly by `index.html` via its import map. Check syntax with `node --input-type=module --check < file`.
- Rendering is three.js r187 WebGPU (`import * as THREE from 'three'`, TSL from `'three/tsl'`). No GLSL, ShaderMaterial, RawShaderMaterial, onBeforeCompile, WebGLRenderer or WebGLRenderTarget.
- Simulation runs at a fixed 1/60 s step (`js/main.js`).
- Keep the lore accurate to the Red Rising books (search when unsure).

## Tests
- Serve with `bash tests/serve.sh`, then run `python3 tests/smoke.py`. It must pass before any merge.
- Changes to `js/enemyai.js`, `js/sim.js`, `js/morale.js` or `js/abilities.js`: also run `bash tests/run_tournament.sh` and compare against the previous summary.
- Graphics changes need a look on the user's real GPU (the built-in browser on their linked computer), since headless runs use SwiftShader.

## Publishing
- Publish only from `main`, only the files that changed since the last publish, with `base_version` set to the artifact's live version.
- If the live artifact has files newer than `main` (someone published outside the repository), bring them into a branch and merge them first. Never overwrite live files from a stale copy.
- Note the published artifact version in the merge commit or a tag (`published-<version>`).
