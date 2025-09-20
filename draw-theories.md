# Tall Columns Rendering Skip - Theories and Remediation

Console message observed:
```
[WALLS] Tall columns drawing skipped - resources not initialized
```
Source: `drawTallColumns()` in `pipelines/walls.js`

## TL;DR Most Likely Fix Path
1. Ensure deferred wall initialization runs before first render frame needing tall columns (add explicit `ensureWallInit()` call early in bootstrap).
2. Unify buffer access inside `drawTallColumns()` with the new `__wall_getBuffers()` indirection (currently still checking old locals like `wallVAO`).
3. Guarantee `walls/buffers.js` loads before `walls.js` and shader script; verify load order in `index.php`.
4. Verify `createWallGeometry()` returns non-empty Float32Array before any tall column draw.
5. If using JSON fallback for map data, delay first render until spans/columns loaded.

---

## Theory 1: Resource Guard Still Points to Removed Locals (Very Likely)
`drawTallColumns()` checks `if (!wallProgram || !wallVAO)` but after refactor the VAO is created in `buffers.js` and exposed via `window.wallVAO`. If `drawTallColumns()` ran before `buffers.js` finished OR we removed local `let wallVAO` (and replaced in other paths) but not updated the tall columns path, the guard will always see `undefined` and skip.

Remediation:
- Replace its guard with the pattern used in `drawWalls()`: destructure `const { wallVAO } = __wall_getBuffers()`.
- Add late re-init attempt: if `!wallProgram && deps present` call `initWallResources()` once.

## Theory 2: Deferred Initialization Race (Very Likely)
The deferred init loop (`scheduleWallInit`) may complete after the first few render frames. If `bootstrap.js` calls `drawTallColumns()` in its render loop immediately, early frames skip and logs appear.

Remediation:
- In bootstrap, gate rendering of walls/columns on `window.wallProgram` existence OR add a one-time `awaitWallInit()` style promise before enabling render.
- Or call `initWallResources()` synchronously if dependencies are already present.

## Theory 3: Geometry Not Yet Generated (Likely)
`tall columns` rely on `wallBasePosData` indirectly for jitter & voxel loops. If `createWallGeometry()` returned `null` (e.g., due to load order or an exception), `initWallVAOs()` aborted. `wallProgram` might be set but VAO missing.

Remediation:
- Add console assertion after `createWallGeometry()` to confirm non-empty.
- Retry geometry generation if first attempt returns falsy.

## Theory 4: buffers.js Not Loaded Before walls.js (Likely)
If `buffers.js` is intended to precede `walls.js` but network ordering or caching causes out‑of‑order execution, then the VAO init function or window exports might not exist yet. `initWallResources()` would call `initWallVAOs()` (which is now removed from `walls.js`), leading to a silent no-op.

Remediation:
- Confirm `<script src=".../walls/buffers.js">` is before `walls.js` in `index.php` (already adjusted, but re-verify).
- Add defensive: `if (!window.initWallVAOs) { console.warn('[WALLS] buffers module missing'); }`.

## Theory 5: Spans / Column Data Not Ready (Moderate)
`tall columns` only draw if `columnSpans.size > 0` or `extraColumns.length > 0`. If the JSON fallback loads async and first frames execute before data arrives, group building results in `groups.size === 0` and early return (silent). But log message implies it got past that to the resource guard. Still, spans may be ready later but resources still not.

Remediation:
- Defer calling `drawTallColumns()` until spans loaded event (e.g., set a flag when data ingest complete).

## Theory 6: State Mutation Clearing VAO After Creation (Moderate)
Some external cleanup (e.g., context loss handler or a debug reset) might null out `window.wallVAO` between frames. Then the guard triggers intermittently.

Remediation:
- Add temporary tracing: if previously had VAO and now missing, log stack.
- Implement lazy re-init: if program exists but VAO missing, call `initWallVAOs(wallBasePosData)` again.

## Theory 7: WebGL Context Recreated (Moderate)
If a context loss occurred and was restored, old VAO/VBO objects are invalid. Guard sees missing references and skips drawing.

Remediation:
- Listen for `webglcontextrestored` event and rerun `initWallResources()`.

## Theory 8: Multiple Copies of walls.js Competing (Moderate)
If cached & bust query variants load twice, first instance sets globals, second instance has shadow copies with uninitialized references causing mismatched state and final copy logs skip.

Remediation:
- Add idempotent guard: if `window.__WALLS_INIT_VERSION` set, skip duplicate evaluation.

## Theory 9: MP / Level Transition Interference (Lower)
Level switch logic might clear spans or map data while tall column path executes during the same frame as a resource re-init.

Remediation:
- Sequence level transitions: freeze render or show loading overlay until both spans + wall resources ready.

## Theory 10: Jitter System Dependency (Lower)
`drawTallColumns()` triggers jitter update; if jitter arrays depend on VAO init ordering and that fails, code path might bail earlier in unrevised segments.

Remediation:
- Ensure jitter init separated from VAO existence check.

## Theory 11: Mutation of Global `mapIdx` / `map` Before Use (Lower)
An exception thrown while grouping columns (e.g., invalid `mapIdx`) could abort before buffers bound, leaving partially configured state and subsequent calls hitting guard.

Remediation:
- Wrap grouping loop in try/catch with explicit error log.

## Theory 12: Incorrect Assumption About `columnSpans` Map Type (Lower)
If `columnSpans` replaced with plain object temporarily, `columnSpans.size` is undefined causing `hasSpans` false; later asynchronous replacement triggers group building but resources weren't initialized at first run.

Remediation:
- Normalize: `const spansMap = (columnSpans instanceof Map) ? columnSpans : new Map(Object.entries(columnSpans||{}));`

## Theory 13: Boot-Time Race With Music / Other Systems (Low)
Some bootstrap sequencing may starve wall init tick (setTimeout) causing a delayed attempt beyond first render frames.

Remediation:
- Convert deferred init to requestAnimationFrame loop with explicit dependency check.

---

## Recommended Implementation Steps (Action Order)
1. Patch `drawTallColumns()` resource guard to mirror updated `drawWalls()` and use `__wall_getBuffers()`.
2. Add late init inside `drawTallColumns()` similar to `drawWalls()` (attempt `initWallResources()` if deps exist and not yet initialized).
3. Add a centralized `ensureWallResources()` function called by both draw functions.
4. Add tracing for first successful VAO acquisition.
5. Add context loss listener to rebuild resources.
6. Gate initial rendering in `bootstrap.js` on `window.wallProgram` readiness.

## Quick Diagnostic Patch (Proposed)
```js
function ensureWallResources(){
  if (wallProgram) return true;
  if (window.gl && window.initWallShaders && window.createWallGeometry && window.initWallVAOs){
    try { initWallResources(); return !!wallProgram; } catch(e){ console.warn('[WALLS] init fail', e); }
  }
  return false;
}
```
Then call at top of both draw functions.

---

## Verification Checklist Post-Fix
- No more "resources not initialized" logs after first second of runtime.
- `drawTallColumns()` renders visible multi-height pillars matching spans.
- Hot level changes still show pillars.
- WebGL context loss (manual test) triggers re-init without persistent errors.

---

## Appendix: Signals To Add Temporarily
| Signal | Purpose |
|--------|---------|
| `[WALLS] ensureWallResources attempt` | Confirm dependency detection path runs |
| `[WALLS] VAO acquired` | First frame VAO becomes non-null |
| `[WALLS] Re-init after missing VAO` | Late creation path triggered |

Remove after stabilization.

---

Let me know if you want me to implement the guard + unified ensure function now.
