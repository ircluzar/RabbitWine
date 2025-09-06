# VRUN MZ — Engine Architecture

This document captures the current (M0) engine architecture implemented in `mz/index.php` and `mz/main.js`. It focuses on what exists today: rendering, input, simulation, view management, and debug UX.

Status: minimal app shell with functional rendering, split views, input handling, simple physics, and basic content pipelines.


## Runtime shell and DOM integration

- Files
  - `index.php`: single-page shell hosting a `<canvas id="app">`, a draggable seam (`#seam`/`#seam-handle`) for split views, a fill toggle button (`#fill-toggle`), a debug HUD (`#hud`), and swipe feedback glows.
  - `main.js`: initializes WebGL2, sets up render pipelines, input, simulation, and draw loop.
- Accessibility
  - Canvas has `aria-label` and is focusable (`tabindex=0`).
  - Seam uses `role="separator"` and `aria-orientation="horizontal"`.
  - Fill toggle uses `aria-pressed` and a clear `title`.
  - Decorative elements have `aria-hidden`.
- Script loading
  - `main.js` is loaded as an ES module (`type="module"`).


## Coordinate systems and units

- World space
  - Y-up; X/Z form the horizontal plane.
  - Tiles are 1×1 in XZ; floor tiles lie on Y=0; wall voxels stack up to heights in tile units.
- Canvas/viewport
  - Logical internal render target: 480×720 portrait. All world rendering targets this space first.
  - Device pixel ratio (`state.dpr`) is clamped to ≤3; used to size the on-screen canvas while preserving the internal logical target.
- Screen composition
  - Offscreen scene is blitted to the canvas. Letterboxing is computed and described via `state.letterboxCss` (x,y,w,h) for UI alignment.


## Rendering overview

- API: WebGL2 context (`webgl2`) with
  - `antialias: true`, `alpha: false`, `preserveDrawingBuffer: false`, `powerPreference: 'high-performance'`.
- Two-stage pipeline
  1) Render into a fixed-size offscreen framebuffer (480×720) for stable, deterministic visuals.
  2) Blit the offscreen texture to the canvas using a full-screen quad.
- Viewports
  - Screen is split into two stacked viewports separated by a draggable seam (`state.seamRatio` ∈ [0,1]).
  - Each viewport is rendered independently with its own camera and overlay.


## Offscreen render target (480×720)

- Created by `createRenderTarget(w,h)`.
- Contains at least a color texture attachment; depth handling depends on the implementation of `createRenderTarget` (not shown).
- Used as the primary target for all 3D passes; final pass samples `u_tex` to display on the main canvas.


## Blit pipeline (post-process copy)

- Geometry: NDC quad (two triangles) covering [-1,1]².
- Shaders
  - VS `BLIT_VS`: passes quad UVs derived from positions.
  - FS `BLIT_FS`: `texture(u_tex, v_uv)`.
- Resources: a VAO/VBO with 4 vertices; one program (`blitProgram`).


## Math utilities

- Implemented helpers: `mat4Identity`, `mat4Multiply`, `mat4Perspective`, `mat4LookAt`, `mat4Translate`, `mat4RotateY`, `mat4Scale`, plus scalars `deg2rad`, `smoothstep`, `normalizeAngle`.
- Used to assemble projection/view matrices per viewport and model transforms for instanced geometry and the player.


## Cameras and viewports

- Two viewports are rendered per frame via `renderGridViewport(x, y, w, h, cameraKind)`.
- Camera flavors
  - First-person/close camera and a third-person/follow camera are implied by `drawGridOverlay(mvp, camEye, isThirdPerson)`.
  - Camera follow target stored in `state.camFollow`; yaw in `state.camYaw`.
- Seam management
  - `#seam-handle` drag updates `state.seamRatio`.
  - Flags `state.snapBottomFull` and `state.snapTopFull` allow snapping a view to full height.


## Map and tiles

- Tile map
  - Dimensions: `MAP_W = 24`, `MAP_H = 24` (`Uint8Array`), with `TILE.OPEN = 0`, `TILE.WALL = 1`.
  - `buildSampleMap()` populates a test layout.
- Instancing
  - `rebuildInstances()` computes two typed arrays:
    - `instOpen: Float32Array` of (x,y) offsets for open-floor tiles.
    - `instWall: Float32Array` of (x,y) offsets for wall tiles.


### Floor tiles pipeline (instanced quads)

- Geometry: unit quad on the XZ plane (two triangles), local [0,1] range.
- Shaders
  - VS `TILE_VS`: places quads at `(a_off + u_originXZ) * u_scale` in XZ and at height `u_y` in Y; `u_mvp` projects.
  - FS `TILE_FS`: solid color `u_color`.
- Attributes
  - `a_pos` (vec3): base quad vertices.
  - `a_off` (vec2, instanced): per-tile XZ offset.
- Uniforms: `u_mvp`, `u_originXZ`, `u_scale`, `u_y`, `u_color`.
- Draw: `drawTiles(mvp, kind)` selects `instOpen` or `instWall` and issues an instanced draw.


