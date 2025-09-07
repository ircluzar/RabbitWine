/**
 * Canvas resize handling with letterboxing and device pixel ratio management.
 * Manages viewport scaling, letterbox calculation, and maintains aspect ratio for the game canvas.
 * Exports: resizeCanvasToViewport() function and letterbox calculation utilities.
 * Dependencies: state from state.js, BASE_WIDTH/BASE_HEIGHT from constants.js, CANVAS from dom.js. Side effects: Modifies canvas size and state.letterboxCss.
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
