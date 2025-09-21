# Lock-Block Upward Collision "Gap" Theories

Problem summary (observed):
- While player is already overlapping a Lock Block span (t:6) and camera lock mode is therefore forced, an upward jump into a solid block (BASE/WALL/HALF or BAD) shows for 1 frame camera logic consistent with being outside the lock (camera tries to revert to AUTO) before re-locking next frame.
- Hitting a BAD block from underneath while inside a lock span sometimes behaves like a normal solid ceiling bounce (small upward propulsion / neutral) instead of the expected immediate downward spike (damage-like behavior). Net effect: player can zip upward or fail to be spiked down.
- Hypothesis: a temporal ordering or spatial classification gap allows one frame where upward collision response is processed before (or without) recognizing continued lock-span containment.

Goal: Enumerate plausible causes of this temporal/spatial "gap" and rank them by likelihood of explaining both (a) the 1-frame camera unlock flicker and (b) the BAD ceiling mis-response while inside lock blocks.

---
## 1. (Most Likely) Order-of-operations mismatch: vertical physics (ceiling response) happens BEFORE lock-span re-evaluation
**Why likely:**
- `stepGame()` sequence: `applyVerticalPhysics(dt)` then later `moveAndCollide(dt)` (which contains lock detection inside `moveAndCollide`).
- Lock containment (`isInsideLockAt`) is only evaluated inside `moveAndCollide`, i.e. AFTER vertical integration & any ceiling collision taken in `processVerticalPhysics` (or fallback). Thus, during the vertical pass, state._inLockNow still reflects last frame (pre-jump position). If upward motion pushes player into a span/cell combination where a solid top forces a clamp, the lock re-evaluation has not yet run.
- If the vertical solver temporarily adjusts Y (ceiling clamp) and possibly modifies tile occupancy in a way that causes camera logic elsewhere (e.g. camera update or rendering heuristics) to think we are no longer inside a lock span for that frame, camera may attempt to revert to AUTO; then `moveAndCollide` re-flags the lock.
- BAD block special downward spike logic likely sits in vertical physics (in extracted `collisionVertical.js` not visible here). If that logic queries lock status (or uses a different branch when in lock), the out-of-date `_inLockNow` could cause it to choose the non-lock path (normal solid collision) for one frame.
**Bridging both symptoms:** outdated lock state during the vertical step yields incorrect ceiling classification and camera state for a single frame.
**Instrumentation ideas:**
- Log before vertical step: `(frame, p.y, _inLockNow)`; after vertical ceiling resolution but before horizontal: `(frame, afterV, _inLockNow, inLockRecalcImmediate())` where `inLockRecalcImmediate()` calls `isInsideLockAt` directly. Compare with value after `moveAndCollide`.
- If mismatch detected (immediate true, stored false), confirm theory.
**Fix approach:**
- Recalculate/refresh lock containment at start of frame (before vertical physics) OR extract lock detection into a shared helper run both before vertical and inside horizontal to keep it fresh.
- Alternatively, move lock detection to its own early step (just after input, before any physics) and store the result for both vertical and horizontal phases.