### Wall voxels pipeline (instanced cubes, voxel-sliced)

- Geometry: unit cube [0,1]³ drawn as triangles.
- Shaders
  - VS `WALL_VS`: voxelizes by dividing the cube into a 3D grid using uniforms `u_voxCount` (counts) and `u_voxOff` (current voxel offset). Each pass renders one voxel slice offset, mapped into tile/world space with `u_originXZ`, `u_scale`, `u_height` (scale Y), and `u_yBase` (stacking base).
  - FS `WALL_FS`: color `u_color` with `u_alpha` for translucency.
- Attributes
  - `a_pos` (vec3): cube vertices.
  - `a_off` (vec2, instanced): tile offset (XZ).
- Uniforms: `u_mvp`, `u_originXZ`, `u_scale`, `u_height`, `u_color`, `u_alpha`, `u_voxCount`, `u_voxOff`, `u_yBase`.
- Draw: `drawWalls(mvp)` loops the voxel offsets and draws instanced cubes for each wall tile.


### Tall columns and block outlines

- Extra columns
  - Defined in `extraColumns` as tile coordinates and heights (in tile units):
    - (10,10)×6, (13,10)×6, (10,13)×6, (13,13)×6.
  - `columnHeights: Map` for O(1) tile-height lookup.
- Rendering
  - `drawTallColumns(mvp)` stacks multiple unit-height cubes using `u_yBase` to offset each layer.
  - `drawOutlinesForTileArray(mvp, tileArray, yCenter, baseScale)` draws thick black outlines for 1×1×1 blocks at given tiles (visual clarity and style pass).


## Player system

- State (`state.player`)
  - Position: `x, y, z` (world units); radius `0.3` (collision proxy).
  - Velocity: `vy` (vertical), `speed` (forward, magnitude); facing `angle` (yaw radians).
  - Flags: `grounded` (bool), `wallJumpCooldown` (timer), `jumpStartY` (for coyote/variable jump logic hooks).
- Control
  - Keyboard: `turnLeft()`, `turnRight()`, and jump via shared `doJump()`.
  - Touch: swipe-based turning (left/right) via `handleSwipeTurns()` and tap-to-jump.
- Physics
  - Horizontal motion: governed by `angle` and `speed` (exact acceleration not shown; speed may be scaled by `seamSpeedFactor()`).
  - Vertical motion: `applyVerticalPhysics(dt)` integrates gravity and handles landing/bounce per `groundHeightAt(x,z)`.
  - Collision: `moveAndCollide(dt)` resolves against tiles; walls block motion; floor Y is 0, wall tops are at 1 (plus column stacks).
- Camera follow
  - `state.camFollow` tracks player; `state.camYaw` stores camera yaw used by view matrices.


## Player rendering (textured cube)

- Geometry: 12 triangles forming a cube (~0.5 edge length), interleaved attributes per vertex: position (3), UV (2), texture-layer (1).
- Texture
  - `createGreenNoiseTextureArray(16, 6)`: creates a 16×16×6 texture array filled with green-noise; layers align with faces via per-vertex `a_layer`.
- Shaders
  - VS `PLAYER_VS`: transforms with `u_model` then `u_mvp`; passes UV and layer index.
  - FS `PLAYER_FS`: samples `sampler2DArray u_tex` at `vec3(v_uv, floor(v_layer + 0.5))` or forces white if `u_forceWhite == 1`.
- Uniforms: `u_mvp`, `u_model`, `u_tex`, `u_forceWhite`.


## Trail system (instanced wireframe cubes)

- Data model: `state.trail`
  - `points`: array of trail nodes with world position and birth time.
  - `maxPoints = 420`, `minDist ≈ 0.345`, `ttl = 0.69s` (fades over lifetime).
- Rendering
  - Base geometry: 12 edges as line segments, unit cube centered at origin.
  - Instancing: per-instance attribute `a_inst = vec4(x,y,z,bornSec)`; per-vertex `a_t` in [0,1] along each edge.
  - Shaders
    - VS `TRAIL_CUBE_VS`: `world = a_inst.xyz + a_pos * u_scale`; computes fade `v_alpha` from age `(now - bornSec)/ttl`.
    - FS `TRAIL_CUBE_FS`: optional dash mode (`u_dashMode` hides middle 80% when 1); color via `u_lineColor`; final alpha scaled by `u_mulAlpha`.
- Update: `updateTrail()` appends points as the player moves, prunes old ones by TTL.


## Grid overlay and debug visualization

- Grid pipeline
  - Geometry: raw line list across a finite area built by `buildGridLines(size, step)`.
  - Shaders: simple colored lines with distance-based falloff: `att = 1/(1 + dist*u_falloff)`, clamped to ≥0.25.
- Rendering helpers
  - `renderGridViewport(...)` draws per-viewport content, including grid, tiles, walls, player, and trail.
  - `drawGridOverlay(mvp, camEye, isThirdPerson)` adds UI overlays appropriate for camera type.


## Input system

- Aggregated state: `state.inputs`
  - `pointers: Map(pointerId → {x,y,...})` normalized by `normalizeEventPosition(e)`.
  - `keys: Set` of pressed key identifiers.
  - `gamepads: []` reserved (detected but not yet used).
