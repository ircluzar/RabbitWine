/**
 * Horizontal collision detection and resolution module
 * Extracted from moveAndCollide() - handles X and Z axis wall collisions
 * Part of Cycle 2 physics segmentation
 */

/**
 * Process horizontal movement (X and Z axes) with wall collision detection
 * @param {number} dt - Delta time in seconds
 * @param {object} p - Player object
 * @param {number} stepX - Intended X movement this frame
 * @param {number} stepZ - Intended Z movement this frame
 * @returns {object} Result containing { newX, newZ, hitWall, collidedFenceRail, collidedSolidSpan, collidedNoClimb, collidedWorldBoundary }
 */
function processHorizontalCollision(dt, p, stepX, stepZ) {
  // NOTE (2025-09): Added elevated NOCLIMB span detection (t:9) in classifyX/classifyZ so wall-jump gating
  // correctly blocks on NOCLIMB pillars. Previously only base tile value 9 set lastHitNoClimb; spans were missed.
  const oldX = p.x, oldZ = p.z;
  
  // Track collision source for wall-jump logic
  let lastHitFenceRail = false; // set by isWallAt() on its last evaluation
  let lastHitSolidSpan = false; // set when solid block/span caused return
  let lastHitNoClimb = false;   // set when the blocking solid was a NOCLIMB ground tile
  let lastHitWorldBoundary = false; // set when block cause was world boundary (out of map bounds treated as wall)
  let lastHitFenceRailDir = null; // 'N'|'S'|'E'|'W' when rail hit
  let collidedFenceRail = false; // aggregated when a move is finally blocked
  let collidedSolidSpan = false; // aggregated when a move is finally blocked
  let collidedNoClimb = false;   // aggregated NOCLIMB contact across axis checks
  let collidedWorldBoundary = false; // aggregated world boundary contact across axis checks
  
  // Resolution targets to pop out of thin rail voxels toward center
  let lastResolveX = null; // world X to snap to if X is blocked by a rail
  let lastResolveZ = null; // world Z to snap to if Z is blocked by a rail
  let newX = p.x + stepX;
  let newZ = p.z + stepZ;
  
  // Limit rail snapping per axis to at most once per frame
  let snappedXThisFrame = false;
  let snappedZThisFrame = false;
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

  // Helper: check if grid coordinates are at world border
  function isBorderCell(gx, gz){
    return (gx === 0 || gz === 0 || gx === (MAP_W|0)-1 || gz === (MAP_H|0)-1);
  }

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

  // Z-axis collision detection
  {
    const gxCur = Math.floor(p.x + MAP_W*0.5);
    const gzNew = Math.floor(newZ + MAP_H*0.5);
    const outZ = (gzNew < 0 || gzNew >= MAP_H);
    
    if (!isWallAt(p.x, newZ)) {
      p.z = newZ;
    } else {
      // Portal check before treating as collision
      if (!tryPortalAt(p.x, newZ, p, 'Z')) {
        // Determine collision classification for this attempted move
        (function classifyZ(){
          const gzNewCell = Math.floor(newZ + MAP_H*0.5);
          const gxCurCell = Math.floor(p.x + MAP_W*0.5);
          if (gzNewCell < 0 || gzNewCell >= MAP_H){
            lastHitWorldBoundary = true; return; }
          try {
            const tile = map[mapIdx(gxCurCell, gzNewCell)];
            if (tile === TILE.NOCLIMB) lastHitNoClimb = true;
            // FENCE/BADFENCE classification already handled elsewhere via lastHitFenceRail
            // NEW: detect elevated NOCLIMB spans (t:9) at this cell/height; previously only ground tile 9 set the flag.
            // Without this, walljump gating misses elevated noclimb pillars because isWallAt() still returns true for them.
            try {
              const keyNC = `${gxCurCell},${gzNewCell}`;
              const spansNC = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(keyNC)
                            : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(keyNC)
                            : null;
              if (Array.isArray(spansNC)){
                for (const s of spansNC){
                  if (!s) continue; const t=((s.t|0)||0); if (t!==9) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
                  const top=b+h; if (p.y >= b && p.y <= top - 0.02){ lastHitNoClimb = true; break; }
                }
              }
            } catch(_){ }
          } catch(_){ }
        })();
        const zRailHit = lastHitFenceRail; 
        const zSolidHit = lastHitSolidSpan; 
        const zRailDir = lastHitFenceRailDir; 
        const zNoClimbHit = lastHitNoClimb;
        const zWorldBoundaryHit = lastHitWorldBoundary;
        const zResolveTarget = lastResolveZ;
        
        // Attempt step-up onto small ledges
        let stepped = false;
        if (!outZ){
          stepped = tryStepUp(p.x, newZ, p, 0.5 + 1e-3);
        }
        
        if (!stepped){
          newZ = p.z; 
          hitWall = true; 
          collidedFenceRail = collidedFenceRail || zRailHit; 
          collidedSolidSpan = collidedSolidSpan || zSolidHit; 
          collidedNoClimb = collidedNoClimb || zNoClimbHit;
          collidedWorldBoundary = collidedWorldBoundary || zWorldBoundaryHit;
          
          // Rail collision nudging and snapping
          if (zRailHit && zRailDir){
            applyRailNudge(p, zRailDir, 0.02);
            applyRailSnap(p, zResolveTarget, 'Z', snappedZThisFrame);
          }
        }
        
        // Hazard collision checks
        handleHazardCollision(p, gxCur, gzNew, outZ, oldX, oldZ, Math.sin(p.angle), -Math.cos(p.angle), 'Z');
      }
    }
  }

  // X-axis collision detection
  {
    const gzCur = Math.floor(p.z + MAP_H*0.5);
    const gxNew = Math.floor(newX + MAP_W*0.5);
    const outX = (gxNew < 0 || gxNew >= MAP_W);
    
    if (!isWallAt(newX, p.z)) {
      p.x = newX;
    } else {
      // Portal check before treating as collision
      if (!tryPortalAt(newX, p.z, p, 'X')) {
        // Determine collision classification for this attempted move
        (function classifyX(){
          const gxNewCell = Math.floor(newX + MAP_W*0.5);
          const gzCurCell = Math.floor(p.z + MAP_H*0.5);
          if (gxNewCell < 0 || gxNewCell >= MAP_W){
            lastHitWorldBoundary = true; return; }
          try {
            const tile = map[mapIdx(gxNewCell, gzCurCell)];
            if (tile === TILE.NOCLIMB) lastHitNoClimb = true;
            // NEW: elevated NOCLIMB span detection (t:9) for X-axis attempt
            try {
              const keyNC = `${gxNewCell},${gzCurCell}`;
              const spansNC = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(keyNC)
                            : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(keyNC)
                            : null;
              if (Array.isArray(spansNC)){
                for (const s of spansNC){
                  if (!s) continue; const t=((s.t|0)||0); if (t!==9) continue; const b=(s.b||0), h=(s.h||0); if (h<=0) continue;
                  const top=b+h; if (p.y >= b && p.y <= top - 0.02){ lastHitNoClimb = true; break; }
                }
              }
            } catch(_){ }
          } catch(_){ }
        })();
        const xRailHit = lastHitFenceRail; 
        const xSolidHit = lastHitSolidSpan; 
        const xRailDir = lastHitFenceRailDir; 
        const xNoClimbHit = lastHitNoClimb;
        const xWorldBoundaryHit = lastHitWorldBoundary;
        const xResolveTarget = lastResolveX;
        
        // Attempt step-up onto small ledges
        let stepped = false;
        if (!outX){
          stepped = tryStepUp(newX, p.z, p, 0.5 + 1e-3);
        }
        
        if (!stepped){
          newX = p.x; 
          hitWall = true; 
          collidedFenceRail = collidedFenceRail || xRailHit; 
          collidedSolidSpan = collidedSolidSpan || xSolidHit; 
          collidedNoClimb = collidedNoClimb || xNoClimbHit;
          collidedWorldBoundary = collidedWorldBoundary || xWorldBoundaryHit;
          
          // Rail collision nudging and snapping
          if (xRailHit && xRailDir){
            applyRailNudge(p, xRailDir, 0.02);
            applyRailSnap(p, xResolveTarget, 'X', snappedXThisFrame);
          }
        }
        
        // Hazard collision checks
        handleHazardCollision(p, gxNew, gzCur, outX, oldX, oldZ, Math.sin(p.angle), -Math.cos(p.angle), 'X');
      }
    }
  }

  return {
    newX: p.x,
    newZ: p.z,
    hitWall,
    collidedFenceRail,
    collidedSolidSpan,
    collidedNoClimb,
    collidedWorldBoundary
  };

  // Helper functions
  function tryPortalAt(wx, wz, player, axis) {
    const nowSec = state.nowSec || (performance.now()/1000);
    if (player._portalCooldownUntil && nowSec < player._portalCooldownUntil) return false;
    
    const gx = Math.floor(wx + MAP_W*0.5);
    const gz = Math.floor(wz + MAP_H*0.5);
    let gxCell = gx, gzCell = gz;
    
    // Clamp to grid for border portals
    if (gxCell < 0) gxCell = 0; else if (gxCell >= MAP_W) gxCell = MAP_W - 1;
    if (gzCell < 0) gzCell = 0; else if (gzCell >= MAP_H) gzCell = MAP_H - 1;
    
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
            for (const s of spansB){ 
              if (!s) continue; 
              const t=((s.t|0)||0); 
              if (t!==5) continue; 
              const b=(s.b||0), h=(s.h||0); 
              if (h<=0) continue; 
              const top=b+h; 
              if (player.y >= b && player.y <= top - 0.02){ 
                portalHit = true; 
                break; 
              } 
            }
          }
        } catch(_){ }
      }
      
      if (portalHit){
        // Portal teleport logic
        const keyB = `${gxCell},${gzCell}`;
        let dest = null;
        try { 
          if (window.portalDestinations instanceof Map) 
            dest = window.portalDestinations.get(keyB) || null; 
        } catch(_){ }
        
        if (typeof dest === 'string' && dest){
          triggerPortalTeleport(player, dest, gxCell, gzCell);
          return true;
        }
      }
    }
    return false;
  }

  function tryStepUp(wx, wz, player, stepMax) {
    // NOTE: This performs a provisional vertical placement (player.y = gDst) and sets
    // player.grounded = true when successful. The vertical physics module will run
    // AFTER horizontal movement this frame and will treat this as a grounded state;
    // it relies on prevGrounded vs new grounded to decide if a landing SFX should fire.
    // Therefore we must only transition to grounded on genuine elevation changes and
    // avoid toggling grounded repeatedly for already grounded movement along flat ground.
    const gDst = landingHeightAt(wx, wz, player.y, stepMax);
    if (gDst !== null){
      const gx = Math.floor(wx + MAP_W*0.5);
      const gz = Math.floor(wz + MAP_H*0.5);
      const pyStand = gDst - 0.02;
      const hazardous = isHazardAtCellY(gx, gz, pyStand) || (map[mapIdx(gx,gz)] === TILE.BAD);
      const cH = ceilingHeightAt(wx, wz, gDst - 0.05);
      const blockedAbove = isFinite(cH) && (cH <= gDst + 0.02);
      
      if (!hazardous && !blockedAbove){
        const oldY = player.y; 
        player.y = gDst;
        const blockedAtNewY = isWallAt(wx, wz);
        if (!blockedAtNewY){ 
          if (wx !== player.x) player.x = wx;
          if (wz !== player.z) player.z = wz;
          player.vy = 0.0; 
          player.grounded = true; 
          return true; 
        }
        player.y = oldY;
      }
    }
    return false;
  }

  function applyRailNudge(player, railDir, nudge) {
    if (railDir==='N' || railDir==='S'){
      const sign = Math.sign(((player.x + MAP_W*0.5) - Math.floor(player.x + MAP_W*0.5) - 0.5) || 1);
      const tryX = player.x + sign * nudge;
      if (!isWallAt(tryX, player.z)) player.x = tryX;
    } else if (railDir==='E' || railDir==='W'){
      const sign = Math.sign(((player.z + MAP_H*0.5) - Math.floor(player.z + MAP_H*0.5) - 0.5) || 1);
      const tryZ = player.z + sign * nudge;
      if (!isWallAt(player.x, tryZ)) player.z = tryZ;
    }
  }

  function applyRailSnap(player, resolveTarget, axis, snappedThisFrame) {
    const SNAP_MIN_PEN = 0.006;
    if (!snappedThisFrame && resolveTarget !== null) {
      if (axis === 'X') {
        const dx = Math.abs(player.x - resolveTarget);
        if (dx > SNAP_MIN_PEN && !isWallAt(resolveTarget, player.z)) {
          player.x = resolveTarget;
          snappedXThisFrame = true;
        }
      } else if (axis === 'Z') {
        const dz = Math.abs(player.z - resolveTarget);
        if (dz > SNAP_MIN_PEN && !isWallAt(player.x, resolveTarget)) {
          player.z = resolveTarget;
          snappedZThisFrame = true;
        }
      }
    }
  }

  function handleHazardCollision(player, gxCell, gzCell, outOfBounds, oldX, oldZ, dirX, dirZ, axis) {
    if (!outOfBounds){
      const cellTile = (gxCell>=0&&gzCell>=0&&gxCell<MAP_W&&gzCell<MAP_H) ? map[mapIdx(gxCell,gzCell)] : -1;
      
      // Check for hazardous rail collision
      let spanHazard = false;
      try {
        const key = `${gxCell},${gzCell}`;
        const spans = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(key) : null;
        if (Array.isArray(spans)){
          for (const s of spans){ 
            if (!s) continue; 
            const b=(s.b|0), h=(s.h|0), t=((s.t|0)||0); 
            if (t===3 && h>0 && player.y >= b && player.y <= (b+h - 0.02)){ 
              spanHazard = true; 
              break; 
            } 
          }
        }
      } catch(_){ }
      
      if (lastHitFenceRail && ((cellTile === TILE.BADFENCE) || spanHazard)){
        const n = axis === 'X' ? 
          { nx: (Math.sign(dirX) > 0 ? -1 : 1), nz: 0 } :
          { nx: 0, nz: (Math.sign(dirZ) > 0 ? -1 : 1) };
        enterBallMode(n, { downward: false });
        player.x = oldX; player.z = oldZ;
        return;
      }
      
      // Check for general hazard collision
      const hazardous = isHazardAtCellY(gxCell, gzCell, player.y) || (map[mapIdx(gxCell,gzCell)] === TILE.BAD);
      if (hazardous){
        const n = axis === 'X' ? 
          { nx: (Math.sign(dirX) > 0 ? -1 : 1), nz: 0 } :
          { nx: 0, nz: (Math.sign(dirZ) > 0 ? -1 : 1) };
        enterBallMode(n, { downward: false });
        player.x = oldX; player.z = oldZ;
        return;
      }
    } else {
      // Out of bounds - check if inside Lock to suppress damage
      try {
        const gxCell = Math.floor(player.x + MAP_W*0.5);
        const gzCell = Math.floor(player.z + MAP_H*0.5);
        if (isInsideLockAt(gxCell, gzCell, player.y)){
          player.x = oldX; player.z = oldZ; 
          return;
        }
      } catch(_){ }
      
      // Trigger boundary damage
      const n = axis === 'X' ? 
        { nx: (Math.sign(dirX) > 0 ? -1 : 1), nz: 0 } :
        { nx: 0, nz: (Math.sign(dirZ) > 0 ? -1 : 1) };
      enterBallMode(n);
      player.x = oldX; player.z = oldZ;
      return;
    }
  }

  function triggerPortalTeleport(player, dest, gxCell, gzCell) {
    // Portal teleport implementation
    const nowSec = state.nowSec || (performance.now()/1000);
    
    // Preserve player state
    const keep = {
      angle: player.angle,
      speed: player.speed,
      movementMode: player.movementMode,
      vy: player.vy,
      grounded: player.grounded,
      isDashing: !!player.isDashing,
      dashUsed: !!player.dashUsed,
      dashTime: player.dashTime,
      _dashDirX: player._dashDirX,
      _dashDirZ: player._dashDirZ,
      isFrozen: !!player.isFrozen,
      isBallMode: !!player.isBallMode,
      _ballVX: player._ballVX,
      _ballVZ: player._ballVZ,
      _ballBouncesLeft: player._ballBouncesLeft,
      _ballSpinAxisX: player._ballSpinAxisX,
      _ballSpinAxisY: player._ballSpinAxisY,
      _ballSpinAxisZ: player._ballSpinAxisZ,
      _ballSpinSpeed: player._ballSpinSpeed,
    };
    
    // Calculate exit position
    let exDirX = (player.isDashing && typeof player._dashDirX==='number') ? player._dashDirX : Math.sin(player.angle);
    let exDirZ = (player.isDashing && typeof player._dashDirZ==='number') ? player._dashDirZ : -Math.cos(player.angle);
    let exGx = gxCell, exGz = gzCell;
    let nX = 0, nZ = 0;
    
    if (gxCell === 0){ nX = -1; nZ = 0; exGx = MAP_W - 1; }
    else if (gxCell === MAP_W-1){ nX = 1; nZ = 0; exGx = 0; }
    else if (gzCell === 0){ nX = 0; nZ = -1; exGz = MAP_H - 1; }
    else if (gzCell === MAP_H-1){ nX = 0; nZ = 1; exGz = 0; }
    
    if (nX!==0 || nZ!==0){ 
      const d = exDirX*nX + exDirZ*nZ; 
      if (d <= 0.05){ exDirX = nX; exDirZ = nZ; } 
    }
    
    const L = Math.hypot(exDirX, exDirZ) || 1; 
    exDirX/=L; exDirZ/=L;
    const cx = exGx - MAP_W*0.5 + 0.5;
    const cz = exGz - MAP_H*0.5 + 0.5;
    const EXIT_DIST = 0.52;
    const outX = cx + exDirX * EXIT_DIST;
    const outZ = cz + exDirZ * EXIT_DIST;
    
    // Switch level
    try { 
      if (typeof window.mpSwitchLevel === 'function') 
        window.mpSwitchLevel(dest); 
      else if (typeof window.setLevel==='function' && typeof window.parseLevelGroupId==='function'){ 
        window.setLevel(window.parseLevelGroupId(dest)); 
      } 
    } catch(_){ }
    
    // Restore player state and position
    player.angle = keep.angle;
    player.x = outX; player.z = outZ;
    
    try {
      const gH2 = groundHeightAt(player.x, player.z);
      if (player.y < gH2 - 1e-3){ 
        player.y = gH2; 
        if ((keep.vy||0) < 0) keep.vy = 0; 
      }
    } catch(_){ }
    
    player.vy = (typeof keep.vy==='number') ? keep.vy : player.vy;
    player.grounded = !!keep.grounded;
    player.speed = (typeof keep.speed==='number') ? keep.speed : player.speed;
    if (keep.movementMode) player.movementMode = keep.movementMode;
    player.isDashing = keep.isDashing; 
    player.dashUsed = keep.dashUsed; 
    player.dashTime = keep.dashTime||0;
    player._dashDirX = keep._dashDirX; 
    player._dashDirZ = keep._dashDirZ;
    player.isFrozen = keep.isFrozen;
    player.isBallMode = keep.isBallMode;
    player._ballVX = keep._ballVX; 
    player._ballVZ = keep._ballVZ; 
    player._ballBouncesLeft = keep._ballBouncesLeft;
    player._ballSpinAxisX = keep._ballSpinAxisX; 
    player._ballSpinAxisY = keep._ballSpinAxisY; 
    player._ballSpinAxisZ = keep._ballSpinAxisZ; 
    player._ballSpinSpeed = keep._ballSpinSpeed;
    player._portalCooldownUntil = nowSec + 0.6;
    
    try { 
      if (window.sfx) sfx.play('./sfx/VRUN_Teleport.mp3'); 
    } catch(_){ }
  }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { processHorizontalCollision };
} else if (typeof window !== 'undefined') {
  window.processHorizontalCollision = processHorizontalCollision;
  console.log('[COLLISION] Horizontal collision module loaded and exported');
}