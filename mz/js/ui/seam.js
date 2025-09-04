// Seam drag logic
let draggingSeam = false;

function onSeamPointerDown(e){
  draggingSeam = true;
  SEAM_HANDLE.setPointerCapture(e.pointerId);
}

function onSeamPointerMove(e){
  if (!draggingSeam) return;
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
