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
  // Prefer spans if available; otherwise derive spans from columnHeights/columnBases and map wall tile.
  let spans = null;
  try {
    spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
          : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
          : null;
  } catch(_){ spans = null; }
  /** @type {Array<{b:number,h:number}>} */
  let spanList = Array.isArray(spans) ? spans.slice() : [];
  // If no explicit spans, synthesize from columnHeights/bases
  if (!spanList.length){
    try {
      if (typeof columnHeights !== 'undefined' && columnHeights && columnHeights.has(key)){
        let b = 0; let h = columnHeights.get(key) || 0;
        try {
          if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
          else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
        } catch(_){ }
        if (h > 0) spanList.push({ b: b|0, h: h|0 });
      }
    } catch(_){ }
  }
  // Always include ground wall as span if map tile is WALL
  const isGroundWall = map[mapIdx(gx,gz)] === TILE.WALL;
  if (isGroundWall){ spanList.push({ b: 0, h: 1 }); }
  if (spanList.length){
    const py = state.player ? state.player.y : 0.0;
    let best = 0.0;
    for (const s of spanList){
      if (!s) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
      const top = b + h; if (top <= py + 1e-6 && top > best) best = top;
    }
    if (best > 0.0) return best;
  }
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
  // Fallbacks when no spans and no column height applicable below player
  if (columnHeights.has(key)){
    const h = columnHeights.get(key) || 0.0;
    const b = getBaseFor(key);
    const py = state.player ? state.player.y : 0.0;
    if (py >= b + h - 1e-6) return b + h;
  }
  return isGroundWall ? 1.0 : 0.0;
}

/**
 * Calculate the nearest ceiling (bottom of a span) above the player's current Y
 * Returns +Infinity if no ceiling above at this (x,z).
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @param {number} py - Player Y reference (current Y)
 * @returns {number} Ceiling height (bottom of span) or +Infinity if none
 */
function ceilingHeightAt(x, z, py){
  const gx = Math.floor(x + MAP_W*0.5);
  const gz = Math.floor(z + MAP_H*0.5);
  if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return Infinity;
  const key = `${gx},${gz}`;
  let spans = null;
  try {
    spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
          : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
          : null;
  } catch(_){ spans = null; }
  /** @type {Array<{b:number,h:number}>} */
  let spanList = Array.isArray(spans) ? spans.slice() : [];
  if (!spanList.length){
    // Synthesize from column data
    try {
      if (typeof columnHeights !== 'undefined' && columnHeights && columnHeights.has(key)){
        let b = 0; let h = columnHeights.get(key) || 0;
        try {
          if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
          else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
        } catch(_){ }
        if (h > 0) spanList.push({ b: b|0, h: h|0 });
      }
    } catch(_){ }
    // Include ground wall tile as span if present
    if (map[mapIdx(gx,gz)] === TILE.WALL){ spanList.push({ b: 0, h: 1 }); }
  }
  if (!spanList.length) return Infinity;
  let best = Infinity;
  const eps = 1e-6;
  for (const s of spanList){
    if (!s) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
    if (b > py + eps && b < best) best = b;
  }
  return best;
}

/**
 * Update player position with collision detection and physics
 * @param {number} dt - Delta time in seconds
 */
