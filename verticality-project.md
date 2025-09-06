# Verticality Project Plan

Bring true Y-positioning to map builder structures so blocks can float above ground. Keep all existing content at Y=0 by default, let new content opt into higher Y. Make collision and rendering fully Y-aware, with special care for TILE.REMOVE carving that uses a structure’s base to place holes and shape collision.

## Requirements checklist

- Add a Y coordinate/base to every builder structure primitive so structures can be placed above ground. [Planned]
- Keep existing sample map content spawning at Y=0 with no behavior change. [Planned]
- Allow new structures to specify higher Y so they spawn above ground. [Planned]
- Collisions must be Y-aware; ensure TILE.REMOVE carves relative to the targeted structure’s base, not global ground, so holes and collision are correct in 3D. [Planned]

## Current state (what’s already in code)

- Map grid and primitives live in `mz/js/map/builder.js` and are used by `mz/js/map/map-data.js`.
- Vertical information is supported via:
  - `extraColumns: Array<{x,y,h,b?}>` and `columnHeights: Map<"x,y", h>` in `mz/js/map/columns.js`.
  - Optional base offset `b` (“raised base”) per column; `applyHeightData()` merges this and also exposes `columnBases: Map<"x,y", b>`.
  - Rendering: `mz/js/pipelines/walls.js` draws “tall columns” using both height and base (`u_yBase`). Ground-level walls come from the map’s `TILE.WALL` instances.
  - Collision/physics: `mz/js/gameplay/physics.js` reads `columnHeights` and `columnBases` to make Y-aware ground height and lateral collision decisions.
- TILE.REMOVE already adjusts a column by increasing its base (`b`) and decreasing its height (`h`) from the bottom up, but it does not yet let you target a Y range explicitly per operation.

Conclusion: The engine already understands a single raised span per tile (b,h). Builder APIs are still largely 2D and don’t let you place shapes at an arbitrary Y. We’ll extend the builder API and ensure REMOVE is Y-targeted.

## Data model and constraints

- Phase 1 (MVP): single-span per (x,z) tile
  - Each grid cell can have at most one vertical span with fields { b: integer base, h: integer height }.
  - Many use cases (floating walls, elevated bridges) are covered by a single span.
  - KEEP: `map[]` still encodes ground-level `TILE.WALL` = a 1-high wall at base 0.
  - NEW: Any structure at b>0 should not write `TILE.WALL` into `map[]`; it should register a span in `extraColumns`/`columnHeights`/`columnBases` instead.

- Phase 2 (optional extension): multi-span per tile
  - Upgrade to `columnSpans: Map<key, Array<{b,h}>>` enabling stacks like a bridge above a ground wall.
  - Requires changes to rendering grouping and collision queries. We can defer until needed.

## API design: Y-aware builder primitives

Add an optional options object to each primitive that can influence vertical placement. Maintain backward compatibility by overloading, defaulting to the old signature when options aren’t provided.

- Common options
  - `height?: number` visible height in voxel units (default 1)
  - `y?: number` integer base elevation (default 0)
  - `mode?: 'outline' | 'fill' | 'remove'` useful for clarity where tile semantics used to imply this

- Proposed signatures (MVP)
  - `border(tile: number, height=1.0, opts?: { y?: number })`
  - `rect(x1, y1, x2, y2, tile, height=1.0, opts?: { y?: number })`
  - `fillRect(x1, y1, x2, y2, tile, opts?: { height?: number, y?: number })`
  - `hLine(x1, x2, y, tile, opts?: { height?: number, y?: number })`
  - `vLine(x, y1, y2, tile, opts?: { height?: number, y?: number })`
  - `pillars(points, tile, height=1.0, opts?: { y?: number })`

Behavior rules:

- For tile == TILE.WALL or outline walls at `opts.y === 0` and `height <= 1`, continue writing to `map[]` as today for perf/compatibility.
- For any structure with `opts.y > 0` OR `height > 1`, don’t write ground map walls for those cells; register a column span `{ b: opts.y|0, h: floor(height) }` using `_setHeight` extended to also carry `b`.
- For tile == TILE.FILL at `opts.y > 0`, create a filled area by emitting spans for all cells in the area (not walls in `map[]`). At `opts.y === 0`, keep current behavior of writing `TILE.WALL` to `map[]` plus height metadata for `height > 1`.

## TILE.REMOVE with Y-awareness

Goal: Carve a hole starting at a given base Y in the target cells.

- Extend `rect(..., tile=TILE.REMOVE, removeHeight, opts?: { y?: number })`.
  - Let `removeHeight` be how many voxel units to remove.
  - Let `opts.y` be the base Y where removal starts.
  - Algorithm (single-span model):
    1. For each cell, look up its current span (b,h) from `columnBases/columnHeights`.
    2. If no span exists, just set `map[] = TILE.OPEN` (as today) and continue.
    3. If span exists and `opts.y` is omitted, treat removal as happening from the span’s own base b (backwards compatible with today’s behavior).
    4. If `opts.y` is provided, treat the removal as intersecting the span over [opts.y, opts.y+removeHeight).
       - Compute the overlap between [b, b+h) and [yR, yR+remH).
       - If no overlap: do nothing to (b,h).
       - If full overlap: delete the span (remove from maps/extraColumns).
       - If partial overlap at bottom: raise base by overlap and reduce height accordingly.
       - If partial overlap at top: reduce height accordingly.
       - If the overlap is strictly in the middle (only possible in multi-span world), in Phase 1 we choose the “raise base” carve (from bottom), leaving a shorter span above. A true middle cut will be part of Phase 2 (span split).
    5. Always set `map[] = TILE.OPEN` for the cells you carve to ensure ground is walkable below any remaining elevated structure.

