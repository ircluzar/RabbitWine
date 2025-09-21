# Lock Block Rendering Optimization Strategies

Purpose: Reduce the disproportionate frame time cost introduced by Lock Blocks (spans with `t:6`) relative to normal pillars/walls. Ordered from highest expected impact to lowest, based on the current implementation in `mz/js/pipelines/walls.js`, multiplayer span generation, and per–frame physics / camera coupling.

---
## 1. Remove Per-Level Per-Block Repacking + Instancing Rebuild (Major CPU & GC)
**Current cost**: For each Lock span group (`(g.t|0)===6`) you:
- Allocate a fresh `Float32Array(pts.length*2)` (`offsPacked`).
- For every level `0..g.h-1` you build another per-level instance buffer (`instOne` of length `pts.length*4`) and re-upload with `gl.bufferData(..., DYNAMIC_DRAW)`.
- Rebuild zeroed corner / axis buffers every loop.

This is O(levels * blocks) allocations per frame. Large Lock columns (tall towers or stacked spans) amplify cost linearly with height.

**Optimization**:
- Pre-bake a single instance buffer per Lock group per frame (or cache across frames until membership / camera-dependent alpha changes).
- Use a structure-of-arrays persistent VBO sized for the max observed Lock instances; update only `.subdata` regions that changed.
- Collapse inner level loop by using instancing for (tile, level) pairs: generate one instanced draw where each instance encodes both tile offset (x,z) and level (y) using a second instanced attribute (or a uniform base + vertex shader loop if small fixed height cap).
- If outline thickness variants (scale 1.02 & 1.05) are required, issue two draws with same bound instance buffer; avoid rebuilding arrays.

**Expected gain**: Large drop in JS allocation churn & upload bandwidth; likely >30–50% of Lock overhead eliminated in dense scenes.

---
## 2. Consolidate Duplicate State Switching & Program Rebinding
Each Lock group draw:
- Switches to `trailCubeProgram`, sets many uniforms, binds VAO, uploads buffers, draws twice (scale variants), then rebinds `wallProgram` and resets attributes.

**Optimization**:
- Batch all Lock outline submissions together: collect all groups first, then one state switch to `trailCubeProgram`, emit draws, then restore.
- Maintain persistent VAO for lock outlines (distinct from trail cubes if semantics diverge) to avoid re-pointing attr 0 repeatedly.
- Hoist uniforms that are constant across instances (e.g., `tc_u_ttl=1.0`, `tc_u_dashMode=0`) outside loop.

**Expected gain**: Fewer WebGL driver calls; improved CPU side. 5–15% total Lock cost.

---
## 3. Replace Multi-Pass Outline Draw With Shader-Inflated Single Pass
Currently: two outline passes per level (`scale 1.02`, `1.05`).

**Optimization**:
- Use a vertex shader uniform pair `[innerScale, outerScale]` and emit a triangle strip / line expansion in-shader (or geometry emulation with instanced duplicates using gl_InstanceID to pick scale) so a single buffer submission covers both widths.
- Or drop second pass; simulate glow via fragment alpha falloff.

**Expected gain**: Halve draw calls for Lock outlines (~1 draw vs 2 per level/group).

---
## 4. Cache Per-Group Alpha Computation & Camera Lock Logic
Alpha `finalAlpha` calculation re-executes per level per frame and involves multiple smoothstep-like ops, clamps, and optional global overrides; it repeats identical math for all tiles in same group & same level.

**Optimization**:
- Compute and cache `finalAlpha[level]` once per group per frame (or until camera Y / lock mode / player Y crosses thresholds that invalidate it).
- If camera Y unchanged and player Y within same band bucket, skip recomputation entirely using frame stamp + coarse quantization (e.g., quantize Y to 0.05 units).

**Expected gain**: 1–3% overall; more if many tall groups.

---
## 5. Early Culling & Visibility Masking
All Lock tiles are drawn even if fully off-screen or beyond far clip (only relying on normal frustum). Outline-only visuals make their fill camera significance low.

**Optimization**:
- Compute 2D screen-space bounds for each group; skip if fully outside viewport (cheap with camera frustum planes already used for other geometry?).
- If `finalAlpha <= capThreshold` early-out before VBO uploads.
- If group distance > configurable threshold and camera not in top view, skip (Lock emphasize top camera anyway).

**Expected gain**: Scene-dependent; big in sparse or off-camera heavy maps.

---
## 6. Use Unsigned Short Instance Buffer & Quantization
Currently using `Float32Array` for integer grid coordinates and time stamp.