function moveAndCollide(dt){
  if (state && state.editor && state.editor.mode === 'fps') return; // no collision in editor
  const p = state.player;
  // If in ball mode: custom motion/bounce, ignore normal control-based movement
  if (p.isBallMode) {
    runBallMode(dt);
    return;
  }
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
    // Collide if any span overlaps player Y; prefer explicit spans, else synthesize from column data and map tile
    let spans = null;
    try {
      spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
            : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
            : null;
    } catch(_){ spans = null; }
    /** @type {Array<{b:number,h:number}>} */
    let spanList = Array.isArray(spans) ? spans : [];
    if (!Array.isArray(spanList) || spanList.length === 0){
      spanList = [];
      // synthesize from columnHeights/bases if present
      if (columnHeights.has(key)){
        let b = 0; let h = columnHeights.get(key) || 0;
        try {
          if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
          else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
        } catch(_){ }
        if (h > 0) spanList.push({ b: b|0, h: h|0 });
      }
      // and include ground wall if map says WALL
      if (map[mapIdx(gx,gz)] === TILE.WALL){ spanList.push({ b: 0, h: 1 }); }
    }
    if (Array.isArray(spanList) && spanList.length){
      const py = state.player.y;
      for (const s of spanList){
        if (!s) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
        const top = b + h;
        if (py > b - 0.02 && py < top - 0.02) return true;
      }
      return false;
    }
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
  // No spans/columns: fallback to ground wall tile only
  if (map[mapIdx(gx,gz)] === TILE.WALL){ return state.player.y < 1.0 - 0.02; }
    return false;
  }
  let hitWall = false;
  // Ball mode should only trigger on touching the grid edge (true out-of-bounds),
  // not when colliding with blocks that happen to be placed in border cells.
  function isBorderCell(gx, gz){
    return (gx === 0 || gz === 0 || gx === (MAP_W|0)-1 || gz === (MAP_H|0)-1);
  }
  // Try move along Z; if blocked by border, enter ball mode
  {
    const gxCur = Math.floor(p.x + MAP_W*0.5);
    const gzNew = Math.floor(newZ + MAP_H*0.5);
    const outZ = (gzNew < 0 || gzNew >= MAP_H);
    if (!isWallAt(p.x, newZ)) {
      p.z = newZ;
    } else {
      newZ = p.z; hitWall = true;
      // Only trigger damage/ball mode if we attempted to go outside the grid
      if (outZ){
        // normal points inward (opposite attempted step)
        const n = { nx: 0, nz: (Math.sign(dirZ) > 0 ? -1 : 1) };
        enterBallMode(n);
        // Revert any movement from this frame
        p.x = oldX; p.z = oldZ;
        return;
      }
    }
  }
  // Try move along X; if blocked by border, enter ball mode
  {
    const gzCur = Math.floor(p.z + MAP_H*0.5);
    const gxNew = Math.floor(newX + MAP_W*0.5);
    const outX = (gxNew < 0 || gxNew >= MAP_W);
    if (!isWallAt(newX, p.z)) {
      p.x = newX;
    } else {
      newX = p.x; hitWall = true;
      // Only trigger damage/ball mode if we attempted to go outside the grid
      if (outX){
        const n = { nx: (Math.sign(dirX) > 0 ? -1 : 1), nz: 0 };
        enterBallMode(n);
        p.x = oldX; p.z = oldZ;
        return;
      }
    }
  }

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
  if (state && state.editor && state.editor.mode === 'fps') return; // no gravity in editor
  const p = state.player;
  if (p.isBallMode) { return; }
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
  // Ceiling collision: if moving upward into a span above, clamp to its bottom and stop upward motion
  if (p.vy > 0.0){
    const cH = ceilingHeightAt(p.x, p.z, p.y);
    if (isFinite(cH)){
      const eps = 1e-4;
      if (newY >= cH - eps){
        newY = cH - eps;
        p.vy = 0.0;
        // Keep air state; this is a head-bump, not a landing
        p.grounded = false;
      }
    }
  }
  p.y = newY;
  // Track previous grounded state for landing SFX
  state._wasGrounded = p.grounded;
}

// --- Damage and Ball Mode ---
/**
 * Trigger player damage and enter ball mode with an impulse away from a hit normal.
 * @param {{nx:number,nz:number}} hitNormalXZ - Unit normal in XZ pointing from wall into free space.
 */
