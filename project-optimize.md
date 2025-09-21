# MZ Project Performance Optimization Audit

_Date: 2025-09-21_

This document lists potential performance optimizations for the `mz` portion of the project, prioritized by estimated impact on overall frame time (highest first). Each item includes: why it matters, current pattern, recommended change, complexity, and validation approach.

## Legend
- Impact: (Est. %) rough potential frame time reduction in stressed scenarios (heuristic tiers: High 10%+, Med 3-10%, Low <3%)
- Effort: S (small <1h), M (1-3h), L (multi-session)
- Category: CPU, GPU, GPU/CPU sync, Memory, Net, I/O

---

## 1. Minimize Per-Frame WebGL State Churn in `drawPlayerAndTrail` (High Impact, Effort M, Category GPU/CPU)
**Why**: The trail rendering rebuilds and uploads multiple buffers every frame (instance, corners, axis) even when data unchanged (bottom camera static branch). Repeated `gl.bufferData` with new Float32Arrays causes GC pressure and driver overhead.
**Current**: For each frame and for each sub-pass (trail, outline(s)), new `Float32Array` allocations and full buffer re-specification (`gl.bufferData(..., DYNAMIC_DRAW)`). Zero arrays allocated for bottom view and player outline jitter loop (multiple uploads per frame).
**Recommendation**:
- Adopt persistent, pre-sized ArrayBuffers with `gl.bufferSubData` updates for only the modified regions.
- Maintain a ring buffer or a single grow-once buffer for trail instances; reuse typed arrays (object pool).
- Skip uploading corner/axis buffers when cameraKind is 'bottom' by binding an already-zeroed static buffer.
- Consolidate outline jitter loop into a single instanced draw (supply offsets in a small instance buffer of N offsets) instead of N separate `bufferData` + draw calls.
**Expected Gain**: Fewer JS allocations + fewer buffer re-specifications reduces CPU time and main thread stalls, likely double-digit % in heavy trails.
**Validation**: Use Performance timeline + WebGL Inspector (EXT_disjoint_timer_query if available) to measure reduced bufferData calls.

## 2. Dual-Pass Player Rendering (Depth + Occluded Stipple) Merge (High Impact, Effort M, Category GPU)
**Why**: Player cube drawn twice (visible then occluded pass) and then multiple wireframe passes. Depth pre-pass logic could be replaced by a single pass with alpha/stipple discard in fragment shader or by using polygon offset / dual depth test techniques.
**Current**: Two full TRIANGLES draws; second uses depthFunc(GREATER) to capture hidden parts.
**Recommendation**:
- Use single pass with fragment shader computing visibility (sample depth via `gl_FragCoord.z` requires extensions / deferred path) OR
- Switch to front-face only then back-face wireframe alternative OR
- If cube geometry is trivial cost, leave—but combine uniform setup (avoid re-binding identical uniforms & textures between passes).
**Expected Gain**: Moderate GPU time reduction & CPU state changes; fewer uniform calls.
**Validation**: GPU frame capture before/after, draw call count.

## 3. Matrix Multiplication Allocation in Camera Setup (Med-High Impact, Effort S, Category CPU/Memory)
**Why**: Frequent allocation of new `Float32Array(16)` per matrix operation inside render loop (`mat4Multiply`, `mat4Perspective`, `mat4LookAt`). GC churn influences long sessions.
**Current**: Each camera branch creates multiple transient matrices per frame, especially in split-view mode (two MVP builds).
**Recommendation**:
- Introduce pooled scratch matrices or in-place variants (`mat4MultiplyInto(out,a,b)` etc.).
- Pre-store projection matrices for both FOV/aspect combos; only recompute when aspect changes (on resize or seam change).
**Expected Gain**: Reduced GC & minor CPU saving (5-8% of math cost in scenes with stable aspect).
**Validation**: Measure minor GC events count drop in Performance Profiler.

### Status Update (Implemented)
In-place matrix helpers (`mat4MultiplyInto`, `mat4PerspectiveInto`, `mat4LookAtInto`) added to `core/math.js` and a perspective matrix cache introduced in `app/bootstrap.js` (`getCachedPerspective`). Instrumentation exposed via `window.__matStats.perspRebuilds` to count projection recomputes. Render loop camera branches now use cached projection matrices and allocate only transient `Float32Array(16)` objects for view + mvp (next step could reuse preallocated scratch to eliminate those too). This should reduce per-frame GC pressure, especially in split-view mode.

