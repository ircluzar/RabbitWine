# Project explode: safe, incremental JS refactors (no behavior changes)

This note lists practical ways to further split our current `mz/js/*.js` files into smaller sub-topics, while preserving the existing classic-script workflow (globals, no imports). The goal is reorganizing only; keep names/behavior identical and just update `index.html` script order.

Current split
- config.js — DOM lookups, base constants, global `state`.
- gl.js — WebGL init, shader/program helpers, blit pipeline, render target, math utils.
- scene.js — grid pipeline, map/tile/walls/columns, grid overlays.
- input_ui.js — resize/letterbox, HUD, input handlers, seam dragging, UI toggle.
- gameplay.js — player control, physics, trail, player/trail renderer.
- bootstrap.js — render loop, cameras, present pass.

General safe-refactor rules
- Keep all identifiers and side-effects the same (names stay global).
- Only move code; don’t edit logic or signatures.
- Maintain dependency order in `index.html` so producers load before consumers.
- Prefer defining functions with `function name() {}` (hoists) over function expressions when moving across files, to avoid order surprises.
- Avoid splitting a variable’s initialization across files (e.g., keep VAO+VBO setup in the same file as its shader/pipeline).
- After each refactor, quick smoke: page loads, no console errors, scene renders.

Option A — split by render pipelines and geometry
- js/
  - core/
    - constants.js — BASE_WIDTH/HEIGHT; utility constants only.
    - state.js — constructs and exports global `state` (keep name `state`).
    - math.js — mat4 utils, normalizeAngle, deg2rad, smoothstep.
    - gl-core.js — getContext + createProgram + createRenderTarget only.
    - blit.js — BLIT shaders + quad VAO + `offscreen` target creation.
  - map/
    - map-data.js — TILE, MAP_W/H, `map`, `mapIdx`, `buildSampleMap`.
    - map-instances.js — `rebuildInstances`, `instOpen`, `instWall`.
    - columns.js — `extraColumns`, `columnHeights`.
  - pipelines/
    - grid.js — grid shaders, VAO, `renderGridViewport`, `drawGridOverlay`.
    - tiles.js — tile shaders, VAO/VBO, `drawTiles`.
    - walls.js — wall shaders, VAO/VBO, `drawWalls`, `drawTallColumns`.
    - trail.js — trail cube shaders/VAOs and helpers (for outlines too).
    - player.js — player textured cube pipeline (shaders, VAO) only.
  - gameplay/
    - player-state.js — `state.player` shape, defaults.
    - controls.js — `turnLeft/right`, keyboard handling.
    - physics.js — `applyVerticalPhysics`, `moveAndCollide`, `groundHeightAt`.
    - trail-logic.js — `updateTrail`.
    - camera.js — cam follow/yaw smoothing.
    - step-loop.js — `stepGame` orchestrator.
  - ui/
    - dom.js — getElementById; export CANVAS, HUD, SEAM, etc. (keep names).
    - resize.js — `resizeCanvasToViewport` and letterbox bookkeeping.
    - hud.js — `updateHUD`.
    - input-pointer.js — pointer handlers and gesture detection.
    - input-keyboard.js — key handlers.
    - seam.js — seam drag handlers.
    - toggle.js — fill viewport toggle wiring.
  - app/
    - bootstrap.js — render loop and camera setup only.

Load order (classic scripts)
1) core/constants.js → core/state.js → ui/dom.js → core/gl-core.js → core/math.js
2) core/blit.js
3) map/*.js (data → instances → columns)
4) pipelines: grid → tiles → walls → trail → player
5) ui: resize → hud → input-pointer → input-keyboard → seam → toggle
6) gameplay: player-state (if separate) → controls → physics → trail-logic → camera → step-loop
7) app/bootstrap.js

Option B — split by layer (platform, engine, game, UI)
- platform/ — dom, resize, input, HUD.
- engine/ — math, GL core, blit, pipelines (grid, tiles, walls, trail, player).
- game/ — map, columns, instances, physics, camera, controls, step.
- app/ — bootstrap.

Option C — split shader-heavy bits
- Keep gl.js small, move each shader + VAO into its own file:
  - grid-pipeline.js
  - tile-pipeline.js
  - wall-pipeline.js
  - trail-pipeline.js
  - player-pipeline.js
- Keep `draw*` functions co-located with their shader/VAO.

Option D — split data vs code
- map-data.js contains only arrays and constants (no GL).
- map-draw.js contains the GL code that consumes those arrays.
- player-data.js for `state.player` and related constants; player-draw.js for rendering.

Option E — separate “present pass”
- present.js owns `offscreen` and final blit to screen (letterbox math stays in UI resize).
- bootstrap calls present.render(offscreen.tex, letterboxRect).

Minimal, safe refactor recipes
- Move math helpers to `math.js` and include it right after `gl-core.js`. Ensure all math users load after it. No code changes.
- Extract `createGreenNoiseTextureArray` to `textures.js`. Replace the inline call site with the same function name (global). Load textures.js before gameplay pipeline.
- Extract gesture logic (swipe detect) to `gestures.js` called by pointer handlers. Keep the helper global name; call it from `onPointerMove` only.
- Pull out `groundHeightAt`, `moveAndCollide`, `applyVerticalPhysics` into `physics.js`. Ensure `map`, `columnHeights`, `TILE`, `MAP_W/H` are loaded first.
- Move the camera smoothing block from `stepGame` to `camera.js` with a global `stepCamera(dt)` and call it from `stepGame`.

Guardrails and gotchas
- Globals: keep names identical (`gl`, `state`, `CANVAS`, `MAP_W`, etc.). Avoid duplicate `const` declarations across files.
- Side-effects: init sequences (e.g., VAO/VBO creations) should run once; don’t import the same pipeline twice.
- Shader/VAO coupling: keep shader code and VAO setup together to avoid mismatches.
- Circular use: e.g., walls use trail-pipeline for outlines; ensure `trail-pipeline.js` loads before walls. If that feels brittle, inject a thin “outline renderer” file both can call.
- Performance: splitting files doesn’t change runtime, but more scripts = more HTTP requests. If that matters later, we can concatenate in a build step while keeping source split.

Progressive path to ES modules (optional, later)
1) Keep classic scripts; split files as above.
2) Introduce a single global namespace `window.MZ = {}` and assign members (no behavior change). Consumers read from `MZ.*`.
3) Convert files to `type="module"` and use explicit imports within `mz/js/`. Update references to remove reliance on globals.
4) Add a tiny bundler step (Rollup/Vite) to ship one file if needed.

Verification checklist per step
- Page loads without console errors.
- Scene and both cameras render.
- Controls: arrow-left/right, swipe left/right, space/tap jump.
- Seam snapping/dragging works and updates both views.
- HUD updates (FPS, inputs, player position).

Suggested next small splits
- math.js (deg2rad, smoothstep, mat4*)
- textures.js (createGreenNoiseTextureArray)
- physics.js (groundHeightAt, moveAndCollide, applyVerticalPhysics)
- camera.js (follow + yaw smoothing)
- pipelines/trail.js (trail wireframe + outlines)

All of the above can be done by moving functions verbatim into new files and adding new `<script>` tags to `mz/index.html` in the specified order.
