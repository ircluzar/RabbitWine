/**
 * Physics and collision detection system for player movement and world interaction.
 * Handles comprehensive 3D collision detection, ground height calculation, player movement
 * with physics integration, and wall collision responses. This is the core physics engine
 * that drives all player-world interactions including jumping, wall-jumping, and movement.
 * 
 * The system supports complex terrain including variable height columns, rail platforms,
 * fence objects, and multiple tile types with different collision behaviors.
 * 
 * @fileoverview Core physics engine for player movement and world collision
 * @exports groundHeightAt() - Terrain height sampling for any world coordinate
 * @exports moveAndCollide() - Complete player movement integration with collision response
 * @dependencies MAP_W, MAP_H, TILE constants, columnHeights, columnBases, map data from map system
 * @sideEffects Modifies state.player position, velocity, grounded state, and movement flags
 */

// Import terrain height calculation functions
try {
  if (typeof document !== 'undefined') {
    const script = document.createElement('script');
    script.src = 'js/gameplay/physics/terrain.js';
    document.head.appendChild(script);
  }
} catch(_) {
  // Fallback for environments without DOM
  if (typeof importScripts !== 'undefined') {
    try { importScripts('js/gameplay/physics/terrain.js'); } catch(_) {}
  }
}

// Collision detection modules loaded via static script tags in index.php
// collisionHorizontal.js and collisionVertical.js should be available via window exports

// ╔════════════════════════════════════════════════════════════╗
// ║ SEGMENT: physics-terrain                                    ║
// ║ CONDEMNED: Extracted to gameplay/physics/terrain.js        ║
// ║ Functions: groundHeightAt, landingHeightAt, ceilingHeightAt ║
// ╚════════════════════════════════════════════════════════════╝

// Terrain height calculation functions are now provided by terrain.js module
// Global exports maintained for compatibility via window object

/**
 * Calculate ground height at any world coordinates with support for complex terrain
 * Handles multiple terrain types including solid blocks, half-blocks, columns, rail platforms,
 * and fence objects. Returns the highest walkable surface at the given position.
 * 
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate  
 * @returns {number} Ground height (0.0 for empty space, 1.0+ for elevated surfaces)
 */
