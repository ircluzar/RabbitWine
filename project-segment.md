# Project Segmentation Plan

This document defines the refactor & modularization plan for the four largest monolithic files:

| Domain | Current File | Approx Lines | Core Concerns (Current) |
|--------|--------------|--------------|--------------------------|
| Gameplay Physics | `mz/js/gameplay/physics.js` | ~1.9K | Terrain sampling, collision (h+v), movement state machine, dash/wall jump, portal teleport, hazard & damage, camera lock, ball mode (enter/run/exit), SFX triggers |
| World Rendering (Walls) | `mz/js/pipelines/walls.js` | ~4K | Shader sources, GL program setup, instancing buffers, span → instance categorization, fences & badfences, portals/locks/no‑climb rendering, outlines, transparency & jitter, elevated spans |
| Multiplayer Sync | `mz/js/app/multiplayer.js` | ~1.6K | WS connection/backoff/ping, time sync, map diff protocol, span rebuild, tile overrides, item & portal ops, level switching/loading, offline fallback, ghost interpolation/rendering, integrity fixups |
| In‑Game Editor | `mz/js/ui/editor.js` | ~1.4K | Mode toggle & pointer lock, FPS camera & input, raycast visor, block/span add/remove (many types), structure builder modal, preview & GL overlay, item placement, keyboard UI & block set switching |

---
## 1. Goals & Non‑Goals

### Goals
- Reduce per‑file cognitive load: isolate distinct responsibilities into cohesive modules.
- Establish clear dependency direction: low‑level data → domain logic → integration → UI.
- Enable incremental extraction without breaking runtime behavior.
- Facilitate future unit / headless tests for pure logic pieces (collision sampling, map diff reconciliation, span normalization, etc.).
- Preserve public surface (global functions used by other modules) via thin re‑export shims during transition.

### Non‑Goals (Phase 1)
- Large-scale behavioral changes or physics tuning.
- Protocol redesign for multiplayer.
- Converting globals to full ES module dependency injection (can follow later).

---
## 2. Architectural Principles
- Single Responsibility: Each new file owns one logical concern (e.g., `terrainSampling`, `horizontalCollision`).
- Pure First: Where possible keep logic free of DOM/GL/state mutation; pass primitives or small context objects.
- Top-Down Assembly: A single orchestrator per domain wires submodules (e.g., `physics/index.js`).
- Explicit Side Effects: SFX, network sends, and GL calls centralized vs. scattered through core logic.
- Stable Facade: Existing global entry points (e.g., `moveAndCollide`, `drawWalls`, `mpSendMapOps`, `onToggleEditorMode`) remain available—internally delegate to new structure.

---
## 3. Target Module Layout (Proposed)
```
mz/js/
  gameplay/physics/
    index.js                 (facade/orchestrator exporting legacy names)
    terrain.js               (groundHeightAt, landingHeightAt, ceilingHeightAt)
    collisionHorizontal.js   (x/z sweep, wall & fence checks)
    collisionVertical.js     (vertical step / gravity / landing resolution)
    movementModes.js         (dash, wall-jump, climb/no-climb logic)
    portals.js               (portal detection & teleport)
    hazards.js               (BAD damage, hazard queries, mp ghost damage hook)
    ballMode.js              (enterBallMode/runBallMode/exitBallMode)
    cameraLock.js            (lock zone calculations)
    stateAdapters.js         (wrappers reading/writing global `state.player`) 

  pipelines/walls/
    index.js                 (public: drawWalls, drawTallColumns, outlines)
    shaders.js               (WALL_VS/WALL_FS source & program creation)
    buffers.js               (VAO/VBO setup & updates)
    instanceBuild.js         (span categorization → instance arrays)
    specialTiles.js          (fences/badfences/locks/portals/noclimb coloring)
    outlines.js              (drawOutlinesForTileArray, outline passes)
    jitter.js                (ensureWallGeomJitterTick & animation data)
    materials.js             (color lookups / palette helpers)

  app/multiplayer/
    index.js                 (facade: connection lifecycle, frame hook)
    config.js                (constants, backoff params)
    connection.js            (mpEnsureWS, ping/pong, backoff, cooldown)
    timeSync.js              (mpComputeOffset, offset logic)
    mapDiff.js               (applyFullMap, applyOps, local apply, rebuild spans)
    tilesDiff.js             (tile full + ops)
    items.js                 (item ops I/O + local spawn suppression)
    portals.js               (portal ops & local map integration)
    levelSwitch.js           (mpSwitchLevel & offline fallback sequencing)
    ghosts.js                (ghost sample buffer, interpolation, drawGhosts)
    integrity.js             (fix/replay/assert helpers: locks/noclimb)
    api.js                   (exports: mpSendMapOps, mpSendTileOps, mpSendItemOps, mpSendPortalOps, mpSetChannel, mpSetLevelName, mpRequestMusicPos)

  ui/editor/
    index.js                 (facade: onToggleEditorMode, enter/exit, frame tick)
    state.js                 (editor state init, block sets/slots)
    input.js                 (handleEditorInput, mouse look)
    raycast.js               (raycastGridFromEditor, __castDistance wrapper)
    visorRender.js           (drawEditorVisorAndPreview)
    blockOps/
      addBlock.js            (addBlockAtVisor with per-type delegates)
      removeBlock.js         (removeBlockAtVisor with per-type delegates)
      types/
        base.js, bad.js, half.js, fence.js, badFence.js, portal.js, lock.js, noclimb.js
    spans.js                 (__getSpans, __setSpans, __normalize helpers)
    structureModal.js        (openEditorModal/closeEditorModal/applyStructure...)
    blockBar.js              (ensureBlockTypeBar/updateBlockTypeBar)
    items.js                 (item placement & removal logic)
```

