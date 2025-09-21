# NOCLIMB Walljump / Climb Persistence Theories

This document captures hypotheses explaining why walljumps (or unintended vertical advancement) can still occur on `NOCLIMB` blocks or at world boundaries despite recent gating logic. The list is ordered from MOST likely to LEAST likely to resolve the issue quickly.

---
## 1. Collision Classification Happens Too Late (State Leakage Between Axes)
**Likelihood:** High

### Explanation
`processHorizontalCollision` runs Z then X axis sequentially. Shared temp flags (`lastHitNoClimb`, `lastHitSolidSpan`, `lastHitWorldBoundary`, etc.) are updated inside each axis attempt but not fully reset between axis passes. A wall-touch on one axis may be overridden or not properly captured when the final aggregated `hitWall` is true, causing `collidedNoClimb` to be false even though the blocking face was a `NOCLIMB` tile.

### Evidence Pointers
- Flags defined at top of function and mutated inside axis blocks.
- Classification IIFE added (our patch) sets `lastHitNoClimb` but does not clear it on non-collision frames before the other axis runs.
- If second axis succeeds (no block) the aggregated state might end up with `hitWall=true` from first axis, but `collidedNoClimb=false` if not OR'ed correctly.

### Fix Approach
- Explicitly reset per-axis temporary flags before each axis check.
- Introduce dedicated per-axis locals (e.g. `zNoClimbHitLocal`) capturing classification before any subsequent axis can overwrite shared variables.
- Return early after first confirmed blocking axis? (Optional simplification if gameplay allows.)

### Quick Patch Sketch
```
// Before Z axis:
lastHitNoClimb = false; lastHitWorldBoundary = false; lastHitFenceRail = false; lastHitSolidSpan = false;
// Capture into zNoClimbHitLocal etc. right after classification and before step-up logic.
```

---
## 2. Step-Up Logic Circumventing NOCLIMB Intent
**Likelihood:** High

### Explanation
`tryStepUp()` is called after detecting a horizontal block. It uses `landingHeightAt()` which treats `NOCLIMB` like a solid (top=1.0). This allows the player to mount the top lip even when lateral walljump should be forbidden. Once on top, future walljump gating is irrelevant because the player is considered grounded or on the ledge.

### Evidence Pointers
- In `landingHeightAt()`, code path: `if (cv === TILE.WALL || cv === TILE.BAD || cv === TILE.NOCLIMB) candidates.push(1.0);`
- No special filtering to disallow stepping up onto NOCLIMB surfaces.

### Fix Approach
- Prevent `NOCLIMB` tiles from being eligible in `landingHeightAt()` (either remove or gate by flag).
- Alternate: Add a parameter `allowNoClimbStep` default true; pass false from horizontal collision for step-up trials.

### Quick Patch Sketch
```
function landingHeightAt(x,z,py,maxRise, opts={}){
  const allowNoClimb = opts.allowNoClimb !== false; // default true
  ...
  if (cv === TILE.NOCLIMB && !allowNoClimb) { /* skip */ } else if (...) { ... }
}
// call: tryStepUp(newX,p.z,p,0.5+1e-3,{allowNoClimb:false});
```

---
## 3. Walljump Condition Uses Upward Velocity Check (Sign Confusion)
**Likelihood:** Medium

### Explanation
Standard walljump branch: `if (... !p.grounded && p.vy > 0.0 ...)`. Depending on physics integration direction (positive vy may actually be upward or downward depending on convention). If convention mismatch occurs `p.vy > 0` could permit walljump attempts when player is ascending along a wall due to slight vertical jitter from step-up attempts, even after NOCLIMB gating is intended.

### Evidence Pointers
- Need to verify sign convention: earlier code sets `p.vy = 8.5` on jump implying positive is upward (OK). Less likely root cause, but could allow early bounce before classification catches up.

### Fix Approach
- Add a check that player vertical delta since `jumpStartY` is positive AND vertical speed is currently downward or near zero to ensure true wall contact friction scenario, or simply allow only when `p.vy < someSmallDownwardThreshold`.

### Patch Concept
```
if (p.canWallJump && hitWall && !p.grounded && p.vy <= 0.2 && ...)
```

---
## 4. World Boundary Treated as Generic Solid Before Classification
**Likelihood:** Medium

### Explanation
`isWallAt()` returns `true` immediately for out-of-bounds positions. Our classification logic occurs only after failing the portal test inside each axis block. If the attempt is OOB, we mark world boundary, but depending on axis ordering the second axis may overwrite or not OR it into the aggregate.

### Fix Approach
- Early classification: if `outZ` or `outX` is true set a local `boundaryHit` and aggregate before any possibility to step up.
- Prevent `tryStepUp()` from running for out-of-bounds collisions.

---
## 5. Fence Rail Misclassification Masking NOCLIMB Flag
**Likelihood:** Medium-Low

