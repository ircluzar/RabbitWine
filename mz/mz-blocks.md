# MZ Block & Map Building Reference

This document catalogs every current block/tile type, the map builder primitives, height/column system, and how blocks interact with the render pipeline (ordering, visibility, special cases). It is derived from scanning the `mz/js` source (September 2025).

## 1. Tile / Block Types (Ground Layer Enum `TILE`)
Defined in `js/map/map-data.js`:

Code | Name  | Meaning / Behavior | Included in `instWall`? | Hazard? | Collidable Volume Source
-----|-------|--------------------|-------------------------|---------|-------------------------
0 | OPEN   | Empty floor; walkable; no wall cube drawn | No (goes to `instOpen`) | No | None
1 | WALL   | Ground-level wall cube (height 1) unless replaced by tall column spans | Yes | No | Ground cube (unless hidden by spans)
2 | FILL   | Instruction token used by builder: treated as WALL for placement; FILL inside rect sets actual tile to WALL | Yes (because converted to WALL) | No | Same as WALL
3 | REMOVE | Instruction token for carving/removing vertical volume; tile becomes OPEN | No | No | Removes / trims spans (no geometry)
4 | BAD    | Hazardous wall (red, glitter); participates in collision & damage | Yes | Yes | Ground cube or hazardous spans

Notes:
- `FILL` and `REMOVE` never persist as visible distinct block types—they are directives interpreted by `MapBuilder`.
- `BAD` tiles at ground level may also have elevated hazardous spans (multi-level hazard volumes) registered via `_setHeight(..., isBad=true)`.

## 2. MapBuilder Primitives (in `js/map/builder.js`)
Fluent API to mutate a provided `Uint8Array` map plus maintain auxiliary verticality data.

Method | Purpose | Core Effects | Height Interaction
-------|---------|--------------|-------------------
`clear(tile)` | Fill entire map | Sets every cell to `tile` | Clears any previous height metadata (user usually starts fresh)
`border(tile, height=1, { y })` | Outline entire map edges | Writes tile on outer perimeter | If `height>1` or `y>0` registers spans at perimeter
`hLine(x1,x2,y,tile)` | Horizontal line | Sets tiles along row | No height unless tile later used by rect/pillars
`vLine(x,y1,y2,tile)` | Vertical line | Sets tiles along column | Same as above
`fillRect(x1,y1,x2,y2,tile,{height,y})` | Solid filled area | Writes `tile` into every cell in region | Registers spans per cell when elevated or thick
`rect(x1,y1,x2,y2,tile,height=1,{y})` | Multi-mode rectangle: outline, fill, carve, hazard | Behavior depends on `tile`: see below | Registers/updates spans for outline/fill/hazard or carves them for REMOVE
`pillars(points,tile,height=1,{y})` | Discrete points (single tiles) | Writes `tile` for each point | Registers per-tile spans
`room(x1,y1,x2,y2,wallTile=WALL,floorTile=OPEN)` | Convenience room (outline + hollow interior) | Outline set to wallTile, interior set to floorTile | Outline may have height if rect call given >1 or elevated (not by default)
`spawn(gx,gy,dir)` | Player spawn metadata | No tile changes | N/A
`item(gx,gy,payload,{y})` / `items([...])` | Place gameplay item markers | No tile change | Optional vertical placement

### 2.1 Rectangle Mode Details
- `tile === TILE.FILL`: Interior filled as WALL (then optionally gets vertical spans if elevated). Treats FILL as a shorthand for mass WALL placement; actual map array stores `TILE.WALL`.
- `tile === TILE.REMOVE`: Carves vertical volume. Always sets ground tile to OPEN and subtracts from spans intersecting the removal prism (base `opts.y` and `height` define carve volume). Supports partial removal from top, bottom, or middle (splitting spans). Records removal volumes in `removals` for debug.
- `tile === TILE.BAD`: Marks ground tile BAD only if baseY==0; always registers a hazardous span at base `y` with given `height` (even elevated hazards).
- Other tiles (e.g., WALL): Outline only; interior unaffected. Height registration only on outline cells.

### 2.2 Height & Span System
`_setHeight(x,y,height, base=0, isBad=false)` maintains per-tile multi-span data:
- Key: "x,y" -> array of spans `{ b: base, h: height, t: hazardFlag }`
- Multiple spans can stack vertically (e.g., floating platforms, multi-level hazards).
- Spans normalize: non-positive heights removed; sorted by base then height.
- Compatibility fields:
  - `columnHeights`: topmost span height only (legacy support)
  - `extraColumns`: representative {x,y,h,b} for topmost span
  - `columnSpans`: authoritative multi-span list
  - `removals`: carved volumes for debug visualization

Carving (`TILE.REMOVE`) operates preferentially on `columnSpans` when present, otherwise falls back to legacy single-span logic.

