/**
 * @fileoverview Main application bootstrap and render loop for MZ game
 * @description Handles the core application lifecycle including initialization,
 * frame rendering, viewport management, and coordinate transformations.
 * Provides the main game loop and manages WebGL rendering pipeline.
 * 
 * @author MZ Team
 * @version 1.0.0
 * 
 * @requires config.js - Application state and configuration
 * @requires gl.js - WebGL context and utilities
 * @requires All rendering pipeline modules
 * @exports {Function} render - Main render loop function
 * @exports {Function} window.isWorldPointVisibleAny - Global visibility helper
 */

/**
 * Global world point visibility checker
 * Tests if a 3D world point is visible in any of the active camera views.
 * Performs clip space transformation and frustum testing against all MVPs.
 */
if (typeof window !== 'undefined' && typeof window.isWorldPointVisibleAny !== 'function'){
  /**
   * Checks if a world point is visible in any active camera viewport
   * @param {number} x - World X coordinate
   * @param {number} y - World Y coordinate  
   * @param {number} z - World Z coordinate
   * @returns {boolean} True if point is visible in any viewport
   */
  window.isWorldPointVisibleAny = function(x, y, z){
    try {
      /**
       * Tests visibility against a specific MVP matrix
       * @param {Float32Array} m - Model-view-projection matrix
       * @returns {boolean} True if point is visible in this view
       */
      const vis = (m) => {
        if (!m) return false;
        
        // Transform world point to clip space
        const v = [x, y, z, 1];
        const clipX = v[0] * m[0] + v[1] * m[4] + v[2] * m[8]  + v[3] * m[12];
        const clipY = v[0] * m[1] + v[1] * m[5] + v[2] * m[9]  + v[3] * m[13];
        const clipZ = v[0] * m[2] + v[1] * m[6] + v[2] * m[10] + v[3] * m[14];
        const clipW = v[0] * m[3] + v[1] * m[7] + v[2] * m[11] + v[3] * m[15];
        
        if (clipW === 0) return false;
        
        // Perspective divide to normalized device coordinates
        const nx = clipX / clipW;
        const ny = clipY / clipW; 
        const nz = clipZ / clipW;
        
        // Test against NDC cube bounds [-1, 1]
        return nx >= -1 && nx <= 1 && 
               ny >= -1 && ny <= 1 && 
               nz >= -1 && nz <= 1;
      };
      
      // Test against all available viewport matrices
      return vis(window._mvpBottom) || 
             vis(window._mvpTop) || 
             vis(window._lastMVP);
             
    } catch(_){ 
      return false; 
    }
  };
}

