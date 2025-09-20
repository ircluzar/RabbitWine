"use strict";
/**
 * Item collection system with floating animated collectibles and ghost state management.
 * Handles item spawning from map data, 3D wireframe cube animations, collision detection,
 * pickup processing with action dispatch, and persistent collection state tracking.
 * 
 * Items appear as rotating wireframe cubes that float in the world. When collected,
 * they trigger actions (typically ability unlocks) and transition to "ghost" state
 * for visual feedback while maintaining save state persistence.
 * 
 * @fileoverview Complete item collection system with animation and persistence
 * @exports initItemsFromBuilder() - Initialize items from map builder data
 * @exports spawnItemWorld() - Create individual items at world coordinates
 * @exports drawItems() - Render all active items with animations
 * @exports updateItems() - Update animations and handle collision detection
 * @dependencies MAP_W, MAP_H from map constants, state.player, gameSave system, dispatchAction()
 * @sideEffects Modifies global items arrays, triggers save state updates, dispatches ability unlock actions
 */

// ============================================================================
// Item Storage and Constants
// ============================================================================

/**
 * Primary item storage for yellow collectible items
 * @type {Array<Object>}
 */
const items = [];

/**
 * Special purple item storage (future expansion/different item types)
 * @type {Array<Object>}
 */
const purpleItems = [];

// Visual constants for ghost (collected) item presentation
/** @const {number} Target alpha transparency for ghost items */
const GHOST_ALPHA = 0.25;

/** @const {number} Duration in seconds for ghost item fade-in animation */
const GHOST_FADE_DURATION = 0.8;

/** @const {number} Delay in seconds before collected items reappear as ghosts */
const GHOST_RESPAWN_DELAY = 3.0;

/** @const {number} Default floating height for items without explicit Y coordinate */
const ITEM_DEFAULT_FLOAT_Y = 0.75;

// ============================================================================
// Environment Detection and Utilities
// ============================================================================

/**
 * Detect if running in editor mode where items should always appear uncollected
 * Editor mode disables ghost state for better visibility during level design
 * @returns {boolean} True if in editor environment
 */
