// ============================================================================
// Wall and Column Rendering Pipeline System
// ============================================================================
/**
 * @fileoverview Advanced voxel-based wall and column rendering pipeline
 * 
 * Features:
 * - Instanced rendering of walls, tall columns, fences with voxel subdivision
 * - Dynamic transparency effects: fade bands, screendoor patterns, stippling
 * - Glitter animation effects for visual interest
 * - Player-relative transparency for visibility management in top-down view
 * - Wireframe outline rendering for editor and debug modes
 * - Multi-height column support with configurable voxel resolution
 * 
 * Architecture:
 * - Voxel-based geometry: Subdivided cubes for smooth lighting and effects
 * - Instance data: Position offsets for efficient batch rendering
 * - Shader effects: Distance fading, stipple patterns, animation support
 * - Buffer management: Separate VAOs for solid walls and wireframe outlines
 * 
 * Dependencies: gl-core.js (createProgram), global gl context, game state
 * Exports: Wall shaders, programs, VAOs, drawWalls(), drawTallColumns()
 * Side effects: Creates multiple VAO/VBO resources, modifies WebGL state
 */

// Wall shader resources are loaded via static script import in index.php
// Dependencies: js/pipelines/walls/shaders.js (loaded before this file)

// ╔════════════════════════════════════════════════════════════╗
// ║ SEGMENT: walls-shaders                                      ║
// ║ CONDEMNED: Extracted to pipelines/walls/shaders.js         ║
// ║ Content: WALL_VS, WALL_FS source + program creation        ║
// ╚════════════════════════════════════════════════════════════╝

// Wall shaders and program are now provided by shaders.js module
// Initialize shader resources when gl context is available

// Shader resources initialized from module
let wallProgram = null;
let wallUniforms = null;
let wallBasePosData = null;

// Legacy uniform references for compatibility (initialized after shader loading)
let wall_u_mvp, wall_u_origin, wall_u_scale, wall_u_height, wall_u_voxCount, wall_u_voxOff, wall_u_yBase;
let wall_u_useFade, wall_u_playerY, wall_u_fadeBand, wall_u_minAlpha, wall_u_color, wall_u_alpha;
let wall_u_glitterMode, wall_u_now, wall_u_stippleMode, wall_u_stippleAllow, wall_u_camXZ, wall_u_camY;
let wall_u_stippleRadius, wall_u_stippleInvert, wall_u_stippleAbove;

let wallCurrPosData = null; // Initialized after base data is loaded

// ╔════════════════════════════════════════════════════════════╗
// ║ SEGMENT: walls-buffers (delegated)                          ║
// ║ CONDEMNED: Logic lives in pipelines/walls/buffers.js       ║
// ║ This file now only references exported buffers             ║
// ╚════════════════════════════════════════════════════════════╝

// Accessors to buffer objects now come from buffers.js
function __wall_getBuffers(){
  try { if (window.getWallBuffers) return window.getWallBuffers(); } catch(_){ }
  return { wallVAO:null, wallVBO_PosBase:null, wallVBO_PosJitter:null, wallVBO_Inst:null, wallWireVAO:null };
}

// Enhanced initialization that sets up both shaders and VAOs
function initWallResources() {
  if (!window.initWallShaders || !window.createWallGeometry) {
    console.warn('Wall shaders module not loaded');
    return false;
  }

  const shaderResource = window.initWallShaders();
  if (!shaderResource) {
    console.error('Failed to initialize wall shaders');
    return false;
  }

  wallProgram = shaderResource.program;
  wallUniforms = shaderResource.uniforms;
  wallBasePosData = window.createWallGeometry();
  
  // Set up legacy uniform references for compatibility
  wall_u_mvp = wallUniforms.mvp;
  wall_u_origin = wallUniforms.origin;
  wall_u_scale = wallUniforms.scale;
  wall_u_height = wallUniforms.height;
  wall_u_voxCount = wallUniforms.voxCount;
  wall_u_voxOff = wallUniforms.voxOff;
  wall_u_yBase = wallUniforms.yBase;
  wall_u_useFade = wallUniforms.useFade;
  wall_u_playerY = wallUniforms.playerY;
  wall_u_fadeBand = wallUniforms.fadeBand;
  wall_u_minAlpha = wallUniforms.minAlpha;
  wall_u_color = wallUniforms.color;
  wall_u_alpha = wallUniforms.alpha;
  wall_u_glitterMode = wallUniforms.glitterMode;
  wall_u_now = wallUniforms.now;
  wall_u_stippleMode = wallUniforms.stippleMode;
  wall_u_stippleAllow = wallUniforms.stippleAllow;
  wall_u_camXZ = wallUniforms.camXZ;
  wall_u_camY = wallUniforms.camY;
  wall_u_stippleRadius = wallUniforms.stippleRadius;
  wall_u_stippleInvert = wallUniforms.stippleInvert;
  wall_u_stippleAbove = wallUniforms.stippleAbove;
  
  // Initialize VAOs after shader setup
  initWallVAOs();
  
  return true;
}

// Top-view jitter - initialized after geometry is loaded
let wallJitterLastTickSec = 0.0;
const wallJitterPeriod = 0.016;
const wallVertexProb = 0.10;
const wallVertexStep = 0.01;
const wallVertexMax = 0.03;
let wallCornerGroups = null;
let wallCornerList = null;
let wallCornerDisp = null;

// ----------------------------------------------------------------------------
// Deferred Initialization Driver
// ----------------------------------------------------------------------------
// Earlier refactor removed the retry loop that ensured shaders + geometry
// helpers were available before first draw. As a result, drawWalls() skips
// because wallProgram / VAOs never get created. We restore a lightweight
// deferred initializer here. It:
//  - waits for a WebGL context (window.gl)
//  - waits for wall shader helpers (initWallShaders, createWallGeometry)
//  - runs only once; subsequent failures stop after max retries
//  - updates exported globals after successful init
let __wallInitAttempted = false;
let __wallInitDone = false;
(function scheduleWallInit(){
  if (typeof window === 'undefined') return; // non-browser environment
  let retries = 0;
  const MAX_RETRIES = 60; // ~6s @100ms
  function tick(){
    if (__wallInitDone) return; // already done
    const depsReady = (window.gl && window.initWallShaders && window.createWallGeometry);
    if (depsReady){
      __wallInitAttempted = true;
      const ok = initWallResources();
      if (ok){
        __wallInitDone = true;
        // Refresh exported globals now that resources exist
        try {
          window.wallProgram = wallProgram;
          window.wallVAO = wallVAO;
          window.wallWireVAO = wallWireVAO;
        } catch(_) {}
        console.log('[WALLS] Initialized (deferred)');
        return;
      }
    }
    retries++;
    if (retries < MAX_RETRIES){
      setTimeout(tick, 100);
    } else {
      console.warn('[WALLS] Initialization gave up after waiting for dependencies.');
    }
  }
  // Delay first tick slightly to allow earlier pipeline scripts to register
  setTimeout(tick, 50);
})();

