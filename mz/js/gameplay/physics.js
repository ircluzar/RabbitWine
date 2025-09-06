/**
 * Physics and collision detection for player movement and world interaction.
 * Handles ground height calculation, wall collision, and player movement with physics integration.
 * Exports: groundHeightAt(), moveAndCollide() functions for use by gameplay loop.
 * Dependencies: MAP_W, MAP_H, TILE, columnHeights, columnBases, map, mapIdx from map data. Side effects: Modifies state.player position and velocity.
 */

// Physics and collision
/**
 * Calculate ground height at world coordinates
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} Ground height (0.0 for empty, 1.0 for wall, or custom column height)
 */
function groundHeightAt(x, z){
  const gx = Math.floor(x + MAP_W*0.5);
  const gz = Math.floor(z + MAP_H*0.5);
  if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return 0.0;
  const key = `${gx},${gz}`;
  // Phase 2: spans-based ground (highest span top <= player Y)
  try {
    if (typeof VERTICALITY_PHASE2 !== 'undefined' ? VERTICALITY_PHASE2 : (typeof window!== 'undefined' && window.VERTICALITY_PHASE2)){
      const spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
                   : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
                   : null;
      if (Array.isArray(spans) && spans.length){
        const py = state.player ? state.player.y : 0.0;
        let best = 0.0;
        for (const s of spans){
          if (!s) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
          const top = b + h; if (top <= py + 1e-6 && top > best) best = top;
        }
        if (best > 0.0) return best;
      }
    }
  } catch(_){ }
  // Resolve base offset reliably even if globals are attached on window
  function getBaseFor(key){
    try {
      if (typeof columnBases !== 'undefined' && columnBases && columnBases instanceof Map && columnBases.has(key)){
        // Note: base may be 0; do not coalesce to default when 0
        const v = columnBases.get(key);
        return (typeof v === 'number') ? v : 0.0;
      }
    } catch(_){}
    if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)){
      const v = window.columnBases.get(key);
      return (typeof v === 'number') ? v : 0.0;
    }
    return 0.0;
  }
  if (columnHeights.has(key)){
    const h = columnHeights.get(key) || 0.0;
    const b = getBaseFor(key);
    // If player is below a raised base, treat ground as 0 (free to pass under). Otherwise top of solid.
    const py = state.player ? state.player.y : 0.0;
    if (py < b - 1e-3) return 0.0;
    return b + h;
  }
  return map[mapIdx(gx,gz)] === TILE.WALL ? 1.0 : 0.0;
}

/**
 * Update player position with collision detection and physics
 * @param {number} dt - Delta time in seconds
 */