function enterBallMode(hitNormalXZ){
  const p = state.player;
  if (p.isBallMode) return;
  // Freeze inputs and camera yaw during ball mode
  p.isBallMode = true;
  p.isFrozen = true;
  p.isDashing = false;
  p.movementMode = 'stationary';
  p.speed = 0.0;
  // Compute push impulse opposite the wall, with small upward pop
  const nx = (hitNormalXZ && isFinite(hitNormalXZ.nx)) ? hitNormalXZ.nx : -Math.sin(p.angle);
  const nz = (hitNormalXZ && isFinite(hitNormalXZ.nz)) ? hitNormalXZ.nz : Math.cos(p.angle);
  const len = Math.hypot(nx, nz) || 1;
  let ix = nx/len, iz = nz/len;
  // Randomize initial recoil direction (free angle in ball mode)
  const jitterDeg = 69; // ±35°
  const jitter = (Math.random()*2 - 1) * (jitterDeg * Math.PI / 180);
  const baseAng = Math.atan2(iz, ix);
  const ang = baseAng + jitter;
  const dirX = Math.cos(ang), dirZ = Math.sin(ang);
  // Impulse magnitudes (less upward jump on first recoil)
  const lateral = 4.5; // m/s sideways
  const up = 4.0;      // m/s upward, reduced for subtler pop
  p._ballVX = dirX * lateral;
  p._ballVZ = dirZ * lateral;
  p.vy = up;
  p.grounded = false;
  p._ballBouncesLeft = 3;
  // Fewer total ground bounces feels snappier and less chaotic
  p._ballBouncesLeft = 2;
  p._ballStartSec = state.nowSec || (performance.now()/1000);
  // Visuals: brief red flash and random initial spin axis/speed
  const now = p._ballStartSec;
  p._ballFlashUntilSec = now + (1/60); // one-frame at 60hz; time-based so robust
  // random unit axis
  {
    let ax = Math.random()*2-1, ay = Math.random()*2-1, az = Math.random()*2-1;
    const L = Math.hypot(ax,ay,az) || 1; ax/=L; ay/=L; az/=L;
    p._ballSpinAxisX = ax; p._ballSpinAxisY = ay; p._ballSpinAxisZ = az;
  }
  p._ballSpinSpeed = 0.8 + Math.random()*0.8; // 0.8..1.6 rad/s
  // Fire event for UI/SFX hooks
  try { window.dispatchEvent(new CustomEvent('playerDamaged', { detail: { x:p.x, y:p.y, z:p.z } })); } catch(_){ }
  // SFX: damage/enter ball mode
  try { if (window.sfx) sfx.play('./sfx/VRUN_DamageRespawn.mp3'); } catch(_){ }
}

/**
 * Integrate ball-mode physics: reduced gravity, ground and wall bounces.
 */