**Optimization**:
- Store gx, gy as `uint16` (supports up to 65535), and pack time & level into normalized bytes (or use per-draw uniform time). Expand in shader.
- Reduces upload bandwidth by ~50% and improves cache locality.

**Expected gain**: GPU upload bandwidth & minor CPU; 2–5%.

---
## 7. Avoid Re-Zeroing Corner / Axis Buffers When Animation Disabled
For each Lock group you allocate zeros for `trailCubeVBO_Corners` and axis every loop. If the animation flag is off (`tc_u_useAnim == 0`), these buffers remain identical.

**Optimization**:
- Allocate once at maximum needed instance count; reuse (only re-upload length via gl.bufferSubData if instance count shrinks).

**Expected gain**: Cuts repeated allocations; reduces GC spikes, 5–10% of Lock portion.

---
## 8. Merge Levels Into Vertical Line Primitives
Instead of drawing each level’s 1×1 outline square separately, represent a contiguous vertical run of Lock span with a single 8-vertex line prism (or two triangle strips for variable-width). This reduces loops over `level` entirely.

**Constraints**: Need distinct alpha per level currently. See #4; if alpha variation minimal, unify.

**Expected gain**: Up to O(height) reduction in draw count when tall spans common.

---
## 9. GPU Side Alpha Fade & Lock Detection
Lock fade depends on camera Y and player Y; right now CPU computes per level.

**Optimization**:
- Send base parameters (cameraY, playerY, minAlpha, band, lockModeFlag) as uniforms; compute alpha in vertex/fragment shader. One instanced attribute encodes level index. Eliminates per-level CPU loops; one draw call per group or per batch.

**Expected gain**: Significant CPU reduction; complexity trade-off (shader branching minimal).

---
## 10. Frame-Rate Throttling / Temporal Reuse
Lock outlines are static except for camera-driven alpha.

**Optimization**:
- Update GPU buffers for Lock groups at reduced frequency (e.g., every 2nd frame) and interpolate alpha on GPU.
- When camera & player velocities below small thresholds, skip update entirely.

**Expected gain**: 10–30% Lock cost during static periods.

---
## 11. Spatial Hash For isInsideLockAt()
Physics `moveAndCollide` calls `isInsideLockAt()` each frame; it iterates spans linearly for the cell.

**Optimization**:
- Maintain separate `lockSpanIndex: Map<cellKey, Array<[b,top]>>` with only t:6 spans; membership check becomes a binary search or simple scan over smaller array.
- Or store aggregated minB, maxTop if spanning contiguous; quick AABB test then optional refine.

**Expected gain**: Minor (function already bounded), but removes scanning non-lock spans.

---
## 12. Deduplicate Multiplayer Span Diffs For Lock Blocks
`multiplayer.js` pushes many `op:'add'` events with `t:6`. Burst additions cause rebuild cost and potential redundant updates.

**Optimization**:
- Debounce network diff application: batch lock span structural changes and rebuild grouping only after flush.
- Maintain a dirty flag and rebuild lock instance buffer post-flush, not per op.

**Expected gain**: Eliminates transient spikes when many locks sync in.

---
## 13. Pre-Sort & Contiguous Memory Layout For Spans
Current grouping map uses string keys & arrays of `[gx,gy]` pairs.

**Optimization**:
- Store `pts` as two parallel typed arrays (Uint16Array gxList, gyList) to avoid array-of-arrays overhead and per-element GC metadata.
- Improves data locality for packing into VBO.

**Expected gain**: 5–10% reduction in CPU time for large groups.

---
## 14. Single Pass Outline Thickening Using Fragment Distance
Instead of two geometry passes with uniform scale tweaks, compute thickness in fragment shader via screen-space derivative or radial alpha falloff.

**Expected gain**: Similar to #3, alternative path if instancing changes blocked.

---
## 15. Optional: Convert Lock Blocks To Screen-Space Overlay
If gameplay allows, render lock outlines once into a texture layer (offscreen FBO) and composite; update only when camera grid cell or lock membership changes.

**Tradeoff**: Requires careful depth sorting; may desync with world if parallax important.

**Expected gain**: Drastically reduces per-frame cost when static.

