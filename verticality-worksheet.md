# Verticality Worksheet (Phase 1)

Small refactor to add Y/base to builder structures so blocks can float above ground, keep existing content at Y=0, and make TILE.REMOVE Y-aware. No tests in this phase; we’ll test at the end.

## Assumptions
- Single span per (x,z) tile: span has base `b` (int) and height `h` (int).
- Backward compatibility: existing calls without options stay at `y=0`.

## Builder API updates — `mz/js/map/builder.js`
- [x] Add optional `opts?: { y?: number }` to primitives (keep old signatures working):
  - [x] `border(tile, height=1.0, opts?)`
  - [x] `rect(x1,y1,x2,y2,tile,height=1.0, opts?)`
  - [x] `fillRect(x1,y1,x2,y2,tile, opts?)`
  - [ ] `hLine(x1,x2,y,tile, opts?)` (not needed for Phase 1; outline path gated by baseY)
  - [ ] `vLine(x,y1,y2,tile, opts?)` (not needed for Phase 1; outline path gated by baseY)
  - [x] `pillars(points,tile,height=1.0, opts?)`
- [x] Extend internal `_setHeight(x,y,height, base=0)` so it always records `b` along with `h`.
- [x] Elevated placements (`opts.y > 0` or `height > 1` at non-ground): don’t write `TILE.WALL` to `map[]`; register span via `extraColumns`/`columnHeights` and set base via `b`.
- [x] `TILE.FILL` at `opts.y > 0`: fill area by emitting spans; do not set `map[]` walls.
- [x] Y-aware `TILE.REMOVE` in `rect(...)`:
  - [x] Parameters: `removeHeight` (units) and `opts.y` as removal base; if `opts.y` omitted, default to current behavior (carve from span base).
  - [x] For each cell with span (b,h), compute overlap of [b, b+h) vs [yR, yR+rem).
  - [x] No overlap: no change to span.
  - [x] Full overlap: delete span (remove height/base metadata).
  - [x] Bottom overlap: raise `b += overlap`, reduce `h -= overlap`.
  - [x] Top overlap: reduce `h -= overlapTop`.
  - [x] Always set `map[] = TILE.OPEN` in carved cells so ground becomes passable.
- [x] Maintain rebuild/export behavior: `getHeightData()` still returns `{ extraColumns, columnHeights }` including `b` where present.

## Columns registry — `mz/js/map/columns.js`
- [x] Confirm `applyHeightData()` preserves `b` into `columnBases` and `h` into `columnHeights` (no schema changes).

## Physics — `mz/js/gameplay/physics.js`
- [x] Verify ground/collision logic already uses `columnHeights` + `columnBases` for Y-aware checks (no code changes expected).

## Rendering — `mz/js/pipelines/walls.js`
- [x] Ensure `drawWalls()` continues to skip cells present in `columnHeights`.
- [x] `drawTallColumns()` uses `u_yBase` per level; no changes expected.

## Items — `mz/js/gameplay/items.js`
- [x] Change default item spawn Y from 0.65 to 0.0 for legacy/sample content.
- [x] Accept optional Y from builder: if provided in item data, use it; else 0.0.

## Sample map — `mz/js/map/map-data.js`
- [x] Keep current placements at Y=0 (no opts) to avoid behavior changes.
- [x] Add one elevated example (e.g., `rect(..., TILE.FILL, 1.0, { y: 3 })`) to visually validate verticality.

## Documentation
- [ ] Cross-reference details in `verticality-project.md` and update if any deltas emerge during implementation.

## Rollout
- [ ] Optional feature flag `VERTICALITY_PHASE1` around new code paths for quick disable if needed.
- [ ] Remove flag after validation.

## Phase 2 — Multi-span verticality (stacked spans and true mid-cuts)

Goal: allow multiple vertical spans per (x,z) tile and support true middle-slice `TILE.REMOVE` that splits spans.

