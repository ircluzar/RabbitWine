# NOCLIMB Wall-Jump Bug: Ranked Theories

Goal: Explain why players can still wall‑jump off NOCLIMB blocks that are intended to be the only surface disallowing wall‑jump, and list most likely fixes in order.

---
## TL;DR (Top 3 Suspects)
1. Missing span-level NOCLIMB classification in `collisionHorizontal.js` (elevated spans with `t:9` never set `collidedNoClimb`).
2. `isWallAt()` does not treat base tile `TILE.NOCLIMB` as solid, so only span form is solid; logic divergence causes inconsistent detection paths and missed flags.
3. Axis resolution + classification order can drop the NOCLIMB flag if the blocking collision that finally sets `hitWall` is a different axis / surface than the earlier NOCLIMB touch.

---
## Detailed Ranked Theories
Each theory includes: Why it matters, Evidence from code, Reproduction hint, and Proposed fix.

### 1. (Most Likely) Elevated NOCLIMB spans (t:9) never set `lastHitNoClimb`
**Why**: Wall-jump gating relies on `collidedNoClimb` from `processHorizontalCollision()`. That flag is set ONLY when `classifyX()` / `classifyZ()` see the *base map tile* `map[mapIdx(...)] === TILE.NOCLIMB`. Elevated NOCLIMB walls are implemented as spans with `t:9` (see editor comments and rendering pipeline), but classification never inspects spans for `t:9` when deciding collision type.

**Evidence**:
- In `collisionHorizontal.js`, inside `classifyZ()` / `classifyX()`:
  ```js
  const tile = map[mapIdx(gxCurCell, gzNewCell)];
  if (tile === TILE.NOCLIMB) lastHitNoClimb = true;
  ```
  No scan of `columnSpans` array for `t===9`.
- `isWallAt()` (in `physics.js`) counts spans as solid unless `t` is 5,6,2,3 — so `t:9` *will* make `isWallAt()` return true (thus `hitWall = true`) without marking `collidedNoClimb`.
- Result: `hitWall === true` while `collidedNoClimb === false` ⇒ `canWallJumpDecision()` passes the `if (collidedFenceRail || collidedNoClimb || ...) return false;` guard and wall-jump is allowed.

**Repro Hint**: Place an elevated NOCLIMB span (`t:9`) (not a ground tile 9) and attempt a wall-jump: succeeds. Compare with a pure ground tile 9 (if base tile variant even collides—see Theory 2).

**Proposed Fix** (minimal): In both `classifyX()` and `classifyZ()`, after reading `tile`, iterate spans for that cell; if any span has `t===9` overlapping player Y, set `lastHitNoClimb = true`.

### 2. Base tile NOCLIMB not treated as solid in `isWallAt()`
**Why**: The base NOCLIMB tile (value 9) is declared "solid, disables walljump" (see comments), but `isWallAt()` only treats `WALL`, `BAD`, `FILL`, `HALF`, `FENCE/BADFENCE` as solid. `TILE.NOCLIMB` is omitted. If ground NOCLIMB tiles aren't recognized as walls, they won't trigger wall collision logic; paradoxically, player might not even get a wall-jump attempt there, pushing design to rely on spans only, which then fail Theory 1.

**Evidence**:
```js
if (cv === TILE.WALL || cv === TILE.BAD || cv === TILE.FILL) {...}
if (cv === TILE.HALF) {...}
if (cv === TILE.FENCE || cv === TILE.BADFENCE) {...}
// NO branch for TILE.NOCLIMB
```
Comments elsewhere: `# 9 = NOCLIMB marker (solid, disables walljump)`.

**Impact**: Inconsistency between tile spec and collision logic; may create maps where designers think a ground NOCLIMB tile works but only elevated spans matter, compounding confusion.

**Proposed Fix**: Add `|| cv === TILE.NOCLIMB` to the first solid block condition.

### 3. Axis Ordering / Mixed Collision Surfaces Drops NOCLIMB Flag
**Why**: `collidedNoClimb` is aggregated only when an axis movement actually resolves into a wall (`!stepped`). If the first axis (say Z) contacts a NOCLIMB surface but then successfully steps or adjusts, and the second axis (X) finally collides with a normal wall, the final `hitWall` will be true while `collidedNoClimb` remains false.

**Evidence**:
- Aggregation code only executed inside the `if (!stepped)` block of each axis.
- Potential for first axis to attempt `tryStepUp()` (returns true) preventing aggregation of the NOCLIMB flag.

**Repro Hint**: Approach a NOCLIMB corner on a shallow angle allowing a partial step adjustment on one axis, then collide fully on the perpendicular axis.

**Proposed Fix**: Record NOCLIMB contact pre-step (classification phase) and aggregate even if the step succeeds OR add a separate boolean for "touchedNoClimbThisFrame" used by wall-jump gating.

### 4. Step-Up Logic Permitting Micro-Penetration Before Flag
**Why**: `tryStepUp()` runs before setting `hitWall`. If a NOCLIMB surface allows a small vertical step (within 0.5 + epsilon), movement proceeds without collision; next frame player is adjacent to wall but not flagged as collidedNoClimb and might still manage to trigger a wall-jump off an adjacent non-NOCLIMB voxel.

