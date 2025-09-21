/**
 * Vertical collision detection and gravity physics module
 * Extracted from applyVerticalPhysics() - handles Y axis motion, gravity, landing, and ceiling collision
 * Part of Cycle 2 physics segmentation
 */

/**
 * Apply vertical physics including gravity, ground collision, and ceiling collision
 * @param {number} dt - Delta time in seconds
 * @param {object} p - Player object
 */
function processVerticalPhysics(dt, p) {
  // Preserve prior grounded state for edge-trigger behaviors (landing SFX, dash reset)
  const prevGrounded = !!p.grounded;
  if (state && state.editor && state.editor.mode === 'fps') return; // no gravity in editor
  if (p.isBallMode) { return; }
  
  const GRAV = -12.5;
  
  // Apply gravity if not frozen
  if (!p.isFrozen){
    // If dashing: ignore gravity for countdown duration
    if (p.isDashing){
      p.dashTime -= dt;
      if (p.dashTime <= 0){
        p.isDashing = false;
        // Drop straight down next frame, keep current vy (0) and clamp speed to max
        const base = 3.0; 
        const max = base;
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
  
  // Ground collision (landing)
  if (p.vy <= 0.0 && newY <= gH){
    newY = gH;
    
    // Check for hazardous landing
    if (checkHazardousLanding(p, gH)) {
      enterBallMode({ nx: 0, nz: 0 });
      p.y = newY; // settle to ground before exiting
      return;
    }
    
    p.vy = 0.0;
    p.grounded = true;

    // Edge-trigger landing logic: fire only when transitioning airborne -> grounded
    // We maintain a module-level (global) flag state._wasGrounded to mirror legacy behavior.
    // If absent, initialize it lazily.
    if (typeof state._wasGrounded !== 'boolean') state._wasGrounded = false;
    if (!prevGrounded) {
      // SFX only on true transition
      try { if (window.sfx) sfx.play('./sfx/VHS_Step2.mp3'); } catch(_){ }
      // Reset dash availability & movement mode side-effects only on first contact
      p.dashUsed = false;
      p.isFrozen = false;
      p.isDashing = false;
    }
    // If already grounded from previous frame, we do NOT replay SFX or re-trigger resets.
  } else {
    if (p.grounded) { 
      p.jumpStartY = p.y; 
    }
    p.grounded = false;
  }
  
  // Ceiling collision
  if (p.vy > 0.0){
    const cH = ceilingHeightAt(p.x, p.z, p.y);
    if (isFinite(cH)){
      const eps = 1e-4;
      if (newY >= cH - eps){
        // Recompute hazardous BEFORE mutating newY so we know true relationship
        const hazardous = checkHazardousCeiling(p, cH);
        const CEIL_SPIKE_DOWN = 4.0;
        if (hazardous){
          // DEBUG: Enable verbose logging of BAD ceiling collisions with: window.__DEBUG_BAD_CEIL = true
          // Always apply downward spike, even inside lock blocks (decouple from camera lock state)
          p.vy = -CEIL_SPIKE_DOWN;
          p.grounded = false;
          // Commit Y just below ceiling
          newY = cH - eps;
          if (window.__DEBUG_BAD_CEIL){ console.log('[bad-ceil] spike', 'y->', newY.toFixed(3), 'vy=', p.vy.toFixed(3), 'lockIn=', !!state._inLockNow); }
          // Option: damage/ball mode only if not already in ball mode; keep previous behavior
          if (!p.isBallMode){
            // Provide downward flag to reuse existing damage effect semantics
            enterBallMode({ nx:0, nz:0 }, { downward:true });
          }
          p.y = newY;
          return;
        }

        // Non-hazardous ceiling: clamp and zero vy
        newY = cH - eps;
        p.vy = 0.0;
        if (window.__DEBUG_BAD_CEIL){ console.log('[bad-ceil] normal ceiling clamp y->', newY.toFixed(3)); }
      }
    }
  }
  
  p.y = newY;

  // Update global previous grounded state AFTER resolving all transitions this frame
  state._wasGrounded = p.grounded;
}

/**
 * Check if landing position is hazardous (BAD spans or BADFENCE rails)
 * @param {object} p - Player object
 * @param {number} gH - Ground height at landing position
 * @returns {boolean} True if landing is hazardous
 */
function checkHazardousLanding(p, gH) {
  try {
    const gx = Math.floor(p.x + MAP_W*0.5);
    const gz = Math.floor(p.z + MAP_H*0.5);
    if (gx>=0&&gz>=0&&gx<MAP_W&&gz<MAP_H){
      let hazardous = false;
      
      // Check span hazard: if the top we landed on is a hazardous span top
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
            const RAIL_HW = 0.11;
            const cellMinX = gx - MAP_W*0.5;
            const cellMinZ = gz - MAP_H*0.5;
            const lx = p.x - cellMinX;
            const lz = p.z - cellMinZ;
            const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
            const centerHit = (inBand(lz,0.5,RAIL_HW) || inBand(lx,0.5,RAIL_HW));
            
            if (centerHit){
              for (const s of spans){
                if (!s) continue; 
                const t=((s.t|0)||0); 
                if (t!==3) continue; 
                const b=(s.b|0), h=(s.h|0); 
                if (h<=0) continue;
                const topMost = b + h; // exclusive
                for (let lv=b; lv<topMost; lv++){
                  const top = lv + 1; 
                  if (Math.abs(top - topY) <= 1e-3){ 
                    hazardous = true; 
                    break; 
                  }
                }
                if (hazardous) break;
              }
            }
          }
        }
      } catch(_){ }
      
      // Fallback: ground-level BAD tile
      if (!hazardous && map[mapIdx(gx,gz)] === TILE.BAD){ 
        hazardous = true; 
      }
      
      return hazardous;
    }
  } catch(_){ }
  return false;
}