function initWallJitter() {
  if (!wallBasePosData) return false;
  
  wallCornerGroups = new Map();
  for (let i=0;i<wallBasePosData.length;i+=3){
    const x=wallBasePosData[i+0], y=wallBasePosData[i+1], z=wallBasePosData[i+2];
    const key = `${x}|${y}|${z}`;
    if (!wallCornerGroups.has(key)) wallCornerGroups.set(key, []);
    wallCornerGroups.get(key).push(i);
  }
  wallCornerList = Array.from(wallCornerGroups.values());
  wallCornerDisp = new Float32Array(wallCornerList.length * 3);
  
  return true;
}
function ensureWallGeomJitterTick(nowSec){
  // Skip if wall geometry is not initialized yet
  if (!wallCornerList) return;
  
  const now = nowSec || (performance.now()/1000);
  if (now - wallJitterLastTickSec < wallJitterPeriod - 1e-6) return;
  wallJitterLastTickSec = now;
  const total = wallCornerList.length;
  const count = Math.max(1, Math.round(total * wallVertexProb));
  const chosen = new Set();
  while (chosen.size < count){ chosen.add(Math.floor(Math.random()*total)); }
  chosen.forEach((ci)=>{
    const baseIx = ci*3;
    const oldX = wallCornerDisp[baseIx+0], oldY = wallCornerDisp[baseIx+1], oldZ = wallCornerDisp[baseIx+2];
    const nx = Math.max(-wallVertexMax, Math.min(wallVertexMax, oldX + (Math.random()*2-1)*wallVertexStep));
    const ny = Math.max(-wallVertexMax, Math.min(wallVertexMax, oldY + (Math.random()*2-1)*wallVertexStep));
    const nz = Math.max(-wallVertexMax, Math.min(wallVertexMax, oldZ + (Math.random()*2-1)*wallVertexStep));
    const dx = nx - oldX, dy = ny - oldY, dz = nz - oldZ;
    const idxList = wallCornerList[ci];
    for (let k=0;k<idxList.length;k++){
      const idx = idxList[k];
      wallCurrPosData[idx+0] = wallCurrPosData[idx+0] + dx;
      wallCurrPosData[idx+1] = wallCurrPosData[idx+1] + dy;
      wallCurrPosData[idx+2] = wallCurrPosData[idx+2] + dz;
    }
    wallCornerDisp[baseIx+0]=nx; wallCornerDisp[baseIx+1]=ny; wallCornerDisp[baseIx+2]=nz;
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_PosJitter);
  gl.bufferData(gl.ARRAY_BUFFER, wallCurrPosData, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

function drawWalls(mvp, viewKind /* 'bottom' | 'top' | undefined */){
  // Late init fallback: if skipped earlier but deps now exist, try once
  if (!wallProgram && typeof window !== 'undefined' && window.gl && window.initWallShaders && window.createWallGeometry){
    try { initWallResources(); } catch(_) {}
  }
  // Update persistent polygon point jitter
    if (state.cameraKindCurrent === 'top' && typeof ensureWallGeomJitterTick === 'function') {
      ensureWallGeomJitterTick(state.nowSec || (performance.now()/1000));
    }
  // Filter out ground-level wall tiles that are represented as tall columns.
  // Important: do NOT hide a ground wall if only elevated spans (base>0) exist there.
  let data = window.instWall || new Float32Array(0);
  // Split instances into normal vs BAD vs HALF, and hide ground cube if spans include base=0
  let wallsNormal = new Float32Array(0);
  let wallsBad = new Float32Array(0);
  let wallsHalf = new Float32Array(0);
  let wallsFence = new Float32Array(0);
  let wallsBadFence = new Float32Array(0);
  let wallsLevelChange = new Float32Array(0);
  let wallsNoClimb = new Float32Array(0);
  if (data.length) {
    // Prefer spans when available regardless of feature flag
    const hasSpans = (typeof columnSpans !== 'undefined') && columnSpans && typeof columnSpans.get === 'function' && columnSpans.size > 0;
    const hasHeights = (typeof columnHeights !== 'undefined') && columnHeights && typeof columnHeights.has === 'function' && columnHeights.size > 0;
    const hasBases = (typeof columnBases !== 'undefined') && columnBases && typeof columnBases.get === 'function' && columnBases.size >= 0; // may be 0 size
  const filteredNormal = [];
  const filteredBad = [];
  const filteredHalf = [];
  const filteredFence = [];
  const filteredBadFence = [];
  const filteredLevelChange = [];
  const filteredNoClimb = [];
    for (let i=0; i<data.length; i+=2){
      const x = data[i], y = data[i+1];
      const key = `${x},${y}`;
      // Read cell value early to allow special cases
      const cell = (typeof map !== 'undefined' && typeof mapIdx==='function' && typeof TILE!=='undefined') ? map[mapIdx(x,y)] : 0;
      // Always render LEVELCHANGE tiles, even if base-0 spans would normally hide the ground cube
      if (cell === TILE.LEVELCHANGE){ filteredLevelChange.push(x,y); continue; }
      let hideGroundWall = false;
      // Determine if the ground cube itself should be flagged BAD: either map says BAD for ground level
      // or spans report a hazardous span at base 0.
  let isBadTile = (typeof map !== 'undefined' && typeof mapIdx === 'function' && typeof TILE !== 'undefined') ? (map[mapIdx(x,y)] === TILE.BAD) : false;
  const isHalfTile = (typeof map !== 'undefined' && typeof mapIdx === 'function' && typeof TILE !== 'undefined') ? (map[mapIdx(x,y)] === TILE.HALF) : false;
      if (hasSpans){
        const spans = columnSpans.get(key);
        if (Array.isArray(spans)){
          // Only treat solid spans (t==0,1,9 or undefined) as hiding the ground cube at base 0.
          // Non-solid markers like portal (t:5) and lock (t:6) should not hide the ground wall.
          hideGroundWall = spans.some(s => {
            if (!s) return false; const b=(s.b|0), h=(s.h|0); if (h<=0) return false; const t=((s.t|0)||0);
            if (t===2 || t===3 || t===5 || t===6) return false; // fence/badfence/portal/lock are non-solid for ground hiding
            return b === 0;
          });
          // If any hazardous solid span sits at base 0, treat ground cube as BAD even if map isn't BAD
          if (!isBadTile){ isBadTile = spans.some(s => s && ((s.b|0)===0) && ((s.h|0)>0) && (((s.t|0)||0)===1)); }
        }
      } else if (hasHeights && columnHeights.has(key)){
        if (hasBases && columnBases.has(key)){
          hideGroundWall = ((columnBases.get(key)|0) === 0);
        } else {
          // No base info -> conservatively assume ground-level column
          hideGroundWall = true;
        }
      }
      if (!hideGroundWall){
        if (cell === TILE.FENCE) filteredFence.push(x,y);
        else if (cell === TILE.BADFENCE) filteredBadFence.push(x,y);
        else if (cell === TILE.NOCLIMB) filteredNoClimb.push(x,y);
        else if (isBadTile) filteredBad.push(x,y);
        else if (isHalfTile) filteredHalf.push(x,y);
        else filteredNormal.push(x,y);
      }
    }
  wallsNormal = new Float32Array(filteredNormal);
  wallsBad = new Float32Array(filteredBad);
  wallsHalf = new Float32Array(filteredHalf);
  wallsFence = new Float32Array(filteredFence);
  wallsBadFence = new Float32Array(filteredBadFence);
  wallsLevelChange = new Float32Array(filteredLevelChange);
  wallsNoClimb = new Float32Array(filteredNoClimb);
  }
  const totalCount = wallsNormal.length + wallsBad.length + wallsHalf.length + wallsFence.length + wallsBadFence.length + wallsLevelChange.length + wallsNoClimb.length;
  if (!totalCount) return;
  
  // Ensure wall resources are initialized before drawing
  const { wallVAO } = __wall_getBuffers();
  if (!wallProgram || !wallVAO) {
    console.warn('[WALLS] Drawing skipped - resources not initialized');
    return;
  }
  
  gl.useProgram(wallProgram);
  gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
  gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(wall_u_scale, 1.0);
  gl.uniform1f(wall_u_height, 1.0);
  gl.uniform1f(wall_u_yBase, 0.0);
  gl.uniform1f(wall_u_now, state.nowSec || (performance.now()/1000));
  // Top-view screendoor settings
  if (viewKind === 'top') {
    gl.uniform1i(wall_u_stippleMode, (state.topStippleEnabled===0)?0:1);
    gl.uniform1f(wall_u_stippleAllow, (typeof state.topStippleAllow==='number')? state.topStippleAllow : 1.0);
  // Bind to camera: use last computed top eye if available; fallback to camFollow
  const eyeTop = (typeof window !== 'undefined' && Array.isArray(window._lastTopEye)) ? window._lastTopEye : null;
  const cx = eyeTop ? eyeTop[0] : (state?.camFollow?.x || 0);
  const cz = eyeTop ? eyeTop[2] : (state?.camFollow?.z || 0);
  const cy = eyeTop ? eyeTop[1] : ((state?.camFollow?.y || 0) + 2.6);
  gl.uniform2f(wall_u_camXZ, cx, cz);
  gl.uniform1f(wall_u_camY, cy);
  // Increase passthrough sphere radius by 40% (default 3.0 -> 4.2)
  gl.uniform1f(wall_u_stippleRadius, (typeof state.topStippleRadius==='number') ? state.topStippleRadius : 4.2);
    gl.uniform1i(wall_u_stippleInvert, (typeof state.topStippleInvert==='number') ? (state.topStippleInvert|0) : 0);
    gl.uniform1i(wall_u_stippleAbove, (typeof state.topStippleAbove==='number') ? (state.topStippleAbove|0) : 1);
  }
  else { gl.uniform1i(wall_u_stippleMode, 0); gl.uniform1f(wall_u_stippleAllow, 0.0); }
  // Height-based fade config (enabled only for bottom view)
  const useFade = (viewKind === 'bottom') ? 1 : 0;
  gl.uniform1i(wall_u_useFade, useFade);
  gl.uniform1f(wall_u_playerY, state.player ? (state.player.y || 0.0) : 0.0);
  gl.uniform1f(wall_u_fadeBand, 3.0);
  gl.uniform1f(wall_u_minAlpha, 0.15);
  // CPU-side culling for fully faded blocks in bottom view
  const __isBottomView = (viewKind === 'bottom');
  const __playerY_forCull = state.player ? (state.player.y || 0.0) : 0.0;
  const __fadeBand_forCull = 3.0;
  const __isFullyFaded = (yBase, height) => {
    if (!__isBottomView) return false;
    const yMin = yBase;
    const yMax = yBase + height;
    let minD = 0.0;
    if (__playerY_forCull < yMin) minD = yMin - __playerY_forCull;
    else if (__playerY_forCull > yMax) minD = __playerY_forCull - yMax;
    else minD = 0.0;
    return minD >= __fadeBand_forCull;
  };
  const voxX=2, voxY=2, voxZ=2;
  gl.uniform3f(wall_u_voxCount, voxX, voxY, voxZ);
  const { wallVBO_PosJitter, wallVBO_PosBase, wallVBO_Inst } = __wall_getBuffers();
  gl.bindVertexArray(wallVAO);
  // Point attribute 0 to the appropriate buffer per view (top=jitter, bottom=base)
  gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
  // First: normal walls depth pre-pass (if any)
  if (wallsNormal.length && !__isFullyFaded(0.0, 1.0)){
    gl.bufferData(gl.ARRAY_BUFFER, wallsNormal, gl.DYNAMIC_DRAW);
    const wallCol = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
    gl.uniform3fv(wall_u_color, new Float32Array(wallCol));
    gl.uniform1f(wall_u_alpha, 0.65);
    gl.uniform1i(wall_u_glitterMode, 0);
    // Depth pre-pass
    gl.disable(gl.BLEND);
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsNormal.length/2);
        }
      }
    }
  }
  // Second: LEVELCHANGE tiles (always draw, even if no normal walls)
  if (wallsLevelChange.length && !__isFullyFaded(0.0, 1.0)){
    gl.bufferData(gl.ARRAY_BUFFER, wallsLevelChange, gl.DYNAMIC_DRAW);
    gl.uniform3fv(wall_u_color, new Float32Array([1.0, 0.55, 0.05]));
    gl.uniform1f(wall_u_alpha, 0.45);
    gl.uniform1i(wall_u_glitterMode, 1);
    // Depth pre-pass for portals
    gl.disable(gl.BLEND);
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsLevelChange.length/2);
        }
      }
    }
    // Blended color pass for portals
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.depthFunc(gl.LESS);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsLevelChange.length/2);
        }
      }
    }
  }
  // Third: normal walls blended color pass (if any). Rebind buffer and reset uniforms to avoid color bleed from portals.
  if (wallsNormal.length && !__isFullyFaded(0.0, 1.0)){
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    gl.bufferData(gl.ARRAY_BUFFER, wallsNormal, gl.DYNAMIC_DRAW);
    const wallCol2n = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
    gl.uniform3fv(wall_u_color, new Float32Array(wallCol2n));
    gl.uniform1f(wall_u_alpha, 0.65);
    gl.uniform1i(wall_u_glitterMode, 0);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsNormal.length/2);
        }
      }
    }
  }
  // Second: half-step walls (half height)
  if (wallsHalf.length && !__isFullyFaded(0.0, 0.5)){
  const { wallVBO_Inst } = __wall_getBuffers();
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
    gl.bufferData(gl.ARRAY_BUFFER, wallsHalf, gl.DYNAMIC_DRAW);
    const wallCol = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
    gl.uniform3fv(wall_u_color, new Float32Array(wallCol));
    gl.uniform1f(wall_u_alpha, 0.65);
    gl.uniform1i(wall_u_glitterMode, 0);
    gl.uniform1f(wall_u_height, 0.5);
    gl.uniform1f(wall_u_yBase, 0.0);
    // Depth pre-pass
    gl.disable(gl.BLEND);
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsHalf.length/2);
        }
      }
    }
    // Blended color pass
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsHalf.length/2);
        }
      }
    }
    // Reset height uniform back to 1.0 for subsequent draws
    gl.uniform1f(wall_u_height, 1.0);
  }
  // Fences (post + rails) with brightened level color and adjacency-based rails
  if (wallsFence.length && !__isFullyFaded(0.0, 1.5)){
    // Instance buffer holds (x,y) grid coords
  const { wallVBO_Inst } = __wall_getBuffers();
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
    gl.bufferData(gl.ARRAY_BUFFER, wallsFence, gl.DYNAMIC_DRAW);
    // Color
    let baseCol = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
    const bright = [Math.min(1, baseCol[0]*1.35+0.05), Math.min(1, baseCol[1]*1.35+0.05), Math.min(1, baseCol[2]*1.35+0.05)];
    gl.uniform3fv(wall_u_color, new Float32Array(bright));
    gl.uniform1f(wall_u_alpha, 0.95);
    gl.uniform1i(wall_u_glitterMode, 0);
    // Use a 5x5x5 voxel grid inside each tile to compose small cubes
    gl.uniform3f(wall_u_voxCount, 5.0, 5.0, 5.0);
  // Rails only (no posts). Set overall fence height scale for rail layers
  gl.uniform1f(wall_u_height, 1.5);
  gl.uniform1f(wall_u_yBase, 0.0);
    // Helper: vertical adjacency checks for ground-level top-extension
    const hasFenceAtLevel0 = (x,y,lv)=>{
      const k = `${x},${y}`; const sp = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(k) : null;
      if (!Array.isArray(sp)) return false; for (const s of sp){ if (!s) continue; const b=(s.b|0), h=(s.h|0), t=((s.t|0)||0); if ((t===2||t===3) && h>0 && lv>=b && lv<b+h) return true; }
      return false;
    };
    const hasSolidAtLevel0 = (x,y,lv)=>{
      const k = `${x},${y}`; const sp = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(k) : null;
      if (Array.isArray(sp)){
        for (const s of sp){ if (!s) continue; const b=(s.b|0), h=(s.h|0), t=((s.t|0)||0); if (h>0 && (t!==2 && t!==3) && lv>=b && lv<b+h) return true; }
      }
      return false;
    };
    // Precompute per-instance vertical extension sets for ground level
    const groundAll = new Set(); // bottom always extends to map bottom
    const groundTop = new Set();  // need top extension if solid/fence at level 1
    for (let i=0;i<wallsFence.length;i+=2){
      const gx = wallsFence[i]|0, gy = wallsFence[i+1]|0; const key=`${gx},${gy}`; groundAll.add(key);
      if (hasFenceAtLevel0(gx,gy,1) || hasSolidAtLevel0(gx,gy,1)) groundTop.add(key);
    }
    // Rails per direction (N,E,S,W) with adaptive vertical rows
    const count = wallsFence.length/2;
    const dirs = [ [0,-1], [1,0], [0,1], [-1,0] ];
    for (let d=0; d<dirs.length; d++){
      const dx = dirs[d][0], dy = dirs[d][1];
      const railInstances = new Float32Array(wallsFence.length);
      let have = 0;
      for (let i=0;i<count;i++){
        const gx = wallsFence[i*2+0]|0;
        const gy = wallsFence[i*2+1]|0;
        const nx = gx + dx, ny = gy + dy;
        if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
  const neighbor = map[mapIdx(nx,ny)];
        const connect = (neighbor===TILE.FENCE) || (neighbor===TILE.BADFENCE) || (neighbor===TILE.WALL) || (neighbor===TILE.BAD) || (neighbor===TILE.FILL) || (neighbor===TILE.HALF) || (neighbor===TILE.NOCLIMB);
        if (connect){ railInstances[have*2+0]=gx; railInstances[have*2+1]=gy; have++; }
      }
      if (!have) continue;
      const arr = railInstances.subarray(0, have*2);
  const { wallVBO_Inst } = __wall_getBuffers();
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
      // Helper to draw a filtered subset for a given vy
      const drawVy = (vy, filterSet)=>{
        let subset = arr;
        if (filterSet){
          const tmp = new Float32Array(arr.length);
          let h2=0; const N = arr.length/2;
          for (let i=0;i<N;i++){
            const gx = arr[i*2+0]|0, gy = arr[i*2+1]|0; if (filterSet.has(`${gx},${gy}`)){ tmp[h2*2+0]=gx; tmp[h2*2+1]=gy; h2++; }
          }
          if (!h2) return; subset = tmp.subarray(0, h2*2);
          const { wallVBO_Inst } = __wall_getBuffers();
          gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, subset, gl.DYNAMIC_DRAW);
        }
        // Depth pre-pass
        gl.disable(gl.BLEND);
        gl.colorMask(false, false, false, false);
        gl.depthMask(true);
        gl.depthFunc(gl.LESS);
        if (dx === 1 && dy === 0){ // East: from center (2) to edge (4)
          for (const vx of [2,3,4]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === -1 && dy === 0){ // West: from center (2) to edge (0)
          for (const vx of [0,1,2]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === 0 && dy === -1){ // North: from center (2) to edge (0)
          for (const vz of [0,1,2]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === 0 && dy === 1){ // South: from center (2) to edge (4)
          for (const vz of [2,3,4]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        }
        // Color pass
        gl.colorMask(true, true, true, true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);
        if (dx === 1 && dy === 0){
          for (const vx of [2,3,4]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === -1 && dy === 0){
          for (const vx of [0,1,2]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === 0 && dy === -1){
          for (const vz of [0,1,2]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === 0 && dy === 1){
          for (const vz of [2,3,4]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        }
      };
      // Base rail rows
      for (const vy of [1,2]){ drawVy(vy, null); }
      // Extend to ground (bottom row) for all ground fences
      drawVy(0, groundAll);
      // Extend to top rows when there is solid/fence above level 1
      if (groundTop.size){ drawVy(3, groundTop); drawVy(4, groundTop); }
    }
    // Restore defaults for subsequent draws
    gl.uniform1f(wall_u_height, 1.0);
    gl.uniform1f(wall_u_yBase, 0.0);
  }
  // Fourth: NOCLIMB walls (color from palette helper, static/glitter)
  if (wallsNoClimb.length && !__isFullyFaded(0.0, 1.0)){
    gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
    gl.bufferData(gl.ARRAY_BUFFER, wallsNoClimb, gl.DYNAMIC_DRAW);
    const ncCol = (typeof getLevelNoClimbColorRGB === 'function') ? getLevelNoClimbColorRGB() : [0.7,0.7,0.7];
    gl.uniform3fv(wall_u_color, new Float32Array(ncCol));
    gl.uniform1f(wall_u_alpha, 0.65);
    gl.uniform1i(wall_u_glitterMode, 1);
    // Depth pre-pass
    gl.disable(gl.BLEND);
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsNoClimb.length/2);
        }
      }
    }
    // Color pass
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsNoClimb.length/2);
        }
      }
    }
  }
  // BADFENCE rails: same geometry as fence but red and glittered; hazardous
  if (wallsBadFence.length){
    gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
    gl.bufferData(gl.ARRAY_BUFFER, wallsBadFence, gl.DYNAMIC_DRAW);
    // Red color like BAD
    gl.uniform3fv(wall_u_color, new Float32Array([0.85, 0.10, 0.12]));
    gl.uniform1f(wall_u_alpha, 0.95);
    gl.uniform1i(wall_u_glitterMode, 1);
    gl.uniform3f(wall_u_voxCount, 5.0, 5.0, 5.0);
    // Match fence rail height/profile exactly so visuals/collision line up
    gl.uniform1f(wall_u_height, 1.5);
    gl.uniform1f(wall_u_yBase, 0.0);
    // Precompute vertical extension for ground-level BADFENCE similar to fences
    const hasFenceAtLevel0_B = (x,y,lv)=>{
      const k = `${x},${y}`; const sp = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(k) : null;
      if (!Array.isArray(sp)) return false; for (const s of sp){ if (!s) continue; const b=(s.b|0), h=(s.h|0), t=((s.t|0)||0); if ((t===2||t===3) && h>0 && lv>=b && lv<b+h) return true; }
      return false;
    };
    const hasSolidAtLevel0_B = (x,y,lv)=>{
      const k = `${x},${y}`; const sp = (typeof columnSpans!=='undefined' && columnSpans && columnSpans.get) ? columnSpans.get(k) : null;
      if (Array.isArray(sp)){
        for (const s of sp){ if (!s) continue; const b=(s.b|0), h=(s.h|0), t=((s.t|0)||0); if (h>0 && (t!==2 && t!==3) && lv>=b && lv<b+h) return true; }
      }
      return false;
    };
    const groundAllB = new Set();
    const groundTopB = new Set();
    for (let i=0;i<wallsBadFence.length;i+=2){
      const gx = wallsBadFence[i]|0, gy = wallsBadFence[i+1]|0; const key=`${gx},${gy}`; groundAllB.add(key);
      if (hasFenceAtLevel0_B(gx,gy,1) || hasSolidAtLevel0_B(gx,gy,1)) groundTopB.add(key);
    }
    const count = wallsBadFence.length/2;
    const dirs = [ [0,-1], [1,0], [0,1], [-1,0] ];
    for (let d=0; d<dirs.length; d++){
      const dx = dirs[d][0], dy = dirs[d][1];
      const railInstances = new Float32Array(wallsBadFence.length);
      let have = 0;
      for (let i=0;i<count;i++){
        const gx = wallsBadFence[i*2+0]|0;
        const gy = wallsBadFence[i*2+1]|0;
        const nx = gx + dx, ny = gy + dy;
        if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
        const neighbor = map[mapIdx(nx,ny)];
        const connect = (neighbor===TILE.BADFENCE) || (neighbor===TILE.FENCE) || (neighbor===TILE.WALL) || (neighbor===TILE.BAD) || (neighbor===TILE.FILL) || (neighbor===TILE.HALF) || (neighbor===TILE.NOCLIMB);
        if (connect){ railInstances[have*2+0]=gx; railInstances[have*2+1]=gy; have++; }
      }
      if (!have) continue;
      const arr = railInstances.subarray(0, have*2);
      gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
      // Helper to draw a filtered subset for a given vy
      const drawVy = (vy, filterSet)=>{
        let subset = arr;
        if (filterSet){
          const tmp = new Float32Array(arr.length);
          let h2=0; const N = arr.length/2;
          for (let i=0;i<N;i++){
            const gx = arr[i*2+0]|0, gy = arr[i*2+1]|0; if (filterSet.has(`${gx},${gy}`)){ tmp[h2*2+0]=gx; tmp[h2*2+1]=gy; h2++; }
          }
          if (!h2) return; subset = tmp.subarray(0, h2*2);
          gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, subset, gl.DYNAMIC_DRAW);
        }
        // Depth pre-pass
        gl.disable(gl.BLEND);
        gl.colorMask(false, false, false, false);
        gl.depthMask(true);
        gl.depthFunc(gl.LESS);
        if (dx === 1 && dy === 0){ // East: from center (2) to edge (4)
          for (const vx of [2,3,4]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === -1 && dy === 0){ // West: from center (2) to edge (0)
          for (const vx of [0,1,2]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === 0 && dy === -1){ // North: from center (2) to edge (0)
          for (const vz of [0,1,2]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === 0 && dy === 1){ // South: from center (2) to edge (4)
          for (const vz of [2,3,4]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        }
        // Color pass
        gl.colorMask(true, true, true, true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);
        if (dx === 1 && dy === 0){
          for (const vx of [2,3,4]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === -1 && dy === 0){
          for (const vx of [0,1,2]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === 0 && dy === -1){
          for (const vz of [0,1,2]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        } else if (dx === 0 && dy === 1){
          for (const vz of [2,3,4]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
        }
      };
      // Base rail rows
      for (const vy of [1,2]){ drawVy(vy, null); }
      // Extend to ground (bottom row) for all ground fences
      drawVy(0, groundAll);
      // Extend to top rows when there is solid/fence above level 1
      if (groundTop.size){ drawVy(3, groundTop); drawVy(4, groundTop); }
    }
    // Restore defaults for subsequent draws
    gl.uniform1f(wall_u_height, 1.0);
    gl.uniform1f(wall_u_yBase, 0.0);
  }
  // Floating/elevated fences from spans (t==2 normal, t==3 bad) at arbitrary heights (no collision, visuals only)
  {
    // Collect per-level sets of cells that contain a fence span at that exact level
    const hasSpanData = (typeof columnSpans !== 'undefined') && columnSpans && typeof columnSpans.entries === 'function' && columnSpans.size > 0;
    if (hasSpanData){
      /** @type {Map<number, Set<string>>} */
      const byLevel = new Map();
      /** @type {Map<number, boolean>} indicates if a level has any bad (t==3) fence spans */
      const levelHasBad = new Map();
      for (const [key, spans] of columnSpans.entries()){
        if (!Array.isArray(spans)) continue;
        const [gxStr, gyStr] = key.split(',');
        const gx = parseInt(gxStr, 10)|0, gy = parseInt(gyStr, 10)|0;
        if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
        for (const s of spans){
          if (!s) continue; const h=(s.h|0); const b=(s.b|0); const t=(s.t|0)||0;
          if (h<=0 || (t!==2 && t!==3)) continue; // only fence marker spans (2=normal,3=bad)
          for (let lv=b; lv<b+h; lv++){
            if (lv === 0) continue; // ground-level fence handled by map-based pass above
            let set = byLevel.get(lv); if (!set){ set = new Set(); byLevel.set(lv, set); }
            set.add(`${gx},${gy}`);
            if (t===3) levelHasBad.set(lv, true);
          }
        }
      }
      if (byLevel.size){
        // Helper: check if a cell has a fence at given level (t==2 or t==3 covering that y)
        const hasFenceAtLevel = (x,y,lv)=>{
          const k = `${x},${y}`;
          const sp = columnSpans.get(k);
          if (!Array.isArray(sp)) return false;
          for (const s of sp){ if (!s) continue; const b=(s.b|0), h=(s.h|0), t=((s.t|0)||0); if ((t===2||t===3) && h>0 && lv>=b && lv<b+h) return true; }
          return false;
        };
        // Helper: check if a cell has any solid span covering level (for visual connectivity into columns)
        const hasSolidAtLevel = (x,y,lv)=>{
          const k = `${x},${y}`;
          const sp = columnSpans.get(k);
          if (Array.isArray(sp)){
            for (const s of sp){ if (!s) continue; const b=(s.b|0), h=(s.h|0), t=((s.t|0)||0); if (h>0 && (t!==2 && t!==3) && lv>=b && lv<b+h) return true; }
          }
          // Fallback: ground-only map tiles if lv==0 (already skipped above), keep false by default
          return false;
        };
        // Shared color/style for elevated fences (normal): brightened level color
        gl.uniform1i(wall_u_glitterMode, 0);
        gl.uniform3f(wall_u_voxCount, 5.0, 5.0, 5.0);
        gl.uniform1f(wall_u_height, 1.5);
        // For determinism, draw levels in ascending order
        const levels = Array.from(byLevel.keys()).sort((a,b)=>a-b);
        for (const lv of levels){
          const set = byLevel.get(lv); if (!set || set.size===0) continue;
          // Choose color per-level: red/glitter if this level contains any bad-fence spans (t==3)
          const anyBadFence = !!levelHasBad.get(lv);
          if (anyBadFence){ gl.uniform3fv(wall_u_color, new Float32Array([0.85, 0.10, 0.12])); gl.uniform1f(wall_u_alpha, 0.95); gl.uniform1i(wall_u_glitterMode, 1); }
          else {
            let baseCol2 = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
            const bright2 = [Math.min(1, baseCol2[0]*1.35+0.05), Math.min(1, baseCol2[1]*1.35+0.05), Math.min(1, baseCol2[2]*1.35+0.05)];
            gl.uniform3fv(wall_u_color, new Float32Array(bright2));
            gl.uniform1f(wall_u_alpha, 0.95);
            gl.uniform1i(wall_u_glitterMode, 0);
          }
          // Pack instances for this level
          const pts = Array.from(set);
          const inst = new Float32Array(pts.length*2);
          for (let i=0;i<pts.length;i++){ const [sx,sy]=pts[i].split(',').map(n=>parseInt(n,10)); inst[i*2+0]=sx; inst[i*2+1]=sy; }
          gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
          gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
          // Offset all rails by base level
          gl.uniform1f(wall_u_yBase, lv * 1.0);
          // Build per-level vertical extension sets
          const needBottom = new Set();
          const needTop = new Set();
          for (let i=0;i<pts.length;i++){
            const [gx,gy] = pts[i].split(',').map(n=>parseInt(n,10));
            if (lv === 0 || hasFenceAtLevel(gx,gy,lv-1) || hasSolidAtLevel(gx,gy,lv-1)) needBottom.add(`${gx},${gy}`);
            if (hasFenceAtLevel(gx,gy,lv+1) || hasSolidAtLevel(gx,gy,lv+1)) needTop.add(`${gx},${gy}`);
          }
          const count = pts.length;
          const dirs = [ [0,-1], [1,0], [0,1], [-1,0] ];
          for (let d=0; d<dirs.length; d++){
            const dx = dirs[d][0], dy = dirs[d][1];
            const railInstances = new Float32Array(inst.length);
            let have = 0;
            for (let i=0;i<count;i++){
              const gx = inst[i*2+0]|0; const gy = inst[i*2+1]|0;
              const nx = gx + dx, ny = gy + dy;
              if (nx<0||ny<0||nx>=MAP_W||ny>=MAP_H) continue;
              // Connect to fence at same level, or to any solid span at same level
              if (hasFenceAtLevel(nx,ny,lv) || hasSolidAtLevel(nx,ny,lv)){
                railInstances[have*2+0]=gx; railInstances[have*2+1]=gy; have++;
              }
            }
            if (!have) continue;
            const arr = railInstances.subarray(0, have*2);
            gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            // Helper to draw subsets by vy with optional filters
            const drawVy = (vy, filterSet)=>{
              let subset = arr;
              if (filterSet){
                const tmp = new Float32Array(arr.length);
                let h2=0; const N = arr.length/2;
                for (let i=0;i<N;i++){
                  const gx = arr[i*2+0]|0, gy = arr[i*2+1]|0; if (filterSet.has(`${gx},${gy}`)){ tmp[h2*2+0]=gx; tmp[h2*2+1]=gy; h2++; }
                }
                if (!h2) return; subset = tmp.subarray(0, h2*2);
                gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, subset, gl.DYNAMIC_DRAW);
              }
              // Depth pre-pass
              gl.disable(gl.BLEND);
              gl.colorMask(false, false, false, false);
              gl.depthMask(true);
              gl.depthFunc(gl.LESS);
              if (dx === 1 && dy === 0){ // East
                for (const vx of [2,3,4]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
              } else if (dx === -1 && dy === 0){ // West
                for (const vx of [0,1,2]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
              } else if (dx === 0 && dy === -1){ // North
                for (const vz of [0,1,2]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
              } else if (dx === 0 && dy === 1){ // South
                for (const vz of [2,3,4]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
              }
              // Color pass
              gl.colorMask(true, true, true, true);
              gl.enable(gl.BLEND);
              gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
              gl.depthMask(false);
              gl.depthFunc(gl.LEQUAL);
              if (dx === 1 && dy === 0){
                for (const vx of [2,3,4]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
              } else if (dx === -1 && dy === 0){
                for (const vx of [0,1,2]){ gl.uniform3f(wall_u_voxOff, vx, vy, 2.0); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
              } else if (dx === 0 && dy === -1){
                for (const vz of [0,1,2]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
              } else if (dx === 0 && dy === 1){
                for (const vz of [2,3,4]){ gl.uniform3f(wall_u_voxOff, 2.0, vy, vz); gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, subset.length/2); }
              }
            };
            // Base rail rows
            drawVy(1, null);
            drawVy(2, null);
            // Extend bottom if needed
            if (needBottom.size) drawVy(0, needBottom);
            // Extend top if needed
            if (needTop.size){ drawVy(3, needTop); drawVy(4, needTop); }
          }
        }
        // Restore defaults for subsequent draws
        gl.uniform1f(wall_u_height, 1.0);
        gl.uniform1f(wall_u_yBase, 0.0);
      }
    }
  }
  // Third: BAD walls
  if (wallsBad.length && !__isFullyFaded(0.0, 1.0)){
    gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
    gl.bufferData(gl.ARRAY_BUFFER, wallsBad, gl.DYNAMIC_DRAW);
    gl.uniform3fv(wall_u_color, new Float32Array([0.85, 0.10, 0.12]));
    gl.uniform1f(wall_u_alpha, 0.85);
    gl.uniform1i(wall_u_glitterMode, 1);
    gl.disable(gl.BLEND);
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsBad.length/2);
        }
      }
    }
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsBad.length/2);
        }
      }
    }
  }
  // Reset voxel count to default for other passes
  gl.uniform3f(wall_u_voxCount, 2.0, 2.0, 2.0);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(null);

  // Silhouette outlines per wall tile
  if (wallsNormal.length && !__isFullyFaded(0.0, 1.0)){
    const wallOutline = (typeof getLevelOutlineColorRGB === 'function') ? getLevelOutlineColorRGB() : ((typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0,0,0]);
    drawOutlinesForTileArray(mvp, wallsNormal, 0.5, 1.0, wallOutline);
  }
  if (wallsHalf.length && !__isFullyFaded(0.0, 0.5)){
    const wallOutline = (typeof getLevelOutlineColorRGB === 'function') ? getLevelOutlineColorRGB() : ((typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0,0,0]);
    // For half-step, center is 0.25 high
    drawOutlinesForTileArray(mvp, wallsHalf, 0.25, 1.0, wallOutline);
  }
  if (wallsBad.length && !__isFullyFaded(0.0, 1.0)) drawOutlinesForTileArray(mvp, wallsBad, 0.5, 1.02, [1.0,0.2,0.2]);
  if (wallsNoClimb.length && !__isFullyFaded(0.0, 1.0)){
    const ncOutline = (typeof getLevelNoClimbOutlineColorRGB === 'function') ? getLevelNoClimbOutlineColorRGB() : [0.8,0.8,0.8];
    drawOutlinesForTileArray(mvp, wallsNoClimb, 0.5, 1.02, ncOutline);
  }
  // Fences: no cube outlines; rails-only visuals should not show block outlines
}

function drawOutlinesForTileArray(mvp, tileArray, yCenter, baseScale, color){
  const count = tileArray.length/2;
  if (count <= 0) return;
  
  // Ensure trail cube program is available
  if (!window.trailCubeProgram) {
    console.warn('[WALLS] Outline drawing skipped - trailCubeProgram not initialized');
    return;
  }
  
  const tNow = state.nowSec || (performance.now()/1000);
  const inst = new Float32Array(count * 4);
  for (let i=0;i<count;i++){
    const tx = tileArray[i*2+0];
    const ty = tileArray[i*2+1];
    const cx = (tx - MAP_W*0.5 + 0.5);
    const cz = (ty - MAP_H*0.5 + 0.5);
    inst[i*4+0]=cx; inst[i*4+1]=yCenter; inst[i*4+2]=cz; inst[i*4+3]=tNow;
  }
  gl.useProgram(window.trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  gl.uniform1f(tc_u_now, tNow);
  gl.uniform1f(tc_u_ttl, 1.0);
  gl.uniform1i(tc_u_dashMode, 0);
  if (Array.isArray(color) && color.length>=3) gl.uniform3f(tc_u_lineColor, color[0], color[1], color[2]); else gl.uniform3f(tc_u_lineColor, 0.0, 0.0, 0.0);
  // Persisted edge jitter update (~16ms bucket)
  if (typeof ensureTrailEdgeJitterTick === 'function') ensureTrailEdgeJitterTick(tNow);
  if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 0);
  gl.bindVertexArray(trailCubeVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  // Per-instance corner offsets: top view uses jitter, bottom view uses zeros
  if (typeof trailCubeVBO_Corners !== 'undefined'){
    if (state.cameraKindCurrent === 'top' && typeof getTrailCornerOffsetsBuffer === 'function'){
      const keys = new Array(count);
      for (let i=0;i<count;i++){
        const tx = tileArray[i*2+0];
        const ty = tileArray[i*2+1];
        keys[i] = `tile@${tx},${ty},${yCenter.toFixed(2)}`;
      }
      const packed = getTrailCornerOffsetsBuffer(keys, tNow);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
      gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
    } else {
      const zeros = new Float32Array(count * 8 * 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
      gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
    }
  }
  // Ensure a_axis buffer has enough entries (even though u_useAnim==0)
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(count * 3), gl.DYNAMIC_DRAW);
  gl.disable(gl.BLEND);
  gl.depthMask(false);
  gl.uniform1f(tc_u_mulAlpha, 1.0);
  gl.uniform1f(tc_u_scale, baseScale);
  gl.drawArraysInstanced(gl.LINES, 0, 24, count);
  gl.uniform1f(tc_u_scale, baseScale * 1.03);
  gl.drawArraysInstanced(gl.LINES, 0, 24, count);
  gl.depthMask(true);
  gl.bindVertexArray(null);
}

function drawTallColumns(mvp, viewKind /* 'bottom' | 'top' | undefined */){
  // Update persistent polygon point jitter
    if (state.cameraKindCurrent === 'top' && typeof ensureWallGeomJitterTick === 'function') {
      ensureWallGeomJitterTick(state.nowSec || (performance.now()/1000));
    }
  // Prefer spans when available regardless of feature flag
  const hasSpans = (typeof columnSpans !== 'undefined') && columnSpans && typeof columnSpans.entries === 'function' && columnSpans.size > 0;
  if (!hasSpans && (!extraColumns || extraColumns.length === 0)) return;

  // Group pillars/columns by their integer height AND base so we can render stacked from bottom
  /** @type {Map<string, {h:number,b:number,pts:Array<[number,number]>,t?:number}>>} */
  const groups = new Map();
  // Fractional-height groups (e.g., half-step slabs): key `${hFrac}@${b}@${t}`
  /** @type {Map<string, {h:number,b:number,pts:Array<[number,number]>,t?:number}>>} */
  const fracGroups = new Map();
  if (hasSpans){
    for (const [key, spans] of columnSpans.entries()){
      if (!Array.isArray(spans)) continue;
      const [gx,gy] = key.split(',').map(n=>parseInt(n,10));
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
      for (const s of spans){
  if (!s) continue; const hF = Number(s.h)||0; const b=(s.b|0); const t=(s.t|0)||0; if (hF<=0) continue; if (t===2 || t===3) continue; // skip fence spans (2=normal,3=bad)
        const full = Math.floor(hF);
        const frac = hF - full;
        if (full > 0){
          const gkey = `${full}@${b}@${t}`;
          let g = groups.get(gkey); if (!g){ g = { h: full, b, pts: [], t }; groups.set(gkey, g); }
          g.pts.push([gx, gy]);
        }
        if (frac > 0){
          const fkey = `${frac.toFixed(3)}@${b+full}@${t}`;
          let fg = fracGroups.get(fkey); if (!fg){ fg = { h: frac, b: b+full, pts: [], t }; fracGroups.set(fkey, fg); }
          fg.pts.push([gx, gy]);
        }
      }
    }
  } else {
    for (const c of extraColumns){
      const hF = (c && typeof c.h === 'number') ? Number(c.h) : 0; // visible height
      const b = (c && typeof c.b === 'number') ? (c.b|0) : 0; // base offset from ground
      if (hF <= 0) continue;
      const full = Math.floor(hF);
      const frac = hF - full;
      if (full > 0){
        const key = `${full}@${b}`;
        let g = groups.get(key);
        if (!g){ g = { h: full, b, pts: [] }; groups.set(key, g); }
        g.pts.push([c.x, c.y]);
      }
      if (frac > 0){
        const fkey = `${frac.toFixed(3)}@${b+full}@0`;
        let fg = fracGroups.get(fkey); if (!fg){ fg = { h: frac, b: b+full, pts: [] }; fracGroups.set(fkey, fg); }
        fg.pts.push([c.x, c.y]);
      }
    }
  }
  if (groups.size === 0) return;

  // Ensure wall resources are initialized before drawing
  if (!wallProgram || !wallVAO) {
    console.warn('[WALLS] Tall columns drawing skipped - resources not initialized');
    return;
  }

  gl.useProgram(wallProgram);
  gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
  gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(wall_u_scale, 1.0);
  gl.uniform1f(wall_u_height, 1.0);
  gl.uniform1f(wall_u_now, state.nowSec || (performance.now()/1000));
  // Top-view screendoor settings
  if (viewKind === 'top') {
    gl.uniform1i(wall_u_stippleMode, (state.topStippleEnabled===0)?0:1);
    gl.uniform1f(wall_u_stippleAllow, (typeof state.topStippleAllow==='number')? state.topStippleAllow : 1.0);
  const eyeTop = (typeof window !== 'undefined' && Array.isArray(window._lastTopEye)) ? window._lastTopEye : null;
  const cx = eyeTop ? eyeTop[0] : (state?.camFollow?.x || 0);
  const cz = eyeTop ? eyeTop[2] : (state?.camFollow?.z || 0);
  const cy = eyeTop ? eyeTop[1] : ((state?.camFollow?.y || 0) +  2.6);
  gl.uniform2f(wall_u_camXZ, cx, cz);
  gl.uniform1f(wall_u_camY, cy);
  // Increase passthrough sphere radius by 40% (default 3.0 -> 4.2)
  gl.uniform1f(wall_u_stippleRadius, (typeof state.topStippleRadius==='number') ? state.topStippleRadius : 4.2);
    gl.uniform1i(wall_u_stippleInvert, (typeof state.topStippleInvert==='number') ? (state.topStippleInvert|0) : 0);
    gl.uniform1i(wall_u_stippleAbove, (typeof state.topStippleAbove==='number') ? (state.topStippleAbove|0) : 1);
  }
  else { gl.uniform1i(wall_u_stippleMode, 0); gl.uniform1f(wall_u_stippleAllow, 0.0); }
  // Height-based fade config (enabled only for bottom view)
  const useFade = (viewKind === 'bottom') ? 1 : 0;
  gl.uniform1i(wall_u_useFade, useFade);
  gl.uniform1f(wall_u_playerY, state.player ? (state.player.y || 0.0) : 0.0);
  gl.uniform1f(wall_u_fadeBand, 3.0);
  gl.uniform1f(wall_u_minAlpha, 0.15);
  // CPU-side culling for fully faded blocks in bottom view
  const __isBottomView_tc = (viewKind === 'bottom');
  const __playerY_forCull_tc = state.player ? (state.player.y || 0.0) : 0.0;
  const __fadeBand_forCull_tc = 3.0;
  const __isFullyFaded_tc = (yBase, height) => {
    if (!__isBottomView_tc) return false;
    const yMin = yBase;
    const yMax = yBase + height;
    let minD = 0.0;
    if (__playerY_forCull_tc < yMin) minD = yMin - __playerY_forCull_tc;
    else if (__playerY_forCull_tc > yMax) minD = __playerY_forCull_tc - yMax;
    else minD = 0.0;
    return minD >= __fadeBand_forCull_tc;
  };
  const voxX=1, voxY=1, voxZ=1;
  gl.uniform3f(wall_u_voxCount, voxX, voxY, voxZ);
  gl.bindVertexArray(wallVAO);
  // Point attribute 0 to the appropriate position buffer per view for tall columns
  gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  // Small epsilon to avoid coplanar depth ties between stacked levels
  const EPS = 1e-4;

  // For determinism, draw groups sorted by (base, height)
  const keys = Array.from(groups.keys()).sort((ka,kb)=>{
    const [ha,ba/*b*/,ta/*t*/] = ka.split('@').map(n=>parseInt(n,10));
    const [hb,bb/*b*/,tb/*t*/] = kb.split('@').map(n=>parseInt(n,10));
    if (ba!==bb) return ba-bb;
    if (ha!==hb) return ha-hb;
    return (ta|0) - (tb|0);
  });
  for (const key of keys){
    const g = groups.get(key);
    if (!g || !g.pts || g.pts.length === 0) continue;
    // Special rendering for Lock spans (t==6): outline-only pastel blue
    if ((g.t|0) === 6){
      const pts = g.pts;
      const baseCol = [0.65, 0.80, 1.0];
      // Camera + vertical fade configuration (tweakable at runtime)
      const cam = (state && state.camera) ? state.camera : {};
      const camY = (cam.position && cam.position[1]) || cam.y || 0;
      const camFadeStart = (window.__LOCK_FADE_CAM_START !== undefined) ? window.__LOCK_FADE_CAM_START : 10.0; // camera Y where fade begins
      const camFadeEnd   = (window.__LOCK_FADE_CAM_END   !== undefined) ? window.__LOCK_FADE_CAM_END   : 40.0; // camera Y where fully faded
      const levelFadeBand = (window.__LOCK_LEVEL_FADE_BAND !== undefined) ? window.__LOCK_LEVEL_FADE_BAND : 2.0; // extra fade for low levels
      const alphaBaseRest = (window.__LOCK_WORLD_ALPHA_REST !== undefined) ? window.__LOCK_WORLD_ALPHA_REST : 0.30; // default world lock alpha
      const alphaBaseHiCam = (window.__LOCK_WORLD_ALPHA_HICAM !== undefined) ? window.__LOCK_WORLD_ALPHA_HICAM : 0.05; // min alpha at/after cam fade end
      // Pre-pack tile array once
      const offsPacked = new Float32Array(pts.length * 2);
      for (let i=0;i<pts.length;i++){ offsPacked[i*2+0]=pts[i][0]; offsPacked[i*2+1]=pts[i][1]; }
      // For each level in span, compute per-level alpha and send a separate outline batch (cheap: lines only)
      for (let level=0; level<g.h; level++){
        const yCenter = (g.b + level) + 0.5 + (level>0 ? EPS*level : 0.0);
        // Bottom view vertical fade (progressive disappearance as player moves away vertically)
        let bottomFade = 1.0;
        try {
          if (state.cameraKindCurrent === 'bottom'){
            const playerY = state.player ? (state.player.y || 0) : 0;
            const band = (typeof window.__LOCK_OUTLINE_FADE_BAND === 'number') ? window.__LOCK_OUTLINE_FADE_BAND : 3.0;
            const minA = (typeof window.__LOCK_OUTLINE_MIN_ALPHA === 'number') ? window.__LOCK_OUTLINE_MIN_ALPHA : 0.0;
            if (band > 0){
              // Lock voxel vertical extent is 1.0; compute distance from player to this 1-unit segment
              const yMin = yCenter - 0.5;
              const yMax = yCenter + 0.5;
              let d = 0.0;
              if (playerY < yMin) d = yMin - playerY; else if (playerY > yMax) d = playerY - yMax; else d = 0.0;
              let t = Math.min(1.0, Math.max(0.0, d / band));
              // smoothstep easing
              t = t*t*(3.0 - 2.0*t);
              bottomFade = (1.0 - t);
              if (bottomFade < minA) bottomFade = minA;
            }
          }
        } catch(_){ }
        // Camera fade factor (0..1) using smoothstep for smoother curve
        let camT = 0.0;
        if (camY > camFadeStart){ camT = Math.min(1.0, (camY - camFadeStart) / Math.max(0.0001, camFadeEnd - camFadeStart)); }
        camT = camT * camT * (3.0 - 2.0 * camT);
        const alphaCam = alphaBaseRest * (1.0 - camT) + alphaBaseHiCam * camT;
        // Extra vertical fade for levels near ground when camera is high
        let levelFade = 1.0;
        if (level === 0){ levelFade = Math.max(0.0, 1.0 - camT * (1.0 + (levelFadeBand*0.5))); }
        else if (level === 1){ levelFade = Math.max(0.0, 1.0 - camT * (0.5 + (levelFadeBand*0.25))); }
        let finalAlpha = alphaCam * levelFade * bottomFade;
        // Camera lock effect (TOP SCREEN ONLY): when the game camera is locked, make lock blocks
        // extremely transparent (target ~5% opacity). We cap (not multiply) their alpha so that
        // returning from lock restores normal computed alpha. Optional override:
        //   window.__LOCK_WORLD_LOCKMODE_ALPHA  (absolute alpha cap, default 0.05)
        // Backwards compat: if legacy multiplier override window.__LOCK_WORLD_LOCKMODE_MUL is present
        // and no absolute alpha override is defined, we keep the old multiplicative path.
        try {
          const lockModeActive = (()=>{
            try {
              if (!state) return false;
              // Existing camera flags
              if (state.camera && (state.camera.isLocked || state.camera.lockMode)) return true;
              // Pointer lock (editor / alt mode)
              if (state.editor?.pointerLocked) return true;
              // Yaw lock often accompanies lock situations
              if (state.lockCameraYaw) return true;
              // Global explicit override for testing
              if (window.__CAMERA_LOCKED) return true;
            } catch(_){ }
            return false;
          })();
          if (lockModeActive && state.cameraKindCurrent === 'top'){
            if (window.__LOCK_WORLD_LOCKMODE_ALPHA !== undefined){
              const cap = window.__LOCK_WORLD_LOCKMODE_ALPHA;
              if (finalAlpha > cap) finalAlpha = cap;
            } else if (window.__LOCK_WORLD_LOCKMODE_MUL !== undefined) {
              // Legacy behavior: apply user-provided multiplier
              finalAlpha *= window.__LOCK_WORLD_LOCKMODE_MUL;
            } else {
              const cap = 0.05; // default 5% opacity target
              if (finalAlpha > cap) finalAlpha = cap;
            }
            if (window.__DEBUG_LOCK_ALPHA){
              if (!window.___dbgLockOnce){
                window.___dbgLockOnce = true;
                console.log('[lock-blocks] Camera lock detected: applying alpha cap to lock blocks (finalAlpha=', finalAlpha, ')');
              }
            } else if (window.___dbgLockOnce){
              // Reset one-shot if debugging turned off or lock released later
              try { delete window.___dbgLockOnce; } catch(_){ }
            }
          }
        } catch(_){ }
        // Global multiplier override
        if (typeof window.__LOCK_WORLD_ALPHA_MUL === 'number'){ finalAlpha *= window.__LOCK_WORLD_ALPHA_MUL; }
        if (finalAlpha <= 0.005) continue; // skip near-zero
        // Temporarily hook drawOutlinesForTileArray with custom alpha via modifying uniforms inline
        // Save current blend/depth state
        if (!window.trailCubeProgram) continue; // Skip if trailCubeProgram not available
        const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
        const wasBlend = gl.isEnabled(gl.BLEND);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(window.trailCubeProgram);
        gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
        const tNow_local = state.nowSec || (performance.now()/1000);
        gl.uniform1f(tc_u_now, tNow_local);
        gl.uniform1f(tc_u_ttl, 1.0);
        gl.uniform1i(tc_u_dashMode, 0);
        gl.uniform3f(tc_u_lineColor, baseCol[0], baseCol[1], baseCol[2]);
        if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 0);
        gl.bindVertexArray(trailCubeVAO);
        const instOne = new Float32Array(offsPacked.length/2 * 4);
        for (let i=0;i<offsPacked.length/2;i++){
          const tx = offsPacked[i*2+0]; const ty = offsPacked[i*2+1];
          const cx = (tx - MAP_W*0.5 + 0.5); const cz = (ty - MAP_H*0.5 + 0.5);
          instOne[i*4+0]=cx; instOne[i*4+1]=yCenter; instOne[i*4+2]=cz; instOne[i*4+3]=tNow_local;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, instOne, gl.DYNAMIC_DRAW);
        if (typeof trailCubeVBO_Corners !== 'undefined'){
          const zeros = new Float32Array((offsPacked.length/2) * 8 * 3);
          gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners); gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array((offsPacked.length/2)*3), gl.DYNAMIC_DRAW);
        gl.depthMask(false);
        gl.uniform1f(tc_u_mulAlpha, finalAlpha);
        gl.uniform1f(tc_u_scale, 1.02); gl.drawArraysInstanced(gl.LINES, 0, 24, offsPacked.length/2);
        gl.uniform1f(tc_u_scale, 1.05); gl.drawArraysInstanced(gl.LINES, 0, 24, offsPacked.length/2);
        if (!wasBlend) gl.disable(gl.BLEND); gl.depthMask(prevDepthMask);
      }
      // Rebind wall VAO and program after custom lock outlines
      gl.bindVertexArray(wallVAO);
      gl.useProgram(wallProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
      gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
      gl.uniform1f(wall_u_scale, 1.0);
      gl.uniform1f(wall_u_height, 1.0);
      const wallCol3p = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
      gl.uniform3fv(wall_u_color, new Float32Array(wallCol3p));
      gl.uniform1f(wall_u_alpha, 0.65);
      gl.uniform1i(wall_u_glitterMode, 0);
      gl.uniform3f(wall_u_voxCount, 1,1,1);
      continue;
    }
    // Special rendering for portal spans (t==5): orange, semi-transparent, glitter
    if ((g.t|0) === 5){
      const pts = g.pts;
      const offs = new Float32Array(pts.length * 2);
      for (let i=0;i<pts.length;i++){ offs[i*2+0]=pts[i][0]; offs[i*2+1]=pts[i][1]; }
      gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
      gl.bufferData(gl.ARRAY_BUFFER, offs, gl.DYNAMIC_DRAW);
      gl.uniform3fv(wall_u_color, new Float32Array([1.0, 0.55, 0.05]));
      gl.uniform1f(wall_u_alpha, 0.45);
      gl.uniform1i(wall_u_glitterMode, 1);
      // Depth pre-pass
      gl.disable(gl.BLEND);
      gl.colorMask(false, false, false, false);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      for (let level=0; level<g.h; level++){
        if (__isFullyFaded_tc((g.b + level) * 1.0, 1.0)) continue;
        gl.uniform1f(wall_u_yBase, (g.b + level) * 1.0 + (level>0 ? EPS*level : 0.0));
        gl.uniform3f(wall_u_voxOff, 0,0,0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pts.length);
      }
      // Color pass
      gl.colorMask(true,true,true,true);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.depthFunc(gl.LEQUAL);
      for (let level=0; level<g.h; level++){
        if (__isFullyFaded_tc((g.b + level) * 1.0, 1.0)) continue;
        gl.uniform1f(wall_u_yBase, (g.b + level) * 1.0 + (level>0 ? EPS*level : 0.0));
        gl.uniform3f(wall_u_voxOff, 0,0,0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pts.length);
      }
  // Intentionally no outlines for portal spans (t==5)
      // Restore program/VAO after outlines
      gl.bindVertexArray(wallVAO);
      gl.useProgram(wallProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
      gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
      gl.uniform1f(wall_u_scale, 1.0);
      gl.uniform1f(wall_u_height, 1.0);
      const wallCol3p = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
      gl.uniform3fv(wall_u_color, new Float32Array(wallCol3p));
      gl.uniform1f(wall_u_alpha, 0.65);
      gl.uniform1i(wall_u_glitterMode, 0);
      gl.uniform3f(wall_u_voxCount, 1,1,1);
      continue;
    }
    // Special rendering for NOCLIMB spans (t==9): color from helper with glitter, non-hazard
    if ((g.t|0) === 9){
      const pts = g.pts;
      const offs = new Float32Array(pts.length * 2);
      for (let i=0;i<pts.length;i++){ offs[i*2+0]=pts[i][0]; offs[i*2+1]=pts[i][1]; }
      gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
      gl.bufferData(gl.ARRAY_BUFFER, offs, gl.DYNAMIC_DRAW);
      const ncCol2 = (typeof getLevelNoClimbColorRGB === 'function') ? getLevelNoClimbColorRGB() : [0.7,0.7,0.7];
      gl.uniform3fv(wall_u_color, new Float32Array(ncCol2));
      gl.uniform1f(wall_u_alpha, 0.65);
      gl.uniform1i(wall_u_glitterMode, 1);
      // Depth pre-pass
      gl.disable(gl.BLEND);
      gl.colorMask(false, false, false, false);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      for (let level=0; level<g.h; level++){
        if (__isFullyFaded_tc((g.b + level) * 1.0, 1.0)) continue;
        gl.uniform1f(wall_u_yBase, (g.b + level) * 1.0 + (level>0 ? EPS*level : 0.0));
        gl.uniform3f(wall_u_voxOff, 0,0,0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pts.length);
      }
      // Color pass
      gl.colorMask(true,true,true,true);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.depthFunc(gl.LEQUAL);
      for (let level=0; level<g.h; level++){
        if (__isFullyFaded_tc((g.b + level) * 1.0, 1.0)) continue;
        gl.uniform1f(wall_u_yBase, (g.b + level) * 1.0 + (level>0 ? EPS*level : 0.0));
        gl.uniform3f(wall_u_voxOff, 0,0,0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pts.length);
      }
      // Outlines per level
      for (let level=0; level<g.h; level++){
        const yCenter = (g.b + level) + 0.5 + (level>0 ? EPS*level : 0.0);
        if (__isFullyFaded_tc((g.b + level) * 1.0, 1.0)) continue;
        const offs2 = new Float32Array(pts.length * 2);
        for (let i=0;i<pts.length;i++){ offs2[i*2+0]=pts[i][0]; offs2[i*2+1]=pts[i][1]; }
        const ncOutline2 = (typeof getLevelNoClimbOutlineColorRGB === 'function') ? getLevelNoClimbOutlineColorRGB() : [0.8,0.8,0.8];
        drawOutlinesForTileArray(mvp, offs2, yCenter, 1.02, ncOutline2);
      }
      // Rebind wall VAO and program after outlines
      gl.bindVertexArray(wallVAO);
      gl.useProgram(wallProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      // IMPORTANT: prevent fall-through into generic pillar rendering logic below.
      // Missing continue caused NOCLIMB spans (t==9) to be processed a second time
      // as generic pillars, overriding visuals for elevated NOCLIMB blocks.
      continue;
    }
    // Split pillars by BAD vs normal: prefer span hazard flag; fallback to map for ground-only
    const pillars = g.pts;
    const normPts = [];
    const badPts = [];
    for (let i=0;i<pillars.length;i++){
      const gx = pillars[i][0], gy = pillars[i][1];
      let isBad = false;
      // If spans exist, look for a matching span with this group's base/height and hazard flag.
      if ((typeof columnSpans !== 'undefined') && columnSpans && typeof columnSpans.get === 'function'){
        const skey = `${gx},${gy}`;
        const spans = columnSpans.get(skey);
        if (Array.isArray(spans)){
          // Extract hazard from key third segment when present
          const parts = key.split('@');
          const bKey = parseInt(parts[1],10)|0;
          const hKey = parseInt(parts[0],10)|0;
          const tKey = (parts.length>=3 ? (parseInt(parts[2],10)|0) : 0);
          isBad = spans.some(s => s && ((s.b|0)===bKey) && ((s.h|0)===hKey) && (((s.t|0)||0)===tKey) && tKey===1);
        }
      }
      if (!isBad){
        // Fallback only for ground-level groups: map BAD marks base=0 cube hazardous.
        // Do NOT let a ground BAD infect elevated normal spans above.
        if ((g.b|0) === 0){
          isBad = (typeof map !== 'undefined' && typeof mapIdx === 'function' && typeof TILE !== 'undefined') ? (map[mapIdx(gx,gy)] === TILE.BAD) : false;
        }
      }
      (isBad ? badPts : normPts).push([gx,gy]);
    }
  function drawGroupPts(pts, color, alpha, glitter){
      if (!pts || !pts.length) return;
      const offs = new Float32Array(pts.length * 2);
      for (let i=0;i<pts.length;i++){ offs[i*2+0]=pts[i][0]; offs[i*2+1]=pts[i][1]; }
      gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
      gl.bufferData(gl.ARRAY_BUFFER, offs, gl.DYNAMIC_DRAW);
      gl.uniform3fv(wall_u_color, new Float32Array(color));
      gl.uniform1f(wall_u_alpha, alpha);
      gl.uniform1i(wall_u_glitterMode, glitter ? 1 : 0);
      // Depth pre-pass
      gl.disable(gl.BLEND);
      gl.colorMask(false, false, false, false);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      for (let level=0; level<g.h; level++){
        if (__isFullyFaded_tc((g.b + level) * 1.0, 1.0)) continue;
        gl.uniform1f(wall_u_yBase, (g.b + level) * 1.0 + (level>0 ? EPS*level : 0.0));
        gl.uniform3f(wall_u_voxOff, 0,0,0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pts.length);
      }
      // Blended color pass
      gl.colorMask(true,true,true,true);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.depthFunc(gl.LEQUAL);
      for (let level=0; level<g.h; level++){
        if (__isFullyFaded_tc((g.b + level) * 1.0, 1.0)) continue;
        gl.uniform1f(wall_u_yBase, (g.b + level) * 1.0 + (level>0 ? EPS*level : 0.0));
        gl.uniform3f(wall_u_voxOff, 0,0,0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pts.length);
      }
    }
    // Draw normal then BAD
  const wallCol2 = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
  drawGroupPts(normPts, wallCol2, 0.65, false);
    drawGroupPts(badPts, [0.85, 0.10, 0.12], 0.85, true);

  // Note: color passes for normal and BAD pillars are already drawn above via drawGroupPts().
  // Avoid re-drawing the combined set here to prevent instance-buffer mismatches that cause ghost tiles.

    // Silhouette outlines per level for this group
    for (let level=0; level<g.h; level++){
      const yCenter = (g.b + level) + 0.5 + (level>0 ? EPS*level : 0.0);
      if (__isFullyFaded_tc((g.b + level) * 1.0, 1.0)) continue;
      if (normPts.length){
        const offs2 = new Float32Array(normPts.length * 2);
        for (let i=0;i<normPts.length;i++){ offs2[i*2+0]=normPts[i][0]; offs2[i*2+1]=normPts[i][1]; }
  const wallOutline2 = (typeof getLevelOutlineColorRGB === 'function') ? getLevelOutlineColorRGB() : ((typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0,0,0]);
  drawOutlinesForTileArray(mvp, offs2, yCenter, 1.0, wallOutline2);
      }
      if (badPts.length){
        const offs3 = new Float32Array(badPts.length * 2);
        for (let i=0;i<badPts.length;i++){ offs3[i*2+0]=badPts[i][0]; offs3[i*2+1]=badPts[i][1]; }
        drawOutlinesForTileArray(mvp, offs3, yCenter, 1.02, [1,0.2,0.2]);
      }
    }

  // Rebind wall VAO and wall program after outlines (they switch program/VAO),
  // and restore uniforms so next group renders color correctly.
  gl.bindVertexArray(wallVAO);
  gl.useProgram(wallProgram);
  // Re-point attribute 0 after outlines switched VAO/program
  gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
  gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(wall_u_scale, 1.0);
  gl.uniform1f(wall_u_height, 1.0);
  const wallCol3 = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
  gl.uniform3fv(wall_u_color, new Float32Array(wallCol3));
  gl.uniform1f(wall_u_alpha, 0.65);
  gl.uniform1i(wall_u_glitterMode, 0);
  gl.uniform3f(wall_u_voxCount, 1,1,1);
  }

  // Render fractional-height slabs
  if (fracGroups.size){
    // Ensure correct program/state
    gl.bindVertexArray(wallVAO);
    gl.useProgram(wallProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
    gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
    gl.uniform1f(wall_u_scale, 1.0);
    gl.uniform1f(wall_u_now, state.nowSec || (performance.now()/1000));
    gl.uniform1i(wall_u_useFade, (viewKind === 'bottom') ? 1 : 0);
    gl.uniform1f(wall_u_playerY, state.player ? (state.player.y || 0.0) : 0.0);
  gl.uniform1f(wall_u_fadeBand, 3.0);
    gl.uniform1f(wall_u_minAlpha, 0.15);
    gl.uniform3f(wall_u_voxCount, 1,1,1);
    const keysF = Array.from(fracGroups.keys()).sort((ka,kb)=>{
      const [ha,ba] = ka.split('@'); const [hb,bb] = kb.split('@');
      const fa = parseFloat(ha)||0; const fb = parseFloat(hb)||0; const baI = parseInt(ba,10)||0; const bbI = parseInt(bb,10)||0;
      if (baI!==bbI) return baI-bbI; if (fa!==fb) return fa-fb; return 0;
    });
    for (const k of keysF){
      const g = fracGroups.get(k); if (!g || !g.pts || !g.pts.length) continue;
      // Outline-only for Lock fractional spans (t==6), if ever present
      if ((g.t|0) === 6){
        const pts = g.pts;
        const yCenter = g.b + g.h*0.5;
        const offs2 = new Float32Array(pts.length * 2);
        for (let i=0;i<pts.length;i++){ offs2[i*2+0]=pts[i][0]; offs2[i*2+1]=pts[i][1]; }
        drawOutlinesForTileArray(mvp, offs2, yCenter, 1.02, [0.65,0.80,1.0]);
        // Restore program/VAO after outlines
        gl.bindVertexArray(wallVAO);
        gl.useProgram(wallProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        continue;
      }
      // Split into BAD vs normal using t from grouping when spans present
      const normPts = []; const badPts = [];
      for (let i=0;i<g.pts.length;i++){
        const gx = g.pts[i][0], gy = g.pts[i][1];
        let isBad = false;
        // Look up span to confirm hazard if possible
        if ((typeof columnSpans !== 'undefined') && columnSpans && typeof columnSpans.get === 'function'){
          const sk = `${gx},${gy}`; const sp = columnSpans.get(sk);
          if (Array.isArray(sp)){
            isBad = sp.some(s=> s && ((s.t|0)===1) && Math.abs((s.b|0) - (g.b|0))<=0 && Math.abs((Number(s.h)||0) - g.h) < 1e-3);
          }
        }
        if (!isBad){
          // Only treat as BAD from map for ground-level slabs; avoid infecting elevated fractional slabs
          if ((g.b|0) === 0){
            isBad = (typeof map !== 'undefined' && typeof mapIdx === 'function' && typeof TILE !== 'undefined') ? (map[mapIdx(gx,gy)] === TILE.BAD) : false;
          }
        }
        (isBad ? badPts : normPts).push([gx,gy]);
      }
      const drawFrac = (pts, color, alpha, glitter)=>{
        if (!pts || !pts.length) return;
        if (__isFullyFaded_tc((g.b * 1.0), g.h)) return;
        const offs = new Float32Array(pts.length * 2);
        for (let i=0;i<pts.length;i++){ offs[i*2+0]=pts[i][0]; offs[i*2+1]=pts[i][1]; }
        gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
        gl.bufferData(gl.ARRAY_BUFFER, offs, gl.DYNAMIC_DRAW);
        gl.uniform3fv(wall_u_color, new Float32Array(color));
        gl.uniform1f(wall_u_alpha, alpha);
        gl.uniform1i(wall_u_glitterMode, glitter ? 1 : 0);
        gl.uniform1f(wall_u_height, g.h);
        // Depth pre-pass
        gl.disable(gl.BLEND);
        gl.colorMask(false, false, false, false);
        gl.depthMask(true);
        gl.depthFunc(gl.LEQUAL);
        gl.uniform1f(wall_u_yBase, (g.b * 1.0) + EPS);
        gl.uniform3f(wall_u_voxOff, 0,0,0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pts.length);
        // Color pass
        gl.colorMask(true,true,true,true);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.depthFunc(gl.LEQUAL);
        gl.uniform1f(wall_u_yBase, (g.b * 1.0) + EPS);
        gl.uniform3f(wall_u_voxOff, 0,0,0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pts.length);
        // Outline
        const yCenter = g.b + g.h*0.5;
        const offs2 = new Float32Array(pts.length * 2);
        for (let i=0;i<pts.length;i++){ offs2[i*2+0]=pts[i][0]; offs2[i*2+1]=pts[i][1]; }
        const outCol = (typeof getLevelOutlineColorRGB === 'function') ? getLevelOutlineColorRGB() : ((typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0,0,0]);
        if (!__isFullyFaded_tc(g.b * 1.0, g.h)){
          drawOutlinesForTileArray(mvp, offs2, yCenter, 1.0, outCol);
        }
        // Restore program/VAO after outlines
        gl.bindVertexArray(wallVAO);
        gl.useProgram(wallProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      };
      const wallColF = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
      drawFrac(normPts, wallColF, 0.65, false);
      drawFrac(badPts, [0.85, 0.10, 0.12], 0.85, true);
    }
    // Reset height
    gl.uniform1f(wall_u_height, 1.0);
  }

  // Restore defaults
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(null);
}

// ============================================================================
// Global Export Registration
// ============================================================================

/** Export wall rendering system components for cross-module access */
if (typeof window !== 'undefined') {
  // Shader source code
  window.WALL_VS = WALL_VS;
  window.WALL_FS = WALL_FS;
  
  // WebGL program and resources
  window.wallProgram = wallProgram;
  window.wallVAO = wallVAO;
  window.wallWireVAO = wallWireVAO;
  
  // Core uniform locations (transform and geometry)
  window.wall_u_mvp = wall_u_mvp;
  window.wall_u_origin = wall_u_origin;
  window.wall_u_scale = wall_u_scale;
  window.wall_u_height = wall_u_height;
  window.wall_u_voxCount = wall_u_voxCount;
  window.wall_u_voxOff = wall_u_voxOff;
  window.wall_u_yBase = wall_u_yBase;
  
  // Visual effect uniforms (transparency and animation)
  window.wall_u_useFade = wall_u_useFade;
  window.wall_u_playerY = wall_u_playerY;
  window.wall_u_fadeBand = wall_u_fadeBand;
  window.wall_u_minAlpha = wall_u_minAlpha;
  window.wall_u_color = wall_u_color;
  window.wall_u_alpha = wall_u_alpha;
  window.wall_u_glitterMode = wall_u_glitterMode;
  window.wall_u_now = wall_u_now;
  
  // Screendoor transparency uniforms
  window.wall_u_stippleMode = wall_u_stippleMode;
  window.wall_u_stippleAllow = wall_u_stippleAllow;
  window.wall_u_camXZ = wall_u_camXZ;
  window.wall_u_camY = wall_u_camY;
  window.wall_u_stippleRadius = wall_u_stippleRadius;
  window.wall_u_stippleInvert = wall_u_stippleInvert;
  
  // Rendering functions
  window.drawWalls = drawWalls;
  window.drawTallColumns = drawTallColumns;
  
} else if (typeof globalThis !== 'undefined') {
  // Alternative global object for other environments
  globalThis.WALL_VS = WALL_VS;
  globalThis.WALL_FS = WALL_FS;
  globalThis.wallProgram = wallProgram;
  globalThis.wallVAO = wallVAO;
  globalThis.drawWalls = drawWalls;
  globalThis.drawTallColumns = drawTallColumns;
}
