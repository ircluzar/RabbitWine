function resizeCanvasToViewport() {
  const dpr = state.dpr = Math.min(window.devicePixelRatio || 1, 3);
  // canvas CSS size fills viewport; set backing store size accordingly
  const cssW = Math.max(1, Math.floor(window.innerWidth));
  const cssH = Math.max(1, Math.floor(window.innerHeight));

  // Keep internal logical resolution BASE_WIDTH x BASE_HEIGHT; adapt via cameras later.
  // For now, we render directly to canvas sized to CSS * DPR to keep crispness.
  let pixelW, pixelH;
  if (state.fillViewport) {
    pixelW = Math.floor(cssW * dpr);
    pixelH = Math.floor(cssH * dpr);
  } else {
    // 1x native resolution (BASE_WIDTH x BASE_HEIGHT) regardless of viewport
    pixelW = BASE_WIDTH;
    pixelH = BASE_HEIGHT;
  }

  if (CANVAS.width !== pixelW || CANVAS.height !== pixelH) {
    CANVAS.width = pixelW;
    CANVAS.height = pixelH;
  }
  // Compute letterbox in CSS px for overlay alignment
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
    // Native size centered
    destWcss = BASE_WIDTH;
    destHcss = BASE_HEIGHT;
    offXcss = Math.floor((cssW - destWcss) / 2);
    offYcss = Math.floor((cssH - destHcss) / 2);
  }
  state.letterboxCss = { x: offXcss, y: offYcss, w: destWcss, h: destHcss };
  // Position seam handle (CSS px)
  if (state.snapBottomFull) {
    SEAM.style.top = `${offYcss}px`;
  } else if (state.snapTopFull) {
    SEAM.style.top = `${offYcss + destHcss}px`;
  } else {
    const topPx = Math.floor(offYcss + state.seamRatio * destHcss);
    SEAM.style.top = `${topPx}px`;
  }
}

// Swipe glow feedback timers and helper
let glowTimerL = 0, glowTimerR = 0;
function showSwipeGlow(dir){
  const now = performance.now();
  const dur = 180; // ms
  if (dir === 'left') { glowTimerL = now + dur; if (GLOW_L) GLOW_L.classList.add('show'); }
  else { glowTimerR = now + dur; if (GLOW_R) GLOW_R.classList.add('show'); }
}

function updateHUD(now) {
  const elapsed = (now - state.timeStart) / 1000;
  if (now - state.lastFpsT >= 500) {
    state.fps = Math.round((state.frames * 1000) / (now - state.lastFpsT));
    state.frames = 0;
    state.lastFpsT = now;
  }
  const pointerLines = [];
  state.inputs.pointers.forEach((p, id) => {
    pointerLines.push(`#${id}: x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} dx=${p.dx.toFixed(1)} dy=${p.dy.toFixed(1)}`);
  });
  HUD.textContent = [
    `FPS ${state.fps} | t ${elapsed.toFixed(1)}s | DPR ${state.dpr.toFixed(2)}`,
  `Canvas ${CANVAS.width}x${CANVAS.height} (px) | seam ${(state.seamRatio*100).toFixed(1)}%`,
  `Present ${state.letterboxCss.w}x${state.letterboxCss.h} css @ (${state.letterboxCss.x},${state.letterboxCss.y})`,
  `Player x=${state.player.x.toFixed(2)} z=${state.player.z.toFixed(2)} ang=${(state.player.angle*180/Math.PI).toFixed(0)} speed=${state.player.speed.toFixed(2)}`,
    pointerLines.length ? `Pointers:\n${pointerLines.join('\n')}` : 'Pointers: none',
    state.inputs.keys.size ? `Keys: ${Array.from(state.inputs.keys).join(',')}` : 'Keys: none',
  ].join('\n');
  // Auto-hide swipe glows shortly after activation
  if (GLOW_L && performance.now() > glowTimerL) GLOW_L.classList.remove('show');
  if (GLOW_R && performance.now() > glowTimerR) GLOW_R.classList.remove('show');
}

// Input handling
function normalizeEventPosition(e) {
  const rect = CANVAS.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left),
    y: (e.clientY - rect.top),
  };
}

