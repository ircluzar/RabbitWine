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
  // Detect if this cell's spans are purely non-solid markers so synthesized columns should not be treated solid
  const spansAllNonSolidGH = Array.isArray(spans) && spans.length>0 && spans.every(s => {
    if (!s) return false; const t=((s.t|0)||0);
    return (t===2 || t===3 || t===5 || t===6);
  });
  /** @type {Array<{b:number,h:number}>} */
  let spanList = Array.isArray(spans) ? spans.slice() : [];
  // Remove fence spans (t==2/t==3), portal spans (t==5), and Lock spans (t==6) from ground computation; they are non-solid visuals
  spanList = spanList.filter(s => s && ((((s.t|0)||0) !== 2) && (((s.t|0)||0) !== 3) && (((s.t|0)||0) !== 5) && (((s.t|0)||0) !== 6)));
  // Rail-platform candidate from inner voxels (center cross) when within band
  let railGroundCandidate = -Infinity;
  try {
    const RAIL_HW = 0.11;
    const cellMinX = gx - MAP_W*0.5;
    const cellMinZ = gz - MAP_H*0.5;
    const lx = x - cellMinX;
    const lz = z - cellMinZ;
    const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
    const centerHit = (inBand(lz,0.5,RAIL_HW) || inBand(lx,0.5,RAIL_HW));
  if (centerHit && Array.isArray(spans)){
      const py = (state && state.player) ? state.player.y : 0.0;
      for (const s of spans){
    if (!s) continue; const t=((s.t|0)||0); if (!(t===2||t===3)) continue; const b=(s.b|0), h=(s.h|0); if (h<=0) continue;
        // Consider top faces of each voxel within this fence span
        const topMost = b + h; // exclusive top
        const maxLv = topMost - 1;
        for (let lv=b; lv<=maxLv; lv++){
          const top = lv + 1; // top face
          if (top <= py + 1e-6 && top > railGroundCandidate) railGroundCandidate = top;
        }
      }
    }
  } catch(_){ }
  // Always also synthesize from columnHeights/bases so default map blocks are respected even with server spans present
  try {
  // Do not synthesize a full column for fence tiles (FENCE/BADFENCE) or when spans are all non-solid markers
  // (e.g., only portal/lock/fence spans exist). Only inner rails should affect collisions/ground in such cases.
  const _cvGH = map[mapIdx(gx,gz)];
  if (_cvGH !== TILE.FENCE && _cvGH !== TILE.BADFENCE && !spansAllNonSolidGH && typeof columnHeights !== 'undefined' && columnHeights && columnHeights.has(key)){
      let b = 0; let h = columnHeights.get(key) || 0;
      try {
        if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
        else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
      } catch(_){ }
      if (h > 0) spanList.push({ b: b|0, h: h|0 });
    }
  } catch(_){ }
  // Always include ground wall/half as span if map tile is WALL/HALF/NOCLIMB (BAD handled via spans)
  const cellValGH = map[mapIdx(gx,gz)];
  const isGroundWall = (cellValGH === TILE.WALL) || (cellValGH === TILE.NOCLIMB);
  const isGroundHalf = (cellValGH === TILE.HALF);
  const isGroundFence = (cellValGH === TILE.FENCE) || (cellValGH === TILE.BADFENCE);
  if (isGroundWall){ spanList.push({ b: 0, h: 1 }); }
  else if (isGroundHalf){ spanList.push({ b: 0, h: 0.5 }); }
  else if (isGroundFence){ /* fences are thin; do not affect ground height */ }
  const py = state.player ? state.player.y : 0.0;
  if (spanList.length){
    let best = 0.0;
    for (const s of spanList){
      if (!s) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
      const top = b + h; if (top <= py + 1e-6 && top > best) best = top;
    }
    if (railGroundCandidate > best) best = railGroundCandidate;
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
  if (map[mapIdx(gx,gz)] !== TILE.FENCE && map[mapIdx(gx,gz)] !== TILE.BADFENCE && columnHeights.has(key) && !spansAllNonSolidGH){
    const h = columnHeights.get(key) || 0.0;
    const b = getBaseFor(key);
    if (py >= b + h - 1e-6) return b + h;
  }
  // As last resort, if a rail platform exists below and no solids, allow standing on it
  if (railGroundCandidate !== -Infinity) return railGroundCandidate;
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
        // Skip non-solid visuals
        if (h<=0 || t===2 || t===3 || t===5 || t===6) continue;
        const top = b + h;
        if (top > py + 1e-6 && (top - py) <= (maxRise + 1e-6)) candidates.push(top);
      }
    }
  } catch(_){ }
  // From fence inner rails (center bands only) as narrow platforms
  try {
    const key = `${gx},${gz}`;
    let spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
              : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
              : null;
    const RAIL_HW = 0.11;
    const cellMinX = gx - MAP_W*0.5;
    const cellMinZ = gz - MAP_H*0.5;
    const lx = x - cellMinX;
    const lz = z - cellMinZ;
    const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
  if (Array.isArray(spans) && (inBand(lz,0.5,RAIL_HW) || inBand(lx,0.5,RAIL_HW))){
      for (const s of spans){
    if (!s) continue; const t=((s.t|0)||0); if (!(t===2||t===3)) continue; const b=(s.b|0), h=(s.h|0); if (h<=0) continue;
        const topMost = b + h; const maxLv = topMost - 1;
        for (let lv=b; lv<=maxLv; lv++){
          const top = lv + 1;
          if (top > py + 1e-6 && (top - py) <= (maxRise + 1e-6)) candidates.push(top);
        }
      }
    }
  } catch(_){ }
  // From map tile at ground level
  try {
    const cv = map[mapIdx(gx,gz)];
    if (cv === TILE.WALL || cv === TILE.BAD || cv === TILE.NOCLIMB){ const top=1.0; if (top > py + 1e-6 && (top - py) <= (maxRise + 1e-6)) candidates.push(top); }
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
  const spansAllNonSolidCH = Array.isArray(spans) && spans.length>0 && spans.every(s => { if (!s) return false; const t=((s.t|0)||0); return (t===2||t===3||t===5||t===6); });
  /** @type {Array<{b:number,h:number}>} */
  let spanList = Array.isArray(spans) ? spans.slice() : [];
  // Remove fence spans (t==2/t==3), portal spans (t==5), and Lock spans (t==6) from ceiling computation; they are non-solid visuals
  spanList = spanList.filter(s => s && ((((s.t|0)||0) !== 2) && (((s.t|0)||0) !== 3) && (((s.t|0)||0) !== 5) && (((s.t|0)||0) !== 6)));
  // Rail-platform ceilings (bottom faces) only if in inner center bands to avoid sudden clips
  let railCeilCandidate = Infinity;
  try {
    const RAIL_HW = 0.11;
    const cellMinX = gx - MAP_W*0.5;
    const cellMinZ = gz - MAP_H*0.5;
    const lx = x - cellMinX;
    const lz = z - cellMinZ;
    const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
    const centerHit = (inBand(lz,0.5,RAIL_HW) || inBand(lx,0.5,RAIL_HW));
  if (centerHit && Array.isArray(spans)){
      for (const s of spans){
    if (!s) continue; const t=((s.t|0)||0); if (!(t===2||t===3)) continue; const b=(s.b|0), h=(s.h|0); if (h<=0) continue;
        // Consider bottom faces of each voxel within this fence span
        const topMost = b + h; // exclusive top
        for (let lv=b; lv<topMost; lv++){
          const bottom = lv; // bottom face
          if (bottom > py + 1e-6 && bottom < railCeilCandidate) railCeilCandidate = bottom;
        }
      }
    }
  } catch(_){ }
  // Always also synthesize from column data so default map blocks are respected
  try {
  const _cvCH = map[mapIdx(gx,gz)];
  if (_cvCH !== TILE.FENCE && _cvCH !== TILE.BADFENCE && !spansAllNonSolidCH && typeof columnHeights !== 'undefined' && columnHeights && columnHeights.has(key)){
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
  else if (cv === TILE.FENCE || cv === TILE.BADFENCE){ /* handled in lateral collision as thin rods */ }
  }
  // For BADFENCE map tiles, approximate voxel-rail ceilings when inside inner bands.
  // This lets upward motion detect a ceiling even without spans.
  try {
    const cvCH2 = map[mapIdx(gx,gz)];
    if (cvCH2 === TILE.BADFENCE){
      const RAIL_HW = 0.11;
      const cellMinX = gx - MAP_W*0.5;
      const cellMinZ = gz - MAP_H*0.5;
      const lx = x - cellMinX;
      const lz = z - cellMinZ;
      const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
      const centerHit = (inBand(lz,0.5,RAIL_HW) || inBand(lx,0.5,RAIL_HW));
      if (centerHit){
        // Rails drawn at ~y rows 0,1,2 (and sometimes 3,4). Use conservative set above py.
        const railBottoms = [0.3, 0.6, 0.9, 1.2];
        for (let i=0;i<railBottoms.length;i++){
          const bottom = railBottoms[i];
          if (bottom > py + 1e-6 && bottom < railCeilCandidate) railCeilCandidate = bottom;
        }
      }
    }
  } catch(_){ }
  if (!spanList.length) return railCeilCandidate;
  let best = Infinity;
  const eps = 1e-6;
  for (const s of spanList){
    if (!s) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
    if (b > py + eps && b < best) best = b;
  }
  return Math.min(best, railCeilCandidate);
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
  // Helper: is the player inside a Lock span (t:6) at current grid cell and Y
  function isInsideLockAt(gx, gz, py){
    if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return false;
    const key = `${gx},${gz}`;
    try {
      const spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
                   : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
                   : null;
      if (Array.isArray(spans)){
        for (const s of spans){ if (!s) continue; const t=((s.t|0)||0); if (t!==6) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue; const top=b+h; if (py >= b && py <= top - 0.02) return true; }
      }
    } catch(_){ }
    return false;
  }
  // Camera: when inside a Lock span, force Locked mode; revert when not
  try {
    const gxCam = Math.floor(p.x + MAP_W*0.5);
    const gzCam = Math.floor(p.z + MAP_H*0.5);
    const inLockNow = isInsideLockAt(gxCam, gzCam, p.y);
    const was = !!state._inLockNow;
    state._inLockNow = !!inLockNow;
    if (inLockNow && !was){
      // Entering Lock: force Locked camera mode and Fixed control scheme
      // Preserve user's prior preferences to restore on exit
      try {
        if (typeof state._prevAltBottomControlLocked === 'undefined') state._prevAltBottomControlLocked = !!state.altBottomControlLocked;
        if (typeof state._prevLockCameraYaw === 'undefined') state._prevLockCameraYaw = !!state.lockCameraYaw;
      } catch(_){ }
      state.lockedCameraForced = true;
      state.altBottomControlLocked = true;
      state.lockCameraYaw = true;
      try { if (typeof window.setAltLockButtonIcon === 'function') window.setAltLockButtonIcon(); } catch(_){ }
      try { if (typeof window.setCameraStatusLabel === 'function') window.setCameraStatusLabel(); } catch(_){ }
      // If entering a Lock on a border cell, auto-face the camera inward if misaligned
      try {
        const maxGX = (MAP_W|0) - 1;
        const maxGZ = (MAP_H|0) - 1;
        const onBorder = (gxCam === 0 || gxCam === maxGX || gzCam === 0 || gzCam === maxGZ);
        if (onBorder){
          // Face outward: choose the cardinal that points toward the boundary
          // we are touching (west/east/north/south). This ignores player facing
          // and uses current yaw only to break ties at corners.
          const cands = [];
          // Outward cardinals (radians): 0=N, +PI/2=E, PI=S, -PI/2=W
          if (gxCam === 0) cands.push(-Math.PI/2);      // west edge -> face west
          if (gxCam === maxGX) cands.push(Math.PI/2);   // east edge -> face east
          if (gzCam === 0) cands.push(0.0);             // north edge -> face north
          if (gzCam === maxGZ) cands.push(Math.PI);     // south edge -> face south
          const norm = (a)=>{ a = a % (Math.PI*2); if (a > Math.PI) a -= Math.PI*2; if (a < -Math.PI) a += Math.PI*2; return a; };
          const cur = state.camYaw || 0.0;
          // Pick the candidate closest to current yaw to avoid jarring spins at corners
          let best = cands[0];
          let bestDiff = Math.abs(norm(best - cur));
          for (let i=1;i<cands.length;i++){
            const d = Math.abs(norm(cands[i] - cur));
            if (d < bestDiff){ best = cands[i]; bestDiff = d; }
          }
          // Apply only if sufficiently different
          const TH = 10 * Math.PI/180; // 10 degrees
          if (best !== undefined && bestDiff > TH){ state.camYaw = norm(best); }
        }
      } catch(_){ }
    } else if (!inLockNow && was){
      // Exiting Lock: revert to Fixed camera mode
      state.lockedCameraForced = false;
      // Restore user's prior preferences if available; otherwise leave as-is
      try {
        if (typeof state._prevAltBottomControlLocked !== 'undefined'){
          state.altBottomControlLocked = !!state._prevAltBottomControlLocked;
        }
        if (typeof state._prevLockCameraYaw !== 'undefined'){
          state.lockCameraYaw = !!state._prevLockCameraYaw;
        }
      } catch(_){ }
      // Clear the stored preferences to avoid stale carryover across future locks
      try { delete state._prevAltBottomControlLocked; delete state._prevLockCameraYaw; } catch(_){ }
      try { if (typeof window.setAltLockButtonIcon === 'function') window.setAltLockButtonIcon(); } catch(_){ }
      try { if (typeof window.setCameraStatusLabel === 'function') window.setCameraStatusLabel(); } catch(_){ }
    }
  } catch(_){ }
  const baseSpeed = 3.0;
  const seamMax = baseSpeed; // seam scaling removed
  const wasDashing = !!p.isDashing;
  // Target speed depends on mode
  let targetSpeed = (p.movementMode === 'accelerate') ? seamMax : 0.0;
  // If frozen, speed is forced 0 (already set in controls but keep safe)
  if (p.isFrozen) targetSpeed = 0.0;
  // If dashing, lock to 125% of max speed
  if (p.isDashing) targetSpeed = baseSpeed * 1.25;
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
  let lastHitNoClimb = false;   // set when the blocking solid was a NOCLIMB ground tile
  let lastHitFenceRailDir = null; // 'N'|'S'|'E'|'W' when rail hit
  let collidedFenceRail = false; // aggregated when a move is finally blocked
  let collidedSolidSpan = false; // aggregated when a move is finally blocked
  let collidedNoClimb = false;   // aggregated NOCLIMB contact across axis checks
  // Resolution targets to pop out of thin rail voxels toward center
  let lastResolveX = null; // world X to snap to if X is blocked by a rail
  let lastResolveZ = null; // world Z to snap to if Z is blocked by a rail
  let newX = p.x + stepX;
  let newZ = p.z + stepZ;
  // Limit rail snapping per axis to at most once per frame
  let snappedXThisFrame = false;
  let snappedZThisFrame = false;
  function isWallAt(wx, wz){
    // reset per-call flag
    lastHitFenceRail = false;
  lastHitSolidSpan = false;
  lastHitNoClimb = false;
  lastHitFenceRailDir = null;
  lastResolveX = null;
  lastResolveZ = null;
    const gx = Math.floor(wx + MAP_W*0.5);
    const gz = Math.floor(wz + MAP_H*0.5);
    if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return true;
    const key = `${gx},${gz}`;
    // Local cell-space coordinates (0..1) inside this tile
    const cellMinX = gx - MAP_W*0.5;
    const cellMinZ = gz - MAP_H*0.5;
    const lx = wx - cellMinX;
    const lz = wz - cellMinZ;
  const RAIL_HW = 0.11; // half-width of rail collision band around center and edge
  const RAIL_MARGIN = 0.004; // toned down push-out margin to reduce aggressive snaps
  const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
    const setResolveForRail = (orient /* 'E'|'W'|'N'|'S' */)=>{
      const eps = 0.002;
      if (orient==='E' || orient==='W'){
        // Rail runs along X, push Z out of the band around center
        if (lz < 0.5) lastResolveZ = cellMinZ + (0.5 - (RAIL_HW + RAIL_MARGIN)); else lastResolveZ = cellMinZ + (0.5 + (RAIL_HW + RAIL_MARGIN));
      } else if (orient==='N' || orient==='S'){
        // Rail runs along Z, push X out of the band around center
        if (lx < 0.5) lastResolveX = cellMinX + (0.5 - (RAIL_HW + RAIL_MARGIN)); else lastResolveX = cellMinX + (0.5 + (RAIL_HW + RAIL_MARGIN));
      }
    };
    // Collide if any span overlaps player Y; prefer explicit spans, else synthesize from column data and map tile
    let spans = null;
    try {
      spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
            : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
            : null;
    } catch(_){ spans = null; }
  /** @type {Array<{b:number,h:number,t?:number}>} */
  let spanList = [];
  if (Array.isArray(spans) && spans.length) spanList = spans.slice();
  const spansAllNonSolidLW = Array.isArray(spans) && spans.length>0 && spans.every(s => { if (!s) return false; const t=((s.t|0)||0); return (t===2||t===3||t===5||t===6); });
    // Always merge in default-map columns (but skip FENCE/BADFENCE tiles; they use inner voxels)
    try {
      const _cvLW = map[mapIdx(gx,gz)];
      if (_cvLW !== TILE.FENCE && _cvLW !== TILE.BADFENCE && !spansAllNonSolidLW && columnHeights.has(key)){
        let b = 0; let h = columnHeights.get(key) || 0;
        try {
          if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
          else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
        } catch(_){ }
    if (h > 0) spanList.push({ b: b|0, h: h|0 });
      }
    } catch(_){ }
  // Always include ground-level WALL/HALF/BAD/NOCLIMB tile as solid span so lateral collision matches ground height logic
    {
      const cell = map[mapIdx(gx,gz)];
      if (cell === TILE.WALL){ spanList.push({ b: 0, h: 1 }); }
      else if (cell === TILE.HALF){ spanList.push({ b: 0, h: 0.5 }); }
      else if (cell === TILE.BAD){ spanList.push({ b: 0, h: 1, t: 1 }); }
      else if (cell === TILE.NOCLIMB){ spanList.push({ b: 0, h: 1, t: 9 }); /* mark with t:9 to track NOCLIMB */ }
    }
  if (Array.isArray(spanList) && spanList.length){
      const py = state.player.y;
  for (const s of spanList){
    if (!s) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
    const top = b + h; const t = ((s.t|0)||0);
    // Portal spans (t==5) are triggers, not solids; do not block laterally here
    if (t === 5 || t === 6) { continue; }
    // Solid spans (non-fence) use strict vertical check (unchanged)
  if (t !== 2 && t !== 3){ if (py >= b && py <= top - 0.02) { lastHitSolidSpan = true; if (t===9) lastHitNoClimb = true; return true; } else { continue; } }
  // Fence spans (t==2 or t==3): voxel-accurate rails with a small vertical tolerance
        {
          const V_EPS = 0.04; // slightly tighter to reduce zip-ups
          if (!(py >= (b - V_EPS) && py <= (top - 0.02 + V_EPS))) continue;
          // Determine the integral level for connectivity (renderer uses integer lv slices)
          const lv = Math.max(b|0, Math.min((top|0)-1, Math.floor(py)));
          // Central (inner) rails inside the current cell: thin cross through center
          // Z-centered rail along X direction
          if (inBand(lz, 0.5, RAIL_HW)) { lastHitFenceRail = true; lastHitFenceRailDir = 'E'; setResolveForRail('E'); return true; }
          // X-centered rail along Z direction
          if (inBand(lx, 0.5, RAIL_HW)) { lastHitFenceRail = true; lastHitFenceRailDir = 'N'; setResolveForRail('N'); return true; }
          const hasFenceAtLevel = (x,y,level)=>{
            const k = `${x},${y}`; const sp = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(k) : null;
            if (!Array.isArray(sp)) return false; for (const ss of sp){ if (!ss) continue; const bb=(ss.b|0), hh=(ss.h|0), tt=((ss.t|0)||0); if ((tt===2 || tt===3) && hh>0 && level>=bb && level<bb+hh) return true; }
            return false;
          };
          const hasSolidAtLevel = (x,y,level)=>{
            const k = `${x},${y}`; const sp = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(k) : null;
            if (Array.isArray(sp)){
              for (const ss of sp){ if (!ss) continue; const bb=(ss.b|0), hh=(ss.h|0), tt=((ss.t|0)||0); if (hh>0 && (tt!==2 && tt!==3 && tt!==5 && tt!==6) && level>=bb && level<bb+hh) return true; }
            }
            return false;
          };
          // Determine rail connections for this cell
      const cellTile = map[mapIdx(gx,gz)];
          // Ground-tile fence connectivity uses map tiles; elevated uses spans
      const connGround = (dx,dy)=>{
            const nx = gx+dx, ny=gz+dy; if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) return false;
            const neighbor = map[mapIdx(nx,ny)];
    // Treat the current cell as having a rail on its edges when it's a ground fence
    const currentIsFence = (cellTile===TILE.FENCE) || (cellTile===TILE.BADFENCE);
    return currentIsFence || (neighbor===TILE.FENCE)||(neighbor===TILE.BADFENCE)||(neighbor===TILE.WALL)||(neighbor===TILE.NOCLIMB)||(neighbor===TILE.BAD)||(neighbor===TILE.FILL)||(neighbor===TILE.HALF);
          };
          const connElev = (dx,dy)=>{
            const nx = gx+dx, ny=gz+dy; if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) return false;
      // Current cell has a fence span at this level by construction of this branch
      const currentHas = true;
      return currentHas || hasFenceAtLevel(nx,ny,lv) || hasSolidAtLevel(nx,ny,lv);
          };
          const connect = ((cellTile===TILE.FENCE || cellTile===TILE.BADFENCE) && b===0) ? connGround : connElev;
          // Test four edge rails (E,W,N,S) using narrow bands near tile edges
          // East edge: z near center AND x near 1.0
          if (connect(1,0) && inBand(lz,0.5,RAIL_HW) && inBand(lx,1.0,RAIL_HW)) { lastHitFenceRail = true; lastHitFenceRailDir='E'; setResolveForRail('E'); return true; }
          // West edge: z near center AND x near 0.0
          if (connect(-1,0) && inBand(lz,0.5,RAIL_HW) && inBand(lx,0.0,RAIL_HW)) { lastHitFenceRail = true; lastHitFenceRailDir='W'; setResolveForRail('W'); return true; }
          // North edge: x near center AND z near 0.0
          if (connect(0,-1) && inBand(lx,0.5,RAIL_HW) && inBand(lz,0.0,RAIL_HW)) { lastHitFenceRail = true; lastHitFenceRailDir='N'; setResolveForRail('N'); return true; }
          // South edge: x near center AND z near 1.0
          if (connect(0,1) && inBand(lx,0.5,RAIL_HW) && inBand(lz,1.0,RAIL_HW)) { lastHitFenceRail = true; lastHitFenceRailDir='S'; setResolveForRail('S'); return true; }
          // If no rail footprint intersects, do not block
        }
      }
      return false;
    }
  // Column with optional raised base (skip for FENCE/BADFENCE tiles)
  if (map[mapIdx(gx,gz)] !== TILE.FENCE && map[mapIdx(gx,gz)] !== TILE.BADFENCE && columnHeights.has(key) && !spansAllNonSolidLW){
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
  // No spans/columns: fallback to ground wall tile only (WALL, HALF and ground-level BAD/FENCE with voxel rails)
  const cv2 = map[mapIdx(gx,gz)];
  if (cv2 === TILE.WALL || cv2 === TILE.BAD){ if (state.player.y <= 1.0 - 0.02) { lastHitSolidSpan = true; return true; } else { return false; } }
  if (cv2 === TILE.NOCLIMB){ if (state.player.y <= 1.0 - 0.02) { lastHitSolidSpan = true; lastHitNoClimb = true; return true; } else { return false; } }
  if (cv2 === TILE.HALF){ if (state.player.y <= 0.5 - 0.02) { lastHitSolidSpan = true; return true; } else { return false; } }
  if (cv2 === TILE.FENCE || cv2 === TILE.BADFENCE){
    if (state.player.y >= -0.06 && state.player.y <= 1.5 - 0.02 + 0.06){
      // Voxel rail check like above using map-based connectivity
      const connect = (dx,dy)=>{
        const nx = gx+dx, ny=gz+dy; if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) return false;
        const neighbor = map[mapIdx(nx,ny)];
        return (neighbor===TILE.FENCE)||(neighbor===TILE.BADFENCE)||(neighbor===TILE.WALL)||(neighbor===TILE.NOCLIMB)||(neighbor===TILE.BAD)||(neighbor===TILE.FILL)||(neighbor===TILE.HALF);
      };
      if ( (connect(1,0) && inBand(lz,0.5,RAIL_HW) && inBand(lx,1.0,RAIL_HW)) ||
           (connect(-1,0) && inBand(lz,0.5,RAIL_HW) && inBand(lx,0.0,RAIL_HW)) ) {
        lastHitFenceRail = true; lastHitFenceRailDir = (lx > 0.5 ? 'E':'W'); setResolveForRail(lastHitFenceRailDir); return true;
      }
      if ( (connect(0,1) && inBand(lx,0.5,RAIL_HW) && inBand(lz,1.0,RAIL_HW)) ||
           (connect(0,-1) && inBand(lx,0.5,RAIL_HW) && inBand(lz,0.0,RAIL_HW)) ) {
        lastHitFenceRail = true; lastHitFenceRailDir = (lz > 0.5 ? 'S':'N'); setResolveForRail(lastHitFenceRailDir); return true;
      }
    }
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
      // Before treating as a collision, if the blocking cell contains a portal at this Y, trigger teleport
      {
        const nowSec = state.nowSec || (performance.now()/1000);
        if (!p._portalCooldownUntil || nowSec >= p._portalCooldownUntil){
          // Use the blocking cell, clamped to the grid, so border portals still trigger
          let gxCell = gxCur;
          let gzCell = gzNew;
          if (gxCell < 0) gxCell = 0; else if (gxCell >= (MAP_W|0)) gxCell = (MAP_W|0) - 1;
          if (gzCell < 0) gzCell = 0; else if (gzCell >= (MAP_H|0)) gzCell = (MAP_H|0) - 1;
          if (gxCell>=0&&gzCell>=0&&gxCell<MAP_W&&gzCell<MAP_H){
            let portalHit = false;
            const cvBlock = map[mapIdx(gxCell,gzCell)];
            if (cvBlock === TILE.LEVELCHANGE) portalHit = true;
            if (!portalHit){
              try {
                const keyB = `${gxCell},${gzCell}`;
                const spansB = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(keyB)
                              : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(keyB)
                              : null;
                if (Array.isArray(spansB)){
                  for (const s of spansB){ if (!s) continue; const t=((s.t|0)||0); if (t!==5) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue; const top=b+h; if (p.y >= b && p.y <= top - 0.02){ portalHit = true; break; } }
                }
              } catch(_){ }
            }
      if (portalHit){
              const keyB = `${gxCell},${gzCell}`;
              let dest = null;
              try { if (window.portalDestinations instanceof Map) dest = window.portalDestinations.get(keyB) || null; } catch(_){ }
      if (typeof dest === 'string' && dest){
  // Exit positioning: if this portal is on a world border, spawn at the opposite wall cell in the other map.
  // Keep player's facing; only use the wall inward normal if player's incoming dir points outward.
  let exDirX = (p.isDashing && typeof p._dashDirX==='number') ? p._dashDirX : Math.sin(p.angle);
  let exDirZ = (p.isDashing && typeof p._dashDirZ==='number') ? p._dashDirZ : -Math.cos(p.angle);
    let exGx = gxCell, exGz = gzCell;
  let nX = 0, nZ = 0; // inward normal
  if (gxCell === 0){ nX = -1; nZ = 0; exGx = (MAP_W|0) - 1; }
  else if (gxCell === (MAP_W|0)-1){ nX = 1; nZ = 0; exGx = 0; }
  else if (gzCell === 0){ nX = 0; nZ = -1; exGz = (MAP_H|0) - 1; }
  else if (gzCell === (MAP_H|0)-1){ nX = 0; nZ = 1; exGz = 0; }
  // If this was a border portal, ensure we move inward. Use player's dir unless it faces outward or is near-tangent.
  if (nX!==0 || nZ!==0){ const d = exDirX*nX + exDirZ*nZ; if (d <= 0.05){ exDirX = nX; exDirZ = nZ; } }
        const L = Math.hypot(exDirX, exDirZ) || 1; exDirX/=L; exDirZ/=L;
        const cx = exGx - MAP_W*0.5 + 0.5;
        const cz = exGz - MAP_H*0.5 + 0.5;
        const EXIT_DIST = 0.52;
        const outX = cx + exDirX * EXIT_DIST;
        const outZ2 = cz + exDirZ * EXIT_DIST;
                // Snapshot movement/physics state and restore after level switch
                const keep = {
                  angle: p.angle,
                  speed: p.speed,
                  movementMode: p.movementMode,
                  vy: p.vy,
                  grounded: p.grounded,
                  isDashing: !!p.isDashing,
                  dashUsed: !!p.dashUsed,
                  dashTime: p.dashTime,
                  _dashDirX: p._dashDirX,
                  _dashDirZ: p._dashDirZ,
                  isFrozen: !!p.isFrozen,
                  isBallMode: !!p.isBallMode,
                  _ballVX: p._ballVX,
                  _ballVZ: p._ballVZ,
                  _ballBouncesLeft: p._ballBouncesLeft,
                  _ballSpinAxisX: p._ballSpinAxisX,
                  _ballSpinAxisY: p._ballSpinAxisY,
                  _ballSpinAxisZ: p._ballSpinAxisZ,
                  _ballSpinSpeed: p._ballSpinSpeed,
                };
                try { if (typeof window.mpSwitchLevel === 'function') window.mpSwitchLevel(dest); else if (typeof window.setLevel==='function' && typeof window.parseLevelGroupId==='function'){ window.setLevel(window.parseLevelGroupId(dest)); } } catch(_){ }
                // Restore movement/physics state and place player at computed exit
                p.angle = keep.angle;
                p.x = outX; p.z = outZ2;
                // Preserve vertical motion; only clamp up to ground if below it
                try {
                  const gH2 = groundHeightAt(p.x, p.z);
                  if (p.y < gH2 - 1e-3){ p.y = gH2; if ((keep.vy||0) < 0) keep.vy = 0; }
                } catch(_){ }
                p.vy = (typeof keep.vy==='number') ? keep.vy : p.vy;
                p.grounded = !!keep.grounded;
                p.speed = (typeof keep.speed==='number') ? keep.speed : p.speed;
                if (keep.movementMode) p.movementMode = keep.movementMode;
                p.isDashing = keep.isDashing; p.dashUsed = keep.dashUsed; p.dashTime = keep.dashTime||0;
                p._dashDirX = keep._dashDirX; p._dashDirZ = keep._dashDirZ;
                p.isFrozen = keep.isFrozen;
                p.isBallMode = keep.isBallMode;
                p._ballVX = keep._ballVX; p._ballVZ = keep._ballVZ; p._ballBouncesLeft = keep._ballBouncesLeft;
                p._ballSpinAxisX = keep._ballSpinAxisX; p._ballSpinAxisY = keep._ballSpinAxisY; p._ballSpinAxisZ = keep._ballSpinAxisZ; p._ballSpinSpeed = keep._ballSpinSpeed;
                p._portalCooldownUntil = nowSec + 0.6;
                try { if (window.sfx) sfx.play('./sfx/VRUN_Teleport.mp3'); } catch(_){ }
                return;
              }
            }
          }
        }
      }
  const zRailHit = lastHitFenceRail; const zSolidHit = lastHitSolidSpan; const zRailDir = lastHitFenceRailDir; const zNoClimbHit = lastHitNoClimb;
  // Preserve resolution target before any further collision checks overwrite it
  const zResolveTarget = lastResolveZ;
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
  newZ = p.z; hitWall = true; collidedFenceRail = collidedFenceRail || zRailHit; collidedSolidSpan = collidedSolidSpan || zSolidHit; collidedNoClimb = collidedNoClimb || zNoClimbHit;
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
          // If we have a safe resolution target along Z, snap to it conservatively
          const SNAP_MIN_PEN = 0.006; // require meaningful penetration before snapping
          if (!snappedZThisFrame && zResolveTarget !== null) {
            const dz = Math.abs(p.z - zResolveTarget);
            if (dz > SNAP_MIN_PEN && !isWallAt(p.x, zResolveTarget)) {
              p.z = zResolveTarget;
              snappedZThisFrame = true;
            }
          }
        }
      }
      // If collided with a hazardous rail at this cell and within bounds, trigger damage like BAD
      if (!outZ){
        const gxCell = gxCur; const gzCell = gzNew;
        const cellTile = (gxCell>=0&&gzCell>=0&&gxCell<MAP_W&&gzCell<MAP_H) ? map[mapIdx(gxCell,gzCell)] : -1;
        // Hazard if ground-tile is BADFENCE or if any span at this cell covering current Y is t==3
        let spanHazard = false;
        try {
          const key = `${gxCell},${gzCell}`; const spans = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(key) : null;
          if (Array.isArray(spans)){
            for (const s of spans){ if (!s) continue; const b=(s.b|0), h=(s.h|0), t=((s.t|0)||0); if (t===3 && h>0 && p.y >= b && p.y <= (b+h - 0.02)){ spanHazard = true; break; } }
          }
        } catch(_){ }
        if (zRailHit && ((cellTile === TILE.BADFENCE) || spanHazard)){
          const n = { nx: 0, nz: (Math.sign(dirZ) > 0 ? -1 : 1) };
          enterBallMode(n, { downward: false });
          p.x = oldX; p.z = oldZ;
          return;
        }
      }
      // Only trigger damage/ball mode if we attempted to go outside the grid
      if (outZ){
        // Suppress boundary damage if currently inside a Lock span
        try {
          const gxCell = Math.floor(p.x + MAP_W*0.5);
          const gzCell = Math.floor(p.z + MAP_H*0.5);
          if (isInsideLockAt(gxCell, gzCell, p.y)){
            p.x = oldX; p.z = oldZ; return; // cancel damage and stay within bounds
          }
        } catch(_){ }
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
      // Before treating as a collision, if the blocking cell contains a portal at this Y, trigger teleport
      {
        const nowSec = state.nowSec || (performance.now()/1000);
        if (!p._portalCooldownUntil || nowSec >= p._portalCooldownUntil){
          // Use the blocking cell, clamped to the grid, so border portals still trigger
          let gxCell = gxNew;
          let gzCell = gzCur;
          if (gxCell < 0) gxCell = 0; else if (gxCell >= (MAP_W|0)) gxCell = (MAP_W|0) - 1;
          if (gzCell < 0) gzCell = 0; else if (gzCell >= (MAP_H|0)) gzCell = (MAP_H|0) - 1;
          if (gxCell>=0&&gzCell>=0&&gxCell<MAP_W&&gzCell<MAP_H){
            let portalHit = false;
            const cvBlock = map[mapIdx(gxCell,gzCell)];
            if (cvBlock === TILE.LEVELCHANGE) portalHit = true;
            if (!portalHit){
              try {
                const keyB = `${gxCell},${gzCell}`;
                const spansB = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(keyB)
                              : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(keyB)
                              : null;
                if (Array.isArray(spansB)){
                  for (const s of spansB){ if (!s) continue; const t=((s.t|0)||0); if (t!==5) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue; const top=b+h; if (p.y >= b && p.y <= top - 0.02){ portalHit = true; break; } }
                }
              } catch(_){ }
            }
      if (portalHit){
              const keyB = `${gxCell},${gzCell}`;
              let dest = null;
              try { if (window.portalDestinations instanceof Map) dest = window.portalDestinations.get(keyB) || null; } catch(_){ }
      if (typeof dest === 'string' && dest){
  // Keep player's facing; only use inward normal at border if player facing is outward or tangent
  let exDirX = (p.isDashing && typeof p._dashDirX==='number') ? p._dashDirX : Math.sin(p.angle);
  let exDirZ = (p.isDashing && typeof p._dashDirZ==='number') ? p._dashDirZ : -Math.cos(p.angle);
  let exGx = gxCell, exGz = gzCell;
  let nX = 0, nZ = 0;
  if (gxCell === 0){ nX = -1; nZ = 0; exGx = (MAP_W|0) - 1; }
  else if (gxCell === (MAP_W|0)-1){ nX = 1; nZ = 0; exGx = 0; }
  else if (gzCell === 0){ nX = 0; nZ = -1; exGz = (MAP_H|0) - 1; }
  else if (gzCell === (MAP_H|0)-1){ nX = 0; nZ = 1; exGz = 0; }
  if (nX!==0 || nZ!==0){ const d = exDirX*nX + exDirZ*nZ; if (d <= 0.05){ exDirX = nX; exDirZ = nZ; } }
        const L = Math.hypot(exDirX, exDirZ) || 1; exDirX/=L; exDirZ/=L;
        const cx = exGx - MAP_W*0.5 + 0.5;
        const cz = exGz - MAP_H*0.5 + 0.5;
        const EXIT_DIST = 0.52;
        const outX2 = cx + exDirX * EXIT_DIST;
        const outZ3 = cz + exDirZ * EXIT_DIST;
                const keep = {
                  angle: p.angle,
                  speed: p.speed,
                  movementMode: p.movementMode,
                  vy: p.vy,
                  grounded: p.grounded,
                  isDashing: !!p.isDashing,
                  dashUsed: !!p.dashUsed,
                  dashTime: p.dashTime,
                  _dashDirX: p._dashDirX,
                  _dashDirZ: p._dashDirZ,
                  isFrozen: !!p.isFrozen,
                  isBallMode: !!p.isBallMode,
                  _ballVX: p._ballVX,
                  _ballVZ: p._ballVZ,
                  _ballBouncesLeft: p._ballBouncesLeft,
                  _ballSpinAxisX: p._ballSpinAxisX,
                  _ballSpinAxisY: p._ballSpinAxisY,
                  _ballSpinAxisZ: p._ballSpinAxisZ,
                  _ballSpinSpeed: p._ballSpinSpeed,
                };
                try { if (typeof window.mpSwitchLevel === 'function') window.mpSwitchLevel(dest); else if (typeof window.setLevel==='function' && typeof window.parseLevelGroupId==='function'){ window.setLevel(window.parseLevelGroupId(dest)); } } catch(_){ }
                p.angle = keep.angle;
                p.x = outX2; p.z = outZ3;
                try {
                  const gH2 = groundHeightAt(p.x, p.z);
                  if (p.y < gH2 - 1e-3){ p.y = gH2; if ((keep.vy||0) < 0) keep.vy = 0; }
                } catch(_){ }
                p.vy = (typeof keep.vy==='number') ? keep.vy : p.vy;
                p.grounded = !!keep.grounded;
                p.speed = (typeof keep.speed==='number') ? keep.speed : p.speed;
                if (keep.movementMode) p.movementMode = keep.movementMode;
                p.isDashing = keep.isDashing; p.dashUsed = keep.dashUsed; p.dashTime = keep.dashTime||0;
                p._dashDirX = keep._dashDirX; p._dashDirZ = keep._dashDirZ;
                p.isFrozen = keep.isFrozen;
                p.isBallMode = keep.isBallMode;
                p._ballVX = keep._ballVX; p._ballVZ = keep._ballVZ; p._ballBouncesLeft = keep._ballBouncesLeft;
                p._ballSpinAxisX = keep._ballSpinAxisX; p._ballSpinAxisY = keep._ballSpinAxisY; p._ballSpinAxisZ = keep._ballSpinAxisZ; p._ballSpinSpeed = keep._ballSpinSpeed;
                p._portalCooldownUntil = nowSec + 0.6;
                try { if (window.sfx) sfx.play('./sfx/VRUN_Teleport.mp3'); } catch(_){ }
                return;
              }
            }
          }
        }
      }
  const xRailHit = lastHitFenceRail; const xSolidHit = lastHitSolidSpan; const xRailDir = lastHitFenceRailDir; const xNoClimbHit = lastHitNoClimb;
  // Preserve resolution target before further checks
  const xResolveTarget = lastResolveX;
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
  newX = p.x; hitWall = true; collidedFenceRail = collidedFenceRail || xRailHit; collidedSolidSpan = collidedSolidSpan || xSolidHit; collidedNoClimb = collidedNoClimb || xNoClimbHit;
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
          // If we have a safe resolution target along X, snap to it conservatively
          const SNAP_MIN_PEN = 0.006;
          if (!snappedXThisFrame && xResolveTarget !== null) {
            const dx = Math.abs(p.x - xResolveTarget);
            if (dx > SNAP_MIN_PEN && !isWallAt(xResolveTarget, p.z)) {
              p.x = xResolveTarget;
              snappedXThisFrame = true;
            }
          }
        }
      }
      // If collided with a hazardous rail at this cell and within bounds, trigger damage like BAD
      if (!outX){
        const gxCell = gxNew; const gzCell = gzCur;
        const cellTile = (gxCell>=0&&gzCell>=0&&gxCell<MAP_W&&gzCell<MAP_H) ? map[mapIdx(gxCell,gzCell)] : -1;
        let spanHazard = false;
        try {
          const key = `${gxCell},${gzCell}`; const spans = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(key) : null;
          if (Array.isArray(spans)){
            for (const s of spans){ if (!s) continue; const b=(s.b|0), h=(s.h|0), t=((s.t|0)||0); if (t===3 && h>0 && p.y >= b && p.y <= (b+h - 0.02)){ spanHazard = true; break; } }
          }
        } catch(_){ }
        if (xRailHit && ((cellTile === TILE.BADFENCE) || spanHazard)){
          const n = { nx: (Math.sign(dirX) > 0 ? -1 : 1), nz: 0 };
          enterBallMode(n, { downward: false });
          p.x = oldX; p.z = oldZ;
          return;
        }
      }
      // Only trigger damage/ball mode if we attempted to go outside the grid
      if (outX){
        // Suppress boundary damage if currently inside a Lock span
        try {
          const gxCell = Math.floor(p.x + MAP_W*0.5);
          const gzCell = Math.floor(p.z + MAP_H*0.5);
          if (isInsideLockAt(gxCell, gzCell, p.y)){
            p.x = oldX; p.z = oldZ; return; // cancel damage and stay within bounds
          }
        } catch(_){ }
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
  const base2 = 3.0; const max2 = base2; if (p.speed > max2) p.speed = max2; return;
    }
  if (!state.player.canWallJump || collidedNoClimb) {
      // If walljump disabled, just cancel dash and stop against wall
      state.player.isDashing = false;
  const base2 = 3.0; const max2 = base2;
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
  const base2 = 3.0; const max2 = base2;
    if (p.speed > max2) p.speed = max2;
  // Ensure we keep moving after the wall-jump
  p.movementMode = 'accelerate';
    return;
  }

  if (p.canWallJump && !p.isDashing && hitWall && !p.grounded && p.vy > 0.0 && (p.wallJumpCooldown || 0) <= 0.0 && (p.y - (p.jumpStartY || 0)) >= 1.5) {
  // Prevent wall-jump if the blocking contact involved any fence or NOCLIMB
  if (collidedFenceRail || collidedNoClimb) { return; }
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

  // --- LEVELCHANGE portal trigger ---
  // If we are inside a LEVELCHANGE tile near ground level OR intersecting an elevated portal span (t:5), perform a level switch
  try {
    if (!p.isBallMode){
      const gx = Math.floor(p.x + MAP_W*0.5);
      const gz = Math.floor(p.z + MAP_H*0.5);
      if (gx>=0 && gz>=0 && gx<MAP_W && gz<MAP_H){
        const cv = map[mapIdx(gx,gz)];
        // Ground-level portal tile triggers
        let portalHit = (cv === TILE.LEVELCHANGE);
        // Elevated portal trigger: any span with t==5 that overlaps current Y
        if (!portalHit){
          try {
            const key = `${gx},${gz}`;
            const spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
                        : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
                        : null;
            if (Array.isArray(spans)){
              for (const s of spans){ if (!s) continue; const t=((s.t|0)||0); if (t!==5) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue; const top=b+h; if (p.y >= b && p.y <= top - 0.02){ portalHit = true; break; } }
            }
          } catch(_){ }
        }
        if (portalHit){
          const nowSec = state.nowSec || (performance.now()/1000);
          if (!p._portalCooldownUntil || nowSec >= p._portalCooldownUntil){
            const key = `${gx},${gz}`;
            let dest = null;
            try { if (window.portalDestinations instanceof Map) dest = window.portalDestinations.get(key) || null; } catch(_){ }
            if (typeof dest === 'string' && dest){
              // Snapshot movement/physics state so we can preserve feel across the switch
              const keep = {
                angle: p.angle,
                speed: p.speed,
                movementMode: p.movementMode,
                vy: p.vy,
                grounded: p.grounded,
                isDashing: !!p.isDashing,
                dashUsed: !!p.dashUsed,
                dashTime: p.dashTime,
                _dashDirX: p._dashDirX,
                _dashDirZ: p._dashDirZ,
                isFrozen: !!p.isFrozen,
                isBallMode: !!p.isBallMode,
                _ballVX: p._ballVX,
                _ballVZ: p._ballVZ,
                _ballBouncesLeft: p._ballBouncesLeft,
                _ballSpinAxisX: p._ballSpinAxisX,
                _ballSpinAxisY: p._ballSpinAxisY,
                _ballSpinAxisZ: p._ballSpinAxisZ,
                _ballSpinSpeed: p._ballSpinSpeed,
              };
              // Determine exit placement. If this is a border cell, spawn at the opposite wall cell
              // and ensure exit direction points inward (unless player already points sufficiently inward).
              const isBorder = (gx === 0 || gx === (MAP_W|0)-1 || gz === 0 || gz === (MAP_H|0)-1);
              let outX = 0, outZ = 0;
              if (isBorder){
                // Base direction on current facing or dash
                let exDirX = (p.isDashing && typeof p._dashDirX==='number') ? p._dashDirX : Math.sin(p.angle);
                let exDirZ = (p.isDashing && typeof p._dashDirZ==='number') ? p._dashDirZ : -Math.cos(p.angle);
                let exGx = gx, exGz = gz;
                let nX = 0, nZ = 0; // inward normal at opposite wall
                if (gx === 0){ nX = -1; nZ = 0; exGx = (MAP_W|0) - 1; }
                else if (gx === (MAP_W|0)-1){ nX = 1; nZ = 0; exGx = 0; }
                else if (gz === 0){ nX = 0; nZ = -1; exGz = (MAP_H|0) - 1; }
                else if (gz === (MAP_H|0)-1){ nX = 0; nZ = 1; exGz = 0; }
                // If incoming dir is outward or near-tangent, use inward normal instead
                if (nX!==0 || nZ!==0){ const d = exDirX*nX + exDirZ*nZ; if (d <= 0.05){ exDirX = nX; exDirZ = nZ; } }
                const L = Math.hypot(exDirX, exDirZ) || 1; exDirX/=L; exDirZ/=L;
                const cx = exGx - MAP_W*0.5 + 0.5;
                const cz = exGz - MAP_H*0.5 + 0.5;
                const EXIT_DIST = 0.52;
                outX = cx + exDirX * EXIT_DIST;
                outZ = cz + exDirZ * EXIT_DIST;
              } else {
                // Interior portal: step forward through the tile center
                let dirX = Math.sin(p.angle), dirZ = -Math.cos(p.angle);
                if (p.isDashing && typeof p._dashDirX === 'number' && typeof p._dashDirZ === 'number'){ dirX = p._dashDirX; dirZ = p._dashDirZ; }
                const L = Math.hypot(dirX, dirZ) || 1; dirX/=L; dirZ/=L;
                const cx = gx - MAP_W*0.5 + 0.5;
                const cz = gz - MAP_H*0.5 + 0.5;
                const EXIT_DIST = 0.52;
                outX = cx + dirX * EXIT_DIST;
                outZ = cz + dirZ * EXIT_DIST;
              }
              // Switch level first (clears world and requests server data)
              try { if (typeof window.mpSwitchLevel === 'function') window.mpSwitchLevel(dest); else if (typeof window.setLevel==='function' && typeof window.parseLevelGroupId==='function'){ window.setLevel(window.parseLevelGroupId(dest)); } } catch(_){ }
              // Restore movement/physics and place the player at computed exit
              p.angle = keep.angle;
              p.x = outX; p.z = outZ;
              // Preserve vertical motion; only clamp up to ground if below it
              try {
                const gH2 = groundHeightAt(p.x, p.z);
                if (p.y < gH2 - 1e-3){ p.y = gH2; if ((keep.vy||0) < 0) keep.vy = 0; }
              } catch(_){ }
              p.vy = (typeof keep.vy==='number') ? keep.vy : p.vy;
              p.grounded = !!keep.grounded;
              p.speed = (typeof keep.speed==='number') ? keep.speed : p.speed;
              if (keep.movementMode) p.movementMode = keep.movementMode;
              p.isDashing = keep.isDashing; p.dashUsed = keep.dashUsed; p.dashTime = keep.dashTime||0;
              p._dashDirX = keep._dashDirX; p._dashDirZ = keep._dashDirZ;
              p.isFrozen = keep.isFrozen;
              p.isBallMode = keep.isBallMode;
              p._ballVX = keep._ballVX; p._ballVZ = keep._ballVZ; p._ballBouncesLeft = keep._ballBouncesLeft;
              p._ballSpinAxisX = keep._ballSpinAxisX; p._ballSpinAxisY = keep._ballSpinAxisY; p._ballSpinAxisZ = keep._ballSpinAxisZ; p._ballSpinSpeed = keep._ballSpinSpeed;
              p._portalCooldownUntil = nowSec + 0.6;
              try { if (window.sfx) sfx.play('./sfx/VRUN_Teleport.mp3'); } catch(_){ }
            }
          }
        }
      }
    }
  } catch(_){ }
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
  const base = 3.0; const max = base;
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
            // BAD blocks (t==1) span top
            hazardous = spans.some(s => s && ((s.t|0)===1) && (((s.b|0)+(s.h|0))===topY));
            // BADFENCE rails (t==3): if we landed on a fence rail top at this cell within inner bands
            if (!hazardous){
              // Check inner cross bands around the tile center like lateral/ceiling logic
              const RAIL_HW = 0.11;
              const cellMinX = gx - MAP_W*0.5;
              const cellMinZ = gz - MAP_H*0.5;
              const lx = p.x - cellMinX;
              const lz = p.z - cellMinZ;
              const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
              const centerHit = (inBand(lz,0.5,RAIL_HW) || inBand(lx,0.5,RAIL_HW));
              if (centerHit){
                for (const s of spans){
                  if (!s) continue; const t=((s.t|0)||0); if (t!==3) continue; const b=(s.b|0), h=(s.h|0); if (h<=0) continue;
                  const topMost = b + h; // exclusive
                  for (let lv=b; lv<topMost; lv++){
                    const top = lv + 1; if (Math.abs(top - topY) <= 1e-3){ hazardous = true; break; }
                  }
                  if (hazardous) break;
                }
              }
            }
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
            // BADFENCE: if the tile is BADFENCE and we are within inner rail bands, treat as hazardous ceiling
            if (!hazardous && map[mapIdx(gx,gz)] === TILE.BADFENCE){
              try {
                const RAIL_HW = 0.11;
                const cellMinX = gx - MAP_W*0.5;
                const cellMinZ = gz - MAP_H*0.5;
                const lx = p.x - cellMinX;
                const lz = p.z - cellMinZ;
                const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
                if (inBand(lz,0.5,RAIL_HW) || inBand(lx,0.5,RAIL_HW)) hazardous = true;
              } catch(_){ }
            }
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
      // fences are handled voxel-accurately below
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
  // Helper: try teleport if a portal is present at a given cell at current Y; returns true if teleported
  function tryBallPortalAtCell(gxCell, gzCell, moveDirX, moveDirZ){
    if (gxCell<0||gzCell<0||gxCell>=MAP_W||gzCell>=MAP_H) return false;
    const nowSec = state.nowSec || (performance.now()/1000);
    if (p._portalCooldownUntil && nowSec < p._portalCooldownUntil) return false;
    let portalHit = false;
    const cv = map[mapIdx(gxCell,gzCell)];
    if (cv === TILE.LEVELCHANGE) portalHit = true;
    if (!portalHit){
      try {
        const key = `${gxCell},${gzCell}`;
        const spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
                    : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
                    : null;
        if (Array.isArray(spans)){
          for (const s of spans){ if (!s) continue; const t=((s.t|0)||0); if (t!==5) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue; const top=b+h; if (p.y >= b && p.y <= top - 0.02){ portalHit = true; break; } }
        }
      } catch(_){ }
    }
    if (!portalHit) return false;
    // Destination
    let dest = null; try { if (window.portalDestinations instanceof Map) dest = window.portalDestinations.get(`${gxCell},${gzCell}`) || null; } catch(_){ }
    if (typeof dest !== 'string' || !dest) return false;
    // Preserve full movement/physics including ball params
    const keep = {
      angle: p.angle,
      speed: p.speed,
      movementMode: p.movementMode,
      vy: p.vy,
      grounded: p.grounded,
      isDashing: !!p.isDashing,
      dashUsed: !!p.dashUsed,
      dashTime: p.dashTime,
      _dashDirX: p._dashDirX,
      _dashDirZ: p._dashDirZ,
      isFrozen: !!p.isFrozen,
      isBallMode: !!p.isBallMode,
      _ballVX: p._ballVX,
      _ballVZ: p._ballVZ,
      _ballBouncesLeft: p._ballBouncesLeft,
      _ballSpinAxisX: p._ballSpinAxisX,
      _ballSpinAxisY: p._ballSpinAxisY,
      _ballSpinAxisZ: p._ballSpinAxisZ,
      _ballSpinSpeed: p._ballSpinSpeed,
    };
    // Exit placement: border portals spawn at opposite wall and use inward normal if needed; interior step forward
    let exDirX = moveDirX, exDirZ = moveDirZ;
    const Ld = Math.hypot(exDirX, exDirZ) || 1; exDirX/=Ld; exDirZ/=Ld;
    const isBorder = (gxCell === 0 || gxCell === (MAP_W|0)-1 || gzCell === 0 || gzCell === (MAP_H|0)-1);
    let outX = 0, outZ = 0;
    if (isBorder){
      let exGx = gxCell, exGz = gzCell;
      let nX = 0, nZ = 0;
      if (gxCell === 0){ nX = -1; nZ = 0; exGx = (MAP_W|0) - 1; }
      else if (gxCell === (MAP_W|0)-1){ nX = 1; nZ = 0; exGx = 0; }
      else if (gzCell === 0){ nX = 0; nZ = -1; exGz = (MAP_H|0) - 1; }
      else if (gzCell === (MAP_H|0)-1){ nX = 0; nZ = 1; exGz = 0; }
      // If moving outward or too tangent, choose inward normal
      if (nX!==0 || nZ!==0){ const d = exDirX*nX + exDirZ*nZ; if (d <= 0.05){ exDirX = nX; exDirZ = nZ; } }
      const L = Math.hypot(exDirX, exDirZ) || 1; exDirX/=L; exDirZ/=L;
      const cx = exGx - MAP_W*0.5 + 0.5;
      const cz = exGz - MAP_H*0.5 + 0.5;
      const EXIT_DIST = 0.52;
      outX = cx + exDirX * EXIT_DIST;
      outZ = cz + exDirZ * EXIT_DIST;
    } else {
      const cx = gxCell - MAP_W*0.5 + 0.5;
      const cz = gzCell - MAP_H*0.5 + 0.5;
      const EXIT_DIST = 0.52;
      outX = cx + exDirX * EXIT_DIST;
      outZ = cz + exDirZ * EXIT_DIST;
    }
    try { if (typeof window.mpSwitchLevel === 'function') window.mpSwitchLevel(dest); else if (typeof window.setLevel==='function' && typeof window.parseLevelGroupId==='function'){ window.setLevel(window.parseLevelGroupId(dest)); } } catch(_){ }
    // Restore and place
    p.angle = keep.angle;
    p.x = outX; p.z = outZ;
    try {
      const gH2 = groundHeightAt(p.x, p.z);
      if (p.y < gH2 - 1e-3){ p.y = gH2; if ((keep.vy||0) < 0) keep.vy = 0; }
    } catch(_){ }
    p.vy = (typeof keep.vy==='number') ? keep.vy : p.vy;
    p.grounded = !!keep.grounded;
    p.speed = (typeof keep.speed==='number') ? keep.speed : p.speed;
    if (keep.movementMode) p.movementMode = keep.movementMode;
    p.isDashing = keep.isDashing; p.dashUsed = keep.dashUsed; p.dashTime = keep.dashTime||0;
    p._dashDirX = keep._dashDirX; p._dashDirZ = keep._dashDirZ;
    p.isFrozen = keep.isFrozen;
    p.isBallMode = keep.isBallMode;
    p._ballVX = keep._ballVX; p._ballVZ = keep._ballVZ; p._ballBouncesLeft = keep._ballBouncesLeft;
    p._ballSpinAxisX = keep._ballSpinAxisX; p._ballSpinAxisY = keep._ballSpinAxisY; p._ballSpinAxisZ = keep._ballSpinAxisZ; p._ballSpinSpeed = keep._ballSpinSpeed;
    p._portalCooldownUntil = nowSec + 0.6;
  try { if (window.sfx) sfx.play('./sfx/VRUN_Teleport.mp3'); } catch(_){ }
    return true;
  }
  function isWallAtXZ(wx, wz){
    // Voxel-accurate lateral collision for ball mode (matches fence renderer)
    const gx = Math.floor(wx + MAP_W*0.5);
    const gz = Math.floor(wz + MAP_H*0.5);
    if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return true; // treat border as wall
    const key = `${gx},${gz}`;
    // Local cell-space coordinates (0..1) inside this tile
    const cellMinX = gx - MAP_W*0.5;
    const cellMinZ = gz - MAP_H*0.5;
    const lx = wx - cellMinX;
    const lz = wz - cellMinZ;
  const RAIL_HW = 0.11;
  const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
    let spans = null;
    try {
      spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
            : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
            : null;
    } catch(_){ spans = null; }
  let spanList = Array.isArray(spans) && spans.length ? spans.slice() : [];
  const spansAllFenceBM = Array.isArray(spans) && spans.length>0 && spans.every(s => s && ((((s.t|0)||0) === 2) || (((s.t|0)||0) === 3)));
    // Merge in default-map columns (skip FENCE/BADFENCE tiles)
    try {
      const _cvBM = map[mapIdx(gx,gz)];
      if (_cvBM !== TILE.FENCE && _cvBM !== TILE.BADFENCE && columnHeights.has(key)){
        let b = 0; let h = columnHeights.get(key) || 0;
        try {
          if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
          else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
        } catch(_){ }
    if (h > 0) spanList.push({ b: b|0, h: h|0, ...(spansAllFenceBM ? { t: 2 } : {}) });
      }
    } catch(_){ }
    // Include ground wall/half/bad (fences handled separately)
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
  const top=b+h; const t=((s.t|0)||0);
    // Portal (t==5) and Lock (t==6) are non-solid; do not block in ball mode
  if (t === 5 || t === 6) { continue; }
    // Solid spans (non-fence) keep strict vertical check
  if (t !== 2 && t !== 3){ if (py > b - 0.02 && py < top - 0.02) return true; else continue; }
  // Fence spans: allow small vertical tolerance
  const V_EPS = 0.04; if (!(py > b - V_EPS && py < top - 0.02 + V_EPS)) continue;
    // Inner cross rails inside tile center
    if (inBand(lz,0.5,RAIL_HW)) return true;
    if (inBand(lx,0.5,RAIL_HW)) return true;
        // Fence spans: voxel rails only; determine integral level for connectivity
        const lv = Math.max(b|0, Math.min((top|0)-1, Math.floor(py)));
  const hasFenceAtLevel = (x,y,level)=>{
          const k = `${x},${y}`; const sp = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(k) : null;
          if (!Array.isArray(sp)) return false; for (const ss of sp){ if (!ss) continue; const bb=(ss.b|0), hh=(ss.h|0), tt=((ss.t|0)||0); if ((tt===2 || tt===3) && hh>0 && level>=bb && level<bb+hh) return true; }
          return false;
        };
        const hasSolidAtLevel = (x,y,level)=>{
          const k = `${x},${y}`; const sp = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(k) : null;
          if (Array.isArray(sp)){
            for (const ss of sp){ if (!ss) continue; const bb=(ss.b|0), hh=(ss.h|0), tt=((ss.t|0)||0); if (hh>0 && (tt!==2 && tt!==3 && tt!==5 && tt!==6) && level>=bb && level<bb+hh) return true; }
          }
          return false;
        };
  const connect = (dx,dy)=>{ const nx=gx+dx, ny=gz+dy; if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) return false; return hasFenceAtLevel(nx,ny,lv) || hasSolidAtLevel(nx,ny,lv); };
     if ( (connect(1,0) && inBand(lz,0.5,RAIL_HW) && inBand(lx,1.0,RAIL_HW)) ||
       (connect(-1,0) && inBand(lz,0.5,RAIL_HW) && inBand(lx,0.0,RAIL_HW)) ) return true;
     if ( (connect(0,1) && inBand(lx,0.5,RAIL_HW) && inBand(lz,1.0,RAIL_HW)) ||
       (connect(0,-1) && inBand(lx,0.5,RAIL_HW) && inBand(lz,0.0,RAIL_HW)) ) return true;
      }
    }
    // Fallback: no spans. Apply voxel rails for ground fence map tile
    const cv = map[mapIdx(gx,gz)];
  if ((cv === TILE.FENCE || cv === TILE.BADFENCE) && p.y >= -0.06 && p.y <= 1.5 - 0.02 + 0.06){
      const connect = (dx,dy)=>{
        const nx = gx+dx, ny=gz+dy; if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) return false;
        const neighbor = map[mapIdx(nx,ny)];
        return (neighbor===TILE.FENCE)||(neighbor===TILE.BADFENCE)||(neighbor===TILE.WALL)||(neighbor===TILE.BAD)||(neighbor===TILE.FILL)||(neighbor===TILE.HALF);
      };
   if ( (connect(1,0) && inBand(lz,0.5,RAIL_HW) && inBand(lx,1.0,RAIL_HW)) ||
     (connect(-1,0) && inBand(lz,0.5,RAIL_HW) && inBand(lx,0.0,RAIL_HW)) ) return true;
   if ( (connect(0,1) && inBand(lx,0.5,RAIL_HW) && inBand(lz,1.0,RAIL_HW)) ||
     (connect(0,-1) && inBand(lx,0.5,RAIL_HW) && inBand(lz,0.0,RAIL_HW)) ) return true;
    }
    return false;
  }
  // Try Z then X similar to normal collision for a simple normal estimate
  let nxTry = p.x, nzTry = p.z + stepZ;
  if (!isWallAtXZ(nxTry, nzTry)) { p.z = nzTry; } else {
    // Blocked along Z: if the blocking cell is a portal, teleport instead of bouncing
    let gxCell = Math.floor(p.x + MAP_W*0.5);
    let gzCell = Math.floor(nzTry + MAP_H*0.5);
    if (gxCell < 0) gxCell = 0; else if (gxCell >= (MAP_W|0)) gxCell = (MAP_W|0)-1;
    if (gzCell < 0) gzCell = 0; else if (gzCell >= (MAP_H|0)) gzCell = (MAP_H|0)-1;
    const dirX = stepX, dirZ = stepZ;
    if (tryBallPortalAtCell(gxCell, gzCell, dirX, dirZ)) return; // teleported
    p._ballVZ = -p._ballVZ * 0.45; bounced = true; nz = -Math.sign(stepZ);
  }
  nxTry = p.x + stepX; nzTry = p.z;
  if (!isWallAtXZ(nxTry, nzTry)) { p.x = nxTry; } else {
    // Blocked along X: if the blocking cell is a portal, teleport instead of bouncing
    let gxCell = Math.floor(nxTry + MAP_W*0.5);
    let gzCell = Math.floor(p.z + MAP_H*0.5);
    if (gxCell < 0) gxCell = 0; else if (gxCell >= (MAP_W|0)) gxCell = (MAP_W|0)-1;
    if (gzCell < 0) gzCell = 0; else if (gzCell >= (MAP_H|0)) gzCell = (MAP_H|0)-1;
    const dirX = stepX, dirZ = stepZ;
    if (tryBallPortalAtCell(gxCell, gzCell, dirX, dirZ)) return; // teleported
    p._ballVX = -p._ballVX * 0.45; bounced = true; nx = -Math.sign(stepX);
  }
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
  // Also allow in-place portal trigger when overlapping a portal span or LEVELCHANGE while in ball mode
  try {
    const gx = Math.floor(p.x + MAP_W*0.5);
    const gz = Math.floor(p.z + MAP_H*0.5);
    if (gx>=0 && gz>=0 && gx<MAP_W && gz<MAP_H){
      // Use current velocity as movement direction; fallback to angle if tiny
      let mdx = p._ballVX, mdz = p._ballVZ;
      const mv = Math.hypot(mdx, mdz);
      if (mv < 1e-4){ mdx = Math.sin(p.angle); mdz = -Math.cos(p.angle); }
      if (tryBallPortalAtCell(gx, gz, mdx, mdz)) return; // teleported
    }
  } catch(_){ }
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