---
## 4. Dependency Direction
```
physics: terrain -> collision -> movementModes / portals / hazards / ballMode -> index (facade)
multiplayer: config -> connection -> timeSync -> {mapDiff, tilesDiff, items, portals, levelSwitch, integrity} -> ghosts -> index/api
walls: shaders -> buffers -> instanceBuild + specialTiles + jitter + outlines -> index
editor: state -> spans -> blockOps(types) -> add/remove -> structureModal/raycast/input/items/visorRender -> index
```
Cross-domain rules:
- Physics reads world data via a thin world access layer (map & spans) but does not mutate structures directly (movement outputs new player position + events).
- Multiplayer is the authority updating spans/map; it emits events (optional future) consumed by rendering / physics to know when cache invalidation is needed.
- Editor mutates world (spans/map) then triggers rebuild & notifies multiplayer API; it must not call physics internals.
- Walls rendering consumes spans/map read-only.

---
## 5. Iterative Migration Pattern (Preferred)

We will NOT march through large domain phases sequentially. Instead, we run a tight loop for each extraction slice:

Base → Extract → Rewire → Condemn → Test

Repeat until the monolith is reduced to a thin facade. Each iteration moves a coherent "slice" (one cluster of related functions) out of the base file.

### 5.1 Step Definitions
1. Base (Select Slice)
   - Identify a self-contained concern (e.g., physics terrain sampling, MP time sync, editor span normalization, wall shader sources).
   - Mark the region in the original file with a temporary comment banner `// SEGMENT: <name>`.
2. Extract
   - Create new module file under the target directory.
   - Move code verbatim; replace implicit globals with explicit imports (or leave TODO if not yet centralized).
   - Add a minimal exported function surface matching old usage.
3. Rewire
   - In the base file, replace original code block with import + delegation.
   - Update any intra-file references that used local helpers now external.
4. Condemn (Quarantine Old Surface)
   - Add a deprecation banner in the base file section:
     `// CONDEMNED: Logic moved to gameplay/physics/terrain.js (commit <hash>)`
   - Remove residual unused helpers (or flag with `// TODO: remove after <date>` if risky).
5. Test
   - Run quick smoke (movement, join MP, place block, render walls) or narrower targeted test depending on slice.
   - If pass: commit with message: `segment: <domain>: extract <slice>`.

### 5.2 Iteration Ordering Strategy
We interleave domains to keep risk low and shorten feedback loops:

| Cycle | Physics | Multiplayer | Editor | Walls |
|-------|---------|-------------|--------|-------|
| 1 | terrain sampling | time sync + config | spans normalize helpers | shader sources |
| 2 | vertical + horizontal collision split | connection wrapper | raycast & visor basics | buffer setup |
| 3 | movement modes (dash/wall) | map diff apply core | add/remove base & bad blocks | instance categorization |
| 4 | portals + hazards | tiles diff + portal ops | per-type modules (fence/badfence/half) | special tile coloring |
| 5 | ball mode | items ops | structure modal | outlines + jitter |
| 6 | camera lock | level switch lifecycle | block bar UI & items overlay | facade orchestrator |
| 7 | orchestrator facade | integrity & fix helpers | final facade + cleanup | final cleanup |

