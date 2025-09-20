/**
 * Split-screen seam dragging UI control.
 *
 * Responsibilities:
 *  - Handle pointer drag interactions on the seam divider (SEAM_HANDLE).
 *  - Manage snap states (top fullscreen / bottom fullscreen / proportional split).
 *  - Update state.seamRatio and SEAM position during drags.
 *  - Enforce unlock condition (player.canTurn) to prevent use when camera control locked.
 *
 * Interaction Logic:
 *  - Drag beyond 80% towards one side snaps to fullscreen mode for that viewport.
 *  - Fullscreen modes require 31% drag back toward center to unsnap.
 *  - Proportional mode clamps seam between 5% and 95% of viewport height.
 *
 * Data Sources (read):
 *  - state: seamRatio, letterboxCss, snapTopFull, snapBottomFull, player.canTurn.
 *  - window.innerHeight for clientY coordinate normalization.
 *  - SEAM_HANDLE, SEAM (DOM elements).
 *
 * Side Effects (write):
 *  - Mutates state.seamRatio, state.snapTopFull, state.snapBottomFull.
 *  - Repositions SEAM.style.top.
 *  - Sets/releases pointer capture on SEAM_HANDLE.
 *
 * Exported API (window):
 *  - draggingSeam (boolean state)
 *  - seamUnlocked() (condition checker)
 *  - onSeamPointerDown(e), onSeamPointerMove(e), onSeamPointerEnd(e)
 */

// Seam drag logic
let draggingSeam = false;

function seamUnlocked(){
  try {
    const canTurn = !!(state.player && state.player.canTurn);
    return canTurn; // same unlock condition as alt lock button (turning unlocked or via Debug which sets canTurn)
  } catch(_){ return false; }
}

/**
 * Start seam dragging interaction
 * @param {PointerEvent} e - Pointer down event
 */
function onSeamPointerDown(e){
  if (!seamUnlocked()) return;
  e.preventDefault();
  draggingSeam = true;
  try { SEAM_HANDLE.setPointerCapture(e.pointerId); } catch(_){ }
}

/**
 * Handle seam drag movement
 * @param {PointerEvent} e - Pointer move event
 */
function onSeamPointerMove(e){
  if (!draggingSeam || !seamUnlocked()) return;
  const lb = state.letterboxCss;
  const cssH = Math.max(1, Math.floor(window.innerHeight));
  const y = Math.max(0, Math.min(cssH, e.clientY));
  const insideY = Math.min(Math.max(y - lb.y, 0), Math.max(1, lb.h));
  const ratio = insideY / Math.max(1, lb.h);
  const bottomRatio = 1 - ratio;

  if (state.snapBottomFull) state.snapTopFull = false;
  if (state.snapTopFull) state.snapBottomFull = false;

  if (state.snapBottomFull) {
    if (ratio >= 0.31) {
      state.snapBottomFull = false;
      state.seamRatio = 0.31;
      const topPx = Math.floor(lb.y + state.seamRatio * lb.h);
      SEAM.style.top = `${topPx}px`;
    } else {
      state.seamRatio = 0.0;
      SEAM.style.top = `${lb.y}px`;
    }
  } else if (state.snapTopFull) {
    if (bottomRatio >= 0.31) {
      state.snapTopFull = false;
      state.seamRatio = 0.80;
      const topPx = Math.floor(lb.y + state.seamRatio * lb.h);
      SEAM.style.top = `${topPx}px`;
    } else {
      state.seamRatio = 1.0;
      SEAM.style.top = `${lb.y + lb.h}px`;
    }
  } else {
    if (bottomRatio > 0.80) {
      state.snapBottomFull = true;
      state.seamRatio = 0.0;
      SEAM.style.top = `${lb.y}px`;
    } else if (ratio > 0.80) {
      state.snapTopFull = true;
      state.seamRatio = 1.0;
      SEAM.style.top = `${lb.y + lb.h}px`;
    } else {
      state.seamRatio = Math.min(0.95, Math.max(0.05, ratio));
      const topPx = Math.floor(lb.y + state.seamRatio * lb.h);
      SEAM.style.top = `${topPx}px`;
    }
  }
}

function onSeamPointerEnd(e){ draggingSeam = false; }

// Global exports
try {
  if (typeof window !== 'undefined'){
    window.draggingSeam = draggingSeam;
    window.seamUnlocked = seamUnlocked;
    window.onSeamPointerDown = onSeamPointerDown;
    window.onSeamPointerMove = onSeamPointerMove;
    window.onSeamPointerEnd = onSeamPointerEnd;
  }
} catch(_){ }
