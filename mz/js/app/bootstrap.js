/**
 * Main render loop and application bootstrap for the MZ game.
 * TODO: Remove this duplicate file and update imports to use js/bootstrap.js instead.
 * Dependencies: All core modules, state management, WebGL pipelines. Side effects: Modifies WebGL state, calls requestAnimationFrame.
 */

/**
 * Main render function called every frame
 * @param {number} now - Current timestamp from requestAnimationFrame
 */
function render(now) {
  state.frames++;
  const dt = Math.min(0.05, Math.max(0, (now - state.timePrev) / 1000));
  state.timePrev = now;
  state.nowSec = now / 1000;
  stepGame(dt);
  // 1) Render into offscreen low-res target (480x720)
  gl.bindFramebuffer(gl.FRAMEBUFFER, offscreen.fbo);
  gl.viewport(0, 0, offscreen.w, offscreen.h);
  // Clear offscreen
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0.04, 0.04, 0.06, 1.0);
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
    const proj = mat4Perspective(deg2rad(48), Math.max(0.1, mvAspectBot), 0.1, 150.0);
    const fx = state.camFollow.x, fz = state.camFollow.z;
    const eye = [fx, 24.0, fz];
    const center = [fx, 0.0, fz];
    const view = mat4LookAt(eye, center, [0, 0, -1]);
    const mvp = mat4Multiply(proj, view);
  drawTiles(mvp, 'open');
  drawWalls(mvp, 'bottom');
  drawTallColumns(mvp, 'bottom');
  if (typeof drawRemoveDebug === 'function') drawRemoveDebug(mvp);
  if (typeof drawItems === 'function') drawItems(mvp);
  if (typeof drawFxLines === 'function') drawFxLines(mvp);
  drawPlayerAndTrail(mvp);
  if (typeof drawEditorVisorAndPreview === 'function') drawEditorVisorAndPreview(mvp);
  drawGridOverlay(mvp, eye, false);
  if (typeof drawBoundaryGrid === 'function') drawBoundaryGrid(mvp, eye, false);
  } else if (state.snapTopFull) {
    // Full-screen top camera
  state.cameraKindCurrent = 'top';
    gl.viewport(0, 0, W, H);
    const mvAspectTop = W / H;
    renderGridViewport(0, 0, W, H, 'top');
    const proj = mat4Perspective(deg2rad(60), Math.max(0.1, mvAspectTop), 0.1, 150.0);
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
      const dist = 4.0;
      const baseHeight = 2.6;
      eye = [fx - dirX * dist, state.camFollow.y + baseHeight, fz - dirZ * dist];
      center = [fx + dirX * 1.2, state.camFollow.y + 0.6, fz + dirZ * 1.2];
    }
    const view = mat4LookAt(eye, center, [0, 1, 0]);
    const mvp = mat4Multiply(proj, view);
  drawTiles(mvp, 'open');
  drawWalls(mvp, 'top');
  drawTallColumns(mvp, 'top');
  if (typeof drawRemoveDebug === 'function') drawRemoveDebug(mvp);
  if (typeof drawItems === 'function') drawItems(mvp);
  if (typeof drawFxLines === 'function') drawFxLines(mvp);
  drawPlayerAndTrail(mvp);
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
      const proj = mat4Perspective(deg2rad(48), Math.max(0.1, mvAspectBot), 0.1, 150.0);
      const fx = state.camFollow.x, fz = state.camFollow.z;
  const eye = [fx, 24.0, fz];
      const center = [fx, 0.0, fz];
      const view = mat4LookAt(eye, center, [0, 0, -1]);
      const mvp = mat4Multiply(proj, view);
    // Draw floor tiles then 3D walls
  drawTiles(mvp, 'open');
  drawWalls(mvp, 'bottom');
  drawTallColumns(mvp, 'bottom');
  if (typeof drawRemoveDebug === 'function') drawRemoveDebug(mvp);
  if (typeof drawItems === 'function') drawItems(mvp);
  if (typeof drawFxLines === 'function') drawFxLines(mvp);
  drawPlayerAndTrail(mvp);
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
      const proj = mat4Perspective(deg2rad(60), Math.max(0.1, mvAspectTop), 0.1, 150.0);
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
      const view = mat4LookAt(eye, center, [0, 1, 0]);
      const mvp = mat4Multiply(proj, view);
  drawTiles(mvp, 'open');
  drawWalls(mvp, 'top');
  drawTallColumns(mvp, 'top');
  if (typeof drawRemoveDebug === 'function') drawRemoveDebug(mvp);
  if (typeof drawItems === 'function') drawItems(mvp);
  if (typeof drawFxLines === 'function') drawFxLines(mvp);
  drawPlayerAndTrail(mvp);
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
  gl.clearColor(0.012, 0.028, 0.03, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Draw textured quad into letterboxed viewport
  gl.useProgram(blitProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, offscreen.tex);
  const loc = gl.getUniformLocation(blitProgram, 'u_tex');
  gl.uniform1i(loc, 0);
  // Set top posterize mix
  const uTopMix = gl.getUniformLocation(blitProgram, 'u_topMix');
  gl.uniform1f(uTopMix, state.topPosterizeMix || 0.0);
  const uTopLevels = gl.getUniformLocation(blitProgram, 'u_topLevels');
  gl.uniform1f(uTopLevels, state.topPosterizeLevels || 6.0);
  const uTopDither = gl.getUniformLocation(blitProgram, 'u_topDither');
  gl.uniform1f(uTopDither, state.topDitherAmt || 0.0);
  const uTopPixel = gl.getUniformLocation(blitProgram, 'u_topPixel');
  gl.uniform1f(uTopPixel, state.topPixelSize || 0.0);
  
  // Debug: log values when they change
  if (state.topPosterizeMix > 0.0 && state.frames % 60 === 0) {
    console.log('Bitcrush state:', {
      mix: state.topPosterizeMix,
      levels: state.topPosterizeLevels,
      dither: state.topDitherAmt,
      pixel: state.topPixelSize
    });
  }
  gl.bindVertexArray(blitVAO);
  gl.viewport(offX, offY, destW, destH);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  // Optional: sync lock button aria quickly each frame in case state changes via keyboard/gameplay
  try {
    if (ALT_LOCK_BTN){
      const hide = !!state.snapBottomFull;
      ALT_LOCK_BTN.dataset.hidden = hide ? 'true' : 'false';
      ALT_LOCK_BTN.setAttribute('aria-hidden', hide ? 'true' : 'false');
      ALT_LOCK_BTN.textContent = state.altBottomControlLocked ? 'Unlock' : 'Lock';
      ALT_LOCK_BTN.setAttribute('aria-pressed', state.altBottomControlLocked ? 'true' : 'false');
    }
  } catch(_){ }

  updateHUD(now);
  requestAnimationFrame(render);
}

// Kick
resizeCanvasToViewport();
// Initialize camera yaw to player angle to avoid initial snap
state.camYaw = state.player.angle;
requestAnimationFrame(render);