## 4. Avoid Repeated `getUniformLocation` Calls in `bootstrap.js` Blit Phase (Med Impact, Effort S, Category CPU)
**Why**: Uniform locations for blit program looked up every frame (u_tex, u_topMix, u_topLevels, u_topDither, u_topPixel). Each lookup is a hash map query in driver.
**Current**: Per-frame calls just before `gl.uniform`.
**Recommendation**: Cache locations in module scope right after program creation.
**Expected Gain**: Small CPU improvement; meaningful when combined with others.
**Validation**: Profile CPU self time in render tail section.
### Status Update (Implemented)
Uniform locations for blit pass (`u_tex`, `u_topMix`, `u_topLevels`, `u_topDither`, `u_topPixel`) are now cached once in `core/blit.js` (exported to `window.__blitUniforms`). The per-frame blit section in `bootstrap.js` uses these cached handles and records stats in `window.__uniformStats` (`blitSetCount`, `blitFallbackLookups`). Fallback path with dynamic lookups remains for safety if load order changes. This removes 5+ uniform location queries per frame.

## 5. Consolidate Redundant Visibility Functions (Med Impact, Effort S, Category CPU)
**Why**: Multiple per-frame redefinitions: `window.isWorldPointVisible` inside camera branches, plus global `isWorldPointVisibleAny` in header. Redefinition allocates closures & can confuse inlined JIT optimizations.
**Current**: Reassignment each time fullscreen/bottom path executed.
**Recommendation**: Single utility with parameter selecting matrix or pass mvp references through a stable closure.
**Expected Gain**: Minor CPU / reduced deopt risk (~1%).
**Validation**: Check function allocation count in memory profiling.

## 6. Replace Multiple Player Outline Draw Calls With Instancing (Med Impact, Effort M, Category GPU/CPU)
**Why**: Outline jitter draws 7 instances via 7 separate `bufferData` + draw calls. Instanced approach would upload a small offsets buffer once and issue a single draw.
**Current**: Loop creates new Float32Array per offset.
**Recommendation**: Prepare offsets array Float32Array(7*4) once per frame (or only when jitter pattern changes) and instanced draw (vertex shader adds offset). Combine with item #1.
**Expected Gain**: Fewer draw calls and allocations; moderate CPU win.
**Validation**: Draw call count -7 per frame improvement.

## 7. Trail Corner Offsets Zero Buffer Reallocation (Med Impact, Effort S, Category CPU/Memory)
**Why**: For bottom camera each frame new large zero-filled Float32Array created and uploaded. Zero fill cost + transfer bandwidth.
**Current**: `zeros = new Float32Array(pts.length * 8 * 3)`.
**Recommendation**: Maintain a single reusable zero buffer sized to last seen max trail length; slice/gl.bufferSubData only needed portion (or keep static buffer with gl.bufferData(null) then gl.clearBuffer?).
**Expected Gain**: Lower allocations; reduces memory churn in large trails.
**Validation**: Allocation timeline.

