# Fence zipping: likely causes and fixes (prioritized)

Observed: Jumping onto FENCE/BADFENCE sometimes makes the player zip or jitter along the rails, especially when landing on the very top. Theories and fixes below are grounded in `mz/js/gameplay/physics.js`.

## 1) Step-up onto rails triggers ping-pong with lateral rail collision

- Where: `moveAndCollide()` tries step-up (`landingHeightAt`) after a lateral block on each axis, even when the block was a rail (`lastHitFenceRail`).
- Why: We step up onto a thin rail top, then get pushed sideways by rail collision on the next axis; repeat across frames (X then Z), producing zip.
- Fix: Skip step-up when the collision was a fence rail.
  - Change: In both axis legs, wrap the step-up block in `if (!outX && !xRailHit) {...}` and `if (!outZ && !zRailHit) {...}`.
  - Effect: You can still step onto real ledges; you won’t climb razor-thin rails as pseudo-platforms during lateral resolution.

## 2) Rail ground height lacks hysteresis (multiple voxel tops)

- Where: `groundHeightAt()` computes `railGroundCandidate` from all fence span voxels under the player when inside inner bands.
- Why: With multiple levels (b..h), tiny float changes swap the chosen top, toggling grounded/ungrounded and vy clamps; combined with lateral push-outs this causes jitter/zip on top.
- Fixes:
  - Only accept `railGroundCandidate` when vy <= 0 (landing/descending), and `abs(py - top) <= ~0.05`, and still inside band.
  - Track sticky stand height per cell (e.g., `p._railStandY`); don’t switch until leaving band or a clear jump.
  - Quantize rail tops to integers and compare with a single epsilon to avoid flicker between adjacent levels.

## 3) Rail snap resolution is aggressive

- Where: `isWallAt()` sets `lastResolveX/Z` to push outside the inner band by `RAIL_MARGIN=0.01`, then we snap if clear; we also nudge along tangent by `0.02`.
- Why: On center rails, collisions in both axes can alternate snaps and nudges, looking like sudden lateral propulsion.
- Fixes:
  - Reduce `RAIL_MARGIN` (e.g., 0.002–0.005) and limit snap to once per axis per frame (or only when penetration is deep).
  - Prefer sliding (project velocity along tangent) instead of teleporting to `lastResolveX/Z` unless necessary.
  - If snapping, bias toward the tile center (0.5) to avoid chaining into neighbors.

## 4) Vertical tolerance for fence rails is too permissive

- Where: Fence rail lateral checks use `V_EPS = 0.04` (and variants) allowing contact even slightly above the rail.
- Why: We alternate between being “inside” and “outside” across frames as `py` bounces, inviting repeated block/slide cycles.
- Fix: Reduce `V_EPS` (~0.02) and avoid `+V_EPS` at the top for lateral blocking. Keep vertical checks consistent across modes.

## 5) Axis order doubles interactions on thin cross rails

- Where: Movement resolves Z then X, each with its own step-up, nudge, and snap.
- Why: On the center cross, both axes may attempt conflicting corrections in one frame.
- Fix: If the first axis hit a rail, skip step-up and snap in the second axis that frame; or unify into a single sweep/contact solve.

## 6) Ground fence connectivity is over-broad

- Where: In `connGround`, we treat edge rails as present when the current tile is a ground fence, even if the neighbor isn’t fence.
- Why: Extra rails increase chance of lateral collisions when perched near edges.
- Fix: Only add edge rails if the neighbor is fence or a true solid (WALL/BAD/FILL/HALF); don’t add due to current tile alone.

## 7) Rail platforming may be inherently unstable

- Where: `landingHeightAt()` and `groundHeightAt()` allow rail tops as landing platforms.
- Why: Standing on a razor-thin cross without capsule/cylinder resolution tends to jitter.
- Fix (policy):
  - A) Disallow rail tops as landing candidates (rails = lateral blockers/hazards only), or
  - B) Allow only the highest rail level per cell as a platform.

## 8) Tangent nudge can look like propulsion

- Where: After rail hits we nudge by `0.02` along the tangent.
- Why: Repeated small pushes + alternating axis blocks looks like a self-propelled zip.
- Fix: Add a short cooldown per axis; disable when grounded or at low speed; or remove in favor of pure sliding.

## 9) BADFENCE ceiling approximation fights landing

- Where: `ceilingHeightAt()` approximates BADFENCE ceiling in bands when spans are absent.
- Why: When near a rail top, an approximate ceiling right above can clamp vy while ground tries to lift to the rail top.
- Fix: Apply same hysteresis/band rules as (2)/(4); ignore very close ceilings for the first frame after a rail landing.

---

### Minimal high-impact patch set

1) Skip step-up on rail collisions (1).
2) Add rail-standing hysteresis and reduce `V_EPS` (2, 4).
3) Tone down rail snapping and limit frequency (3).

These should greatly reduce zipping while keeping fence behavior intact.

### Optional follow-ups

- Tighten `connGround` (6).
- Gate/soften tangent nudge (8).
- Consider disabling rail platforming (7) if not desired.

### Quick debug aids

- Overlay inner bands and chosen `railGroundCandidate`.
- Log grounded transitions when in bands.
- Count snaps per frame; throttle if too many.