## 3. Height Data Export / Import
`builder.getHeightData()` returns `{ extraColumns, columnHeights, columnSpans, removeVolumes }`.
`applyHeightData(heightData, replace)` (in `js/map/columns.js`):
- Replaces or merges current column structures.
- Normalizes spans to integer bases/heights.
- Derives representative top span into `extraColumns` / `columnHeights` / `columnBases` for legacy consumption.
- Stores `removeVolumes` for debug.
- Exposes globals: `extraColumns`, `columnHeights`, `columnBases`, `columnSpans`, `removeVolumes`.

## 4. Instance Buffers & Classification (`js/map/map-instances.js`)
`rebuildInstances()` scans the 2D map array:
- A tile is considered a wall instance if its raw value is `WALL`, `FILL`, or `BAD`.
- BAD tiles also populate `instBad` (currently only exposed for potential special passes; walls pipeline re-categorizes anyway).
- OPEN tiles go to `instOpen`.
Important: Elevated spans do not create entries in `instWall` directly; tall columns are drawn separately in `drawTallColumns()` using `columnSpans` or `extraColumns`.

## 5. Rendering Pipelines & Order
Main related pipelines:
- `tiles.js`: draws ground/floor plane tiles (OPEN vs WALL classification influences color, but floor color currently uniform black, y = -0.001 to avoid z-fighting with cube bottoms).
- `walls.js`: draws wall ground cubes (`drawWalls`) and multi-height columns (`drawTallColumns`). Handles BAD vs normal coloring, hazard glitter, outlines, and voxel subdivision.

### 5.1 drawWalls()
Steps:
1. Optionally jitter vertices (top view).
2. Filter `instWall` to hide ground cube at (x,y) if a span exists with base=0 (so the ground cube isn’t duplicated beneath a multi-height column stack). Condition hierarchy:
   - Prefer `columnSpans` when available: hide if any span has `b=0` and `h>0`.
   - Else if only `columnHeights` present: hide if base is implicitly 0 (or unknown assumed ground).
3. Split remaining ground cubes into normal vs BAD (hazard) based on map tile OR hazard span at base 0.
4. For each category (normal first, then BAD):
   - Depth pre-pass (color mask off, depth write on) across a 2x2x2 voxel subdivision to produce interior depth for subtle volumetric layering.
   - Blended color pass with alpha (0.65 normal, 0.85 BAD) and jittered geometry in top view.
5. Draw silhouette outlines (wireframe "shell" traces) slightly scaled for readability (normal and BAD separately).

### 5.2 drawTallColumns()
1. Groups spans (or legacy `extraColumns`) by `(height, base, hazardFlag)` so that stacks of identical vertical prisms at different coordinates are instanced together.
2. Sort groups by `base` then `height` then hazard flag to ensure deterministic layering from low to high.
3. For each group: split into normal vs BAD points.
4. Render each group with depth pre-pass then blended color pass for each level `0 .. h-1`, offsetting Y by `base + level`. A tiny epsilon per level avoids depth fighting between stacked unit cubes.
5. Draw per-level outlines for readability.
6. Rebind/reset pipeline state between groups because outline drawing switches VAO/program.

### 5.3 Player & Other Passes
Player (`gameplay.js`) renders after walls/columns and uses a two-pass technique (visible then occluded with stipple) to remain readable when behind walls. Wireframe shell overlays the player, using depth conditions to show occlusion correctly.

### 5.4 Why Some Blocks Render In Front / Behind
Ordering & depth rationale:
- Geometry is generally depth-tested with standard LESS/LEQUAL; rendering sequence + pre-pass establishes depth buffer.
- Tall columns: lower bases draw first; higher bases still pass depth because their Y is above—no horizontal overlap depth conflict. Overlap at same (x,y) is segmented by levels with epsilon.
- Ground cubes hidden when a base=0 span exists prevents z-fighting and double-darkening.
- Outlines draw after filling geometry; they disable depth writes but keep depth tests (or sometimes depthMask(false)), so they appear over faces but still occlude properly relative to farther geometry.
- Hazard (BAD) geometry drawn after normal ensures glitter pass overlays correctly when overlapping at same depth (though depth test still resolves). Distinct alpha and color highlight hazards.
- Floor tiles draw first at Y ~ -0.001 so wall bottom faces at y=0 appear cleanly without coplanar artifacts.

### 5.5 Alpha & Fading
Height-based fade (enabled for "bottom" view only):
- Uniforms `u_useHeightFade`, `u_playerY`, `u_fadeBand`, `u_minAlpha` fade wall/column fragments based on vertical distance from player Y, improving vertical situational awareness.
- BAD pillars inherit same fade logic but with higher base alpha.