function moveAndCollide(dt){
  const p = state.player;
  const oldX = p.x, oldZ = p.z;
  const baseSpeed = 3.0;
  const seamMax = baseSpeed * seamSpeedFactor();
  const wasDashing = !!p.isDashing;
  // Target speed depends on mode
  let targetSpeed = (p.movementMode === 'accelerate') ? seamMax : 0.0;
  // If frozen, speed is forced 0 (already set in controls but keep safe)
  if (p.isFrozen) targetSpeed = 0.0;
  // If dashing, lock to 125% of max speed
  if (p.isDashing) targetSpeed = seamMax * 1.25;
  // Detect first acceleration start
  if (p.movementMode === 'accelerate' && !state.firstAccelFired && (p.speed||0) <= 1e-6) {
    state.firstAccelFired = true;
    // Apply a brief slow-acceleration window (longer for a gentler start)
    state.firstAccelSlowUntil = (state.nowSec || performance.now()/1000) + 1.75;
    state.firstAccelStartSec = (state.nowSec || performance.now()/1000);
    state.firstAccelDuration = 1.75;
    try { window.dispatchEvent(new CustomEvent('firstAccel')); } catch(_){}
  }

  // Smooth accel/decel toward target; default rates
  let accelRate = 10.0; // units/sec^2 when speeding up
  const decelRate = 12.0; // units/sec^2 when slowing down
  // During the first acceleration window, use a gentler acceleration rate
  if (state.firstAccelFired && (state.nowSec || performance.now()/1000) < (state.firstAccelSlowUntil || 0)) {
    accelRate = 1.5; // even gentler ramp for first time
  }
  const rate = (targetSpeed > p.speed + 1e-4) ? accelRate : decelRate;
  const ds = Math.sign(targetSpeed - p.speed) * rate * dt;
  // Clamp to target to avoid oscillation
  if ((ds >= 0 && p.speed + ds > targetSpeed) || (ds < 0 && p.speed + ds < targetSpeed)) {
    p.speed = targetSpeed;
  } else {
    p.speed += ds;
  }
  let dirX = Math.sin(p.angle);
  let dirZ = -Math.cos(p.angle);
  // Dash overrides direction
  if (p.isDashing && typeof p._dashDirX === 'number' && typeof p._dashDirZ === 'number'){
    dirX = p._dashDirX; dirZ = p._dashDirZ;
  }
  const stepX = dirX * p.speed * dt;
  const stepZ = dirZ * p.speed * dt;
  let newX = p.x + stepX;
  let newZ = p.z + stepZ;
  function isWallAt(wx, wz){
    const gx = Math.floor(wx + MAP_W*0.5);
    const gz = Math.floor(wz + MAP_H*0.5);
    if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return true;
    const key = `${gx},${gz}`;
    // Phase 2: collide if any span overlaps player Y
    try {
      if (typeof VERTICALITY_PHASE2 !== 'undefined' ? VERTICALITY_PHASE2 : (typeof window!== 'undefined' && window.VERTICALITY_PHASE2)){
        const spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
                     : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
                     : null;
        if (Array.isArray(spans) && spans.length){
          const py = state.player.y;
          for (const s of spans){
            if (!s) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
            const top = b + h;
            if (py > b - 0.02 && py < top - 0.02) return true;
          }
          return false;
        }
      }
    } catch(_){ }
    // Column with optional raised base
    if (columnHeights.has(key)){
      const h = columnHeights.get(key) || 0.0;
      // Use same safe base lookup as groundHeightAt
      let b = 0.0;
      try {
        if (typeof columnBases !== 'undefined' && columnBases && columnBases instanceof Map && columnBases.has(key)){
          const bv = columnBases.get(key);
          b = (typeof bv === 'number') ? bv : 0.0;
        } else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)){
          const bv = window.columnBases.get(key);
          b = (typeof bv === 'number') ? bv : 0.0;
        }
      } catch(_){}
      if (h <= 0.0) return false;
      const top = b + h;
      const py = state.player.y;
      // If below the base or above the top, not colliding laterally.
      if (py <= b - 0.02) return false;
      if (py >= top - 0.02) return false;
      return true;
    }
    // Simple wall tile at ground level (height 1)
    if (map[mapIdx(gx,gz)] === TILE.WALL){
      // Treat as solid from y in (0..1); allow passing if above the top
      if (state.player.y >= 1.0 - 0.02) return false;
      return true;
    }
    return false;
  }
  let hitWall = false;
  if (!isWallAt(p.x, newZ)) { p.z = newZ; } else { newZ = p.z; hitWall = true; }
  if (!isWallAt(newX, p.z)) { p.x = newX; } else { newX = p.x; hitWall = true; }

  // If dash hit a wall this frame, cancel any movement and jump immediately
  if (hitWall && wasDashing){
    if (!state.player.canWallJump) {
      // If walljump disabled, just cancel dash and stop against wall
      state.player.isDashing = false;
      const base2 = 3.0; const max2 = base2 * seamSpeedFactor();
      if (state.player.speed > max2) state.player.speed = max2;
      return;
    }
    // Revert movement from this frame
    p.x = oldX; p.z = oldZ;
    p.isDashing = false;
    // Wall jump: flip and give upward vy
    p.angle += Math.PI;
    p.vy = 8.5;
    p.grounded = false;
    p.jumpStartY = p.y;
    p.wallJumpCooldown = 0.22;
  // SFX: wall jump
  try { if (window.sfx) sfx.play('./sfx/VHS_Jump2.mp3'); } catch(_){}
    // Reset dash on wall jump to allow chaining as requested
    p.dashUsed = false;
    // Clamp speed to max after dash ends
    const base2 = 3.0; const max2 = base2 * seamSpeedFactor();
    if (p.speed > max2) p.speed = max2;
  // Ensure we keep moving after the wall-jump
  p.movementMode = 'accelerate';
    return;
  }

  if (p.canWallJump && !p.isDashing && hitWall && !p.grounded && p.vy > 0.0 && (p.wallJumpCooldown || 0) <= 0.0 && (p.y - (p.jumpStartY || 0)) >= 1.5) {
    p.angle += Math.PI;
    p.vy = 8.5;
    p.grounded = false;
    p.jumpStartY = p.y;
    p.wallJumpCooldown = 0.22;
  // SFX: wall jump (auto bounce)
  try { if (window.sfx) sfx.play('./sfx/VHS_Jump2.mp3'); } catch(_){}
    // Reset dash on wall jump
    p.dashUsed = false;
    // keep moving post-bounce
    p.movementMode = 'accelerate';
  }
}

function applyVerticalPhysics(dt){
  const p = state.player;
  const GRAV = -12.5;
  // If frozen: pause gravity
  if (!p.isFrozen){
    // If dashing: ignore gravity for 1 second countdown
  if (p.isDashing){
      p.dashTime -= dt;
      if (p.dashTime <= 0){
        p.isDashing = false;
    // Drop straight down next frame, keep current vy (0) and clamp speed to max
    const base = 3.0; const max = base * seamSpeedFactor();
    if (p.speed > max) p.speed = max;
    // Continue moving at max speed in that direction
    p.movementMode = 'accelerate';
      }
      // Do not apply gravity while dashing
    } else {
      p.vy += GRAV * dt;
    }
  }
  let newY = p.y + p.vy * dt;
  const gH = groundHeightAt(p.x, p.z);
  if (p.vy <= 0.0 && newY <= gH){
    newY = gH;
    p.vy = 0.0;
    p.grounded = true;
    // SFX: landing (only if we were in the air)
    try { if (!state._wasGrounded && window.sfx) sfx.play('./sfx/VHS_Step2.mp3'); } catch(_){}
    // touching ground resets dash availability
    p.dashUsed = false;
    // Exiting any freeze/dash on ground
    p.isFrozen = false;
    p.isDashing = false;
  } else {
    if (p.grounded) { p.jumpStartY = p.y; }
    p.grounded = false;
  }
  p.y = newY;
  // Track previous grounded state for landing SFX
  state._wasGrounded = p.grounded;
}