## 8. Consolidate Uniform Updates Across Similar Passes (Low-Med Impact, Effort S, Category CPU)
**Why**: Player program uniforms set twice identically in two passes.
**Current**: Duplicate uniform calls; texture rebind.
**Recommendation**: Cache values & only set uniforms that differ; or merge passes (#2). At minimum avoid re-binding identical texture.
**Expected Gain**: Small but measurable in tight loops.
**Validation**: CPU profiling.

## 9. Minimize Map Diff Iteration Work (Multiplayer) (Low-Med Impact, Effort M, Category CPU/Net)
**Why**: Map diff application loops (`mpApplyFullMap`, `mpApplyOps`) iterate large sets; multiple membership checks on `mpMap.adds/removes`. Branch duplication for each type flag (#1..#9) leads to many lookups.
**Current**: Repetitive `if (mpMap.adds.has(op.key+'#1')) ...` chain.
**Recommendation**:
- Normalize type flag additions via helper mapping table {1:'#1', ...} to build candidate keys, loop through array once.
- Use a small function to strip any suffix and unify remove logic.
- Possibly store adds as Map(key->type) instead of encoded key strings.
**Expected Gain**: Reduces string concatenation & multiple Set lookups; helpful for large diff bursts.
**Validation**: Benchmark synthetic 10k op diff apply.

## 10. Defer Non-Critical Baseline Restore Logging (Low Impact, Effort S, Category CPU)
**Why**: Multiple `console.log` in multiplayer diff functions during gameplay can cost ms on some browsers.
**Current**: Logging each diff application.
**Recommendation**: Gate logs behind debug flag or sample every N versions.
**Expected Gain**: Minor; reduces long-session hitches.
**Validation**: Disable logs and compare frame spikes.

## 11. Avoid Rebinding VAOs When Not Needed (Low Impact, Effort S, Category GPU/CPU)
**Why**: For simple sequences the code binds/unbinds VAOs around each draw; unbinds often not required unless state pollution risk high.
**Current**: `gl.bindVertexArray(null)` after each pass.
**Recommendation**: Keep bound until different VAO needed; only unbind at frame end if necessary.
**Expected Gain**: Minor CPU savings.
**Validation**: Instrument function call counts.

## 12. Replace Repeated Zero Arrays With Static GL Buffer (Low Impact, Effort S, Category Memory/CPU)
**Why**: Creating `new Float32Array(3)` or similar every frame (axis, single instance seeds) accumulates allocations.
**Current**: Many micro allocations.
**Recommendation**: Pre-allocate small typed arrays and reuse.
**Expected Gain**: Micro-optimization; reduces minor GC.
**Validation**: Allocation profiling.

## 13. Precompute Player Model Matrix Components (Low Impact, Effort S, Category CPU)
**Why**: Player matrix built every frame even when position unchanged between frames (rare but possible when paused or stationary). Could short-circuit.
**Current**: Always multiplies translate*rotate*scale.
**Recommendation**: Cache last position/angle; recompute only if changed.
**Expected Gain**: Small.
**Validation**: Frame time with stationary player.

## 14. Use In-Shader Conditional for Top Posterize Region Instead of CPU Logic (Low Impact, Effort S, Category GPU/CPU)
**Why**: Minor; logic already in shader but could avoid branching by precomputing boolean uniform; impact tiny.
**Current**: Shader computes region each fragment.
**Recommendation**: Add uniform flags to simplify fragment logic if profiling shows cost (unlikely high benefit).
**Expected Gain**: Very small.
**Validation**: GPU shader timing diff (likely negligible).

## 15. Consider WebGL2 Instanced Arrays for Ghost Rendering (Future) (Potential High Impact, Effort L, Category GPU/CPU)
**Why**: Ghost rendering (not inspected fully here) likely similar pattern to trail; batching instances reduces draw overhead.
**Recommendation**: Audit ghost draw path, unify instancing buffers, apply pooling patterns from trail.
**Expected Gain**: High if many ghosts concurrently.
**Validation**: Synthetic spawn test.

---

## Cross-Cutting Implementation Plan (Suggested Order)
1. Buffer & instancing refactor for trail + player outline (Items 1,6,7,12 combined) – biggest immediate win.
2. Uniform location caching & matrix pooling (Items 3,4,5).
3. Combine or streamline player dual-pass (Item 2 + 8).
4. Multiplayer diff structure optimization (Item 9) once correctness tests in place.
5. Logging gating and residual micro-opt (Items 10,11,13,14).
6. Ghost path optimization if target scenarios demand (Item 15).

## Tooling & Metrics
- Enable `EXT_disjoint_timer_query_webgl2` for per-draw GPU timings when available.
- Integrate lightweight stats overlay: buffer uploads count, draw call count, allocations (tracked via monkey-patched `Float32Array` if needed in dev build).
- Add a dev flag `window.__perfDebug` to toggle verbose instrumentation.

## Risk Notes
- Buffer pooling must avoid resizing thrash; always allocate to max observed and reuse.
- Merging player passes may change visual fidelity (occluded stipple). Keep fallback path until parity confirmed.
- Multiplayer diff structure changes require server/client compatibility layer.

## Quick Wins Summary
| Item | Impact | Effort | Rationale |
|------|--------|--------|-----------|
| 1    | High   | M      | Cuts repeated buffer allocations & uploads |
| 3    | Med-High | S    | Removes per-frame GC hot path |
| 4    | Med    | S      | Eliminates uniform lookups each frame |
| 6    | Med    | M      | Reduces draw calls & allocations |

## Appendix: Detection Evidence
- `bootstrap.js`: repeated matrix creation, uniform lookups (`getUniformLocation` in frame loop), visibility function redefinition.
- `gameplay.js`: loop allocating new Float32Arrays per trail point; multiple small allocations per outline draw.
- `math.js`: pure functional allocations per call (no reuse).
- `multiplayer.js`: verbose diff application with repeated Set membership checks and string concatenation patterns.

---

Feel free to request implementation patches for specific items; Items 1, 3, 4, and 6 are recommended first.