function groundHeightAt(x, z){
  const __profOn = (typeof window !== 'undefined' && window.__PROFILE_LOCK===true);
  let __tStart = __profOn ? performance.now() : 0;
  // Convert world coordinates to grid coordinates
  const gx = Math.floor(x + MAP_W*0.5);
  const gz = Math.floor(z + MAP_H*0.5);
  
  // Early bounds check - outside map is considered empty space
  if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return 0.0;
  
  const key = `${gx},${gz}`;
  
  // ============================================================================
  // Span-Based Terrain System (Advanced Terrain)
  // ============================================================================
  
  /** @type {Array<{b:number,h:number,t?:number}>|null} */
  let spans = null;
  try {
    spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
          : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
          : null;
  } catch(_){ spans = null; }
  
  // Detect if this cell contains only non-solid decorative spans
  const spansAllNonSolidGH = Array.isArray(spans) && spans.length>0 && spans.every(s => {
    if (!s) return false; 
    const t=((s.t|0)||0);
    return (t===2 || t===3 || t===5 || t===6); // fence, portal, lock types
  });
  
  /** @type {Array<{b:number,h:number}>} */
  // Use cached solid spans if available
  let spanList = [];
  const cachedSolids = (typeof window !== 'undefined' && window.getSolidSpansCached) ? window.getSolidSpansCached(key) : null;
  if (cachedSolids){
    spanList = cachedSolids;
    if (__profOn){ // approximate profiling counts without iteration
      const P = (window.__lockPhysProfile || (window.__lockPhysProfile = { frames:0, spanTotal:0, spanLock:0, spanSolid:0, timeSpanMs:0 }));
      P.spanTotal += (Array.isArray(spans)? spans.length : spanList.length);
      P.spanSolid += spanList.length;
      if (Array.isArray(spans)){
        for (let i=0;i<spans.length;i++){ const s=spans[i]; if (s && ((s.t|0)||0)===6) P.spanLock++; }
      }
    }
  } else if (Array.isArray(spans)){
    for (let i=0;i<spans.length;i++){
      const s = spans[i]; if (!s) continue; const t=((s.t|0)||0);
      if (__profOn){ const P = (window.__lockPhysProfile || (window.__lockPhysProfile = { frames:0, spanTotal:0, spanLock:0, spanSolid:0, timeSpanMs:0 })); P.spanTotal++; if (t===6) P.spanLock++; }
      if (t===2||t===3||t===5||t===6) continue; spanList.push(s); if (__profOn){ window.__lockPhysProfile.spanSolid++; }
    }
  }
  
  // ============================================================================
  // Rail Platform System (Special Narrow Walkways)
  // ============================================================================
  
  let railGroundCandidate = -Infinity;
  try {
    const RAIL_HW = 0.11; // Rail half-width for collision detection
    const cellMinX = gx - MAP_W*0.5;
    const cellMinZ = gz - MAP_H*0.5;
    const lx = x - cellMinX; // Local X within cell [0,1]
    const lz = z - cellMinZ; // Local Z within cell [0,1]
    
    // Check if position is within rail band (center cross pattern)
    const inBand = (v, c=0.5, hw=RAIL_HW) => (v >= c - hw - 1e-4 && v <= c + hw + 1e-4);
    const centerHit = (inBand(lz,0.5,RAIL_HW) || inBand(lx,0.5,RAIL_HW));
    
    if (centerHit && Array.isArray(spans)){
      const py = (state && state.player) ? state.player.y : 0.0;
      for (const s of spans){
        if (!s) continue; 
        const t=((s.t|0)||0); 
        if (!(t===2||t===3)) continue; // Only fence types create rail platforms
        const b=(s.b|0), h=(s.h|0); 
        if (h<=0) continue;
        
        // Consider top faces of each voxel within this fence span as potential rail platforms
        const topMost = b + h; // exclusive top
        const maxLv = topMost - 1;
        for (let lv=b; lv<=maxLv; lv++){
          const top = lv + 1; // top face height
          if (top <= py + 1e-6 && top > railGroundCandidate) railGroundCandidate = top;
        }
      }
    }
  } catch(_){ }
  
  // ============================================================================
  // Column Height System (Standard Terrain)
  // ============================================================================
  
  try {
    // Skip synthesis for fence tiles or cells with only decorative spans
    const _cvGH = map[mapIdx(gx,gz)];
    if (_cvGH !== TILE.FENCE && _cvGH !== TILE.BADFENCE && !spansAllNonSolidGH && typeof columnHeights !== 'undefined' && columnHeights && columnHeights.has(key)){
      let b = 0; // Base height
      let h = columnHeights.get(key) || 0; // Column height
      
      // Get base height from columnBases if available
      try {
        if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
        else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
      } catch(_){ }
      
      if (h > 0) spanList.push({ b: b|0, h: h|0 });
    }
  } catch(_){ }
  
  // ============================================================================
  // Basic Tile System (Fallback for Simple Terrain)
  // ============================================================================
  
  const cellValGH = map[mapIdx(gx,gz)];
  const isGroundWall = (cellValGH === TILE.WALL) || (cellValGH === TILE.NOCLIMB);
  const isGroundHalf = (cellValGH === TILE.HALF);
  const isGroundFence = (cellValGH === TILE.FENCE) || (cellValGH === TILE.BADFENCE);
  
  // Add basic terrain spans for standard tile types
  if (isGroundWall){ 
    spanList.push({ b: 0, h: 1 }); // Full-height wall
  } else if (isGroundHalf){ 
    spanList.push({ b: 0, h: 0.5 }); // Half-height platform
  }
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
  if (__profOn){
    const P = window.__lockPhysProfile || (window.__lockPhysProfile = { frames:0, spanTotal:0, spanLock:0, spanSolid:0, timeSpanMs:0 });
    P.frames++;
    P.timeSpanMs += (performance.now() - __tStart);
  }
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
  const __profOn = (typeof window !== 'undefined' && window.__PROFILE_LOCK===true);
  let __tStart = __profOn ? performance.now() : 0;
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
  let spanList = [];
  const cachedSolids = (typeof window !== 'undefined' && window.getSolidSpansCached) ? window.getSolidSpansCached(key) : null;
  if (cachedSolids){
    spanList = cachedSolids;
    if (__profOn){
      const P = (window.__lockPhysProfile || (window.__lockPhysProfile = { frames:0, spanTotal:0, spanLock:0, spanSolid:0, timeSpanMs:0 }));
      P.spanTotal += (Array.isArray(spans)? spans.length : spanList.length);
      P.spanSolid += spanList.length;
      if (Array.isArray(spans)) for (let i=0;i<spans.length;i++){ const s=spans[i]; if (s && ((s.t|0)||0)===6) P.spanLock++; }
    }
  } else if (Array.isArray(spans)) {
    for (let i=0;i<spans.length;i++){
      const s = spans[i]; if (!s) continue; const t=((s.t|0)||0);
      if (__profOn){ const P = (window.__lockPhysProfile || (window.__lockPhysProfile = { frames:0, spanTotal:0, spanLock:0, spanSolid:0, timeSpanMs:0 })); P.spanTotal++; if (t===6) P.spanLock++; }
      if (t===2||t===3||t===5||t===6) continue; spanList.push(s); if (__profOn){ window.__lockPhysProfile.spanSolid++; }
    }
  }
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
  const res = Math.min(best, railCeilCandidate);
  if (__profOn){
    const P = window.__lockPhysProfile || (window.__lockPhysProfile = { frames:0, spanTotal:0, spanLock:0, spanSolid:0, timeSpanMs:0 });
    P.frames++;
    P.timeSpanMs += (performance.now() - __tStart);
  }
  return res;
}