**Evidence**: Step height threshold `0.5 + 1e-3`; NOCLIMB design intent may not anticipate step-ups.

**Proposed Fix**: Disallow step-up attempts when base tile or span is NOCLIMB; early-return false in `tryStepUp()` when encountering t:9 or tile==NOCLIMB.

### 5. Dash Collision Path Masks Missing NOCLIMB Flag
**Why**: Dash-triggered wall-jumps bypass the ascend check. If dash hits an elevated NOCLIMB span (unflagged per Theory 1), wall-jump triggers more easily, making the bug more noticeable.

**Evidence**: `canWallJumpDecision({ dashCollision:true })` skips the ascend velocity check but still relies on `collidedNoClimb` (which is false due to Theory 1), enabling the jump.

**Proposed Fix**: Same fix as Theory 1 automatically resolves; optionally add a secondary runtime assertion logging when `hitWall && spanIsNoClimb && !collidedNoClimb`.

### 6. Lack of Vertical Context for NOCLIMB (Player Y vs Span Y)
**Why**: If the player collides at a Y outside the span's vertical band (e.g., brushing the top pixel), classification might see the span as solid (via generic span solidity rule) but a dedicated t:9 check would require overlap—so it was never attempted.

**Evidence**: Generic solidity check for spans does not store t value; once any solid span blocks, detailed type info is lost unless classification had already tagged it.

**Proposed Fix**: Pass back surface metadata (type code) from `isWallAt()` or refactor to a `traceWallAt()` returning `{ solid:bool, types:Set }` so gating logic has precise context.

### 7. Potential Timing/Race With External Collision Module Load
**Why**: Physics logs: `console.log('[PHYSICS] Using extracted horizontal collision module');` If races occur (one frame using fallback vs module), `collidedNoClimb` semantics might differ frame-to-frame allowing a jump window.

**Evidence**: Guard clause early-exits if module not present, but no explicit sync barrier.

**Proposed Fix**: Initialize collision module before enabling player control; assert once loaded.

### 8. Cooldown / Height Threshold Masking Misclassification
**Why**: High `WALLJUMP_MIN_RISE` (1.5) plus ascend requirement might mean testers focus on higher rises where corner cases with NOCLIMB spans at partial heights are more frequent.

**Evidence**: `WALLJUMP_MIN_RISE` constant; interplay not causal but can amplify bug visibility.

**Proposed Fix**: Instrument logging: when `hitWall && !collidedNoClimb` log span types for diagnostics.

### 9. Legacy Variable Reuse (`lastHitNoClimb`) Leading to Stale State
**Why**: Single `lastHitNoClimb` reused across both axis passes; although aggregated logic resets through classification, a rare path (e.g., early return or future edits) could leak state.

**Evidence**: Variable defined once at top; reused.

**Proposed Fix**: Scope per-axis variables or explicitly reset before second axis classification.

---
## Recommended Fix Order
1. Implement span-level detection (Theory 1) – small, direct, high confidence.
2. Add `TILE.NOCLIMB` to `isWallAt()` solid set (Theory 2) – enforces spec consistency.
3. Refactor collision result to include `touchedNoClimb` independent of axis aggregation (covers Theory 3 & 4).
4. Add debug instrumentation / assertions (supports remaining theories, validates fix).

---
## Example Patch Sketches (Not Applied Yet)

1. In `collisionHorizontal.js` inside both `classifyZ()` / `classifyX()` blocks:
```js
// After reading base tile
try {
  const key = `${gxCurCell},${gzNewCell}`; // or appropriate coords
  const spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
              : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
              : null;
  if (Array.isArray(spans)) {
    for (const s of spans) {
      if (!s) continue; const t=((s.t|0)||0); if (t!==9) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
      const top = b + h; if (p.y >= b && p.y <= top - 0.02) { lastHitNoClimb = true; break; }
    }
  }
} catch(_){ }
```

2. In `isWallAt()` add NOCLIMB base tile solidity:
```js
if (cv === TILE.WALL || cv === TILE.BAD || cv === TILE.FILL || cv === TILE.NOCLIMB) {
  if (py > -EPS && py < 1.0 - EPS) return true;
}
```

3. Add debug (temporary):
```js
if (hitWall && !collidedNoClimb) {
  // scan spans & log if we actually hit a t:9
}
```

---
## Validation Plan After Fix
- Unit-style scenario: Place a single elevated NOCLIMB span; attempt wall-jump → should fail.
- Ground tile NOCLIMB after adding solidity: collision should occur and wall-jump should fail.
- Mixed corner: NOCLIMB + normal wall adjacency; ensure touching normal wall still permits wall-jump (control test) but NOCLIMB face does not.
- Dash collision into NOCLIMB: confirm no wall-jump rebound.

---
## Closing
Primary root cause is almost certainly missing span-type classification for `t:9` (elevated NOCLIMB). Secondary inconsistency in `isWallAt()` exacerbates confusion. Address both and add logging to confirm resolution.

Let me know if you want me to implement the patch directly.
