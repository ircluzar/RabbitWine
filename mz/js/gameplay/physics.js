/**
 * Physics and collision detection for player movement and world interaction.
 * Handles ground height calculation, wall collision, and player movement with physics integration.
 * Exports: groundHeightAt(), moveAndCollide() functions for use by gameplay loop.
 * Dependencies: MAP_W, MAP_H, TILE, columnHeights, map, mapIdx from map data. Side effects: Modifies state.player position and velocity.
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
  if (columnHeights.has(key)) return columnHeights.get(key);
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
  // Smooth accel/decel toward target; accelerate relatively fast
  const accelRate = 10.0; // units/sec^2 when speeding up
  const decelRate = 12.0; // units/sec^2 when slowing down
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
    let blockH = 0.0;
    if (columnHeights.has(key)) blockH = columnHeights.get(key);
    else if (map[mapIdx(gx,gz)] === TILE.WALL) blockH = 1.0;
    if (blockH <= 0.0) return false;
    if (state.player.y >= blockH - 0.02) return false;
    return true;
  }
  let hitWall = false;
  if (!isWallAt(p.x, newZ)) { p.z = newZ; } else { newZ = p.z; hitWall = true; }
  if (!isWallAt(newX, p.z)) { p.x = newX; } else { newX = p.x; hitWall = true; }

  // If dash hit a wall this frame, cancel any movement and jump immediately
  if (hitWall && wasDashing){
    // Revert movement from this frame
    p.x = oldX; p.z = oldZ;
    p.isDashing = false;
    // Wall jump: flip and give upward vy
    p.angle += Math.PI;
    p.vy = 8.5;
    p.grounded = false;
    p.jumpStartY = p.y;
    p.wallJumpCooldown = 0.22;
    // Reset dash on wall jump to allow chaining as requested
    p.dashUsed = false;
    // Clamp speed to max after dash ends
    const base2 = 3.0; const max2 = base2 * seamSpeedFactor();
    if (p.speed > max2) p.speed = max2;
  // Ensure we keep moving after the wall-jump
  p.movementMode = 'accelerate';
    return;
  }

  if (!p.isDashing && hitWall && !p.grounded && p.vy > 0.0 && (p.wallJumpCooldown || 0) <= 0.0 && (p.y - (p.jumpStartY || 0)) >= 1.5) {
    p.angle += Math.PI;
    p.vy = 8.5;
    p.grounded = false;
    p.jumpStartY = p.y;
    p.wallJumpCooldown = 0.22;
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
}
