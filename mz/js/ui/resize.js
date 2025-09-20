/**
 * Viewport resize handling + letterbox calculation.
 *
 * Responsibilities:
 *  - Resize game canvas to match window dimensions while preserving aspect ratio.
 *  - Calculate letterbox offsets for centered viewport presentation.
 *  - Support both fixed resolution (BASE_WIDTH × BASE_HEIGHT) and fillViewport modes.
 *  - Apply device pixel ratio scaling (clamped to max 3× for performance).
 *  - Update seam position and UI element visibility on resize.
 *
 * Resize Strategy:
 *  - fillViewport mode: scale canvas to full window size, maintain aspect ratio via letterboxing.
 *  - Fixed mode: use BASE_WIDTH × BASE_HEIGHT canvas, center within window.
 *  - DPR scaling applied to canvas.width/height but CSS size uses logical pixels.
 *
 * Data Sources (read):
 *  - window.innerWidth/Height, window.devicePixelRatio.
 *  - state: fillViewport, seamRatio, snapTopFull, snapBottomFull, player.canTurn.
 *  - BASE_WIDTH, BASE_HEIGHT (target aspect ratio).
 *  - CANVAS, SEAM, ALT_LOCK_BTN, SEAM_HANDLE (DOM elements).
 *
 * Side Effects (write):
 *  - Mutates CANVAS.width/height (backing store pixels).
 *  - Updates state.dpr, state.letterboxCss.
 *  - Repositions SEAM.style.top.
 *  - Updates ALT_LOCK_BTN + SEAM_HANDLE visibility/attributes.
 *
 * Exported API (window):
 *  - resizeCanvasToViewport()
 */

// Resize and letterbox computation
/**
 * Resize canvas to fit viewport with proper letterboxing
 */
function resizeCanvasToViewport() {
  const dpr = state.dpr = Math.min(window.devicePixelRatio || 1, 3);
  const cssW = Math.max(1, Math.floor(window.innerWidth));
  const cssH = Math.max(1, Math.floor(window.innerHeight));

  let pixelW, pixelH;
  if (state.fillViewport) {
    pixelW = Math.floor(cssW * dpr);
    pixelH = Math.floor(cssH * dpr);
  } else {
    pixelW = BASE_WIDTH;
    pixelH = BASE_HEIGHT;
  }

  if (CANVAS.width !== pixelW || CANVAS.height !== pixelH) {
    CANVAS.width = pixelW;
    CANVAS.height = pixelH;
  }

  const targetAR = BASE_WIDTH / BASE_HEIGHT;
  const cssAR = cssW / cssH;
  let destWcss, destHcss, offXcss, offYcss;
  if (state.fillViewport) {
    if (cssAR > targetAR) {
      destHcss = cssH;
      destWcss = Math.floor(destHcss * targetAR);
    } else {
      destWcss = cssW;
      destHcss = Math.floor(destWcss / targetAR);
    }
    offXcss = Math.floor((cssW - destWcss) / 2);
    offYcss = Math.floor((cssH - destHcss) / 2);
  } else {
    destWcss = BASE_WIDTH;
    destHcss = BASE_HEIGHT;
    offXcss = Math.floor((cssW - destWcss) / 2);
    offYcss = Math.floor((cssH - destHcss) / 2);
  }
  state.letterboxCss = { x: offXcss, y: offYcss, w: destWcss, h: destHcss };

  // Position seam element based on snap state
  if (state.snapBottomFull) {
    SEAM.style.top = `${offYcss}px`;
  } else if (state.snapTopFull) {
    SEAM.style.top = `${offYcss + destHcss}px`;
  } else {
    const topPx = Math.floor(offYcss + state.seamRatio * destHcss);
    SEAM.style.top = `${topPx}px`;
  }
  // Update lock button visibility immediately on resize
  try {
    if (ALT_LOCK_BTN){
      const canTurn = !!(state.player && state.player.canTurn);
      const hide = (state.snapBottomFull || !canTurn);
      ALT_LOCK_BTN.dataset.hidden = hide ? 'true' : 'false';
      ALT_LOCK_BTN.style.display = hide ? 'none' : 'inline-flex';
    }
    if (typeof window.setAltLockButtonIcon === 'function') window.setAltLockButtonIcon();
    if (SEAM_HANDLE){
      const canTurn2 = !!(state.player && state.player.canTurn);
      const seamHide = !canTurn2;
      SEAM_HANDLE.dataset.hidden = seamHide ? 'true' : 'false';
      SEAM_HANDLE.style.display = seamHide ? 'none' : 'block';
    }
  } catch(_){ }
}

// Global exports
try {
  if (typeof window !== 'undefined'){
    window.resizeCanvasToViewport = resizeCanvasToViewport;
  }
} catch(_){ }
