# Fence collisions: why full-block hits still happen and how to fix

This document lists the most likely causes of “full tile box” collisions against fences instead of thin rail/voxel collisions, with concrete fixes in order of likelihood and impact.

## TL;DR
The collision code tries to do voxel-accurate rails for fences (t=2), but we synthesize generic spans from columnHeights without preserving t, and network sync drops t=2 entirely. Both paths make elevated fences behave like solid blocks.

---

## 1) Synthesized column spans ignore fence type (t) for elevated fences

- Where:
  - `mz/js/gameplay/physics.js` (lateral collision)
    - In `isWallAt(wx, wz)`, we build `spanList` and then "merge in default-map columns":
      - If the map tile is not `TILE.FENCE` and `columnHeights.has(key)`, we push `{ b, h }` with no `t`.
      - Result: `t` defaults to 0 (non-fence) later in the loop.
  - `mz/js/map/columns.js` (`applyHeightData`)
    - When applying spans, we always derive `columnHeights`/`columnBases` from the topmost span, ignoring its `t`.

- Why this causes full-block collisions:
  - Elevated fences (t=2) often live above ground on map tiles that are not `TILE.FENCE` (e.g., `OPEN`).
  - Because the map tile isn’t `FENCE`, `isWallAt` synthesizes a “generic” span from `columnHeights` and pushes it without `t`.
  - The collision loop treats entries with `t !== 2` as solid AABBs and returns early, so the thin-rail logic never runs.

- Evidence in code:
  - physics.js: “Always merge in default-map columns (but skip FENCE tiles; they use inner voxels) … spanList.push({ b: b|0, h: h|0 });” (no `t`)
  - Later: `const t = ((s.t|0)||0); if (t !== 2) return true;` — synthesized entries become solid.

- Fix options (pick one, or combine):
  1. In physics.js, when merging from `columnHeights`, peek at `columnSpans.get(key)`.
     - If all spans at this key are fences (`t===2`), either:
       - Do not synthesize a generic span at all; or
       - Synthesize with `t:2` so the rail logic applies: `spanList.push({ b, h, t: 2 })`.
     - Do the same in ball-mode’s `isWallAtXZ`.
  2. In columns.js `applyHeightData`, don’t populate `columnHeights`/`columnBases` for keys where all spans are `t===2` (pure fence). Only set heights when there exists a non-fence span.
     - Safer variant: still store them, but also store and expose type metadata so physics can preserve `t` when synthesizing.

- Also applies to vertical logic:
  - `groundHeightAt` and `ceilingHeightAt` also synthesize from `columnHeights` using the same `_cv !== TILE.FENCE` check, but they don’t re-attach `t`, so elevated fence tops can be treated as ground/ceiling. Apply the same “skip or tag as `t:2`” rule there to keep fences from affecting vertical collision.

## 2) Multiplayer merge drops `t:2` (fences) during sync

- Where:
  - `mz/js/app/multiplayer.js`
    - When rebuilding spans, we call `window.setSpansAt(gx,gy, merged.map(s => ({ b:s.b, h:s.h, ...(s.t===1?{t:1}:{}) })))`.
    - This explicitly preserves only `t===1` (hazard/BAD) and drops `t===2` (fence), turning fences into solid spans.

- Why it causes full-block collisions:
  - With `t` removed, physics sees those spans as plain solids and applies full AABB collision before rail checks.

- Fix:
  - Preserve `t:2`:
    - `...(s.t===1 ? {t:1} : (s.t===2 ? {t:2} : {}))`
  - Ensure receivers also keep `t:2` in `setSpansAt` (it already sanitizes `t` to 0/1/2).

## 3) Vertical ground/ceiling synthesis includes fence spans inadvertently

- Where:
  - `groundHeightAt` and `ceilingHeightAt` in `physics.js`.
  - They filter out fence spans (`spanList = spanList.filter(s => t!==2)`), but subsequently add a synthesized `{ b, h }` from `columnHeights` (no `t`) when the map tile isn’t `TILE.FENCE`.

- Symptom:
  - Player can “stand on” or “head-bump” against elevated fence segments as if solid slabs.

- Fix:
  - Same as #1: when synthesizing, detect if the underlying spans are fences-only; skip synth or tag with `t:2` so they remain ignored by ground/ceiling.

## 4) Rail footprint too generous (less likely root for full-tile hits)

- Where:
  - `RAIL_HW = 0.11` and `inBand` tests around cell center or edges.

- Effect:
  - Could make rails feel thicker than intended, but won’t produce whole-block collisions by itself because voxel rails are gated by narrow bands and neighbor connectivity.

- Optional tweak:
  - Reduce `RAIL_HW` to ~0.08–0.10 after addressing #1/#2 to fine-tune feel.

## 5) Mixed data: fence spans plus a wall tile at the same cell

- Scenario:
  - If a cell is `TILE.WALL` and also has a `t:2` span (from editor or sync), the wall’s solid ground span gets added and will block as a full tile regardless of fence logic.

- Fix:
  - Ensure fence visuals aren’t authored on top of ground `WALL` tiles unless you want a fully solid block there.

---

## Recommended minimal patch set

1) Physics preservation of `t` on synthesis (lateral + vertical):
   - physics.js in `isWallAt` and `isWallAtXZ` (ball mode) and in `groundHeightAt`/`ceilingHeightAt`:
     - Before pushing a synthesized `{ b, h }`, check `columnSpans.get(key)`:
       - If spans exist and every span at this key has `t===2`, push `{ b, h, t: 2 }` or skip adding.
       - Else push as today.

2) Multiplayer: keep `t:2` across the wire:
   - In `app/multiplayer.js`, change the mapper to include `t:2`.

These two changes keep fence semantics intact without reworking data structures.

---

## How to verify quickly

- Instrument physics (`isWallAt`) to log which branch blocked movement at a fence cell:
  - Log when returning due to a synthesized span vs. a `t:2` rail.
- Create a test map with an elevated fence over `OPEN` tiles.
  - Before the patch you’ll hit a full block; after, you should only collide when intersecting the narrow rail bands.
- With multiplayer enabled, place a fence via the editor and ensure it remains `t:2` after sync (inspect `window.getSpansAt(gx,gy)`).

---

## Notes

- If other systems depend on `columnHeights` for rendering/occlusion, prefer tagging synthesized entries with `t:2` over skipping entirely, so downstream code can distinguish fences from solids.
- The existing rail connectivity logic and local-band tests look solid; the main issue is type loss during synthesis and network merge.