/**
 * Check if there's a wall at the given world coordinates
 * Simple collision check used by extracted collision modules
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {boolean} True if there's a solid wall/obstacle at the position
 */
function isWallAt(x, z) {
  const __profOn = (typeof window !== 'undefined' && window.__PROFILE_LOCK===true);
  let __tStart = __profOn ? performance.now() : 0;
  const gx = Math.floor(x + MAP_W*0.5);
  const gz = Math.floor(z + MAP_H*0.5);
  if (gx < 0 || gz < 0 || gx >= MAP_W || gz >= MAP_H) return true; // border = wall
  
  const key = `${gx},${gz}`;
  const p = state.player;
  const py = p ? p.y : 0.5; // use player Y or default
  
  // Check spans
  let spans = null;
  try {
    spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
          : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
          : null;
  } catch(_){ spans = null; }
  
  const cachedSolids = (typeof window !== 'undefined' && window.getSolidSpansCached) ? window.getSolidSpansCached(key) : null;
  if (cachedSolids){
    if (__profOn){ const P = (window.__lockPhysProfile || (window.__lockPhysProfile = { frames:0, spanTotal:0, spanLock:0, spanSolid:0, timeSpanMs:0 })); P.spanSolid += cachedSolids.length; }
    for (let i=0;i<cachedSolids.length;i++){
      const s = cachedSolids[i]; const b=s.b||0, h=s.h||0; if (h<=0) continue; if (py > b - 0.02 && py < b + h - 0.02){ if (__profOn){ const P=window.__lockPhysProfile; P.frames++; P.timeSpanMs += (performance.now()-__tStart); } return true; }
    }
  } else if (Array.isArray(spans) && spans.length) {
    for (let i=0;i<spans.length;i++){
      const s = spans[i]; if (!s) continue; const b=(s.b||0), h=(s.h||0), t=((s.t|0)||0);
      if (__profOn){ const P = (window.__lockPhysProfile || (window.__lockPhysProfile = { frames:0, spanTotal:0, spanLock:0, spanSolid:0, timeSpanMs:0 })); P.spanTotal++; if (t===6) P.spanLock++; }
      if (h<=0) continue; if (t===5||t===6||t===2||t===3) continue; // skip non-solid & fences
      if (__profOn){ window.__lockPhysProfile.spanSolid++; }
      if (py > b - 0.02 && py < b + h - 0.02){ if (__profOn){ const P=window.__lockPhysProfile; P.frames++; P.timeSpanMs += (performance.now()-__tStart); } return true; }
    }
  }
  
  // Check base map tile (treat base tiles as voxel spans with finite vertical extent)
  const cv = map[mapIdx(gx, gz)];
  const EPS = 1e-4;
  // WALL / BAD / FILL occupy [0,1). Only block if player vertical center inside that slab.
  if (cv === TILE.WALL || cv === TILE.BAD || cv === TILE.FILL){
    if (py > -EPS && py < 1.0 - EPS) return true;
  }
  // HALF occupies [0,0.5). Allow clearance once player reaches the top (with small descent grace)
  if (cv === TILE.HALF){
    const HALF_TOP = 0.5;
    const DESC_GRACE = 0.012; // allow slight downward motion to still count as on top
    if (py < HALF_TOP - EPS) return true;               // clearly below: collide
    if (py < HALF_TOP + DESC_GRACE && p && p.vy < -0.05) return true; // descending onto lip
  }
  // FENCE/BADFENCE: rails up to ~1.5; treat as blocking only within that vertical band
  if (cv === TILE.FENCE || cv === TILE.BADFENCE){
    if (py > -0.1 && py < 1.5 - EPS) return true;
  }
  
  if (__profOn){ const P = window.__lockPhysProfile || (window.__lockPhysProfile = { frames:0, spanTotal:0, spanLock:0, spanSolid:0, timeSpanMs:0 }); P.frames++; P.timeSpanMs += (performance.now() - __tStart); }
  return false;
}