(If any cycle feels too large, split further; never batch more than one risky slice per commit.)

### 5.3 Slice Checklist Template
Copy this for each slice into commit description or project tracking doc:
```
[ ] Mark slice region in base file
[ ] New module file created (path: ...)
[ ] Code moved verbatim (no behavior change)
[ ] Added exports / updated imports in dependents
[ ] Base file section replaced by delegate
[ ] Added CONDEMNED banner with commit reference
[ ] Ran targeted smoke / scenario tests
[ ] Removed dead code (or TODO flagged)
```

### 5.4 Condemnation Banner Format
```
// ╔════════════════════════════════════════════════════════════╗
// ║ CONDEMNED SLICE: terrain sampling (moved to terrain.js)     ║
// ║ Ref: commit abc123  Date: 2025-09-20                       ║
// ╚════════════════════════════════════════════════════════════╝
```
Automated scripts can later grep for `CONDEMNED SLICE` to report remaining debt.

### 5.5 Testing Cadence per Cycle
Minimum quick tests (manual for now):
- Physics: jump, wall collision, portal teleport sanity.
- Multiplayer: connect, receive ghost position, map diff apply (place block via editor and see remote update if possible).
- Editor: place & remove each currently supported block type for that cycle's extracted modules.
- Walls: visual smoke (no GL errors in console, walls still render, outlines visible where expected).

### 5.6 Exit Criteria Per Domain
Domain considered migrated when:
- All core slices listed in table extracted & base file line count reduced < 25% original.
- All remaining banners are strictly orchestrator or transitional shims.
- No slice lacks a condemnation banner.
- Smoke tests pass consecutively for two cycles without regression in that domain.

### 5.7 Legacy Phase Mapping (For Reference Only)
Old Phase numbers map to new slice cycles:
| Old Phase | New Cycle Range |
|-----------|-----------------|
| 0 | 1 (scaffolding occurs inside first slice) |
| 1 | 1–2 |
| 2 | 2–3 |
| 3 | 3–6 |
| 4 | 2–5 (editor slices interleaved) |
| 5 | 1–6 (walls decomposed progressively) |
| 6 | 7 |

The remaining sections (Tasks, Risk, DoD) will be updated to reference slices instead of phases.

---
## 6. Slice Task Breakdown & Reusable Checklists

All work tracked as SLICES, not phases. Use the template in Section 5.3 for every slice commit.

### 6.1 Global Setup (once)
- [ ] Create target directories (if absent) for each domain.
- [ ] Add root `CHANGELOG_SEGMENT.md` entry.
- [ ] Introduce condemnation banner style reference snippet.

### 6.2 Planned Slice Sequence (Initial Pass)

#### Cycle 1
- Physics: `terrain.js` (ground/landing/ceiling) ← slice name: `physics-terrain`
- Multiplayer: `config.js` + `timeSync.js` ← `mp-timesync`
- Editor: `spans.js` (normalize + get/set) ← `editor-spans`
- Walls: `shaders.js` (GLSL + compile) ← `walls-shaders`

#### Cycle 2
- Physics: `collisionVertical.js` + `collisionHorizontal.js` split ← `physics-collision`
- Multiplayer: `connection.js` wrapper (open/backoff) ← `mp-connection`
- Editor: `raycast.js` + basic visor state ← `editor-raycast`
- Walls: `buffers.js` (VAO/VBO central) ← `walls-buffers`

#### Cycle 3
- Physics: `movementModes.js` (dash, wall, climb) ← `physics-modes`
- Multiplayer: `mapDiff.js` core apply + rebuild hook ← `mp-mapdiff`
- Editor: `addBlock.js` / `removeBlock.js` for BASE & BAD ← `editor-blockops-core`
- Walls: `instanceBuild.js` basic categorization ← `walls-instances`

#### Cycle 4
- Physics: `portals.js` + `hazards.js` ← `physics-portals-hazards`
- Multiplayer: `tilesDiff.js` + portal ops ← `mp-tiles-portals`
- Editor: per-type modules (fence, badfence, half) ← `editor-blocktypes-1`
- Walls: `specialTiles.js` (fence/portal/lock) ← `walls-special`