function runBallMode(dt){
  const p = state.player;
  const GRAV = -8.0; // lowered gravity in ball mode
  // Integrate vertical
  p.vy += GRAV * dt;
  let newY = p.y + p.vy * dt;
  const gH = groundHeightAt(p.x, p.z);
  const wasAir = !p.grounded;
  if (p.vy <= 0.0 && newY <= gH){
    newY = gH;
    // Ground bounce
    if (p._ballBouncesLeft > 0){
      // Dampen vertical and horizontal more strongly
      const bounceFactor = 0.45; // lower vertical energy retention
      const decay = 0.55; // stronger horizontal decay per ground contact
      p.vy = Math.max(1.6, Math.abs(p.vy) * bounceFactor);
      p._ballVX *= decay;
      p._ballVZ *= decay;
      // Cap horizontal speed after bounce to avoid propulsion
      {
        const hv = Math.hypot(p._ballVX, p._ballVZ);
        const cap = 3.0;
        if (hv > cap){ const s = cap / hv; p._ballVX *= s; p._ballVZ *= s; }
      }
      p._ballBouncesLeft--;
      // Randomize spin axis and speed on each ground bounce
      {
        let ax = Math.random()*2-1, ay = Math.random()*2-1, az = Math.random()*2-1;
        const L = Math.hypot(ax,ay,az) || 1; ax/=L; ay/=L; az/=L;
        p._ballSpinAxisX = ax; p._ballSpinAxisY = ay; p._ballSpinAxisZ = az;
        p._ballSpinSpeed = 0.6 + Math.random()*1.2; // 0.6..1.8 rad/s
      }
  // SFX per ground bounce
  try { if (window.sfx) sfx.play('./sfx/TunnelRun_Jump.mp3', { volume: 0.6 }); } catch(_){ }
    } else {
      // End ball mode on ground rest
      p.vy = 0.0;
      p.grounded = true;
      exitBallMode();
      p.y = newY;
      return;
    }
  }
  p.y = newY;
  // Horizontal move with wall bounce using same lateral collision check as walls
  const stepX = p._ballVX * dt;
  const stepZ = p._ballVZ * dt;
  let nx = 0, nz = 0; // collision normal accumulator
  let bounced = false;
  function isWallAtXZ(wx, wz){
    // Reuse horizontal collision test from moveAndCollide scope
    const gx = Math.floor(wx + MAP_W*0.5);
    const gz = Math.floor(wz + MAP_H*0.5);
    if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return true; // treat border as wall
    const key = `${gx},${gz}`;
    let spans = null;
    try {
      spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
            : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
            : null;
    } catch(_){ spans = null; }
    let spanList = Array.isArray(spans) ? spans : [];
    if (!spanList.length){
      if (columnHeights.has(key)){
        let b = 0; let h = columnHeights.get(key) || 0;
        try {
          if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
          else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
        } catch(_){ }
        if (h > 0) spanList.push({ b: b|0, h: h|0 });
      }
      if (map[mapIdx(gx,gz)] === TILE.WALL){ spanList.push({ b: 0, h: 1 }); }
    }
    if (spanList.length){
      const py = p.y;
      for (const s of spanList){
        if (!s) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
        const top=b+h; if (py > b - 0.02 && py < top - 0.02) return true;
      }
    }
    return false;
  }
  // Try Z then X similar to normal collision for a simple normal estimate
  let nxTry = p.x, nzTry = p.z + stepZ;
  if (!isWallAtXZ(nxTry, nzTry)) { p.z = nzTry; } else { p._ballVZ = -p._ballVZ * 0.45; bounced = true; nz = -Math.sign(stepZ); }
  nxTry = p.x + stepX; nzTry = p.z;
  if (!isWallAtXZ(nxTry, nzTry)) { p.x = nxTry; } else { p._ballVX = -p._ballVX * 0.45; bounced = true; nx = -Math.sign(stepX); }
  if (bounced){
    // Smaller upward nudge on wall bounce
    p.vy = Math.max(p.vy, 1.0);
    // Cap horizontal speed after wall bounce
    const hv = Math.hypot(p._ballVX, p._ballVZ);
    const cap = 3.5;
    if (hv > cap){ const s = cap / hv; p._ballVX *= s; p._ballVZ *= s; }
    // Randomize spin axis and speed on wall bounce as well
    {
      let ax = Math.random()*2-1, ay = Math.random()*2-1, az = Math.random()*2-1;
      const L = Math.hypot(ax,ay,az) || 1; ax/=L; ay/=L; az/=L;
      p._ballSpinAxisX = ax; p._ballSpinAxisY = ay; p._ballSpinAxisZ = az;
      p._ballSpinSpeed = 0.6 + Math.random()*1.2; // 0.6..1.8 rad/s
    }
  // SFX per wall bounce
  try { if (window.sfx) sfx.play('./sfx/TunnelRun_Jump.mp3', { volume: 0.5 }); } catch(_){ }
  }
}

function exitBallMode(){
  const p = state.player;
  p.isBallMode = false;
  p.isFrozen = false;
  // Restore control and camera; come to rest
  p.movementMode = 'stationary';
  p.speed = 0.0;
  // Clear ball visuals
  p._ballSpinSpeed = 0.0;
  p._ballFlashUntilSec = 0.0;
}

// Expose enterBallMode for other modules
if (typeof window !== 'undefined') window.enterBallMode = enterBallMode;