### Data model and storage
- [ ] Introduce `columnSpans: Map<"x,y", Array<{ b: number, h: number }>>` in `mz/js/map/columns.js`.
- [ ] Provide adapters to keep `columnHeights`/`columnBases` as derived “dominant span” for legacy consumers.
- [ ] Migration compatibility in `applyHeightData()`:
  - [ ] Accept Phase 1 format (`extraColumns`, `columnHeights`) and convert into single-span entries.
  - [ ] Accept new Phase 2 spans format and populate `columnSpans` directly.
  - [ ] Keep globals available on `window` for both legacy and new maps.

### Builder API — stacking and split-aware REMOVE
- [ ] Add stacking support in `mz/js/map/builder.js`:
  - [ ] Allow repeated calls to add multiple spans at the same cell without overriding.
  - [ ] Add optional `opts.spans?: Array<{ y: number, height: number }>` for `pillars`, `rect`, and `fillRect` to place multiple spans in one call.
  - [ ] Ensure ground-level walls in `map[]` are skipped when a span at `b=0` exists, to avoid double-draw and collision duplication.
- [ ] Update `TILE.REMOVE` to be interval-based and split spans:
  - [ ] For each target cell, compute overlap of removal interval [yR, yR+rem) with every span.
  - [ ] Bottom-cut: raise base; top-cut: reduce height.
  - [ ] Middle-cut: split into two spans `{b, h1}` and `{b2, h2}`.
  - [ ] If a span is fully covered, delete it.
  - [ ] Still set `map[] = TILE.OPEN` in carved cells to guarantee passable ground.
- [ ] Backward compatibility: existing height-only calls still yield a single span and behave as Phase 1.

### Columns registry — spans API
- [ ] Extend `mz/js/map/columns.js`:
  - [ ] New accessors: `getSpansAt(gx,gy): Array<{b,h}>`, `setSpansAt(gx,gy,spans)`.
  - [ ] Maintain derived `columnHeights`/`columnBases` from the topmost span or a chosen policy.
  - [ ] Ensure `window.columnSpans` is exposed for debugging.

### Physics — multi-span queries (`mz/js/gameplay/physics.js`)
- [ ] Update `groundHeightAt(x,z)`:
  - [ ] Use spans: choose the highest span top ≤ player Y as ground; if none, ground is 0.
  - [ ] Preserve previous behavior when only one span exists.
- [ ] Update lateral collision check (`isWallAt` inner logic in `moveAndCollide`):
  - [ ] Collide if player Y intersects any span interval (b..b+h) at that cell.
  - [ ] Preserve pass-under and pass-over behavior when below base or above top.
- [ ] Edge cases: stepping between stacked platforms, dash interactions near edges; keep priority consistent with Phase 1.

### Rendering — draw all spans (`mz/js/pipelines/walls.js`)
- [ ] Consume `columnSpans` instead of single `extraColumns`:
  - [ ] Flatten spans into groups by (b,h) for instancing, as done today.
  - [ ] Ensure draw order is stable (sort by base, then height).
  - [ ] Continue skipping `instWall` entries for any cell having spans (including b=0 spans).
- [ ] Keep outlines per level using the existing outline pass.

### Sample content and helpers
- [ ] Add Phase 2 demos in `mz/js/map/map-data.js` (behind a flag):
  - [ ] Bridge over corridor (two spans in same tile: b=0,h=1 ground wall + b=3,h=1 bridge).
  - [ ] Archway/window carved with `TILE.REMOVE` mid-cut from a tall span.
  - [ ] Item placed on the bridge using `builder.item(...,{ y: topY })`.
- [ ] Utility: expose a helper (builder or columns) to get top Y of highest span at (gx,gy) for item placement.

### Rollout and flagging
- [ ] Add `VERTICALITY_PHASE2` feature flag to gate spans, physics path, rendering consumption, and sample content.
- [ ] Document migration and fallback to Phase 1 if flag is off.