---
## 16. Configurable Quality Levels
Expose tuning knobs via `window.__LOCK_*` already present:
- Add `__LOCK_PER_FRAME_UPDATE=0/1` to gate buffer rebuild.
- Add `__LOCK_DRAW_DETAIL=0..2` to pick thickening method (#3 vs #14 vs dual pass).

**Expected gain**: Scales cost down on low-end hardware.

---
## 17. Micro-Optimizations / Low Impact
- Inline small helpers inside hot loops (avoid closures in `isInsideLockAt`).
- Avoid constructing temporary arrays for color each iteration; cache pastel `[0.65,0.80,1.0]` as a typed array.
- Use `gl.bufferSubData` instead of `gl.bufferData` when size unchanged to avoid realloc.

---
## Prioritized Implementation Roadmap
1. Batch & cache instance buffers (1,2).  
2. Merge per-level draws via instancing or shader level attribute (1,3,9).  
3. GPU alpha computation & per-frame throttling (4,9,10).  
4. Memory layout + reduced allocations (6,7,13).  
5. Multiplayer batch & culling (5,12).  
6. Physics span index (11).  
7. Optional advanced refactors: vertical merging, offscreen overlay (8,15).  
8. Quality level flags & micro-opts (16,17).

---
## Suggested Code Entry Points
- Rendering hot path: `mz/js/pipelines/walls.js` lines ~1160–1215, 1500+ (Lock spans section).
- Span grouping: same file lines ~1000–1080 (`groups` / `fracGroups` creation) – extend to produce separate lock arrays.
- Physics lock detection: `mz/js/gameplay/physics.js` around helper `isInsideLockAt`.
- Multiplayer span insertion: `mz/js/app/multiplayer.js` lines ~420, 1420+ with `t:6` operations.

---
## Metrics & Verification Plan
1. Instrument timers (performance.now) around Lock section before/after (#1 & #2 changes).  
2. Log allocations via lightweight counter (override `ArrayBuffer` constructor or wrap pack functions).  
3. Capture frame time percent (Lock / total) over 300 frames static vs moving camera.  
4. Validate visual fidelity: outline thickness, fade behavior, lock-mode alpha cap.  
5. Regression tests: create synthetic map with tall 32-level lock columns dense grid (worst-case). Ensure >X fps improvement baseline.

---
## Quick Wins to Implement First
- Cache `offsPacked` & `instOne` arrays per group; resize only when count grows.  
- Switch double-pass scale draws to single pass with gl_InstanceID (two instances, one buffer).  
- Move alpha computation into shader with level index instanced attribute.  
- Add lock span fast index for physics.

---
## Potential Pitfalls
- Alpha in shader must replicate cap semantics (LOCKMODE_ALPHA cap vs multiplier).  
- Reusing VBO sizes: must guard against driver ignoring smaller subData leading to stale data beyond new count (track active instance count).  
- Offscreen caching: ensure depth ordering correct vs other translucent geometry.

---
## Summary
Most overhead comes from per-level allocation + buffer uploads and excessive state churn for outline-only lock spans. Consolidating into batched instanced draws with persistent buffers and GPU-computed alpha will yield the largest performance gains while simplifying CPU logic. Secondary improvements (buffer reuse, quantization, multiplayer batching) compound further savings. Implement iteratively with instrumentation gates to quantify each step.

---
## Multiplayer Sync Note (Sept 2025)
Issue Observed: Lock voxel deletions (t:6) appeared to revert after a reconnect / server echo.

Cause: `mpSendMapOps` stripped the `t` field for `remove` operations, while adds preserved type (and were stored as `key#6`). Untyped removes could leave typed `key#6` entries intact server-side or allow later reconciliation code to resurrect them.

Fix Applied: Modified `mpSendMapOps` to include `t` metadata for BOTH add and remove ops (types 1,2,3,4,5,6,9). This allows precise server-side deletion of typed lock adds and prevents resurrection during diff rebuild or reconciliation.

Client Impact: No functional change for earlier adds; removals now reliably propagate. Backwards-compatible if server ignores `t` on remove (hint caching still updates locally).

Recommended Server Follow-Up (Optional): Ensure remove ops with `t` purge both `key` and `key#t` entries to avoid any stale diff accumulation.

Instrumentation Suggestion: Temporarily log incoming `map_edit` remove ops containing `t:6` to verify end-to-end propagation.

### Server Patch Applied
The server (`multi_server.py`) was updated to:
- Log explicit removal of previously-added Lock voxels.
- Clean up any overlapping adds/removes to prevent resurrection after reload.
- Warn during persistence if an overlap invariant is violated.
These diagnostics will help confirm that a Lock removal both deletes the add entry and records the removal, ensuring it does not reappear on refresh.