#### Cycle 5
- Physics: `ballMode.js` ← `physics-ball`
- Multiplayer: `items.js` ← `mp-items`
- Editor: structure modal extraction ← `editor-structure-modal`
- Walls: `outlines.js` + `jitter.js` ← `walls-outlines-jitter`

#### Cycle 6
- Physics: `cameraLock.js` + orchestrator `index.js` ← `physics-facade`
- Multiplayer: `levelSwitch.js` ← `mp-levelswitch`
- Editor: block bar UI, items placement, visor render ← `editor-ui`
- Walls: `materials.js` + final facade `index.js` ← `walls-facade`

#### Cycle 7
- Physics: remove dead residue / final condemnation ← `physics-cleanup`
- Multiplayer: integrity helpers (`integrity.js`) + `api.js` facade ← `mp-integrity-api`
- Editor: finalize facade `index.js` & cleanup ← `editor-facade`
- Walls: final cleanup & banner pruning ← `walls-cleanup`

### 6.3 Per-Slice Extended Checklist (Add to Template When Applicable)
- [ ] Replace magic constants with imports (if constant module exists) or TODO tag.
- [ ] Add minimal JSDoc header (purpose + original line range).
- [ ] Ensure no `console.log` debug left unless guarded by `if (DEBUG)`.
- [ ] Verify bundle/global ordering not broken (defer if dependency ordering risk; annotate).

### 6.4 Post-Cycle Validation
After each cycle (set of 4 domain slices):
- [ ] Run unified smoke: movement, wall render, MP connect (or offline fallback), editor place/remove, portal teleport, item spawn.
- [ ] Count remaining lines of each monolith (target downward trend; log in status block).
- [ ] Update Status section with slice IDs completed.

### 6.5 Final Domain Exit Checklist
- [ ] Base file size <25% original.
- [ ] All remaining code is façade or glue.
- [ ] No unresolved `// SEGMENT:` markers.
- [ ] No `TODO remove after` older than 2 cycles.
- [ ] All condemnation banners reference a commit hash.

---
## 7. Risk Mitigation (Slice Model)
- Micro-Slices: Each commit isolates one slice (or at most a pair if trivial) to minimize blast radius.
- Facade Shims: Preserve legacy globals until final cleanup cycle; never remove surfaces mid-cycle.
- Shared Constants: If a constant source of truth not yet extracted, annotate with `// TODO constantize` rather than duplicating logic.
- Circular Dependency Watch: After every cycle run a quick grep (manual for now) for `require`/`import` chains forming loops; adjust by pushing glue into facade layer.
- Visual Drift Guard: Walls and editor rendering slices always validated with a quick manual render before commit.

Rollback Strategy:
- Each slice commit is additive + small replacement; revert single commit to undo entire slice.
- Condemnation banners help locate removed logic rapidly for partial reversion.

---
## 8. Definition of Done (Per Domain & Overall)
Domain DoD:
- Base file <25% of original lines.
- All slices in Section 6.2 marked completed (with commit refs in status block).
- No remaining `SEGMENT:` markers.
- All condemnation banners carry a commit hash & date.
- Smoke tests for that domain pass in two consecutive cycles without new issues.

Overall Project DoD:
- All four domains meet Domain DoD.
- Cross-domain smoke (movement, MP connect/offline fallback, editor block ops, walls render, portals, items) passes post final cleanup.
- Status section lists every slice ID completed.
- Readme architecture section updated to point to modular layout (optional but recommended).

---
## 9. Follow‑Up (Post‑Segmentation) Ideas
- Convert globals to ES module imports with a bundler step.
- Add headless tests for terrain sampling & diff reconciliation.
- Introduce event bus (simple pub/sub) between multiplayer diff apply and subsystems (render invalidation, physics cache reset).
- Implement lint rules / script to guard new monolith growth (e.g., max lines per file threshold CI check).
- TypeScript migration of pure logic directories.

---
## 10. Status Tracking Template
Add progress marks directly below as work proceeds.
```
[Status]
Phase 0: ...
Phase 1: ...
Phase 2: ...
Phase 3: ...
Phase 4: ...
Phase 5: ...
Phase 6: ...
```

---
Prepared by: segmentation assistant
Date: (update on first commit)