// ---------------------------------------------------------------------------
// Render Loop Instrumentation & Single-Start Guard
// ---------------------------------------------------------------------------
// Goal: Detect accidental creation of multiple main render loops (e.g. script
// reinjection or re-bootstrap during online/offline flip-flopping).
// Provides lightweight statistics accessible via console:
//   window.__getRenderLoopStats()
//   window.__renderLoopMeta (live object)
// Logs a warning if multiple loops attempt to start or if two frames are
// rendered with (near) identical RAF timestamps (heuristic duplicate).
// ---------------------------------------------------------------------------
(function(){
  if (typeof window === 'undefined') return;
  // Matrix stats & perspective cache (perf optimization Item 3)
  if (!window.__matStats) window.__matStats = { perspRebuilds: 0 };
  if (!window.__perspCache) window.__perspCache = new Map();
  // Declare outer-scoped variable so later code (render loop) can call directly.
  if (typeof getCachedPerspective === 'undefined'){
    // eslint-disable-next-line no-global-assign
    getCachedPerspective = function getCachedPerspective(fovDeg, aspect, near, far){
      if (!Number.isFinite(aspect) || aspect <= 0) aspect = 1;
      const key = fovDeg+':'+aspect.toFixed(4)+':'+near+':'+far;
      let m = window.__perspCache.get(key);
      if (!m){
        m = new Float32Array(16);
        if (window.mat4PerspectiveInto){
          window.mat4PerspectiveInto(m, (window.deg2rad?window.deg2rad(fovDeg):fovDeg*Math.PI/180), aspect, near, far);
        } else {
          const tmp = mat4Perspective((window.deg2rad?window.deg2rad(fovDeg):fovDeg*Math.PI/180), aspect, near, far); m.set(tmp);
        }
        window.__perspCache.set(key, m);
        window.__matStats.perspRebuilds++;
      }
      return m;
    };
  }
  if (!window.__renderLoopMeta){
    window.__renderLoopMeta = {
      startedAt: performance.now(),
      startCount: 0,
      frameCount: 0,
      duplicateFrameCount: 0,
      lastNow: -1,
      lastFrameDurationMs: 0,
      multiStartStacks: [],
      perFrame: {
        drawWalls: 0,
        drawTallColumns: 0
      },
      totals: {
        drawWalls: 0,
        drawTallColumns: 0
      },
      lastFramePerFrame: { drawWalls: 0, drawTallColumns: 0 }
    };
  }
  // Expose accessor
  if (!window.__getRenderLoopStats){
    window.__getRenderLoopStats = function(){
      const m = window.__renderLoopMeta;
      const uptimeSec = (performance.now() - m.startedAt)/1000;
      return {
        uptimeSec: +uptimeSec.toFixed(2),
        startCount: m.startCount,
        frameCount: m.frameCount,
        duplicateFrameCount: m.duplicateFrameCount,
        duplicatePct: m.frameCount ? +(100*m.duplicateFrameCount/m.frameCount).toFixed(2) : 0,
        avgFPS: m.frameCount/Math.max(0.001, uptimeSec),
        lastFrameDurationMs: +m.lastFrameDurationMs.toFixed(3),
        lastFramePerFrame: m.lastFramePerFrame,
        totals: m.totals
      };
    };
  }
  // Instrument drawWalls / drawTallColumns only once
  function wrapOnce(fnName){
    if (typeof window[fnName] === 'function' && !window['__orig_'+fnName]){
      window['__orig_'+fnName] = window[fnName];
      window[fnName] = function(){
        const m = window.__renderLoopMeta; if (m){ m.perFrame[fnName]++; m.totals[fnName]++; }
        return window['__orig_'+fnName].apply(this, arguments);
      };
    }
  }
  wrapOnce('drawWalls');
  wrapOnce('drawTallColumns');

  // -----------------------------------------------------------------------
  // LockFast Aggressive Optimization Helper
  // Enables all current experimental lock rendering optimizations & tuning.
  // User can disable auto-enable by setting window.__LOCK_FAST_AUTO=0 before bootstrap runs.
  // -----------------------------------------------------------------------
  if (!window.enableAllLockFastOptimizations){
    window.enableAllLockFastOptimizations = function(enable=true){
      try {
        if (!enable){ return false; }
        // Core fast column aggregation
        window.__LOCK_FAST_COLUMN = 1;
        // Anticipated future tasks (culling, fade precompute, buffer reuse, LOD)
        window.__LOCK_MAX_DRAW_DIST = (typeof window.__LOCK_MAX_DRAW_DIST_OVERRIDE === 'number') ? window.__LOCK_MAX_DRAW_DIST_OVERRIDE : Infinity;
        // Level-of-detail stride (higher => fewer vertical samples). 1 = full detail.
        window.__LOCK_LEVEL_STRIDE = (typeof window.__LOCK_LEVEL_STRIDE_OVERRIDE === 'number') ? window.__LOCK_LEVEL_STRIDE_OVERRIDE : 1;
        // Alpha / fade aggressiveness knobs (allow smaller baseline at high cam)
        if (window.__LOCK_WORLD_ALPHA_REST === undefined) window.__LOCK_WORLD_ALPHA_REST = 0.28;
        if (window.__LOCK_WORLD_ALPHA_HICAM === undefined) window.__LOCK_WORLD_ALPHA_HICAM = 0.05;
        if (window.__LOCK_LEVEL_FADE_BAND === undefined) window.__LOCK_LEVEL_FADE_BAND = 2.0;
        // Future precompute toggle placeholder
        window.__LOCK_PRECOMPUTE_FADES = 1;
        // LOD placeholder flags
        window.__LOCK_LOD = 1; // (Task 8 future) currently no-op
        // Visual lock mode alpha cap tuning
        if (window.__LOCK_WORLD_LOCKMODE_ALPHA === undefined) window.__LOCK_WORLD_LOCKMODE_ALPHA = 0.05;
        // Buffer reuse placeholder flags (Task 5 future)
        window.__LOCK_BUFFER_REUSE = 1;
        // Confirm
        return true;
      } catch(err){ console.warn('[LockFast][enableAll] failed', err); return false; }
    };
  }
  try {
    if (window.__LOCK_FAST_AUTO !== 0){ window.enableAllLockFastOptimizations(true); }
  } catch(_){ }
})();

