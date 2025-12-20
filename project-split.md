# Rabbit Wine Livingroom — Project Split Plan

This document describes how to split the current monolithic `livingroom/index.htm` into a modular structure with separate CSS and JavaScript modules:

- `livingroom.css` — styles and responsive layout
- `livingroom.js` — app bootstrap, DOM wiring, event handlers
- `scene.js` — scene state, persistence, and object management
- `webcamfx.js` — webcam FX buffer rendering and loop control
- `warp.js` — perspective transform helpers and warp-handle interactions

## Goals
- Isolate concerns to improve readability and maintainability.
- Reduce inlined CSS/JS in HTML and enable reuse across views.
- Keep public behavior identical while preparing for future features.

## Target Files & Responsibilities

- `livingroom.css`
  - Move all CSS from the `<style>` block in `index.htm`.
  - Preserve variables (`--bg`, `--panel`, etc.), responsive media queries, and class names (`.object`, `.shadow`, `.warp-handle`, etc.).

- `livingroom.js`
  - Entry module. Imports `scene.js`, `webcamfx.js`, `warp.js`.
  - Queries DOM elements, wires UI events, orchestrates initialization.
  - Hosts view camera logic: zoom, pan, fullscreen UI sync and `applyViewTransform()`.
  - Hosts music lifecycle (fade in/out), external-music integration, and HUD toggle messaging.

- `scene.js`
  - Exports `Scene` class encapsulating:
    - State: `objects`, `referenceSize`, `subtitle`, `music`.
    - Persistence via global `memory` (`read`/`write`) with keys: `scene_v1`, `auto_import`, `dev_unlocked`.
    - Object operations: `addObject()`, `toggleBase()`, `moveZ()`, `duplicateObject()`, `resetObject()`, `deleteObject()`, `setLockAll()`.
    - Utilities: `getBase()`, `ensureAlias()`, `centerCoords()`, `getScaleFactors()`, `getBaseAspect()`, `measureBaseIntrinsic()`.
    - Import/export: `importScene(text)`, `downloadScene()` with data-source upgrade.

- `webcamfx.js`
  - Exports `WebcamFX` class responsible for:
    - Offscreen buffer sizing and sync: `syncSize()`.
    - Scene rasterization: `drawSceneIntoBuffer(scene, objectLayer)`.
    - Noise overlay: `applyNoiseOverlay()`.
    - Frame render and loop control: `renderFrame()`, `startLoop()`, `stopLoop()`, `setEnabled(flag)`, `setQuality(q)`, `setInterval(ms)`.
    - Availability checks based on presence of video objects and UI updates.

- `warp.js`
  - Pure helpers + controller:
    - `getPerspectiveTransform(w, h, points)` generating the CSS `matrix3d`.
    - `WarpController` encapsulating pointer interactions:
      - `beginDrag(e, obj, index)`, `moveDrag(e)`, `endDrag()`.
      - Emits updates to re-render and persist via hooks.

## HTML Changes (livingroom/index.htm)

1. Replace inline CSS with a stylesheet link:
   ```html
   <link rel="stylesheet" href="livingroom.css" />
   ```

2. Keep `../memory.js` as a non-module script (provides global `memory`):
   ```html
   <script src="../memory.js"></script>
   ```

3. Load the entry module instead of inline `<script>`:
   ```html
   <script type="module" src="livingroom.js"></script>
   ```

4. No structural HTML changes needed; preserve element IDs/classes used by JS modules (`#viewport`, `#stageFrame`, `#stage`, `#objectLayer`, HUD elements, modal elements, etc.).

## CSS Extraction Guidelines (livingroom.css)
- Copy all rules from the existing `<style>` block verbatim.
- Confirm media queries and the `.warp-handle` visibility behavior remain intact.
- Do not change class names; JS relies on them for behavior.

## JavaScript Module Split

### livingroom.js (entry)
- Imports:
  ```js
  import { Scene } from './scene.js';
  import { WebcamFX } from './webcamfx.js';
  import { getPerspectiveTransform, WarpController } from './warp.js';
  ```