/**
 * Check if ceiling collision is hazardous
 * @param {object} p - Player object
 * @param {number} cH - Ceiling height
 * @returns {boolean} True if ceiling is hazardous
 */
function checkHazardousCeiling(p, cH) {
  try {
    const gx = Math.floor(p.x + MAP_W*0.5);
    const gz = Math.floor(p.z + MAP_H*0.5);
    if (gx>=0&&gz>=0&&gx<MAP_W&&gz<MAP_H){
      let hazardous = false;
      
      // Check if the ceiling base belongs to a hazardous span
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
      if (!hazardous && map[mapIdx(gx,gz)] === TILE.BAD){ 
        hazardous = true; 
      }
      
      // BADFENCE: if the tile is BADFENCE and we are within inner rail bands, treat as hazardous ceiling
      if (!hazardous && map[mapIdx(gx,gz)] === TILE.BADFENCE){
        try {
          const RAIL_HW = 0.11;
          const cellMinX = gx - MAP_W*0.5;
          const cellMinZ = gz - MAP_H*0.5;
          const lx = p.x - cellMinX;
          const lz = p.z - cellMinZ;
          const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
          const centerHit = (inBand(lz,0.5,RAIL_HW) || inBand(lx,0.5,RAIL_HW));
          if (centerHit) hazardous = true;
        } catch(_){ }
      }
      
      return hazardous;
    }
  } catch(_){ }
  return false;
}

/**
 * Check if ceiling is a spike that should apply downward velocity
 * @param {object} p - Player object  
 * @param {number} cH - Ceiling height
 * @returns {boolean} True if ceiling is a spike
 */
function checkSpikeCeiling(p, cH) {
  // For now, treat any solid ceiling as potentially spike-like
  // This could be expanded with specific spike detection logic
  return false; // Disabled for now - original logic was complex
}

/**
 * Handle vertical portal triggers (LEVELCHANGE tiles and portal spans)
 * @param {object} p - Player object
 * @returns {boolean} True if portal was triggered
 */
function handleVerticalPortalTrigger(p) {
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
              for (const s of spans){ 
                if (!s) continue; 
                const t=((s.t|0)||0); 
                if (t!==5) continue; 
                const b=(s.b||0), h=(s.h||0); 
                if (h<=0) continue; 
                const top=b+h; 
                if (p.y >= b && p.y <= top - 0.02){ 
                  portalHit = true; 
                  break; 
                } 
              }
            }
          } catch(_){ }
        }
        
        if (portalHit){
          const nowSec = state.nowSec || (performance.now()/1000);
          if (!p._portalCooldownUntil || nowSec >= p._portalCooldownUntil){
            const key = `${gx},${gz}`;
            let dest = null;
            try { 
              if (window.portalDestinations instanceof Map) 
                dest = window.portalDestinations.get(key) || null; 
            } catch(_){ }
            
            if (typeof dest === 'string' && dest){
              triggerVerticalPortal(p, dest, gx, gz);
              return true;
            }
          }
        }
      }
    }
  } catch(_){ }
  return false;
}