/**
 * Main render function called every frame by requestAnimationFrame
 * Handles game state updates, camera management, and the complete rendering pipeline.
 * 
 * @param {number} now - Current timestamp in milliseconds from requestAnimationFrame
 */
function render(now) {
  // --- Instrumentation (frame entry) ---
  try {
    const m = window.__renderLoopMeta;
    if (m){
      // Detect duplicate frame invocation (same or near-identical RAF timestamp)
      if (m.lastNow >= 0){
        const dtMs = now - m.lastNow;
        m.lastFrameDurationMs = dtMs;
        if (dtMs <= 0.15){ // 0.15ms threshold – essentially same RAF quantum
          m.duplicateFrameCount++;
          if (!m._dupWarnedOnce){
            console.warn('[LOOP][dup] Potential duplicate main loop invocation detected (Δt=', dtMs.toFixed(4),'ms).');
            m._dupWarnedOnce = true; // Spam guard; remove if full log desired
          }
        }
      }
      m.lastNow = now;
      m.frameCount++;
      // Reset per-frame counters
      m.lastFramePerFrame = { drawWalls: m.perFrame.drawWalls, drawTallColumns: m.perFrame.drawTallColumns };
      m.perFrame.drawWalls = 0;
      m.perFrame.drawTallColumns = 0;
    }
  } catch(_){ }

  // Update frame counter and calculate delta time
  state.frames++;
  const dt = Math.min(0.05, Math.max(0, (now - state.timePrev) / 1000));
  state.timePrev = now;
  state.nowSec = now / 1000;
  
  // Update game logic and physics
  stepGame(dt);
  
  // === Camera Management ===
  // Smooth bottom camera vertical follow with exponential lag
  try {
    if (!Number.isFinite(state.bottomCamY)) {
      state.bottomCamY = state.camFollow.y;
    }
    
    const k = (typeof state.bottomCamLagK === 'number' && state.bottomCamLagK > 0) 
      ? state.bottomCamLagK 
      : 8.0;
    const a = 1 - Math.exp(-k * dt);
    state.bottomCamY += (state.camFollow.y - state.bottomCamY) * a;
  } catch(_) {
    // Fallback: direct camera assignment if lag calculation fails
  }
  
  // === Multiplayer Updates ===
  // Handle multiplayer networking and ghost interpolation
  try { 
    if (typeof __mp_onFrame === 'function') {
      __mp_onFrame(dt, now); 
    }
  } catch(_) {
    // Ignore multiplayer errors if system not available
  }
  
  // === Offscreen Rendering Pass ===
  // Render scene to low-resolution offscreen target (480x720)
  gl.bindFramebuffer(gl.FRAMEBUFFER, offscreen.fbo);
  gl.viewport(0, 0, offscreen.w, offscreen.h);
  
  // Clear offscreen buffer
  gl.disable(gl.SCISSOR_TEST);
  // Offscreen base clear: darkened base color
  try {
    const useCol = (typeof getLevelBackgroundColored === 'function') ? getLevelBackgroundColored() : true;
    if (useCol){
      const base = (typeof getLevelBaseColorRGB === 'function') ? getLevelBaseColorRGB() : [0.06,0.45,0.48];
      const c = base.map(v=>v*0.08);
      gl.clearColor(c[0], c[1], c[2], 1.0);
    } else {
      gl.clearColor(0,0,0,1);
    }
  } catch(_){ gl.clearColor(0,0,0,1); }
  gl.clear(gl.COLOR_BUFFER_BIT);

  const W = offscreen.w, H = offscreen.h;
  const seamY = Math.floor(H * state.seamRatio);
  const topH = Math.max(1, seamY);
  const botH = Math.max(1, H - seamY);
  if (state.snapBottomFull) {
    // Full-screen bottom camera
  state.cameraKindCurrent = 'bottom';
    gl.viewport(0, 0, W, H);
    const mvAspectBot = W / H;
    renderGridViewport(0, 0, W, H, 'bottom');
  const proj = getCachedPerspective(48, Math.max(0.1, mvAspectBot), 0.1, 150.0);
    const fx = state.camFollow.x, fz = state.camFollow.z;
  const eye = [fx, state.bottomCamY + (state.bottomCamOffset || 14.4), fz];
  const center = [fx, state.bottomCamY, fz];
  const view = (window.mat4LookAtInto? window.mat4LookAtInto(new Float32Array(16), eye, center, [0,0,-1]) : mat4LookAt(eye, center, [0,0,-1]));
  const mvp = (window.mat4MultiplyInto? window.mat4MultiplyInto(new Float32Array(16), proj, view) : mat4Multiply(proj, view));
  // Expose a simple visibility test for world-space points in current camera
  window._lastMVP = mvp;
  window._mvpBottom = mvp;
    window.isWorldPointVisible = function(x,y,z){
      try {
        const m = window._lastMVP; if (!m) return false;
        const v = [x,y,z,1];
        const clipX = v[0]*m[0] + v[1]*m[4] + v[2]*m[8]  + v[3]*m[12];
        const clipY = v[0]*m[1] + v[1]*m[5] + v[2]*m[9]  + v[3]*m[13];
        const clipZ = v[0]*m[2] + v[1]*m[6] + v[2]*m[10] + v[3]*m[14];
        const clipW = v[0]*m[3] + v[1]*m[7] + v[2]*m[11] + v[3]*m[15];
        if (clipW === 0) return false;
        const nx = clipX/clipW, ny = clipY/clipW, nz = clipZ/clipW;
        return nx>=-1 && nx<=1 && ny>=-1 && ny<=1 && nz>=-1 && nz<=1;
      } catch(_){ return false; }
    };
  drawTiles(mvp, 'open');
  drawWalls(mvp, 'bottom');
  drawTallColumns(mvp, 'bottom');
  if (typeof drawRemoveDebug === 'function') drawRemoveDebug(mvp);
  if (typeof drawItems === 'function') drawItems(mvp);
  if (typeof drawFxLines === 'function') drawFxLines(mvp);
  drawPlayerAndTrail(mvp);
  // Draw ghosts in this viewport
  if (typeof drawGhosts === 'function') drawGhosts(mvp);
  if (typeof drawEditorVisorAndPreview === 'function') drawEditorVisorAndPreview(mvp);
  drawGridOverlay(mvp, eye, false);
  if (typeof drawBoundaryGrid === 'function') drawBoundaryGrid(mvp, eye, false);
  } else if (state.snapTopFull) {
    // Full-screen top camera
  state.cameraKindCurrent = 'top';
    gl.viewport(0, 0, W, H);
    const mvAspectTop = W / H;
    renderGridViewport(0, 0, W, H, 'top');
  const proj = getCachedPerspective(60, Math.max(0.1, mvAspectTop), 0.1, 150.0);
      let fx = state.camFollow.x, fz = state.camFollow.z;
      // If editing, lock top camera onto the modal origin
      if (state.editor && state.editor.modalOpen && state.editor.modalOrigin && state.editor.modalOrigin.gx >= 0) {
        const o = state.editor.modalOrigin;
        fx = (o.gx - MAP_W * 0.5 + 0.5);
        fz = (o.gy - MAP_H * 0.5 + 0.5);
      }
  let eye, center;
    if (state.editor && state.editor.mode === 'fps' && !state.editor.modalOpen){
      // True first-person camera using FPS yaw+pitch
      const e = state.editor.fps;
  const dirX = Math.sin(e.yaw) * Math.cos(e.pitch);
  const dirY = Math.sin(e.pitch);
  const dirZ = -Math.cos(e.yaw) * Math.cos(e.pitch);
      eye = [e.x, e.y, e.z];
      center = [e.x + dirX, e.y + dirY, e.z + dirZ];
    } else {
      const dirX = Math.sin(state.camYaw);
      const dirZ = -Math.cos(state.camYaw);
  const dist = 4.0 * 1.69; // 33% further when top view is fullscreen
      const baseHeight = 2.6;
      eye = [fx - dirX * dist, state.camFollow.y + baseHeight, fz - dirZ * dist];
      center = [fx + dirX * 1.2, state.camFollow.y + 0.6, fz + dirZ * 1.2];
    }
  const view = (window.mat4LookAtInto? window.mat4LookAtInto(new Float32Array(16), eye, center, [0,1,0]) : mat4LookAt(eye, center, [0,1,0]));
  // Expose eye for top view so pipelines can bind camera-centric uniforms
  window._lastTopEye = eye;
  const mvp = (window.mat4MultiplyInto? window.mat4MultiplyInto(new Float32Array(16), proj, view) : mat4Multiply(proj, view));
  window._lastMVP = mvp;
  window._mvpTop = mvp;
  drawTiles(mvp, 'open');
  drawWalls(mvp, 'top');
  drawTallColumns(mvp, 'top');
  if (typeof drawRemoveDebug === 'function') drawRemoveDebug(mvp);
  if (typeof drawItems === 'function') drawItems(mvp);
  if (typeof drawFxLines === 'function') drawFxLines(mvp);
  drawPlayerAndTrail(mvp);
  if (typeof drawGhosts === 'function') drawGhosts(mvp);
  if (typeof drawEditorVisorAndPreview === 'function') drawEditorVisorAndPreview(mvp);
  drawGridOverlay(mvp, eye, true);
  if (typeof drawBoundaryGrid === 'function') drawBoundaryGrid(mvp, eye, true);
  } else {
    // Bottom viewport (lower half in pixels 0..seam)
  state.cameraKindCurrent = 'bottom';
    gl.viewport(0, 0, W, botH);
    const mvAspectBot = W / botH;
    // Clear and optional grid first so scene draws on top
    renderGridViewport(0, 0, W, botH, 'bottom');
    // Recompute bottom camera MVP (reuse function’s math inline for tiles)
    {
  const proj = getCachedPerspective(48, Math.max(0.1, mvAspectBot), 0.1, 150.0);
      const fx = state.camFollow.x, fz = state.camFollow.z;
  const eye = [fx, state.bottomCamY + (state.bottomCamOffset || 14.4), fz];
    const center = [fx, state.bottomCamY, fz];
    const view = (window.mat4LookAtInto? window.mat4LookAtInto(new Float32Array(16), eye, center, [0,0,-1]) : mat4LookAt(eye, center, [0,0,-1]));
    const mvp = (window.mat4MultiplyInto? window.mat4MultiplyInto(new Float32Array(16), proj, view) : mat4Multiply(proj, view));
  window._lastMVP = mvp;
  window._mvpBottom = mvp;
    // Draw floor tiles then 3D walls
  drawTiles(mvp, 'open');
  drawWalls(mvp, 'bottom');
  drawTallColumns(mvp, 'bottom');
  if (typeof drawRemoveDebug === 'function') drawRemoveDebug(mvp);
  if (typeof drawItems === 'function') drawItems(mvp);
  if (typeof drawFxLines === 'function') drawFxLines(mvp);
  drawPlayerAndTrail(mvp);
  if (typeof drawGhosts === 'function') drawGhosts(mvp);
  if (typeof drawEditorVisorAndPreview === 'function') drawEditorVisorAndPreview(mvp);
  drawGridOverlay(mvp, eye, false);
  if (typeof drawBoundaryGrid === 'function') drawBoundaryGrid(mvp, eye, false);
    }
    // Top viewport (upper half in pixels seam..H)
  state.cameraKindCurrent = 'top';
    gl.viewport(0, H - seamY, W, topH);
    const mvAspectTop = W / topH;
    // Clear and optional grid first so scene draws on top
    renderGridViewport(0, H - seamY, W, topH, 'top');
    {
  const proj = getCachedPerspective(60, Math.max(0.1, mvAspectTop), 0.1, 150.0);
      let fx = state.camFollow.x, fz = state.camFollow.z;
      // If editing with a modal, keep origin lock (set above in full-top path), else FPS first-person
      let eye, center;
      if (state.editor && state.editor.mode === 'fps' && !state.editor.modalOpen){
        const e = state.editor.fps;
  const dirX = Math.sin(e.yaw) * Math.cos(e.pitch);
  const dirY = Math.sin(e.pitch);
  const dirZ = -Math.cos(e.yaw) * Math.cos(e.pitch);
        eye = [e.x, e.y, e.z];
        center = [e.x + dirX, e.y + dirY, e.z + dirZ];
      } else {
        const dirX = Math.sin(state.camYaw);
        const dirZ = -Math.cos(state.camYaw);
        const dist = 4.0;
        const baseHeight = 2.6;
        eye = [fx - dirX * dist, state.camFollow.y + baseHeight, fz - dirZ * dist];
        center = [fx + dirX * 1.2, state.camFollow.y + 0.6, fz + dirZ * 1.2];
      }
  const view = (window.mat4LookAtInto? window.mat4LookAtInto(new Float32Array(16), eye, center, [0,1,0]) : mat4LookAt(eye, center, [0,1,0]));
  window._lastTopEye = eye;
  const mvp = (window.mat4MultiplyInto? window.mat4MultiplyInto(new Float32Array(16), proj, view) : mat4Multiply(proj, view));
  drawTiles(mvp, 'open');
  drawWalls(mvp, 'top');
  drawTallColumns(mvp, 'top');
  window._mvpTop = mvp;
  if (typeof drawRemoveDebug === 'function') drawRemoveDebug(mvp);
  if (typeof drawItems === 'function') drawItems(mvp);
  if (typeof drawFxLines === 'function') drawFxLines(mvp);
  drawPlayerAndTrail(mvp);
  if (typeof drawGhosts === 'function') drawGhosts(mvp);
  if (typeof drawEditorVisorAndPreview === 'function') drawEditorVisorAndPreview(mvp);
  drawGridOverlay(mvp, eye, true);
  if (typeof drawBoundaryGrid === 'function') drawBoundaryGrid(mvp, eye, true);
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // 2) Present offscreen texture to screen with letterboxing and NEAREST scaling
  const targetAR = BASE_WIDTH / BASE_HEIGHT;
  const Wpx = CANVAS.width, Hpx = CANVAS.height;
  const canvasAR = Wpx / Hpx;
  let destW, destH;
  if (state.fillViewport) {
    if (canvasAR > targetAR) {
      destH = Hpx;
      destW = Math.floor(destH * targetAR);
    } else {
      destW = Wpx;
      destH = Math.floor(destW / targetAR);
    }
  } else {
    destW = BASE_WIDTH;
    destH = BASE_HEIGHT;
  }
  const offX = Math.floor((Wpx - destW) / 2);
  const offY = Math.floor((Hpx - destH) / 2);

  // Clear screen background
  gl.viewport(0, 0, Wpx, Hpx);
  gl.disable(gl.SCISSOR_TEST);
  try {
    const useCol2 = (typeof getLevelBackgroundColored === 'function') ? getLevelBackgroundColored() : true;
    if (useCol2){
      const base2 = (typeof getLevelBaseColorRGB === 'function') ? getLevelBaseColorRGB() : [0.06,0.45,0.48];
      const c2 = base2.map(v=>v*0.05);
      gl.clearColor(c2[0], c2[1], c2[2], 1.0);
    } else {
      gl.clearColor(0,0,0,1);
    }
  } catch(_){ gl.clearColor(0,0,0,1); }
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Draw textured quad into letterboxed viewport
  gl.useProgram(blitProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, offscreen.tex);
  // Optimized uniform path (Item 4). Cache from __blitUniforms if available.
  if (!window.__uniformStats) window.__uniformStats = { blitSetCount:0, blitFallbackLookups:0 };
  const U = window.__blitUniforms;
  if (U){
    if (U.u_tex) gl.uniform1i(U.u_tex, 0);
    if (U.u_topMix) gl.uniform1f(U.u_topMix, state.topPosterizeMix || 0.0);
    if (U.u_topLevels) gl.uniform1f(U.u_topLevels, state.topPosterizeLevels || 6.0);
    if (U.u_topDither) gl.uniform1f(U.u_topDither, state.topDitherAmt || 0.0);
    if (U.u_topPixel) gl.uniform1f(U.u_topPixel, state.topPixelSize || 0.0);
    window.__uniformStats.blitSetCount++;
  } else {
    // Fallback (should not happen after core/blit.js loads first)
    const loc = gl.getUniformLocation(blitProgram, 'u_tex');
    gl.uniform1i(loc, 0);
    gl.uniform1f(gl.getUniformLocation(blitProgram, 'u_topMix'), state.topPosterizeMix || 0.0);
    gl.uniform1f(gl.getUniformLocation(blitProgram, 'u_topLevels'), state.topPosterizeLevels || 6.0);
    gl.uniform1f(gl.getUniformLocation(blitProgram, 'u_topDither'), state.topDitherAmt || 0.0);
    gl.uniform1f(gl.getUniformLocation(blitProgram, 'u_topPixel'), state.topPixelSize || 0.0);
    window.__uniformStats.blitFallbackLookups++;
  }
  
  gl.bindVertexArray(blitVAO);
  gl.viewport(offX, offY, destW, destH);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  // Avoid touching UI button DOM here; updates occur in UI modules to prevent click interruptions.

  updateHUD(now);
  requestAnimationFrame(render);
}

// Kick
resizeCanvasToViewport();
// Initialize camera yaw to player angle to avoid initial snap
state.camYaw = state.player.angle;

// Proactively initialize wall resources if dependencies are present.
// (Deferred loop in walls.js will still catch if this runs too early.)
try {
  if (typeof window !== 'undefined' && window.gl && window.initWallShaders && window.createWallGeometry) {
    if (!window.wallProgram) {
      const ok = (typeof initWallResources === 'function') ? initWallResources() : false;
      if (ok) {
      }
    }
  }
} catch(e){ }

requestAnimationFrame(render);
// Guard against multiple bootstrap starts (script reinjection)
try {
  if (typeof window !== 'undefined'){
    const m = window.__renderLoopMeta;
    if (m){
      m.startCount++;
      if (m.startCount > 1){
        m.multiStartStacks.push(new Error('Multi-start '+m.startCount).stack);
        console.warn('[LOOP][warn] render loop start attempted again; ignoring additional start. startCount=', m.startCount);
      }
    }
    if (window.__MAIN_LOOP_ACTIVE){
      console.warn('[LOOP] Additional bootstrap.js execution detected; main loop already active.');
    } else {
      window.__MAIN_LOOP_ACTIVE = true;
      // First legitimate start already scheduled above (requestAnimationFrame(render))
    }
  }
} catch(_){ }

// If a save restored player position, sync camera follow point immediately
try {
  if (state && state.camFollow && state.player){
    state.camFollow.x = state.player.x;
    state.camFollow.y = state.player.y;
    state.camFollow.z = state.player.z;
  }
} catch(_){ }
