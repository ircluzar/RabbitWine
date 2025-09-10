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
  // Remove fence spans (t==2) from ground computation; they are non-solid visuals
  spanList = spanList.filter(s => s && (((s.t|0)||0) !== 2));
  // Always also synthesize from columnHeights/bases so default map blocks are respected even with server spans present
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
  // Always include ground wall/half as span if map tile is WALL/HALF (BAD handled via spans)
  const cellValGH = map[mapIdx(gx,gz)];
  const isGroundWall = (cellValGH === TILE.WALL);
  const isGroundHalf = (cellValGH === TILE.HALF);
  const isGroundFence = (cellValGH === TILE.FENCE);
  if (isGroundWall){ spanList.push({ b: 0, h: 1 }); }
  else if (isGroundHalf){ spanList.push({ b: 0, h: 0.5 }); }
  else if (isGroundFence){ /* fences are thin; do not affect ground height */ }
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
  if (isGroundWall) return 1.0;
  if (isGroundHalf) return 0.5;
  return 0.0;
}

/**
 * Find the nearest landing top above a given Y at (x,z), up to a max rise.
 * Considers explicit spans (excluding fences) and map tiles (WALL/HALF/BAD as solid).
 * Returns null if no suitable landing within rise.
 * @param {number} x
 * @param {number} z
 * @param {number} py - current player Y
 * @param {number} maxRise - maximum allowed rise
 * @returns {number|null}
 */
