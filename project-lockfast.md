# Project: LockFast (Accelerating Lock Block Rendering & CPU Cost)

Purpose: Reduce frame time and input latency impact caused by lock spans (t:6) in `drawTallColumns()` and related pipelines. Target ≥60% reduction in worst‑case per-frame lock rendering cost while preserving visuals (outline aesthetic, fades) and correctness (collision semantics unchanged).

## Baseline (to capture before starting)
Record on a representative scene heavy with locks (N tiles * average height H):
- lock tiles (unique x,y with t:6) = ?
- average & max height = ?
- frame time (ms) 95th / worst while camera top and bottom
- `__lockProfile`: spanLock, lockTiles, timeGroupMs, timeLockRenderMs averages
- GPU timing (optional): total GL time vs CPU scripting time (Performance panel)
Store raw notes in `perf-notes/lockfast-baseline.md`.

## High-Level Strategy
1. Eliminate per-level CPU loops where possible (collapse vertical levels into a single instance + shader logic).
2. Minimize WebGL buffer churn (allocate once, reuse with subData or instancing metadata).
3. Reduce draw call count (one draw per column or per batch instead of 2 * height).
4. Hoist & cache computations (alphas, fades) outside hot loops.
5. Add cheap culling (frustum / distance) prior to lock processing.
6. Defragment spans at ingestion (merge contiguous same-type vertical segments).
7. Provide instrumentation to quantify improvements after each phase.

## Task Breakdown

### Task 1: Measurement & Instrumentation Hardening
- [ ] Subtask 1.1: Extend `window.__lockProfile` to track: maxHeightObserved, drawCallsLock, bufferBytesUploadedLock.
- [ ] Subtask 1.2: Add a toggle `window.__PROFILE_LOCK_GPU` that inserts `gl.finish()` around lock rendering (dev only) to approximate GPU cost.
- [ ] Subtask 1.3: Add console summary helper `printLockProfile(deltaFrames=300)`.
- Success Criteria: Can reliably compare before/after per-frame metrics across 300 frames; overhead < 2% when profiling disabled.