/**
 * Trigger portal teleport from vertical movement
 * @param {object} p - Player object
 * @param {string} dest - Destination level ID
 * @param {number} gx - Grid X coordinate
 * @param {number} gz - Grid Z coordinate
 */
function triggerVerticalPortal(p, dest, gx, gz) {
  const nowSec = state.nowSec || (performance.now()/1000);
  
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
  
  // Determine exit placement
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
    if (nX!==0 || nZ!==0){ 
      const d = exDirX*nX + exDirZ*nZ; 
      if (d <= 0.05){ exDirX = nX; exDirZ = nZ; } 
    }
    
    const L = Math.hypot(exDirX, exDirZ) || 1; 
    exDirX/=L; exDirZ/=L;
    const cx = exGx - MAP_W*0.5 + 0.5;
    const cz = exGz - MAP_H*0.5 + 0.5;
    const EXIT_DIST = 0.52;
    outX = cx + exDirX * EXIT_DIST;
    outZ = cz + exDirZ * EXIT_DIST;
  } else {
    // Interior portal: step forward through the tile center
    let dirX = Math.sin(p.angle), dirZ = -Math.cos(p.angle);
    if (p.isDashing && typeof p._dashDirX === 'number' && typeof p._dashDirZ === 'number'){ 
      dirX = p._dashDirX; dirZ = p._dashDirZ; 
    }
    const L = Math.hypot(dirX, dirZ) || 1; 
    dirX/=L; dirZ/=L;
    const cx = gx - MAP_W*0.5 + 0.5;
    const cz = gz - MAP_H*0.5 + 0.5;
    const EXIT_DIST = 0.52;
    outX = cx + dirX * EXIT_DIST;
    outZ = cz + dirZ * EXIT_DIST;
  }
  
  // Switch level first
  try { 
    if (typeof window.mpSwitchLevel === 'function') 
      window.mpSwitchLevel(dest); 
    else if (typeof window.setLevel==='function' && typeof window.parseLevelGroupId==='function'){ 
      window.setLevel(window.parseLevelGroupId(dest)); 
    } 
  } catch(_){ }
  
  // Restore movement/physics and place the player at computed exit
  p.angle = keep.angle;
  p.x = outX; p.z = outZ;
  
  // Preserve vertical motion; only clamp up to ground if below it
  try {
    const gH2 = groundHeightAt(p.x, p.z);
    if (p.y < gH2 - 1e-3){ 
      p.y = gH2; 
      if ((keep.vy||0) < 0) keep.vy = 0; 
    }
  } catch(_){ }
  
  p.vy = (typeof keep.vy==='number') ? keep.vy : p.vy;
  p.grounded = !!keep.grounded;
  p.speed = (typeof keep.speed==='number') ? keep.speed : p.speed;
  if (keep.movementMode) p.movementMode = keep.movementMode;
  p.isDashing = keep.isDashing; 
  p.dashUsed = keep.dashUsed; 
  p.dashTime = keep.dashTime||0;
  p._dashDirX = keep._dashDirX; 
  p._dashDirZ = keep._dashDirZ;
  p.isFrozen = keep.isFrozen;
  p.isBallMode = keep.isBallMode;
  p._ballVX = keep._ballVX; 
  p._ballVZ = keep._ballVZ; 
  p._ballBouncesLeft = keep._ballBouncesLeft;
  p._ballSpinAxisX = keep._ballSpinAxisX; 
  p._ballSpinAxisY = keep._ballSpinAxisY; 
  p._ballSpinAxisZ = keep._ballSpinAxisZ; 
  p._ballSpinSpeed = keep._ballSpinSpeed;
  p._portalCooldownUntil = nowSec + 0.6;
  
  try { 
    if (window.sfx) sfx.play('./sfx/VRUN_Teleport.mp3'); 
  } catch(_){ }
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { 
    applyVerticalPhysics, 
    handleVerticalPortalTrigger,
    checkHazardousLanding,
    checkHazardousCeiling 
  };
} else if (typeof window !== 'undefined') {
  window.processVerticalPhysics = processVerticalPhysics;
  window.handleVerticalPortalTrigger = handleVerticalPortalTrigger;
  window.checkHazardousLanding = checkHazardousLanding;
  window.checkHazardousCeiling = checkHazardousCeiling;
  console.log('[COLLISION] Vertical collision module loaded and exported');
}