- Responsibilities:
  - Query DOM, cache elements, wire event listeners (`menuToggle`, `hudToggle`, `zoom`, `fullscreenToggle`, drag/drop, etc.).
  - Instantiate `Scene`, `WebcamFX`, `WarpController` and pass required hooks/refs.
  - Implement camera pan/zoom/fullscreen logic and update transform on `#stage` and `#webcamFxCanvas`.
  - Music orchestration: `startMusic()`, `fadeInMusic()`, `fadeOutAndStopMusic()`, `setMusicSource()` and external-music messages.
  - Bootstrap sequence similar to `init()` with ordered steps: load preferences → load scene → set zoom → render → setup FX → auto-import default → sync inputs → start music.

### scene.js
- Class `Scene` with methods mapped from current inline script:
  - Persistence: `load()`, `save()`.
  - Object lifecycle: `addObject()`, `toggleBase(id)`, `moveZ(id, dir)`, `duplicateObject(id)`, `resetObject(id)`, `deleteObject(id)`, `setLockAll(locked)`.
  - Import/export: `import(text)`, `download()`.
  - Layout helpers: `getReferenceSize()`, `centerCoords()`, `getScaleFactors()`, `getBaseAspect()`, `measureBaseIntrinsic(obj)`.
  - Public properties used by other modules: `objects`, `subtitle`, `music`, and flags.

### webcamfx.js
- Class `WebcamFX` constructed with refs `{ stageFrame, canvas, objectLayer }`.
- Methods:
  - `setEnabled(flag)`, `startLoop()`, `stopLoop()`, `renderFrame(scene)`.
  - `setQuality(q)`, `setInterval(ms)`, and a ramp akin to `setupWebcamFxRamp()`.
  - Internals replicate: buffer creation, cover-dimensions, ordering/z-index, shadow raster, bitmap draw.

### warp.js
- `getPerspectiveTransform(w, h, p)` copied from current implementation.
- `WarpController` encapsulates pointer handlers; calls back to `renderObjects()` and `scene.save()` via injected callbacks.

## Initialization Flow
1. Construct `Scene` and load: preferences (`auto_import`, `dev_unlocked`, `webcam_fx_enabled`) and saved scene.
2. Render objects and subtitle; measure base intrinsic to set aspect.
3. Initialize `WebcamFX`:
   - Apply quality/interval ramp, enable state, and start loop if available.
4. Wire UI controls and global listeners (`fullscreenchange`, `resize`, `drag/drop`, messaging).
5. Auto-import `default.json` if enabled.
6. Update inputs (`subtitleInput`, `musicInput`) from scene.
7. Start or resume music with fade-in; enforce volume ceiling.

## Dependency Notes
- `memory.js` remains a global dependency loaded before `livingroom.js`.
- `Audio("music.mp3")` stays in `livingroom.js`; `scene.music` selects source via `getMusicSource()`.
- Keep `crypto.randomUUID()` usage for IDs.
- Maintain all accessibility labels and button titles.

## Migration Checklist

- [ ] Create `livingroom.css` and move all CSS from `index.htm`.
- [ ] Add `<link rel="stylesheet" href="livingroom.css">` to `index.htm`.
- [ ] Create `scene.js` with state/persistence/object methods.
- [ ] Create `webcamfx.js` with buffer, render loop, and ramp.
- [ ] Create `warp.js` with transform helper and controller.
- [ ] Create `livingroom.js` that imports modules, wires DOM, and runs `init()`.
- [ ] Replace inline `<script>` in `index.htm` with `<script type="module" src="livingroom.js"></script>`.
- [ ] Verify drag/pan/zoom, warp handles, shadows, HUD toggle, modal actions, import/export.
- [ ] Verify Webcam FX on/off and auto-disable when video objects present.
- [ ] Verify music fade-in/out and external music messages.
- [ ] Test responsive behavior in portrait/landscape and fullscreen.

## Try It (Local)
No build required. Open `livingroom/index.htm` in a modern browser. For local files and fetch-based features (e.g., `default.json` HEAD/GET), use a simple static server:

```bash
# PowerShell
python -m http.server 8080 -d w:\rabbitwine
# Then navigate to http://localhost:8080/livingroom/index.htm
```

## Future Enhancements
- Consider extracting camera view code to `view.js` if it grows.
- Add `utils.js` for shared helpers like `clamp()`, `coverDimensions()`, and `fileToDataURL()`.
- Type annotations via JSDoc or migrate to TypeScript for stronger contracts.