### Task 2: Span Coalescing (Data-Level Reduction)
- [x] Subtask 2.1: In span merge logic (`multiplayer.js` region ~440–504), detect contiguous same `(t,b,h)` vertical neighbors for t:6 and merge into singular larger h.
- [x] Subtask 2.2: Provide optional one-time compaction pass `compactAllLockSpans()` to run after bulk loads.
- [x] Subtask 2.3: Add debug counter `window.__lockSpanMerged` (# merges performed).
- Success Criteria: For fragmented scenarios, number of lock span records decreases ≥30% without changing visual output. (Pending measurement)

### Task 3: Per-Column Aggregation (Replace Per-Level Loop)
### Task 3: Per-Column Aggregation (Replace Per-Level Loop)
- [ ] Subtask 3.1: Introduce new instance format for locks: (x, y, base, height, packedFlags) in a dedicated VBO. (In progress: placeholder still uses per-level loop but batched collection implemented.)
- [ ] Subtask 3.2: New shader path (reusing trailCube or separate minimal program) that draws vertical outline stack procedurally using instanced geometry + height loop in shader (vertex expands lines per level or uses cylinder-like extrusion of edges). (Pending)
- [x] Subtask 3.3: Feature flag `window.__LOCK_FAST_COLUMN=1` fallback to legacy path when disabled.
- [ ] Subtask 3.4: Maintain identical fade computations in shader (pass uniform arrays or param functions) or approximate within 5% alpha difference. (Placeholder alpha logic; full parity to be handled with Task 4.)
- Success Criteria: Draw call reduction: old ≈ 2 * (sum heights) vs new ≈ batches of ≤4 calls (depends on voxel off loops). CPU timeLockRenderMs reduced ≥50%. (Not yet measured – awaiting shader instancing completion.)

### Task 4: Alpha & Fade Precomputation
- [ ] Subtask 4.1: Precompute per-level fade factors once per frame up to `maxVisibleLockHeight` (derived from tallest lock span in frustum) – store in small float array uniform or UBO.
- [ ] Subtask 4.2: Cache camera fade (camT) & bottom fade parameters outside per-instance loop.
- [ ] Subtask 4.3: Provide dev toggle `__LOCK_SKIP_LEVEL_FADE_TEST` to isolate performance effect.
- Success Criteria: JS time inside the lock render loop (profiling slice) reduced by ≥10% after other changes.

### Task 5: Buffer Reuse & SubData
- [ ] Subtask 5.1: Allocate a persistent `lockInstBufferCap` sized to next power-of-two of needed instances; reuse until exceed => grow.
- [ ] Subtask 5.2: Use `gl.bufferSubData` instead of `gl.bufferData` when capacity unchanged.
- [ ] Subtask 5.3: Track bytes uploaded in profile to verify reduction.
- Success Criteria: bufferBytesUploadedLock per frame drops ≥60% in static scene; Chrome Performance shows fewer BufferData events.

### Task 6: Frustum & Distance Culling
- [ ] Subtask 6.1: Implement simple AABB against precomputed frustum planes (reuse any existing camera frustum code if present) to skip off-screen lock columns.
- [ ] Subtask 6.2: Add configurable distance cutoff `__LOCK_MAX_DRAW_DIST` (default Infinity) to skip distant locks in top view.
- [ ] Subtask 6.3: Profile counts: before vs after culledTiles.
- Success Criteria: In large maps, culledTiles > 25% with negligible overhead (<0.3ms).

### Task 7: Outline Pass Consolidation
- [ ] Subtask 7.1: Replace two-pass (scale 1.02 & 1.05) line draw with single pass using shader-based width or alpha halo.
- [ ] Subtask 7.2: Visual QA: difference screenshot diff < threshold (document tolerance).
- Success Criteria: drawCallsLock decreases ~50% (relative to step before Task 7). No noticeable visual regression for typical camera heights.

### Task 8: Optional LOD (Level of Detail)
- [ ] Subtask 8.1: Define LOD tiers by camera height: near (full per-level), mid (batch every 2 levels), far (single column outline with dim alpha).
- [ ] Subtask 8.2: Integrate into shader via uniform controlling sampling stride.
- [ ] Subtask 8.3: Provide toggle `__LOCK_LOD=1`.
- Success Criteria: With tall locks and high camera, additional ≥20% reduction in timeLockRenderMs compared to Task 7 baseline.

### Task 9: Regression Safety & Testing
- [ ] Subtask 9.1: Add sanity checker `validateLockVisualParity()` comparing legacy vs new path on a seeded lock layout (renders to offscreen FBO, pixel diff tolerance).
- [ ] Subtask 9.2: Add non-visual unit test (if test harness available) verifying span merge outputs for synthetic fragmented spans.
- [ ] Subtask 9.3: Document manual test checklist (top view fade, bottom view fade, lockModeActive alpha cap, editor placement, removal).
- Success Criteria: Automated parity test passes; manual checklist yields no discrepancies.

### Task 10: Documentation & Cleanup
- [ ] Subtask 10.1: Update `lock-optimize.md` with measured improvements and note deprecated toggles.
- [ ] Subtask 10.2: Add inline code comments referencing LockFast tasks (remove after stabilization).
- [ ] Subtask 10.3: Remove legacy code path after bake period (flag removal plan).
- Success Criteria: Clear doc; dead code ratio decreased; no stray flags in production build.

## Sequencing & Dependencies
1. Tasks 1–2 first (instrument + reduce fragmentation) to simplify later metrics.
2. Task 3 (column aggregation) is the core structural change; follow immediately with Task 5 (buffer reuse) and Task 4 (alpha precompute) because they interact with instance format.
3. Task 6 (culling) benefits from new aggregated instances (cheaper bounding tests).
4. Task 7 (outline consolidation) after ensuring new shader stable.
5. Task 8 LOD is optional / stretch after core perf win proven.
6. Task 9 runs continuously—parity test added before removing legacy path.

## Risk & Mitigation
| Risk | Impact | Mitigation |
|------|--------|-----------|
| Shader rewrite introduces visual drift | Medium | Parity test (Task 9.1), screenshot diffs |
| Over-optimization hurts editor clarity | Medium | Keep legacy toggle until QA sign-off |
| Extra uniforms exceed limits on low-end | Low | Use small arrays, pack into vec4 slots |
| Frustum culling errors hide needed locks | Low | Start with distance-only; enable frustum after confidence |

## Metrics After Each Major Task
Capture: `timeLockRenderMs / frame`, drawCallsLock, bufferBytesUploadedLock, spanLock count, lockTiles, GPU frame time (if available). Append to a running table in `perf-notes/lockfast-progress.md`.

## Aggressive Mode (Temporary for Non-Benchmark Devices)
When local benchmarking is unavailable, all current optimizations can be force-enabled:

Helper: `enableAllLockFastOptimizations(true)` (auto-runs on bootstrap unless `__LOCK_FAST_AUTO=0`).

Flags / Tunables Set:
- `__LOCK_FAST_COLUMN = 1` enable aggregated lock path.
- `__LOCK_LEVEL_STRIDE = 1` (can raise to 2/3 for more speed, less vertical fidelity).
- `__LOCK_MAX_DRAW_DIST = Infinity` (set `__LOCK_MAX_DRAW_DIST_OVERRIDE` before bootstrap to clamp).
- `__LOCK_WORLD_ALPHA_REST` / `__LOCK_WORLD_ALPHA_HICAM` baseline & high-cam alpha targets (0.28 / 0.05 default if unset).
- `__LOCK_LEVEL_FADE_BAND = 2.0` fade band for near-ground attenuation.
- `__LOCK_PRECOMPUTE_FADES = 1` placeholder for Task 4 integration.
- `__LOCK_LOD = 1` (future LOD, currently no-op placeholder).
- `__LOCK_BUFFER_REUSE = 1` placeholder for Task 5.
- `__LOCK_WORLD_LOCKMODE_ALPHA = 0.05` clamp when lock mode active.

Distance & Stride Overrides (set before auto-run to override):
- `__LOCK_LEVEL_STRIDE_OVERRIDE` (integer ≥1)
- `__LOCK_MAX_DRAW_DIST_OVERRIDE` (world units radius; squared check per column batch)

Disable auto-mode: set `window.__LOCK_FAST_AUTO = 0` before scripts finish loading.

NOTE: Aggressive Mode is intended for interim performance validation; final tuned values will be established after Tasks 3–5 metrics.

### Gameplay Lock Visibility Policy
As of post-optimization change, lock (t:6) spans are hidden during normal gameplay (both top & bottom views) to eliminate their render cost. They remain visible inside the editor.

Overrides:
- `__LOCK_FORCE_RENDER = 1` force show locks even in gameplay.
- `__LOCK_FORCE_HIDE = 1` force hide locks even in editor (for visual testing).

Debug policy snapshot available at `window.__lockRenderPolicy` with fields:
`{ inEditor:boolean, forceRender:boolean, forceHide:boolean, policy:'render'|'hide' }`.

## Immediate Next Steps (Sprint 1)
1. Implement Task 1 instrumentation (Subtasks 1.1–1.3).
2. Implement Task 2 span coalescing for t:6 in merge path.
3. Record new baseline metrics.

---
Maintainer: (add name)
Status: Draft
Created: 2025-09-21