// ╔════════════════════════════════════════════════════════════╗
// ║ SEGMENT: physics-collision                                  ║
// ║ Functions: moveAndCollide - horizontal collision logic      ║
// ║ Extracted to: collision/collisionHorizontal.js             ║
// ║            : collision/collisionVertical.js                ║
// ╚════════════════════════════════════════════════════════════╝

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
          const norm = (a)=>{ a = a % (Math.PI*2); if (a > Math.PI) a -= Math.PI*2; if (a < -Math.PI) a += Math.PI*2; return a; };
          const prevGX = (typeof state._prevGridGX === 'number') ? state._prevGridGX : gxCam;
          const prevGZ = (typeof state._prevGridGZ === 'number') ? state._prevGridGZ : gzCam;
          const prevSides = [];
          if (prevGX === 0) prevSides.push('W'); else if (prevGX === maxGX) prevSides.push('E');
          if (prevGZ === 0) prevSides.push('N'); else if (prevGZ === maxGZ) prevSides.push('S');
          const curSides = [];
          if (gxCam === 0) curSides.push('W'); else if (gxCam === maxGX) curSides.push('E');
          if (gzCam === 0) curSides.push('N'); else if (gzCam === maxGZ) curSides.push('S');
          const isCorner = curSides.length === 2;
          let targetYaw = null;
          if (isCorner){
            const cornerKey = gxCam + ',' + gzCam;
            const prevKey = state._lastCornerKeyEntered;
            const dGX = gxCam - prevGX;
            const dGZ = gzCam - prevGZ;
            // New side difference triggers rotation; allow re-trigger after leaving corner (prevKey different) or if previous sides differ.
            const newSides = curSides.filter(s => !prevSides.includes(s));
            const shouldTrigger = (cornerKey !== prevKey) && newSides.length > 0;
            if (shouldTrigger){
              const newSide = newSides[0];
              switch(newSide){
                case 'W': targetYaw = -Math.PI/2; break;
                case 'E': targetYaw =  Math.PI/2; break;
                case 'N': targetYaw = 0.0; break;
                case 'S': targetYaw =  Math.PI; break;
              }
              state._lastCornerKeyEntered = cornerKey;
              if (window.__DEBUG_LOCK_WALL){ console.log('[lock-wall] corner trigger entry key=',cornerKey,' prevKey=',prevKey,' prevSides=',prevSides,' curSides=',curSides,' newSides=',newSides,' dGX=',dGX,' dGZ=',dGZ,' yaw=',targetYaw); }
            } else {
              if (window.__DEBUG_LOCK_WALL){ console.log('[lock-wall] corner no-trigger key=',cornerKey,' prevKey=',prevKey,' prevSides=',prevSides,' curSides=',curSides,' newSides=',newSides,' dGX=',dGX,' dGZ=',dGZ); }
            }
          } else {
            // Clear corner key when leaving a corner so re-entry can trigger again.
            if (state._lastCornerKeyEntered) delete state._lastCornerKeyEntered;
          }
          if (!isCorner){
            // Single-side border cell: straightforward mapping + reset corner key
            if (gxCam === 0) targetYaw = -Math.PI/2; else if (gxCam === maxGX) targetYaw = Math.PI/2; else if (gzCam === 0) targetYaw = 0.0; else if (gzCam === maxGZ) targetYaw = Math.PI;
          }
          if (targetYaw !== null){
            const cur = state.camYaw || 0.0;
            const diff = Math.abs(norm(targetYaw - cur));
            const TH = 5 * Math.PI/180;
            if (diff > TH){ state.camYaw = norm(targetYaw); }
          }
        } else {
          // Left border region; nothing special
        }
        // Persist previous frame grid after processing (always)
        state._prevGridGX = gxCam; state._prevGridGZ = gzCam;
      } catch(_){ }
    } else if (inLockNow && was){
      // Still in lock; check if we crossed from one boundary wall to another lock block on a different side.
      try {
        const maxGX = (MAP_W|0) - 1;
        const maxGZ = (MAP_H|0) - 1;
        const onBorder = (gxCam === 0 || gxCam === maxGX || gzCam === 0 || gzCam === maxGZ);
        if (onBorder){
          const prevGX = (typeof state._prevGridGX === 'number') ? state._prevGridGX : gxCam;
          const prevGZ = (typeof state._prevGridGZ === 'number') ? state._prevGridGZ : gzCam;
          const prevSides = [];
          if (prevGX === 0) prevSides.push('W'); else if (prevGX === maxGX) prevSides.push('E');
          if (prevGZ === 0) prevSides.push('N'); else if (prevGZ === maxGZ) prevSides.push('S');
          const curSides = [];
          if (gxCam === 0) curSides.push('W'); else if (gxCam === maxGX) curSides.push('E');
          if (gzCam === 0) curSides.push('N'); else if (gzCam === maxGZ) curSides.push('S');
          let chosenSide = null;
          if (curSides.length === 2){
            const cornerKey = gxCam + ',' + gzCam;
            const prevKey = state._lastCornerKeyEntered;
            const dGX = gxCam - prevGX;
            const dGZ = gzCam - prevGZ;
            const newSides = curSides.filter(s => !prevSides.includes(s));
            const shouldTrigger = (cornerKey !== prevKey) && newSides.length > 0;
            if (shouldTrigger){
              chosenSide = newSides[0];
              state._lastCornerKeyEntered = cornerKey;
              if (window.__DEBUG_LOCK_WALL){ console.log('[lock-wall] corner move trigger key=',cornerKey,' prevKey=',prevKey,' prevSides=',prevSides,' curSides=',curSides,' newSides=',newSides,' dGX=',dGX,' dGZ=',dGZ,' chosenSide=',chosenSide); }
            } else if (window.__DEBUG_LOCK_WALL){
              console.log('[lock-wall] corner move no-trigger key=',cornerKey,' prevKey=',prevKey,' prevSides=',prevSides,' curSides=',curSides,' newSides=',newSides,' dGX=',dGX,' dGZ=',dGZ); }
          } else if (curSides.length === 1){
            chosenSide = curSides[0];
            if (state._lastCornerKeyEntered) delete state._lastCornerKeyEntered;
          }
          const prevSide = state._lockBorderSide || null;
          if (chosenSide && chosenSide !== prevSide){
            const yawForSide = (s)=>{ switch(s){ case 'W': return -Math.PI/2; case 'E': return Math.PI/2; case 'N': return 0.0; case 'S': return Math.PI; } return state.camYaw||0.0; };
            const targetYaw = yawForSide(chosenSide);
            const norm = (a)=>{ a = a % (Math.PI*2); if (a > Math.PI) a -= Math.PI*2; if (a < -Math.PI) a += Math.PI*2; return a; };
            const cur = state.camYaw || 0.0;
            const diff = Math.abs(norm(targetYaw - cur));
            const smooth = (window.__LOCK_WALL_SMOOTH !== undefined) ? !!window.__LOCK_WALL_SMOOTH : false;
            if (!smooth || diff > (2*Math.PI/180)){
              state.camYaw = norm(targetYaw);
            } else if (smooth && diff > 0){
              const step = Math.min(diff, ( (typeof window.__LOCK_WALL_STEP_DEG === 'number'? window.__LOCK_WALL_STEP_DEG:90) * Math.PI/180));
              state.camYaw = norm(cur + Math.sign(targetYaw - cur)*step);
            }
            if (window.__DEBUG_LOCK_WALL){ console.log('[lock-wall] switched side', prevSide, '->', chosenSide, 'prevSides=',prevSides,'curSides=',curSides,'yaw=', state.camYaw.toFixed(3)); }
            state._lockBorderSide = chosenSide;
          }
        } else {
          // Not on border; clear side tracking so re-entry triggers orientation again.
          if (state._lockBorderSide) delete state._lockBorderSide;
        }
        // Always update previous grid so repeated corner traversals inside continuous lock work.
        state._prevGridGX = gxCam; state._prevGridGZ = gzCam;
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
  
  // ╔════════════════════════════════════════════════════════════╗
  // ║ CONDEMNED: Horizontal collision processing                  ║
  // ║ EXTRACTED TO: collision/collisionHorizontal.js             ║
  // ╚════════════════════════════════════════════════════════════╝
  
  // Store dash state before potential modification
  const wasDashing = !!p.isDashing;
  
  // Delegate horizontal collision processing to extracted module
  if (typeof window.processHorizontalCollision !== 'function') {
    console.error('[PHYSICS] processHorizontalCollision not available - collision modules not loaded');
    console.log('[PHYSICS] Available window functions:', Object.keys(window).filter(k => k.includes('collision') || k.includes('Collision')));
    return; // Early exit to prevent runtime error
  }
  console.log('[PHYSICS] Using extracted horizontal collision module');
  const horizontalResult = window.processHorizontalCollision(dt, p, stepX, stepZ);
  const hitWall = horizontalResult.hitWall;
  const collidedFenceRail = horizontalResult.collidedFenceRail;
  const collidedSolidSpan = horizontalResult.collidedSolidSpan;
  const collidedNoClimb = horizontalResult.collidedNoClimb;

  // If dash hit a wall this frame, cancel any movement and jump immediately
  if (hitWall && wasDashing){
    // If collided with a fence rail (and not a solid span), disallow wall-jump response
    if (collidedFenceRail && !collidedSolidSpan){
      p.isDashing = false;
      const base2 = 3.0; const max2 = base2; 
      if (p.speed > max2) p.speed = max2; 
      return;
    }
    if (!state.player.canWallJump || collidedNoClimb) {
      // If walljump disabled, just cancel dash and stop against wall
      state.player.isDashing = false;
      const base2 = 3.0; const max2 = base2;
      if (state.player.speed > max2) state.player.speed = max2;
      return;
    }
    // Revert movement from this frame (handled by collision module)
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

// ╔════════════════════════════════════════════════════════════╗
// ║ SEGMENT: physics-collision-vertical                         ║
// ║ CONDEMNED: Vertical physics processing                      ║  
// ║ EXTRACTED TO: collision/collisionVertical.js               ║
// ╚════════════════════════════════════════════════════════════╝

function applyVerticalPhysics(dt){
  // Delegate to extracted vertical physics module
  const p = state.player;
  if (typeof window.processVerticalPhysics === 'function') {
    window.processVerticalPhysics(dt, p);
  } else {
    // Fallback implementation if module not loaded
    if (state && state.editor && state.editor.mode === 'fps') return;
    if (p.isBallMode) { return; }
    const prevGrounded = !!p.grounded;
    
    const GRAV = -12.5;
    if (!p.isFrozen){
      if (p.isDashing){
        p.dashTime -= dt;
        if (p.dashTime <= 0){
          p.isDashing = false;
          const base = 3.0; 
          if (p.speed > base) p.speed = base;
          p.movementMode = 'accelerate';
        }
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
      if (typeof state._wasGrounded !== 'boolean') state._wasGrounded = false;
      if (!prevGrounded) {
        try { if (window.sfx) sfx.play('./sfx/VHS_Step2.mp3'); } catch(_){ }
        p.dashUsed = false;
        p.isFrozen = false;
        p.isDashing = false;
      }
    } else {
      if (p.grounded) { 
        p.jumpStartY = p.y; 
      }
      p.grounded = false;
    }
    
    p.y = newY;
    state._wasGrounded = p.grounded;
  }
  
  // Handle vertical portal triggers
  if (typeof window.handleVerticalPortalTrigger === 'function') {
    window.handleVerticalPortalTrigger(state.player);
  }
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
if (typeof window !== 'undefined') {
  window.enterBallMode = enterBallMode;
  window.isWallAt = isWallAt;
}