## 6. Hazard (BAD) Behavior
- BAD ground tile: `map[x,y] === TILE.BAD` -> glitter effect via `u_glitterMode=1` and red color.
- Elevated BAD span: any span with `t=1` (hazard flag) at given base/height; when base=0 it also marks ground tile if originally placed with BAD.
- Filtering logic treats a ground cube as BAD if either the map cell is BAD or a hazardous base=0 span exists.

## 7. Carving / Removal Semantics
Using `rect(..., TILE.REMOVE, height, { y })`:
- Carve volume from base `y` up `height` units.
- Spans overlapping carve volume are truncated, removed, or split (middle carve keeps only the upper part for now; future may support preserving lower + upper separately by generating a second span).
- Legacy path (no spans) adjusts single topmost column height/base.
- Always sets 2D map cell to OPEN for pathing, regardless of remaining elevated spans.
- Debug: each carve recorded as `{x,y,b,h}` in `removals` and later copied to global `removeVolumes`.

## 8. Editor-Relevant Block Placement Patterns
In an editor UI you can expose these logical placement actions:
Category | Action | Underlying Builder Call | Notes
---------|--------|-------------------------|------
Ground Wall | Place single wall tile | `pillars([x,y], TILE.WALL,1)` or direct map write | Height=1, base=0
Tall Column | Place column h units | `pillars([x,y], TILE.WALL,h)` | h integer >=2
Elevated Platform | Floating slab | `rect(x1,y1,x2,y2, TILE.FILL, thickness, { y: base })` | Thickness usually 1; base>0
Hazard Column | BAD pillar | `pillars([x,y], TILE.BAD,h)` | Registers hazardous span(s)
Hazard Slab | BAD area elevated | `rect(x1,y1,x2,y2, TILE.BAD, h, { y: base })` | Ground tile only BAD if base=0
Room | Hollow room | `room(...)` | Convenience around `rect` + `fillRect`
Fill Area | Solid wall mass | `rect(..., TILE.FILL, h, { y })` | Writes WALL tiles; spans if elevated or h>1
Carve Ground Hole | Remove floor wall | `rect(..., TILE.REMOVE, depth)` | Sets OPEN, trims spans
Carve Elevated | Remove part of column | `rect(..., TILE.REMOVE, depth, { y: base })` | Partial span removal
Spawn Point | Player start | `spawn(x,y,dir)` | Not a tile
Item | Place collectible | `item(x,y,payload,{y})` | Not a tile

## 9. Collision & Traversal Implications (High-Level)
(Not fully defined in provided code, but inferred):
- Ground-level collision likely treats any `map` cell whose value is WALL or BAD as solid at y in [0,1).
- Tall columns extend collision vertically per span: a span `{b,h}` occupies world Y in `[b, b+h)`.
- Carved cells set ground passable even if elevated spans remain (player could pass underneath elevated platforms).
- Hazard detection checks contact with BAD spans or ground BAD tiles; elevated hazard spans allow mid-air damage zones.

## 10. Common Rendering / Editing Edge Cases
Edge Case | Cause | Handling
----------|-------|---------
Double geometry (z-fight) at ground | Both ground cube and span base=0 present | drawWalls() hides ground cube if base=0 span exists
Invisible elevated platform | Only spans created but underlying 2D tile left OPEN intentionally | Correct; elevated platform drawn by drawTallColumns()
Carve leaves floating top but no lower column | Middle carve path keeps only upper part (lower removed) | By design (Phase 1); future improvement could preserve both
Hazard not glowing at elevation | Span inserted without `isBad=true` | Ensure builder call used BAD tile or `_setHeight` with `isBad=true`
Outline missing for carved area | Outlines generated from current wall/column instances only | Visualizing removed volumes requires separate debug overlay using `removeVolumes`

## 11. Suggested Future Extensions
- Dual-span preservation for middle carves (split into lower + upper instead of discarding lower).
- Editor visualization of `columnSpans` layering and `removeVolumes` (ghosted boxes).
- Dedicated instanced platform mesh (top face only) for performance when `thickness=1` and base>0.
- Distinct tile values for decorative variants (color/material) without changing collision semantics.

## 12. Quick Reference Cheat Sheet
Symbol | Meaning
-------|--------
`TILE.WALL` | Solid ground wall, may represent base of tall column
`TILE.FILL` | Builder directive to mass-place walls (becomes WALL)
`TILE.REMOVE` | Builder directive to carve/cut spans & open ground
`TILE.BAD` | Hazard (glitter) ground or elevated span
Span `{b,h,t}` | Vertical prism: base `b`, height `h`, hazard flag `t` (1=hazard)
`columnSpans` | Map tile -> array of spans (authoritative verticality)
`extraColumns` | Legacy representative (top span) list for debug/render

---
Generated automatically (GitHub Copilot) from source inspection.
