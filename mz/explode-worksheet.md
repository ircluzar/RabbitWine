# Option A worksheet — milestone plan with checklists (safe, no-behavior-change)

Guiding rules
- Only move code; keep names/behavior identical. No signature changes.
- Classic scripts (globals) — maintain dependency-safe load order in `mz/index.html`.
- After every milestone, run a quick smoke test before continuing.

Verification checklist (run after each milestone)
- [ ] Page loads with no console errors.
- [ ] Scene renders (both views) and FPS updates.
- [ ] Arrow keys (or A/D) turn left/right once per press.
- [ ] Space/tap jumps; wall-jump triggers when applicable.
- [ ] Trail renders and fades.
- [ ] Seam drag/snap works (bottom/top/full).
- [ ] HUD shows pointers/keys and positions.

---

## Milestone 0 — Prep and baseline
- [ ] Confirm current split runs (config.js, gl.js, scene.js, input_ui.js, gameplay.js, bootstrap.js).
- [ ] Note current `index.html` script order.
- [ ] Commit a checkpoint (baseline before deeper split).

---

## Milestone 1 — Core foundation split
Create `mz/js/core/` and move low-level, shared pieces.

Files
- [x] core/constants.js — `BASE_WIDTH`, `BASE_HEIGHT` (constants only).
- [x] core/state.js — constructs global `state` object (same shape/names).
- [x] ui/dom.js — `CANVAS`, `HUD`, `SEAM`, `SEAM_HANDLE`, `GLOW_L`, `GLOW_R`, `FILL_TOGGLE` (DOM lookups only).
- [x] core/gl-core.js — WebGL2 `gl` init; `createProgram`, `createRenderTarget`.
- [x] core/math.js — `mat4Identity`, `mat4Multiply`, `mat4Perspective`, `mat4LookAt`, `mat4Translate`, `mat4RotateY`, `mat4Scale`, `deg2rad`, `smoothstep`, `normalizeAngle`.
- [x] core/blit.js — BLIT shaders/VAO/VBO and `offscreen` target.

Index order update
- [x] Include: constants → state → ui/dom → gl-core → math → blit (before anything that uses them).
- [x] Smoke test (see checklist).

---

## Milestone 2 — Map data and instances
Create `mz/js/map/` for game space data separate from rendering.

Files
- [x] map-data.js — `TILE`, `MAP_W`, `MAP_H`, `map`, `mapIdx`, `buildSampleMap()` (invoked once here).
- [x] map-instances.js — `rebuildInstances()`, `instOpen`, `instWall`.
- [x] columns.js — `extraColumns`, `columnHeights` (built once here).

Index order update
- [x] Load map-data → map-instances → columns after core and before pipelines.
- [x] Smoke test.

---

## Milestone 3 — Rendering pipelines by component
Create `mz/js/pipelines/` and split each GPU pipeline with its VAO+draw routines.

Files
- [x] grid.js — grid shaders/VAO; `renderGridViewport`, `drawGridOverlay`.
- [x] tiles.js — tile shaders/VAO; `drawTiles(mvp, kind)`.
- [x] trail.js — trail wireframe shaders/VAO; exports uniforms/VAOs used by trail + outlines.
- [x] walls.js — wall shaders/VAO; `drawWalls`, `drawTallColumns` (depends on trail.js for outlines).
- [x] player.js — player cube shaders/VAO; exposes uniforms/VAO for player drawing.

Index order update
- [x] pipelines load order: grid → tiles → trail → walls → player.
- [ ] Smoke test.

---

## Milestone 4 — UI + input split
Create `mz/js/ui/` for browser/UI concerns.

Files
- [x] resize.js — `resizeCanvasToViewport` and letterbox computation.
- [x] hud.js — `updateHUD`.
- [x] input-pointer.js — `onPointerDown/Move/UpOrCancel`, swipe detection.
- [x] input-keyboard.js — `onKey` (keydown/up wiring).
- [x] seam.js — seam drag handlers and snapping logic.
- [x] toggle.js — fill viewport toggle button wiring.
- [x] dom-events.js — all `addEventListener` bindings (optional; can remain near each feature if preferred).

Index order update
- [x] Load ui files after core and before gameplay (so handlers exist early).
- [ ] Smoke test.

---

## Milestone 5 — Gameplay logic split
Create `mz/js/gameplay/` for pure logic and orchestration.

Files
- [ ] player-state.js — default `state.player` structure and constants (if not kept in state.js; choose one place and remove duplication).
	- Note: kept in `core/state.js`; no separate file needed.
- [x] controls.js — `turnLeft`, `turnRight`, `handleKeyboard`.
- [x] physics.js — `groundHeightAt`, `moveAndCollide`, `applyVerticalPhysics`.
- [x] trail-logic.js — `updateTrail`.
- [x] camera.js — camera follow/yaw smoothing helpers.
- [x] step-loop.js — `stepGame(dt)` calls physics, movement, camera, trail updates.

Index order update
- [x] Load gameplay files after pipelines and UI.
- [ ] Smoke test.

---

## Milestone 6 — App bootstrap and present
Create `mz/js/app/` to isolate the render loop and presenting.

Files
- [x] bootstrap.js — the main loop (`render(now)`), both camera views, scene draw calls, and final blit.
- [ ] (Optional) present.js — move final screen blit here; bootstrap calls present.

Index order update
- [x] Ensure bootstrap is last.
- [ ] Smoke test.

---

## Milestone 7 — Wiring + cleanup
- [x] Replace previous intermediate split files (config.js, gl.js, scene.js, input_ui.js, gameplay.js) with the new structure or keep them only as temporary shims until parity is verified.
	- Removed: `js/config.js`, `js/gl.js`, `js/scene.js`, `js/input_ui.js`, old `js/bootstrap.js`.
	- Kept: `js/gameplay.js` (rendering-only) and all new split files.
- [x] Remove any duplicated globals; ensure each symbol is defined once.
	- Player state remains in `core/state.js`.
	- Rendering helpers live in `gameplay.js`; logic lives in `gameplay/*`.
- [x] Verify load order comments are reflected in `index.html`.
- [ ] Update/readme for new layout (optional).
- [ ] Smoke test (final).

---

## Index.html target order (summary)
1. core/constants.js → core/state.js → ui/dom.js → core/gl-core.js → core/math.js → core/blit.js
2. map/map-data.js → map/map-instances.js → map/columns.js
3. pipelines/grid.js → pipelines/tiles.js → pipelines/trail.js → pipelines/walls.js → pipelines/player.js
4. ui/resize.js → ui/hud.js → ui/input-pointer.js → ui/input-keyboard.js → ui/seam.js → ui/toggle.js (→ ui/dom-events.js if used)
5. gameplay/player-state.js (if separate) → gameplay/controls.js → gameplay/physics.js → gameplay/trail-logic.js → gameplay/camera.js → gameplay/step-loop.js
6. app/bootstrap.js (→ app/present.js if split)

Notes
- Keep shader + VAO creation co-located.
- Trails/outlines required by walls: load `pipelines/trail.js` before `pipelines/walls.js`.
- If a symbol ends up referenced before definition, adjust script order rather than changing code.
