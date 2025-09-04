// Resize and letterbox computation
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
}