function isEditorMode(){
  try { if (window.IS_MZ_EDITOR === true) return true; } catch(_){ }
  try { if (typeof location !== 'undefined' && /\/editor\//i.test(location.pathname)) return true; } catch(_){ }
  return false;
}

/**
 * Convert grid coordinates to world space coordinates
 * @param {number} gx - Grid X coordinate
 * @param {number} gy - Grid Y coordinate  
 * @returns {{x: number, z: number}} World coordinates with proper centering
 */
function gridToWorld(gx, gy){
  return {
    x: (gx + 0.5) - MAP_W * 0.5,
    z: (gy + 0.5) - MAP_H * 0.5,
  };
}

// ============================================================================
// Item Initialization and Spawning
// ============================================================================

/**
 * Initialize all items from map builder data array
 * Clears existing items and creates new ones from level data
 * @param {Array<{x: number, y: number, payload?: string, yWorld?: number}>} list - Item definitions from map
 */
function initItemsFromBuilder(list){
  items.length = 0; purpleItems.length = 0;
  if (!Array.isArray(list)) return;
  
  for (const it of list){
    if (!it || typeof it.x !== 'number' || typeof it.y !== 'number') continue;
    
    const w = gridToWorld(it.x, it.y);
    
    // Determine Y coordinate from various possible sources
    const iyOpt = (typeof it.yWorld === 'number') ? it.yWorld
               : (typeof it.yBase === 'number') ? it.yBase
               : (typeof it.y0 === 'number') ? it.y0
               : ITEM_DEFAULT_FLOAT_Y;
    
    spawnItemWorld(w.x, iyOpt, w.z, it.payload||'');
  }
}

/**
 * Spawn a single item at world coordinates with optional configuration
 * Handles ghost state determination based on save data and editor mode
 * @param {number} x - World X coordinate
 * @param {number} y - World Y coordinate (height)
 * @param {number} z - World Z coordinate
 * @param {string} payload - Action key to dispatch on collection
 * @param {Object} opts - Optional configuration {ghost: boolean, fadeIn: boolean}
 */
function spawnItemWorld(x, y, z, payload, opts){
  let ghost = false, fadeIn = false;
  
  try {
    if (!isEditorMode()){
      // Determine ghost state based on save data
      if (opts && typeof opts.ghost === 'boolean') ghost = opts.ghost;
      else if (window.gameSave && payload && gameSave.isYellowPayloadCollected && gameSave.isYellowPayloadCollected(payload)) ghost = true;
      else if (window.gameSave && !payload && gameSave.isItemCollected && gameSave.isItemCollected(x, z)) ghost = true; // legacy fallback
      
      if (opts && opts.fadeIn) fadeIn = true;
    } else {
      // Editor mode: always show items as uncollected for visibility
      ghost = false; fadeIn = false;
    }
  } catch(_){ }
  let ax = Math.random()*2-1, ay = Math.random()*2-1, az = Math.random()*2-1;
  const al = Math.hypot(ax,ay,az) || 1; ax/=al; ay/=al; az/=al;
  let ix = Math.random()*2-1, iy = Math.random()*2-1, iz = Math.random()*2-1;
  const il = Math.hypot(ix,iy,iz) || 1; ix/=il; iy/=il; iz/=il;
  items.push({ x, y, z, payload: String(payload || ''), spawnT: state.nowSec || performance.now()/1000, gone: false, ghost, fadeInStart: fadeIn ? (state.nowSec || performance.now()/1000) : -1, ax, ay, az, ix, iy, iz });
}

function spawnPurpleItemWorld(x, y, z, opts){
  let ghost = false, fadeIn = false;
  try {
    if (!isEditorMode()){
      if (opts && typeof opts.ghost === 'boolean') ghost = opts.ghost; else if (window.gameSave && gameSave.isPurpleCollected && gameSave.isPurpleCollected(null, x, y, z)) ghost = true;
      if (opts && opts.fadeIn) fadeIn = true;
    } else {
      ghost = false; fadeIn = false;
    }
  } catch(_){ }
  let ax = Math.random()*2-1, ay = Math.random()*2-1, az = Math.random()*2-1;
  const al = Math.hypot(ax,ay,az) || 1; ax/=al; ay/=al; az/=al;
  let ix = Math.random()*2-1, iy = Math.random()*2-1, iz = Math.random()*2-1;
  const il = Math.hypot(ix,iy,iz) || 1; ix/=il; iy/=il; iz/=il;
  purpleItems.push({ x, y, z, spawnT: state.nowSec || performance.now()/1000, gone: false, ghost, fadeInStart: fadeIn ? (state.nowSec || performance.now()/1000) : -1, ax, ay, az, ix, iy, iz });
}

// Remove items at (world x,z) cell (within small epsilon). Returns number removed.
function removeItemsAtWorld(x, z){
  let removed = 0;
  for (let i=items.length-1;i>=0;i--){
    const it = items[i]; if (!it || it.gone) continue;
    if (Math.abs(it.x - x) < 0.4 && Math.abs(it.z - z) < 0.4){ items.splice(i,1); removed++; }
  }
  for (let i=purpleItems.length-1;i>=0;i--){
    const it = purpleItems[i]; if (!it || it.gone) continue;
    if (Math.abs(it.x - x) < 0.4 && Math.abs(it.z - z) < 0.4){ purpleItems.splice(i,1); removed++; }
  }
  return removed;
}

// Query active items (for export or debug)
function listActiveItems(){ return items.filter(it=>!it.gone).map(it=>({ x: it.x, y: it.y, z: it.z, payload: it.payload })); }
function listActivePurpleItems(){ return purpleItems.filter(it=>!it.gone).map(it=>({ x: it.x, y: it.y, z: it.z })); }

function updateItems(dt){
  const p = state.player;
  const pr = Math.max(0.25, p.radius || 0.3);
  if (items.length){
    for (const it of items){
  if (it.gone) continue;
  if (it.ghost) continue; // ghosts ignore collisions
      const dx = it.x - p.x;
      const dz = it.z - p.z;
      const itemHalf = 0.24;
      const pTop = p.y + 0.25;
      const itemBottom = it.y - itemHalf;
      const itemTop = it.y + itemHalf;
      let dy = 0.0;
      if (pTop < itemBottom) dy = itemBottom - pTop; else if (pTop > itemTop) dy = pTop - itemTop;
      const dist2 = dx*dx + dz*dz + dy*dy;
      const r = pr + 0.26;
      if (dist2 <= r*r){
  it.gone = true;
        // Mark yellow collection using new composite system; legacy fallback kept
        try {
          if (window.gameSave){
            if (it.payload && gameSave.markYellowCollected){
              gameSave.markYellowCollected(null, it.payload);
              try { console.debug('[SAVE][yellow] collected payload', it.payload); } catch(__){}
            } else if (gameSave.markItemCollected){
              gameSave.markItemCollected(it);
            }
            if (gameSave.saveNow) gameSave.saveNow();
          }
        } catch(_){ }
  if (typeof dispatchAction === 'function' && it.payload){ dispatchAction(it.payload, it); }
        try { if (window.sfx) sfx.play('./sfx/VRUN_HealthGet.mp3'); } catch(_){ }
  // Schedule ghost respawn
  try { setTimeout(()=>{ spawnItemWorld(it.x, it.y, it.z, it.payload, { ghost:true, fadeIn:true }); }, GHOST_RESPAWN_DELAY*1000); } catch(_){ }
        p.speed = 0.0; p.movementMode = 'stationary'; p.isDashing = false;
        const nowSec = state.nowSec || (performance.now()/1000);
        const age = Math.max(0, nowSec - (it.spawnT || nowSec));
        const outerAxis = { x: it.ax || 0, y: it.ay || 1, z: it.az || 0 };
        const innerAxis = { x: it.ix || 0, y: it.iy || 1, z: it.iz || 0 };
        const outerAngle = 0.35 * age;
        const innerAngle = 0.55 * age;
        if (typeof spawnPickupFloatingLinesWithRotation === 'function'){
          spawnPickupFloatingLinesWithRotation(it.x, it.y, it.z, 0.46, 0.28, outerAxis, outerAngle, innerAxis, innerAngle);
        } else if (typeof spawnPickupFloatingLines === 'function'){
          spawnPickupFloatingLines(it.x, it.y, it.z, 0.46, 0.28);
        }
      }
    }
  }
  // Always process purple items too
  if (typeof updatePurpleItems === 'function') updatePurpleItems(dt);
}

function updatePurpleItems(dt){
  if (!purpleItems.length) return;
  const p = state.player; const pr = Math.max(0.25, p.radius || 0.3);
  for (const it of purpleItems){
  if (it.gone) continue;
  if (it.ghost) continue; // ignore collisions when ghost
    const dx = it.x - p.x;
    const dz = it.z - p.z;
    const itemHalf = 0.24;
    const pTop = p.y + 0.25;
    const itemBottom = it.y - itemHalf;
    const itemTop = it.y + itemHalf;
    let dy = 0.0;
    if (pTop < itemBottom) dy = itemBottom - pTop; else if (pTop > itemTop) dy = pTop - itemTop;
    const dist2 = dx*dx + dz*dz + dy*dy;
    const r = pr + 0.26;
    if (dist2 <= r*r){
  it.gone = true;
      // Play distinct SFX
      try { if (window.sfx) sfx.play('./sfx/TunnelRun_EnterVRUN.mp3'); } catch(_){ }
      // Track purple collections per level (composite key) via save API
      try {
        if (window.gameSave && gameSave.trackPurpleItemCollected){
          gameSave.trackPurpleItemCollected(it);
          try { console.debug('[SAVE][purple] collected', it.x.toFixed(2), it.y.toFixed(2), it.z.toFixed(2)); } catch(__){}
          if (gameSave.saveNow) gameSave.saveNow();
        }
      } catch(_){ }
  // Schedule ghost respawn
  try { setTimeout(()=>{ spawnPurpleItemWorld(it.x, it.y, it.z, { ghost:true, fadeIn:true }); }, GHOST_RESPAWN_DELAY*1000); } catch(_){ }
      // Enhanced FX: triple density, faster spin/drift, longer life
      try {
        if (typeof spawnPickupFloatingLinesWithRotation === 'function'){
          const nowSec = state.nowSec || (performance.now()/1000);
          const age = Math.max(0, nowSec - (it.spawnT || nowSec));
          const outerAxis = { x: it.ax || 0, y: it.ay || 1, z: it.az || 0 };
          const innerAxis = { x: it.ix || 0, y: it.iy || 1, z: it.iz || 0 };
          const outerAngle = 0.55 * age; // faster
          const innerAngle = 0.85 * age; // faster
          // Use only purple-tinted custom bursts (no yellow)
          if (typeof spawnFloatingLinesCustom === 'function'){
            for (let k=0;k<3;k++){
              spawnFloatingLinesCustom(it.x, it.y, it.z,
                {r:0.72,g:0.35,b:1.0},{r:0.95,g:0.85,b:1.0}, 0.50, 0.30,
                {axis:outerAxis, angle: outerAngle + k*0.35 + Math.random()*0.4},
                {axis:innerAxis, angle: innerAngle + k*0.5 + Math.random()*0.6});
            }
          }
          // Increase global FX speeds/TTLs temporarily (if supported) by duplicating lines with longer ttl via direct push not exposed -> skipped for now
        }
      } catch(_){ }
    }
  }
}

function drawItems(mvp){
  const tNow = state.nowSec || (performance.now()/1000);
  let activeY, ghostYStable, ghostYFading, activeP, ghostPStable, ghostPFading;
  if (isEditorMode()){
    // In editor: force all items to appear as active (full color), ignore ghost visuals
    for (const it of items){ if (it && !it.gone){ it.ghost = false; it.fadeInStart = -1; } }
    for (const it of purpleItems){ if (it && !it.gone){ it.ghost = false; it.fadeInStart = -1; } }
    activeY = items.filter(it => !it.gone);
    activeP = purpleItems.filter(it => !it.gone);
    ghostYStable = ghostYFading = ghostPStable = ghostPFading = [];
  } else {
    activeY = items.filter(it => !it.gone && !it.ghost);
    ghostYStable = items.filter(it => !it.gone && it.ghost && !(it.fadeInStart>=0 && (tNow - it.fadeInStart) < GHOST_FADE_DURATION));
    ghostYFading = items.filter(it => !it.gone && it.ghost && ( it.fadeInStart>=0 && (tNow - it.fadeInStart) < GHOST_FADE_DURATION));
    activeP = purpleItems.filter(it => !it.gone && !it.ghost);
    ghostPStable = purpleItems.filter(it => !it.gone && it.ghost && !(it.fadeInStart>=0 && (tNow - it.fadeInStart) < GHOST_FADE_DURATION));
    ghostPFading = purpleItems.filter(it => !it.gone && it.ghost && ( it.fadeInStart>=0 && (tNow - it.fadeInStart) < GHOST_FADE_DURATION));
  }
  if (!activeY.length && !ghostYStable.length && !ghostYFading.length && !activeP.length && !ghostPStable.length && !ghostPFading.length) return;

  gl.useProgram(trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  gl.uniform1i(tc_u_useAnim, 1);
  gl.uniform1f(tc_u_wobbleAmp, 0.06);
  gl.uniform1f(tc_u_wobbleSpeed, 0.5);
  gl.uniform1f(tc_u_ttl, 99999.0);
  gl.uniform1i(tc_u_dashMode, 0);
  gl.bindVertexArray(trailCubeVAO);
  gl.depthMask(false);
  gl.disable(gl.BLEND);

  const scales = [1.00, 1.02, 1.04, 1.06];
  const innerBase = 0.28;
  const innerScales = [1.00, 1.02, 1.04];

  function drawBatch(list, outerColor, innerColor, alphaMul){
    if (!list.length) return;
    const inst = new Float32Array(list.length * 4);
    const axis = new Float32Array(list.length * 3);
    const axisInner = new Float32Array(list.length * 3);
    for (let i=0;i<list.length;i++){
      const it = list[i];
      inst[i*4+0] = it.x; inst[i*4+1] = it.y; inst[i*4+2] = it.z; inst[i*4+3] = it.spawnT;
      axis[i*3+0] = it.ax || 0; axis[i*3+1] = it.ay || 1; axis[i*3+2] = it.az || 0;
      axisInner[i*3+0] = it.ix || 0; axisInner[i*3+1] = it.iy || 1; axisInner[i*3+2] = it.iz || 0;
    }
    gl.uniform1f(tc_u_now, tNow);
    gl.uniform1f(tc_u_mulAlpha, alphaMul);
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
    if (typeof trailCubeVBO_Corners !== 'undefined'){
      if (state.cameraKindCurrent === 'top' && typeof getTrailCornerOffsetsBuffer === 'function'){
        const keys = new Array(list.length);
        for (let i=0;i<list.length;i++){ const it=list[i]; keys[i] = `itm@${it.x.toFixed(2)},${it.y.toFixed(2)},${it.z.toFixed(2)}`; }
        const packed = getTrailCornerOffsetsBuffer(keys, tNow);
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners); gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
      } else {
        const zeros = new Float32Array(list.length * 8 * 3);
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners); gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis); gl.bufferData(gl.ARRAY_BUFFER, axis, gl.DYNAMIC_DRAW);
    gl.uniform1f(tc_u_rotSpeed, 0.35);
    gl.uniform3f(tc_u_lineColor, outerColor[0], outerColor[1], outerColor[2]);
    for (let s of scales){ gl.uniform1f(tc_u_scale, 0.46 * s); gl.drawArraysInstanced(gl.LINES, 0, 24, list.length); }
    gl.uniform1f(tc_u_rotSpeed, 0.55);
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis); gl.bufferData(gl.ARRAY_BUFFER, axisInner, gl.DYNAMIC_DRAW);
    gl.uniform3f(tc_u_lineColor, innerColor[0], innerColor[1], innerColor[2]);
    for (let s of innerScales){ gl.uniform1f(tc_u_scale, innerBase * s); gl.drawArraysInstanced(gl.LINES, 0, 24, list.length); }
  }

  // Bottom view distance fade helper (returns multiplier for a single item)
  function bottomViewFadeForItem(it){
    if (state.cameraKindCurrent !== 'bottom') return 1.0;
    const band = (typeof window.__ITEM_OUTLINE_FADE_BAND === 'number') ? window.__ITEM_OUTLINE_FADE_BAND : 3.0;
    const minA = (typeof window.__ITEM_OUTLINE_MIN_ALPHA === 'number') ? window.__ITEM_OUTLINE_MIN_ALPHA : 0.0;
    if (!(band > 0)) return 1.0;
    const playerY = state.player ? (state.player.y || 0) : 0;
    // Item vertical extent (approx cube of half 0.24; keep 0.25 for simplicity)
    const half = 0.25;
    const yMin = it.y - half;
    const yMax = it.y + half;
    let d = 0.0;
    if (playerY < yMin) d = yMin - playerY; else if (playerY > yMax) d = playerY - yMax; else d = 0.0;
    let t = Math.min(1.0, Math.max(0.0, d / band));
    t = t*t*(3.0 - 2.0*t);
    let fade = 1.0 - t;
    if (fade < minA) fade = minA;
    return fade;
  }

  // Wrapper to apply bottom view fade potentially per-item; keeps batching if all fades==1
  function drawBatchWithBottomFade(list, outerColor, innerColor, baseAlpha){
    if (!list.length) return;
    if (state.cameraKindCurrent !== 'bottom') { drawBatch(list, outerColor, innerColor, baseAlpha); return; }
    // Compute fades
    const fades = new Array(list.length);
    let allOne = true;
    for (let i=0;i<list.length;i++){ const f = bottomViewFadeForItem(list[i]); fades[i]=f; if (f < 0.999) allOne = false; }
    if (allOne){ drawBatch(list, outerColor, innerColor, baseAlpha); return; }
    // Draw per distinct fade buckets to reduce draw calls: group items by rounded fade
    const buckets = new Map();
    for (let i=0;i<list.length;i++){
      const f = fades[i];
      const key = (Math.round(f*100)/100).toFixed(2); // 0.01 resolution
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(list[i]);
    }
    for (const [k, arr] of buckets.entries()){
      const f = parseFloat(k);
      drawBatch(arr, outerColor, innerColor, baseAlpha * f);
    }
  }

  // Active batches (opaque) with bottom fade
  drawBatchWithBottomFade(activeY, [1.0,0.95,0.2], [1.0,1.0,1.0], 1.0);
  drawBatchWithBottomFade(activeP, [0.72,0.35,1.0], [0.95,0.85,1.0], 1.0);

  // Enable blending for ghost passes
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Stable ghosts (gray, semi-transparent) with fade
  drawBatchWithBottomFade(ghostYStable, [0.5,0.5,0.5], [0.7,0.7,0.7], GHOST_ALPHA);
  drawBatchWithBottomFade(ghostPStable, [0.45,0.45,0.55], [0.65,0.65,0.75], GHOST_ALPHA);
  // Fading ghosts (draw individually for per-item alpha) + bottom fade
  function drawFading(list, outerColor, innerColor){
    for (const it of list){
      const age = (tNow - it.fadeInStart);
      const a = Math.min(1, age / GHOST_FADE_DURATION) * GHOST_ALPHA;
      const f = bottomViewFadeForItem(it);
      drawBatch([it], outerColor, innerColor, a * f);
    }
  }
  drawFading(ghostYFading, [0.5,0.5,0.5], [0.7,0.7,0.7]);
  drawFading(ghostPFading, [0.45,0.45,0.55], [0.65,0.65,0.75]);

  // Disable blending again (cleanup)
  gl.disable(gl.BLEND);
  gl.uniform1f(tc_u_mulAlpha, 1.0);

  gl.depthMask(true);
  gl.bindVertexArray(null);
}

// Expose in global scope
if (typeof window !== 'undefined'){
  window.initItemsFromBuilder = initItemsFromBuilder;
  window.spawnItemWorld = spawnItemWorld;
  window.spawnPurpleItemWorld = spawnPurpleItemWorld;
  window.removeItemsAtWorld = removeItemsAtWorld;
  window.listActiveItems = listActiveItems;
  window.listActivePurpleItems = listActivePurpleItems;
  window.updateItems = updateItems;
  window.updatePurpleItems = updatePurpleItems;
  window.drawItems = drawItems;
  // Helper to force all ghosts back to normal (used by editor)
  window.editorRevealAllItems = function(){
    for (const it of items){ if (it && !it.gone){ it.ghost = false; it.fadeInStart = -1; } }
    for (const it of purpleItems){ if (it && !it.gone){ it.ghost = false; it.fadeInStart = -1; } }
  };
  if (Array.isArray(window._pendingItems)){
    initItemsFromBuilder(window._pendingItems);
    delete window._pendingItems;
  }
  // If already in editor mode when this script loads, un-ghost immediately
  try { if (isEditorMode()) setTimeout(()=>{ if (typeof window.editorRevealAllItems==='function') window.editorRevealAllItems(); },0); } catch(_){ }
  // Editor: right-click to delete nearest item (yellow or purple)
  try {
    if (isEditorMode()){
      window.addEventListener('contextmenu', function(e){
        try {
          if (!isEditorMode()) return;
          const mx = e.clientX, my = e.clientY;
          if (typeof window.pickWorldRay === 'function'){
            const hit = window.pickWorldRay(mx, my); // expect {x,z}
            if (hit && typeof hit.x==='number' && typeof hit.z==='number'){
              let best=null, bestD=1e9, bestArr=null;
              function consider(arr){ for (const it of arr){ if (!it||it.gone) continue; const dx=it.x-hit.x, dz=it.z-hit.z; const d=dx*dx+dz*dz; if (d<bestD){ best=it; bestD=d; bestArr=arr; } } }
              consider(items); consider(purpleItems);
              if (best && bestArr){ best.gone=true; const idx=bestArr.indexOf(best); if (idx>=0) bestArr.splice(idx,1); try { console.debug('[EDITOR] removed item', best); } catch(_){ } }
              // Also attempt to remove a block at that grid cell (topmost span or single layer) regardless of selection
              try {
                const gx = Math.floor(hit.x + MAP_W*0.5);
                const gy = Math.floor(hit.z + MAP_H*0.5);
                if (gx>=0 && gy>=0 && gx<MAP_W && gy<MAP_H){
                  // Determine the highest occupied y (scan spans/columns)
                  let topY = -1;
                  const key = `${gx},${gy}`;
                  let spans = null;
                  try { spans = (window.columnSpans && window.columnSpans.get(key)) || null; } catch(_){ }
                  if (Array.isArray(spans) && spans.length){
                    for (const s of spans){ if (!s) continue; const b=s.b|0, h=s.h|0; if (h>0){ const t=b+h-1; if (t>topY) topY=t; } }
                  } else {
                    // Fallback to wall/height maps
                    try {
                      if (window.columnHeights && window.columnHeights.has(key)){
                        const h = window.columnHeights.get(key)|0; if (h>0){ let b=0; if (window.columnBases && window.columnBases.has(key)) b = window.columnBases.get(key)|0; topY = b + h - 1; }
                      } else if (typeof mapIdx==='function' && typeof map!=='undefined' && typeof TILE!=='undefined'){
                        const tile = map[mapIdx(gx,gy)]; if (tile===TILE.WALL || tile===TILE.NOCLIMB || tile===TILE.BAD) topY = 0;
                      }
                    } catch(_){ }
                  }
                  if (topY >= 0){
                    // Send removal op (server authoritative). Client local removal will occur via echo.
                    if (typeof window.mpSendMapOps === 'function') mpSendMapOps([{ op:'remove', key:`${gx},${gy},${topY}` }]);
                  }
                }
              } catch(_){ }
            }
          }
          e.preventDefault();
        } catch(_){ }
      });
    }
  } catch(_){ }
}