- Event wiring
  - Pointer events: `pointerdown`, global `pointermove`, `pointerup`, `pointercancel`.
  - Keyboard: `keydown`, `keyup` mapped to `onKey(e)`.
  - Context menu disabled (`contextmenu` prevented) to allow long-press.
- Gestures and feedback
  - Swipe detection for turning left/right in `handleSwipeTurns()` with UI glows (`#swipe-glow-left/right`); timers `glowTimerL/R` control fade.
  - Tap triggers `doJump()` when grounded.


## View management: seam and scaling

- Seam divider
  - DOM: `#seam` with `#seam-handle`.
  - Logic: drag handle updates `state.seamRatio`; `snapBottomFull` / `snapTopFull` support snapping.
- Fill toggle
  - `state.fillViewport` toggled by `#fill-toggle`; sets CSS to either fill window or render at native size with letterboxing.
- Resize handling
  - `resizeCanvasToViewport()` recomputes canvas CSS size and on-screen pixel size based on DPR, aspect, and fill mode.


## Frame loop and timing

- `render(now)` (RAF-driven)
  - Computes `dt` from `state.timePrev`.
  - Steps simulation: `stepGame(dt)`
    - Reads input: `handleKeyboard(dt)`, `handleSwipeTurns()`
    - Updates physics: `moveAndCollide(dt)`, `applyVerticalPhysics(dt)`, trail, etc.
  - Renders both viewports into the offscreen target.
  - Blits offscreen texture to the canvas.
  - Updates HUD (`updateHUD(now)`) including FPS every second using `state.frames` and `state.lastFpsT`.


## Performance characteristics

- Stable internal target (480×720) decouples visual quality from device resolution; DPR is applied only at final blit.
- Instancing minimizes draw calls for tiles and walls.
- Simple shaders and compact vertex formats keep bandwidth low.
- Potential improvements (future)
  - Depth prepass and proper depth buffer config (depends on `createRenderTarget` specifics).
  - Frustum culling / tile visibility.
  - Batched voxel slicing to reduce passes.
  - GPU timers / stats overlays.


## Error handling and fallbacks

- WebGL2 context
  - On failure, an early guard shows a message (in code: `if (!gl) { … }`).
- Input
  - Pointer and keyboard listeners are global; events are clamped/normalized; context menu prevented.


## Data contracts (selected)

- Tile instances (buffers)
  - `instOpen`, `instWall`: Float32Array length = 2×instanceCount, laid out as `[x0,y0, x1,y1, ...]`.
- Trail instance buffer
  - Layout per instance: `vec4(x, y, z, bornSec)`; TTL and now are uniforms.
- Player VBO (interleaved)
  - Stride: 6 floats (24 bytes). Offsets: pos 0, uv 12 bytes, layer 20 bytes.


## Known constants and tuning knobs

- `BASE_WIDTH = 480`, `BASE_HEIGHT = 720`.
- DPR clamp: `min(devicePixelRatio, 3)`.
- Player radius: `0.3`.
- Trail: `maxPoints = 420`, `minDist = 0.69/2`, `ttl = 0.69`.
- Grid: `buildGridLines(24, 1)` by default.
- Extra columns: four positions with height 6 each (see above).


## Extensibility and next steps

- Input
  - Hook up `gamepads[]` with a polling layer and deadzone filtering.
- World
  - Externalize map building; add loader for authored levels; introduce per-tile materials.
- Rendering
  - Add proper depth buffer to offscreen RT and enable depth test; add face culling where appropriate.
  - Material system for walls/tiles; lighting or stylized shading.
- Simulation
  - Separate physics tick from render; fixed-step integrator; collision sweeps against voxel stacks.
- UI
  - Keyboard/gamepad UI hints; mobile-friendly seam handle size; accessibility announcements for mode toggles.


## File map and responsibilities

- `mz/index.php`
  - Hosts canvas and interactive controls (seam, fill toggle, HUD, swipe glows).
  - Wires ARIA attributes for minimal accessibility.
- `mz/main.js`
  - Initializes GL, compiles shader programs, creates buffers and textures.
  - Manages application `state` (timing, input, camera, player, trail, map).
  - Owns the render loop, viewport composition, and all drawing calls.


## Glossary (symbols referenced)

- Programs: `blitProgram`, `gridProgram`, `tileProgram`, `wallProgram`, `playerProgram`, `trailCubeProgram`.
- VAOs: `blitVAO`, `gridVAO`, `tileVAO`, `wallVAO`, `playerVAO`, `trailCubeVAO`.
- VBOs: corresponding position/instance buffers for each pipeline.
- Uniforms: listed in each section; primarily `u_mvp`, `u_model`, `u_tex`, `u_color`, `u_alpha`, `u_scale`, `u_originXZ`, `u_vox*`, `u_now`, `u_ttl`.


---

This document reflects the current code as of the attached `main.js` summary and `index.php`. It will evolve as systems mature and new subsystems (animation, audio, UI, tooling) are added.