function landingHeightAt(x, z, py, maxRise){
  const gx = Math.floor(x + MAP_W*0.5);
  const gz = Math.floor(z + MAP_H*0.5);
  if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return null;
  const key = `${gx},${gz}`;
  /** @type {Array<{b:number,h:number,t?:number}>} */
  let candidates = [];
  // From explicit spans (skip fences t==2)
  try {
    let spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
              : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
              : null;
    if (Array.isArray(spans)){
      for (const s of spans){
        if (!s) continue; const b=(s.b||0), h=(typeof s.h==='number'?s.h:0); const t=((s.t|0)||0);
        if (h<=0 || t===2) continue;
        const top = b + h;
        if (top > py + 1e-6 && (top - py) <= (maxRise + 1e-6)) candidates.push(top);
      }
    }
  } catch(_){ }
  // From map tile at ground level
  try {
    const cv = map[mapIdx(gx,gz)];
    if (cv === TILE.WALL || cv === TILE.BAD){ const top=1.0; if (top > py + 1e-6 && (top - py) <= (maxRise + 1e-6)) candidates.push(top); }
    else if (cv === TILE.HALF){ const top=0.5; if (top > py + 1e-6 && (top - py) <= (maxRise + 1e-6)) candidates.push(top); }
  } catch(_){ }
  if (!candidates.length) return null;
  // Choose the smallest top above py (closest ledge)
  candidates.sort((a,b)=>a-b);
  return candidates[0];
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
  // Remove fence spans (t==2) from ceiling computation; they are non-solid visuals
  spanList = spanList.filter(s => s && (((s.t|0)||0) !== 2));
  // Always also synthesize from column data so default map blocks are respected
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
  // Include ground wall/half tile as span if present (WALL/HALF). BAD uses spans.
  {
    const cv = map[mapIdx(gx,gz)];
  if (cv === TILE.WALL){ spanList.push({ b: 0, h: 1 }); }
  else if (cv === TILE.HALF){ spanList.push({ b: 0, h: 0.5 }); }
  else if (cv === TILE.FENCE){ /* handled in lateral collision as thin rods */ }
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
  // Network ghost collision: if any ghost is in damaging state (red/ball) and overlaps generously, apply damage bounce
  try {
    if (typeof window !== 'undefined' && typeof window.mpGetDangerousGhosts === 'function'){
      const ghosts = window.mpGetDangerousGhosts();
      if (Array.isArray(ghosts) && ghosts.length){
        const R = 0.69; // generous radius around player center
        for (let i=0;i<ghosts.length;i++){
          const g = ghosts[i]; if (!g) continue;
          const dy = (p.y + 0.25) - (g.y + 0.25);
          if (Math.abs(dy) > 0.9) continue; // require rough vertical proximity
          const dx = p.x - g.x; const dz = p.z - g.z;
          if (dx*dx + dz*dz <= R*R){
            // Knock the player away from the ghost position
            const nx = (p.x - g.x), nz = (p.z - g.z);
            const L = Math.hypot(nx, nz) || 1; const hit = { nx: nx/L, nz: nz/L };
            enterBallMode(hit);
            break;
          }
        }
      }
    }
  } catch(_){ }
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
  // Track collision source for wall-jump logic
  let lastHitFenceRail = false; // set by isWallAt() on its last evaluation
  let lastHitSolidSpan = false; // set when solid block/span caused return
  let lastHitFenceRailDir = null; // 'N'|'S'|'E'|'W' when rail hit
  let collidedFenceRail = false; // aggregated when a move is finally blocked
  let collidedSolidSpan = false; // aggregated when a move is finally blocked
  // Resolution targets to pop out of thin rail voxels toward center
  let lastResolveX = null; // world X to snap to if X is blocked by a rail
  let lastResolveZ = null; // world Z to snap to if Z is blocked by a rail
  let newX = p.x + stepX;
  let newZ = p.z + stepZ;
  function isWallAt(wx, wz){
    // reset per-call flag
    lastHitFenceRail = false;
  lastHitSolidSpan = false;
  lastHitFenceRailDir = null;
  lastResolveX = null;
  lastResolveZ = null;
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
  /** @type {Array<{b:number,h:number,t?:number}>} */
  let spanList = [];
  if (Array.isArray(spans) && spans.length) spanList = spans.slice().filter(s => s && (((s.t|0)||0) !== 2));
    // Always merge in default-map columns
    try {
      if (columnHeights.has(key)){
        let b = 0; let h = columnHeights.get(key) || 0;
        try {
          if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
          else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
        } catch(_){ }
        if (h > 0) spanList.push({ b: b|0, h: h|0 });
      }
    } catch(_){ }
    // Always include ground-level WALL/HALF/BAD tile as solid span so lateral collision matches ground height logic
    {
      const cell = map[mapIdx(gx,gz)];
      if (cell === TILE.WALL){ spanList.push({ b: 0, h: 1 }); }
      else if (cell === TILE.HALF){ spanList.push({ b: 0, h: 0.5 }); }
      else if (cell === TILE.BAD){ spanList.push({ b: 0, h: 1, t: 1 }); }
    }
  if (Array.isArray(spanList) && spanList.length){
      const py = state.player.y;
      for (const s of spanList){
        if (!s) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
        const top = b + h;
        // Only collide laterally when player Y lies strictly within the span slab
    if (py >= b && py <= top - 0.02) { lastHitSolidSpan = true; return true; }
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
  if (py < b) return false;
    if (py > top - 0.02) return false;
  lastHitSolidSpan = true; return true;
    }
  // No spans/columns: fallback to ground wall tile only (WALL, HALF and ground-level BAD)
  const cv2 = map[mapIdx(gx,gz)];
  if (cv2 === TILE.WALL || cv2 === TILE.BAD){ if (state.player.y <= 1.0 - 0.02) { lastHitSolidSpan = true; return true; } else { return false; } }
  if (cv2 === TILE.HALF){ if (state.player.y <= 0.5 - 0.02) { lastHitSolidSpan = true; return true; } else { return false; } }
  if (cv2 === TILE.FENCE){
    // Fence collision temporarily disabled for aesthetic work; fences are non-collidable for now.
    return false;
  }
    return false;
  }
  let hitWall = false;
  // Helper: check if the current grid cell contains a hazardous span at the player's Y
  function isHazardAtCellY(gx, gz, py){
    if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return false;
    const key = `${gx},${gz}`;
    let spans = null;
    try {
      spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
            : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
            : null;
    } catch(_){ spans = null; }
    if (Array.isArray(spans)){
      for (const s of spans){
        if (!s) continue; const b=(s.b||0), h=(s.h||0), t=((s.t|0)||0); if (h<=0) continue;
        if (t===1 && py >= b && py <= (b + h - 0.02)) return true;
      }
    }
    return false;
  }
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
  const zRailHit = lastHitFenceRail; const zSolidHit = lastHitSolidSpan; const zRailDir = lastHitFenceRailDir;
      // Attempt step-up onto small ledges (half-step or <=0.5 rise)
      let stepped = false;
      if (!outZ){
        const stepMax = 0.5 + 1e-3;
        const gDst = landingHeightAt(p.x, newZ, p.y, stepMax);
        if (gDst !== null){
          // Ensure destination is not hazardous at the standing Y
          const keyG = `${gxCur},${gzNew}`;
          const pyStand = gDst - 0.02;
          const hazardous = isHazardAtCellY(gxCur, gzNew, pyStand) || (map[mapIdx(gxCur,gzNew)] === TILE.BAD);
          // Ensure no ceiling immediately at stand height
          const cH = ceilingHeightAt(p.x, newZ, gDst - 0.05);
          const blockedAbove = isFinite(cH) && (cH <= gDst + 0.02);
          if (!hazardous && !blockedAbove){
            // Check lateral clearance at new Y by temporarily adjusting Y
            const oldY = p.y; p.y = gDst;
            const blockedAtNewY = isWallAt(p.x, newZ);
            if (!blockedAtNewY){ p.z = newZ; p.vy = 0.0; p.grounded = true; stepped = true; }
            p.y = stepped ? p.y : oldY;
            if (stepped){ p.y = gDst; }
          }
        }
      }
      if (!stepped){
        newZ = p.z; hitWall = true; collidedFenceRail = collidedFenceRail || zRailHit; collidedSolidSpan = collidedSolidSpan || zSolidHit;
        // Try a tiny nudge along the rail tangent to reduce sticking if the block was a rail
        if (zRailHit && zRailDir){
          const nudge = 0.02;
          if (zRailDir==='N' || zRailDir==='S'){
            const sign = Math.sign(((p.x + MAP_W*0.5) - Math.floor(p.x + MAP_W*0.5) - 0.5) || 1);
            const tryX = p.x + sign * nudge;
            if (!isWallAt(tryX, p.z)) p.x = tryX;
          } else if (zRailDir==='E' || zRailDir==='W'){
            const sign = Math.sign(((p.z + MAP_H*0.5) - Math.floor(p.z + MAP_H*0.5) - 0.5) || 1);
            const tryZ = p.z + sign * nudge;
            if (!isWallAt(p.x, tryZ)) p.z = tryZ;
          }
          // If we have a safe resolution target along Z, snap to it
          if (lastResolveZ !== null && !isWallAt(p.x, lastResolveZ)) {
            p.z = lastResolveZ;
          }
        }
      }
      // Only trigger damage/ball mode if we attempted to go outside the grid
      if (outZ){
        // normal points inward (opposite attempted step)
        const n = { nx: 0, nz: (Math.sign(dirZ) > 0 ? -1 : 1) };
        enterBallMode(n);
        // Revert any movement from this frame
        p.x = oldX; p.z = oldZ;
        return;
      } else {
        // Collided within bounds; if the blocked cell is BAD, trigger damage
        const gxCell = gxCur;
        const gzCell = gzNew;
        if (gxCell>=0&&gzCell>=0&&gxCell<MAP_W&&gzCell<MAP_H){
          // Prefer span hazard at current Y; fallback to ground-level BAD map tile
          const hazardous = isHazardAtCellY(gxCell, gzCell, p.y) || (map[mapIdx(gxCell,gzCell)] === TILE.BAD);
          if (hazardous){
            const n = { nx: 0, nz: (Math.sign(dirZ) > 0 ? -1 : 1) };
            enterBallMode(n, { downward: false });
            p.x = oldX; p.z = oldZ;
            return;
          }
        }
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
  const xRailHit = lastHitFenceRail; const xSolidHit = lastHitSolidSpan; const xRailDir = lastHitFenceRailDir;
      // Attempt step-up onto small ledges (half-step or <=0.5 rise)
      let stepped = false;
      if (!outX){
        const stepMax = 0.5 + 1e-3;
        const gDst = landingHeightAt(newX, p.z, p.y, stepMax);
        if (gDst !== null){
          const keyG = `${gxNew},${gzCur}`;
          const pyStand = gDst - 0.02;
          const hazardous = isHazardAtCellY(gxNew, gzCur, pyStand) || (map[mapIdx(gxNew,gzCur)] === TILE.BAD);
          const cH = ceilingHeightAt(newX, p.z, gDst - 0.05);
          const blockedAbove = isFinite(cH) && (cH <= gDst + 0.02);
          if (!hazardous && !blockedAbove){
            const oldY = p.y; p.y = gDst;
            const blockedAtNewY = isWallAt(newX, p.z);
            if (!blockedAtNewY){ p.x = newX; p.vy = 0.0; p.grounded = true; stepped = true; }
            p.y = stepped ? p.y : oldY;
            if (stepped){ p.y = gDst; }
          }
        }
      }
      if (!stepped){
        newX = p.x; hitWall = true; collidedFenceRail = collidedFenceRail || xRailHit; collidedSolidSpan = collidedSolidSpan || xSolidHit;
        if (xRailHit && xRailDir){
          const nudge = 0.02;
          if (xRailDir==='N' || xRailDir==='S'){
            const sign = Math.sign(((p.x + MAP_W*0.5) - Math.floor(p.x + MAP_W*0.5) - 0.5) || 1);
            const tryX = p.x + sign * nudge;
            if (!isWallAt(tryX, p.z)) p.x = tryX;
          } else if (xRailDir==='E' || xRailDir==='W'){
            const sign = Math.sign(((p.z + MAP_H*0.5) - Math.floor(p.z + MAP_H*0.5) - 0.5) || 1);
            const tryZ = p.z + sign * nudge;
            if (!isWallAt(p.x, tryZ)) p.z = tryZ;
          }
          // If we have a safe resolution target along X, snap to it
          if (lastResolveX !== null && !isWallAt(lastResolveX, p.z)) {
            p.x = lastResolveX;
          }
        }
      }
      // Only trigger damage/ball mode if we attempted to go outside the grid
      if (outX){
        const n = { nx: (Math.sign(dirX) > 0 ? -1 : 1), nz: 0 };
        enterBallMode(n);
        p.x = oldX; p.z = oldZ;
        return;
      } else {
        // Collided within bounds; if the blocked cell is BAD, trigger damage
        const gxCell = gxNew;
        const gzCell = gzCur;
        if (gxCell>=0&&gzCell>=0&&gxCell<MAP_W&&gzCell<MAP_H){
          const hazardous = isHazardAtCellY(gxCell, gzCell, p.y) || (map[mapIdx(gxCell,gzCell)] === TILE.BAD);
          if (hazardous){
            const n = { nx: (Math.sign(dirX) > 0 ? -1 : 1), nz: 0 };
            enterBallMode(n, { downward: false });
            p.x = oldX; p.z = oldZ;
            return;
          }
        }
      }
    }
  }

  // If dash hit a wall this frame, cancel any movement and jump immediately
  if (hitWall && wasDashing){
    // If collided with a fence rail (and not a solid span), disallow wall-jump response
    if (collidedFenceRail && !collidedSolidSpan){
      p.isDashing = false;
      const base2 = 3.0; const max2 = base2 * seamSpeedFactor(); if (p.speed > max2) p.speed = max2; return;
    }
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
    // Prevent wall-jump only if the blocking contact was a fence rail, and not a solid span
    if (collidedFenceRail && !collidedSolidSpan) { return; }
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
    // If landing on a BAD cell (hazardous span top or ground BAD), trigger damage immediately
    try {
      const gx = Math.floor(p.x + MAP_W*0.5);
      const gz = Math.floor(p.z + MAP_H*0.5);
      if (gx>=0&&gz>=0&&gx<MAP_W&&gz<MAP_H){
        // Prefer span hazard: check if the top we landed on is a hazardous span top
        let hazardous = false;
        try {
          const key = `${gx},${gz}`;
          let spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
                    : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
                    : null;
          if (Array.isArray(spans)){
            const topY = Math.round(gH); // integer voxel top
            hazardous = spans.some(s => s && ((s.t|0)===1) && (((s.b|0)+(s.h|0))===topY));
          }
        } catch(_){ }
        // Fallback: ground-level BAD tile
        if (!hazardous && map[mapIdx(gx,gz)] === TILE.BAD){ hazardous = true; }
        if (hazardous){
          enterBallMode({ nx: 0, nz: 0 });
          p.y = newY; // settle to ground before exiting
          return;
        }
      }
    } catch(_){ }
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
        // If hitting a BAD ceiling in current grid, trigger damage (prefer span hazard at the ceiling base)
  try {
          const gx = Math.floor(p.x + MAP_W*0.5);
          const gz = Math.floor(p.z + MAP_H*0.5);
          if (gx>=0&&gz>=0&&gx<MAP_W&&gz<MAP_H){
            // Check if the ceiling base belongs to a hazardous span
            let hazardous = false;
            try {
              const key = `${gx},${gz}`;
              let spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
                        : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
                        : null;
              if (Array.isArray(spans)){
    // Find any span whose base is within a tiny epsilon of the computed ceiling
    const epsB = 1e-3;
    hazardous = spans.some(s => s && ((s.t|0)===1) && Math.abs((s.b|0) - cH) <= epsB);
              }
            } catch(_){ }
            // Fallback: ground-level BAD tile
            if (!hazardous && map[mapIdx(gx,gz)] === TILE.BAD){ hazardous = true; }
            if (hazardous){
              // Apply downward recoil on ceiling damage to prevent zipping upward through the block
              enterBallMode({ nx: 0, nz: 0 }, { downward: true });
            }
          }
        } catch(_){ }
        newY = cH - eps;
        // Do not forcibly zero vy before damage; ball-mode handler will set appropriate vertical velocity
        if (!p.isBallMode) p.vy = 0.0;
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
function enterBallMode(hitNormalXZ, opts){
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
  // Impulse magnitudes
  const lateral = 4.5; // m/s sideways
  const up = 4.0;      // m/s upward
  const down = 4.0;    // m/s downward for ceiling hazards
  p._ballVX = dirX * lateral;
  p._ballVZ = dirZ * lateral;
  // Special-case: if caller flags downward (ceiling hit), push down instead of up
  if (opts && opts.downward === true){
    p.vy = -down;
  } else {
    p.vy = up;
  }
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
  // Track if we hit a ceiling this frame to avoid overriding the downward spike in wall bounce
  let hitCeilingThisFrame = false;
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
  // Ceiling collision: if moving upward into a span above, clamp to its bottom and spike downward
  if (p.vy > 0.0){
    const cH = ceilingHeightAt(p.x, p.z, p.y);
    if (isFinite(cH)){
      const eps = 1e-4;
      if (newY >= cH - eps){
        newY = cH - eps;
        // Apply same downward spike used for BAD ceiling hits in normal mode
        const CEIL_SPIKE_DOWN = 4.0;
        p.vy = -CEIL_SPIKE_DOWN;
        p.grounded = false;
        hitCeilingThisFrame = true;
      }
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
    let spanList = Array.isArray(spans) && spans.length ? spans.slice() : [];
    // Merge in default-map columns
    try {
      if (columnHeights.has(key)){
        let b = 0; let h = columnHeights.get(key) || 0;
        try {
          if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
          else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
        } catch(_){ }
        if (h > 0) spanList.push({ b: b|0, h: h|0 });
      }
    } catch(_){ }
    // Include ground wall/bad to match lateral collision with ground height logic
    {
      const cv = map[mapIdx(gx,gz)];
      if (cv === TILE.WALL){ spanList.push({ b: 0, h: 1 }); }
  else if (cv === TILE.HALF){ spanList.push({ b: 0, h: 0.5 }); }
      else if (cv === TILE.BAD){ spanList.push({ b: 0, h: 1, t: 1 }); }
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
    // Smaller upward nudge on wall bounce; but don't cancel a ceiling spike this frame
    if (!hitCeilingThisFrame) p.vy = Math.max(p.vy, 1.0);
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