## 2. Ceiling sampling excludes lock spans, causing transient Y penetration enabling camera unlock
**Why likely:**
- `ceilingHeightAt` explicitly skips spans with t==6 (Lock) when building `spanList` (treated non-solid). While correct for collision (locks aren't physical), this means when inside a lock volume and jumping into a REAL solid ceiling above, the solver may momentarily place player just outside / above lock vertical extent for one frame until horizontal collision repositions or until height correction.
- If lock spans are non-solid, but vertical position during collision resolution sits on the boundary (top or just outside), `isInsideLockAt` run later might return false for the earlier moment. Any camera code running BETWEEN vertical and lock update could see outside lock.
**Relation to BAD block behavior:**
- If BAD block downward spike logic expects to fire when detecting a BAD tile as ceiling; but if vertical pass misclassifies due to being exactly at a threshold (and lock spans not considered), spike might be skipped and a generic upward bounce persists (or the player's vy is only mildly inverted by generic clamp).
**Instrumentation:** Track `py` vs lock span [b, top] each sub-step; log when `py` crosses `top - eps` and whether camera flicker occurs.
**Mitigation:** Add a small hysteresis margin for lock containment (treat inside if `py <= top + margin` and `py >= b - margin`) or evaluate lock before camera updates (see #1). Ensure BAD spike logic does not depend on lock state for classification.

## 3. Race between camera update timing and lock flag update
**Why medium:**
- Camera updates (`updateCameraFollow`, `updateCameraYaw`) are called after `moveAndCollide` where lock is set—so a flicker implies some earlier system (maybe grid visuals or a UI label) queries outdated info before the lock gets reasserted. Possibly a separate render or UI tick uses `_inLockNow` earlier (e.g., in a requestAnimationFrame before `stepGame` completes) or uses a heuristic (like ground tile type) that is influenced by temporary vertical position.
- If camera status label or forced yaw logic writes global flags that other modules read mid-frame, ordering might expose a frame w/out forced lock.
**Overlap with BAD behavior:** less direct; would not alone explain incorrect vertical impulse unless same stale flag drives vertical collision response branch.
**Instrumentation:** Timestamp each write to `state._inLockNow` and each read by camera/UI; ensure reads occur post-write. Add a frame counter to verify.
**Fix:** Consolidate lock state read/write at a single deterministic point; defer any UI/camera decisions until after that point.

## 4. BAD block upward collision path shares generic ceiling collision code that loses "hazard" semantics when inside lock spans
**Why plausible:**
- If inside a lock span, some hazard handling might be disabled (e.g., to prevent repetitive damage in confined puzzle areas). Accidentally the BAD ceiling branch may early-return to standard solid response when `inLockNow` is true. That would invert effect when state mis-evaluated across frames.
- Observed effect (zip upward) suggests upward vy is preserved or slightly positive instead of being forcibly negative (spike). This could happen if BAD hazard branch not taken.
**Need to inspect:** `collisionVertical.js` (not shown) for conditional like `if (!inLockNow && tile===BAD && vy>0){ spikeDown(); }`.
**Fix:** Make BAD hazard downward spike unconditional with respect to lock status; use separate flag for disabling damage but keep physical behavior.

## 5. Floating point epsilon thresholds allow oscillation across lock boundary (off-by-epsilon leak)
**Why plausible:**
- Lock inclusion test uses `py >= b && py <= top - 0.02`. A hard `-0.02` shrink at top creates a vertical dead zone (last 0.02 units) where the player can be physically still visually inside the block volume but logically considered outside. During upward collision clamp, player may settle exactly at `top - eps` slightly above inclusion threshold, causing one frame outside.
- Combined with discrete integration (vy * dt), a single frame may overshoot into the dead zone then be corrected downward next frame, producing flicker.
**Relation to BAD spike:** If player's Y is in dead zone, BAD hazard code may think not truly inside lock, altering logic ordering or overlapping classification.
**Mitigation:** Replace strict inner shrink with symmetrical hysteresis (enter threshold vs exit threshold) or reduce top shrink to a very small tolerance (1e-4) and add a stateful latch (remain inside until py > top + margin).

## 6. Horizontal collision / wall jump code possibly resetting camera lock flags transiently
**Why lower:**
- In `moveAndCollide` the lock state is only set (no explicit temporary clearing) unless exiting. But wall-jump code modifies angle, vy, etc. Perhaps a path sets `state.lockedCameraForced=false` indirectly? Not visible here.
- Upward collision issue described occurs with vertical ceiling, not lateral wall, so less related.

## 7. Portal / special span interactions interfering (unlikely)
**Why low:**
- Portal detection logic scans spans (t:5). No direct modification to lock flags except distant side effects. Unlikely to cause single-frame unlock specifically during upward BAD collision.

## 8. Asynchronous span cache (getSolidSpansCached) not yet reflecting lock spans for current frame
**Why lower:**
- Lock spans (t:6) are non-solid; caching pipeline maybe delays new spans addition/removal causing inconsistent isInsideLockAt results across frames where vertical integration uses stale geometry but horizontal uses fresh.
- However primary symptom needs just one frame; caching mismatch could produce that.
**Check:** Log when `getSolidSpansCached` returns a value different from iterated spans set across frame boundaries.

## 9. Ball mode / damage interplay leaving residual velocities (edge scenario)
**Why low:**
- Reported case not in ball mode. Not primary.

---
## Cross-Cutting: Evidence Collection Plan
Instrumentation lines to add (temporary):
1. Early in `stepGame` after input:
   ```js
   const gx=Math.floor(player.x+MAP_W*0.5), gz=Math.floor(player.z+MAP_H*0.5);
   if (window.__LOG_LOCK_GAP){ console.log('preV', frameCounter, player.y.toFixed(4), state._inLockNow, isInsideLockAt(gx,gz,player.y)); }
   ```
2. Inside vertical physics right after computing newY & before ceiling clamp; and immediately after clamp.
3. At start of `moveAndCollide` BEFORE lock detection, and right after updating `_inLockNow`.
4. In BAD ceiling collision branch (where downward spike expected) log vy in/out plus lock flags.
5. Camera status update location: log when camera tries to revert to AUTO and reason.

Correlate frames where camera flicker occurs with mismatch: `state._inLockNow !== isInsideLockAt(...)` earlier the same frame.

---
## Remediation Options (Ranked by Benefit/Simplicity)
1. Early Lock Pass (Implement): Run a shared `updateLockContainment()` at start of `stepGame` (before vertical physics) and again optionally after horizontal move only if position changed across cells; camera/physics read only this stable flag. (Addresses Theories #1, #3)
2. Hysteresis for Lock Inclusion: Introduce `state._lockInsideLatched` that only flips false if `py > top + 0.01` instead of `py <= top - 0.02`. (Addresses #5)
3. BAD Ceiling Spike Decoupling: Make downward spike independent of lock state; ensure BAD tile detection purely tile/span based. (Addresses #1, #4)
4. Single Source of Truth for Camera Mode: Camera logic relies solely on `state.lockedCameraForced` which is updated only after lock state pass; no mid-frame recomputation. (Addresses #3)
5. Optional: Slight predictive lock update after vertical motion but before camera update if vertical module changed Y across span boundaries without horizontal movement (micro-optimization vs #1).

---
## Quick Diagnostic Checklist
- Does logging show stale `_inLockNow` during vertical ceiling collision frame? -> If yes, Theory #1 confirmed.
- Does player Y land within 0.02 of lock span top when flicker occurs? -> If yes, Theory #5 contributing.
- Does BAD spike branch skip on frames with mismatch? -> If yes, Theory #4 interplay.
- After adding early lock pass, do both flicker and BAD misbehavior disappear? -> Success.

---
## Recommended Immediate Patch Outline
- Extract `isInsideLockAt` from `moveAndCollide` into module scope (already nested) and call at start of `stepGame` before `applyVerticalPhysics`.
- Store result in `state._inLockNowNext` then atomic swap into `_inLockNow` after vertical physics to prevent mid-frame racing; or simpler: compute at start and use constant for rest of frame.
- Add hysteresis: track last inside top height; only exit if `py > lastTop + 0.01`.
- Audit BAD vertical collision (in `collisionVertical.js`) to ensure downward spike isn't gated by lock state.

---
## Summary Ranking
1. Early lock-state update missing (ordering) – root cause
2. Non-solid lock span exclusion + no hysteresis – amplifies ordering gap
3. Camera/UI reading stale lock flag mid-frame – secondary symptom enabler
4. BAD spike logic conditionally dependent on lock state – misclassification of collision type
5. Epsilon dead zone at top of lock span – intermittent classification leakage
6+. Lesser ancillary factors

---
## Next Steps
- Implement instrumentation toggled by a global flag.
- Verify logs for 10–20 jump tests; confirm elimination after patch.
- Clean up instrumentation.

(End)
