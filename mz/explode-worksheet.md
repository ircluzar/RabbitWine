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
- [x] Confirm current split runs (config.js, gl.js, scene.js, input_ui.js, gameplay.js, bootstrap.js).
- [x] Note current `index.html` script order.
- [x] Commit a checkpoint (baseline before deeper split).

---

## Milestone 1 — Core foundation split
Create `mz/js/core/` and move low-level, shared pieces.

Files
- [ ] core/constants.js — `BASE_WIDTH`, `BASE_HEIGHT` (constants only).
- [ ] core/state.js — constructs global `state` object (same shape/names).
- [ ] ui/dom.js — `CANVAS`, `HUD`, `SEAM`, `SEAM_HANDLE`, `GLOW_L`, `GLOW_R`, `FILL_TOGGLE` (DOM lookups only).
- [ ] core/gl-core.js — WebGL2 `gl` init; `createProgram`, `createRenderTarget`.
- [ ] core/math.js — `mat4Identity`, `mat4Multiply`, `mat4Perspective`, `mat4LookAt`, `mat4Translate`, `mat4RotateY`, `mat4Scale`, `deg2rad`, `smoothstep`, `normalizeAngle`.
- [ ] core/blit.js — BLIT shaders/VAO/VBO and `offscreen` target.

Index order update
- [ ] Include: constants → state → ui/dom → gl-core → math → blit (before anything that uses them).
- [ ] Smoke test (see checklist).

---

## Milestone 2 — Map data and instances
Create `mz/js/map/` for game space data separate from rendering.

Files
- [ ] map-data.js — `TILE`, `MAP_W`, `MAP_H`, `map`, `mapIdx`, `buildSampleMap()` (invoked once here).
- [ ] map-instances.js — `rebuildInstances()`, `instOpen`, `instWall`.
- [ ] columns.js — `extraColumns`, `columnHeights` (built once here).

Index order update
- [ ] Load map-data → map-instances → columns after core and before pipelines.
- [ ] Smoke test.

---

## Milestone 3 — Rendering pipelines by component
Create `mz/js/pipelines/` and split each GPU pipeline with its VAO+draw routines.

Files
- [ ] grid.js — grid shaders/VAO; `renderGridViewport`, `drawGridOverlay`.
- [ ] tiles.js — tile shaders/VAO; `drawTiles(mvp, kind)`.
- [ ] trail.js — trail wireframe shaders/VAO; exports uniforms/VAOs used by trail + outlines.
- [ ] walls.js — wall shaders/VAO; `drawWalls`, `drawTallColumns` (depends on trail.js for outlines).
- [ ] player.js — player cube shaders/VAO; exposes uniforms/VAO for player drawing.

Index order update
- [ ] pipelines load order: grid → tiles → trail → walls → player.
- [ ] Smoke test.

---

## Milestone 4 — UI + input split
Create `mz/js/ui/` for browser/UI concerns.

Files
- [ ] resize.js — `resizeCanvasToViewport` and letterbox computation.
- [ ] hud.js — `updateHUD`.
- [ ] input-pointer.js — `onPointerDown/Move/UpOrCancel`, swipe detection.
- [ ] input-keyboard.js — `onKey` (keydown/up wiring).
- [ ] seam.js — seam drag handlers and snapping logic.
- [ ] toggle.js — fill viewport toggle button wiring.
- [ ] dom-events.js — all `addEventListener` bindings (optional; can remain near each feature if preferred).

Index order update
- [ ] Load ui files after core and before gameplay (so handlers exist early).
- [ ] Smoke test.

---

## Milestone 5 — Gameplay logic split
Create `mz/js/gameplay/` for pure logic and orchestration.

Files
- [ ] player-state.js — default `state.player` structure and constants (if not kept in state.js; choose one place and remove duplication).
- [ ] controls.js — `turnLeft`, `turnRight`, `handleKeyboard`.
- [ ] physics.js — `groundHeightAt`, `moveAndCollide`, `applyVerticalPhysics`.
- [ ] trail-logic.js — `updateTrail`.
- [ ] camera.js — camera follow/yaw smoothing helpers.
- [ ] step-loop.js — `stepGame(dt)` calls physics, movement, camera, trail updates.

Index order update
- [ ] Load gameplay files after pipelines and UI.
- [ ] Smoke test.

---

## Milestone 6 — App bootstrap and present
Create `mz/js/app/` to isolate the render loop and presenting.

Files
- [ ] bootstrap.js — the main loop (`render(now)`), both camera views, scene draw calls, and final blit.
- [ ] (Optional) present.js — move final screen blit here; bootstrap calls present.

Index order update
- [ ] Ensure bootstrap is last.
- [ ] Smoke test.

---

## Milestone 7 — Wiring + cleanup
- [ ] Replace previous intermediate split files (config.js, gl.js, scene.js, input_ui.js, gameplay.js) with the new structure or keep them only as temporary shims until parity is verified.
- [ ] Remove any duplicated globals; ensure each symbol is defined once.
- [ ] Verify load order comments are reflected in `index.html`.
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