function onPointerDown(e) {
  CANVAS.focus();
  const pos = normalizeEventPosition(e);
  const id = e.pointerId || 0;
  state.inputs.pointers.set(id, { x: pos.x, y: pos.y, dx: 0, dy: 0, startX: pos.x, startY: pos.y, lastT: e.timeStamp, downT: e.timeStamp, turned: false });
}
function onPointerMove(e) {
  const id = e.pointerId || 0;
  const pos = normalizeEventPosition(e);
  const p = state.inputs.pointers.get(id);
  if (p) {
    p.dx = pos.x - p.x;
    p.dy = pos.y - p.y;
    p.x = pos.x;
    p.y = pos.y;
    p.lastT = e.timeStamp;
    // Swipe-to-turn while dragging: detect strong horizontal gesture
    const totalDx = p.x - p.startX;
    const totalDy = p.y - p.startY;
    if (!p.turned && Math.abs(totalDx) > 36 && Math.abs(totalDx) > Math.abs(totalDy) * 1.3) {
      if (totalDx < 0) turnLeft(); else turnRight();
      p.turned = true; // avoid repeat until finger lifted
    }
  }
}
function onPointerUpOrCancel(e) {
  const id = e.pointerId || 0;
  const p = state.inputs.pointers.get(id);
  if (p) {
    // Only consider fallback swipe on release if we didn't already turn during drag
    if (!p.turned) {
      const dx = p.x - p.startX;
      const dy = p.y - p.startY;
      const mag = Math.hypot(dx, dy);
      if (mag > 24 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) turnLeft(); else turnRight();
      } else {
        // Treat as a tap: small movement or short press duration
        const isSmallMove = mag <= 14;
        const dur = (p.downT != null) ? (e.timeStamp - p.downT) : 1e9;
        const isShortPress = dur <= 280;
        if (isSmallMove || isShortPress) {
          doJump();
        }
      }
    }
  }
  state.inputs.pointers.delete(id);
}

function onKey(e) {
  if (e.type === 'keydown') state.inputs.keys.add(e.key);
  else state.inputs.keys.delete(e.key);
}

// Trigger a jump if grounded (shared by keyboard and tap)
function doJump(){
  if (state.player.grounded){
    state.player.vy = 8.5;
    state.player.grounded = false;
    state.player.jumpStartY = state.player.y;
  }
}

// Prevent context menu on long-press/right-click
window.addEventListener('contextmenu', (e) => e.preventDefault(), { passive: false });

CANVAS.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUpOrCancel);
window.addEventListener('pointercancel', onPointerUpOrCancel);

window.addEventListener('keydown', onKey);
window.addEventListener('keyup', onKey);

window.addEventListener('resize', resizeCanvasToViewport);
window.addEventListener('orientationchange', resizeCanvasToViewport);

// Toggle fill/native scaling
if (FILL_TOGGLE){
  FILL_TOGGLE.addEventListener('click', () => {
    state.fillViewport = !state.fillViewport;
    FILL_TOGGLE.setAttribute('aria-pressed', state.fillViewport ? 'true' : 'false');
    FILL_TOGGLE.textContent = `Fill: ${state.fillViewport ? 'ON' : 'OFF'}`;
    resizeCanvasToViewport();
  });
}

// Seam drag logic
let draggingSeam = false;
SEAM_HANDLE.addEventListener('pointerdown', (e) => {
  draggingSeam = true;
  SEAM_HANDLE.setPointerCapture(e.pointerId);
});
SEAM_HANDLE.addEventListener('pointermove', (e) => {
  if (!draggingSeam) return;
  const lb = state.letterboxCss;
  const cssH = Math.max(1, Math.floor(window.innerHeight));
  const y = Math.max(0, Math.min(cssH, e.clientY));
  const insideY = Math.min(Math.max(y - lb.y, 0), Math.max(1, lb.h));
  const ratio = insideY / Math.max(1, lb.h); // top height ratio
  const bottomRatio = 1 - ratio;

  // Normalize mutual exclusivity
  if (state.snapBottomFull) state.snapTopFull = false;
  if (state.snapTopFull) state.snapBottomFull = false;

  if (state.snapBottomFull) {
    // Stay snapped until user pulls past threshold (top >= 31%)
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
    // Stay snapped until user pulls past threshold from bottom (bottom >= 31% => ratio <= 0.80)
    if (bottomRatio >= 0.31) {
      state.snapTopFull = false;
      state.seamRatio = 0.80; // top 80%
      const topPx = Math.floor(lb.y + state.seamRatio * lb.h);
      SEAM.style.top = `${topPx}px`;
    } else {
      state.seamRatio = 1.0;
      SEAM.style.top = `${lb.y + lb.h}px`;
    }
  } else {
    // Not snapped: if bottom grows beyond 80%, snap to full bottom
    if (bottomRatio > 0.80) {
      state.snapBottomFull = true;
      state.seamRatio = 0.0;
      SEAM.style.top = `${lb.y}px`;
    } else if (ratio > 0.80) {
      // If top grows beyond 80%, snap to full top
      state.snapTopFull = true;
      state.seamRatio = 1.0;
      SEAM.style.top = `${lb.y + lb.h}px`;
    } else {
      state.seamRatio = Math.min(0.95, Math.max(0.05, ratio));
      const topPx = Math.floor(lb.y + state.seamRatio * lb.h);
      SEAM.style.top = `${topPx}px`;
    }
  }
});
const endDrag = (e) => { draggingSeam = false; };
SEAM_HANDLE.addEventListener('pointerup', endDrag);
SEAM_HANDLE.addEventListener('pointercancel', endDrag);