Collision implication: `physics.js` already uses `columnHeights` and `columnBases` so, once we update those according to the overlap carve, lateral collision and ground height will be correct for player Y.

## Rendering updates

- Ground-level `instWall` rendering already skips any cell found in `columnHeights` to avoid double-drawing.
- `drawTallColumns()` already groups by (b,h) and sets `u_yBase` per drawn layer, which is correct for elevated spans.
- Action: Ensure builder uses spans for any `opts.y > 0` so these elevated shapes render via the tall-column path.
- Optional: add simple “floating slab” debug outlines using existing outline pass at each level’s y center (already supported for columns).

## Items and Y defaults

- Current behavior: `initItemsFromBuilder()` places pickup items with a hard-coded `y: 0.65`.
- Requirement says “Every current spawned item in the sample map data would be set to spawn at coordinate y 0.”
  - Action: change default item spawn to `y: 0.0` for legacy/sample content.
  - Extend `builder.item(gx, gy, payload, opts?: { y?: number })` so items can be placed higher (e.g., on bridges). If `opts.y` given, use it; otherwise 0.0.
  - Keep the visual wobble/rotation math unchanged; it will operate around the item’s provided Y.

## Integration points and code changes

1) `mz/js/map/builder.js`
   - Extend internal `_setHeight(x,y,height, base=0)` to store both h and b. Today it stores h and keeps b in `extraColumns`. Retain that but normalize calls to always pass base.
   - Overload `border`, `rect`, `fillRect`, `hLine`, `vLine`, `pillars` to accept `opts?: { y?: number, height?: number }` without breaking existing signatures.
   - For elevated structures (`opts.y > 0`), don’t set `map[...] = TILE.WALL`; only register spans via `extraColumns`/`columnHeights`/`columnBases`.
   - Implement Y-aware TILE.REMOVE overlap logic described above.

2) `mz/js/map/columns.js`
   - Already supports `columnBases`. No schema change needed for Phase 1.
   - Ensure `applyHeightData()` copies base `b` when provided; it already does.

3) `mz/js/gameplay/physics.js`
   - Logic already checks player Y against `b` and `b+h` for collision and ground height. No changes required for Phase 1 beyond validation.

4) `mz/js/pipelines/walls.js`
   - No changes for Phase 1; ensure skip-if-column logic remains.

5) `mz/js/map/map-data.js`
   - Leave all existing shapes without opts (default `y=0`).
   - Use a few new examples to validate verticality (e.g., an elevated walkway using `rect(..., TILE.FILL, 1.0, { y: 3 })`).
   - Keep sample item spawns but update items’ default Y to 0 in items module.

6) `mz/js/gameplay/items.js`
   - Change the default item Y from 0.65 to 0.0.
   - Read optional item Y from builder-provided data when present.

## Acceptance tests (manual + small programmatic checks)

- Rendering
  - Ground walls still render as before.
  - An elevated 1-tile-thick slab at y=3 renders at the correct Y; walls pass still excludes those cells.

- Collision & ground height
  - Walking under a slab at y=3: no lateral collision, ground height remains 0.
  - Jumping into the slab’s underside: lateral collision triggers only when player Y is in (b..b+h).
  - Standing on top of a slab at y=3 with h=1: groundHeightAt returns 4.0 and player stands there.

- TILE.REMOVE
  - Remove a 1×N doorway at base y=0 in a 3-high wall column results in b=1,h=2 (carved from bottom).
  - Remove at base y=2 with height=1 removes only the top layer: b stays, h reduces to 2.
  - Remove at base y=3 with height=5 fully deletes the span.

- Items
  - Items in sample map spawn at y=0 and can be picked up as before.
  - Items spawned with opts.y=3 appear and are collectible at elevated Y.

## Edge cases and decisions

- Out-of-bounds or negative height values are clamped/ignored as today.
- Fractional heights and bases: coerce to integers (voxel units); document this in the builder.
- Overlapping elevated structures in the same (x,z): Phase 1 rejects silently by last-writer-wins or logs a warning. Phase 2 would allow multi-span stacks.
- TILE.REMOVE middle-cuts: Phase 1 behavior is “carve from bottom”; a true split into two spans comes with Phase 2.

## Rollout plan

1. Implement builder API extensions and items’ default Y change behind a small feature flag (`VERTICALITY_PHASE1 = true`) to ease testing.
2. Add one new elevated structure to the sample map to validate.
3. Verify rendering and collisions across desktop and mobile.
4. Remove flag after validation.

## Work breakdown (Phase 1)

- Builder API + REMOVE Y-awareness: 4–6 hrs
- Items default Y=0 and optional Y: 0.5–1 hr
- Sample map elevated example + screenshots: 0.5 hr
- QA pass (collision/ground height): 1–2 hrs

## Future: Phase 2 (multi-span)

- Replace `columnHeights/columnBases` with `columnSpans` and adapters so current calls still work for the “dominant” span.
- Update physics to check spans near player Y (pick the span that contains Y for lateral collisions and the max floor below Y for ground).
- Update rendering to explode spans into per-(b,h) instances (similar to current `drawTallColumns` grouping, but duplicates per tile when multiple spans exist).
- Update TILE.REMOVE to split spans when removal region is fully in the middle.

## Migration notes

- No existing content changes required. All current calls without opts stay at y=0.
- Sample items default to y=0 instead of 0.65. If the visual offset is desired, a wobble or shader bias can add lift without changing logical Y.

## Done definition

- Builder primitives accept optional Y/base and create elevated shapes.
- Rendering and collision behave correctly for elevated shapes.
- TILE.REMOVE operations respect a provided base Y and carve correctly.
- Items default to y=0 and can be placed at higher Y.