### Explanation
Fence rail detection may set `lastHitFenceRail` first; later logic deciding OR of `collidedNoClimb` may skip if early return / branch triggered (e.g. rail snapping path). Player then still hits the wall (rail adjacent to NOCLIMB) and obtains a walljump because gating only checks `collidedFenceRail` OR `collidedNoClimb` not the underlying tile.

### Fix Approach
- Collect full collision bitmask before any early returns or snapping.
- Introduce unified collision descriptor object with flags: `{ fence, noclimb, boundary, solidSpan }`.

---
## 6. Dash Branch vs Normal Walljump Branch Divergence
**Likelihood:** Low

### Explanation
Dash walljump gating and normal walljump gating share similar but not identical condition ordering. If in one branch `collidedNoClimb` can still be false due to temporal ordering, dash branch may incorrectly allow bounce. (We already added gating there, so residual issue would indicate race in flag population.)

### Fix Approach
- Consolidate walljump gating into a single helper: `canWallJumpFromCollision(result)` ensuring identical logic.

---
## 7. Cached Solid Span Overrides NOCLIMB Tag
**Likelihood:** Low

### Explanation
If a cell has both a column span and underlying base tile `NOCLIMB`, the cached solid spans path may cause `isWallAt()` to return true without inspecting the base tile type, so we never set `lastHitNoClimb`.

### Fix Approach
- When classifying, always also read base tile even if a cached solid span returned collision.
- Add explicit base tile read inside classification IIFEs.

---
## 8. Jump Start Y Threshold Too Low (Early Walljump Enable)
**Likelihood:** Low

### Explanation
Requirement `(p.y - p.jumpStartY) >= 1.5` might be satisfied via a combined step-up + minor vertical velocity before actual sideways separation from wall, enabling bounce before classification updates flags.

### Fix Approach
- Track continuous wall contact frames and require N frames of non-NOCLIMB wall contact before allowing walljump.

---
## 9. Multiple Physics Frames Per Render (Flag Lost Each Substep)
**Likelihood:** Very Low

### Explanation
If physics runs multiple substeps and only last substep returns a hit without proper classification (or vice versa), final aggregated flags may miss NOCLIMB context.

### Fix Approach
- Persist collision flags across substeps in an accumulating structure for the frame, then finalize.

---
## 10. External Script Overwriting processHorizontalCollision
**Likelihood:** Very Low

### Explanation
Another script might replace `window.processHorizontalCollision` after our patch, removing new flags.

### Fix Approach
- Console assert once per frame that returned object has `collidedWorldBoundary` when `hitWall` and boundary expected. If missing, log override detection.

---
## Recommended Fix Order
1. Reset & isolate per-axis temp flags; aggregate with explicit locals.
2. Exclude `NOCLIMB` tiles from `landingHeightAt()` (step-up) or add parameter to disable.
3. Harden walljump condition with downward/neutral vy requirement.
4. Ensure out-of-bounds classification occurs before any step-up attempt.
5. Introduce unified collision descriptor object and helper gating logic.
6. Always classify base tile even when span collision path triggers.

Apply steps 1–2 first; they likely solve majority of unintended climbs.

---
## Diagnostic Additions (Optional but Helpful)
- Add `window.__DEBUG_NOCLIMB` toggle to print collision result flags when `hitWall`.
- Visual overlay: color the face red if `NOCLIMB`, yellow if boundary.
- Counter of consecutive frames against the same wall with collected flags (for testing gating robustness).

---
## Minimal Patch Plan (Concrete)
1. In `collisionHorizontal.js` before Z axis: `resetTempFlags()`; after classification store into local booleans; OR into aggregate inside the same collision branch only.
2. Change `landingHeightAt` to accept `opts` and skip NOCLIMB when `allowNoClimb=false`; call from `tryStepUp` with false.
3. Modify walljump condition: replace `p.vy > 0.0` with `p.vy <= 0.25` (tunable) and require `collisionDescriptor.allowsWallJump === true`.
4. Add `allowsWallJump` computed as `!(noclimb || boundary || fenceRail)`.

---
## Success Criteria
- Attempting to walljump against a pure NOCLIMB tile never triggers bounce or direction flip.
- Holding forward into NOCLIMB does not produce upward step increments.
- Regular WALL behavior unchanged.
- Boundary edges behave like NOCLIMB (no walljump, no step-up beyond map).

---
## Rollback / Safety
Changes are contained to collision classification and sampling logic. Provide a runtime flag (e.g., `window.__DISABLE_NOCLIMB_GATING`) to quickly revert gating if unforeseen side effects appear.

---
## Open Questions
- Should player be able to stand atop a NOCLIMB if they arrive from above? (Current design seems to permit; clarify spec.)
- Are NOCLIMB blocks ever intentionally used as decorative non-step vertical guides? If yes, need a separate TILE type or per-instance metadata.

---
*Prepared: 2025-09-21*
