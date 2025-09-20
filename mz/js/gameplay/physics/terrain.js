/**
 * Terrain height sampling and surface detection for physics system
 * Extracted from physics.js - handles ground height, landing, and ceiling calculations
 * 
 * @fileoverview Pure terrain sampling functions for collision and movement
 * @dependencies MAP_W, MAP_H, TILE constants, columnSpans, columnHeights, columnBases, map
 */

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
  let spanList = Array.isArray(spans) ? spans.slice() : [];
  
  // Filter out non-solid decorative spans (fences, portals, locks) from ground computation
  spanList = spanList.filter(s => s && ((((s.t|0)||0) !== 2) && (((s.t|0)||0) !== 3) && (((s.t|0)||0) !== 5) && (((s.t|0)||0) !== 6)));
  
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

// Export functions
if (typeof window !== 'undefined') {
  window.groundHeightAt = groundHeightAt;
  window.landingHeightAt = landingHeightAt;
  window.ceilingHeightAt = ceilingHeightAt;
}