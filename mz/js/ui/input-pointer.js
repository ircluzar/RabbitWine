/**
 * Pointer and touch input handling with swipe gesture detection.
 * Manages mouse and touch events, tracks pointer state, and detects left/right swipe gestures for player control.
 * Exports: normalizeEventPosition(), onPointerDown(), onPointerMove(), onPointerUp() functions.
 * Dependencies: CANVAS from dom.js, state.inputs from state.js, turnLeft/turnRight from controls.js. Side effects: Modifies state.inputs.pointers Map.
 */

// Pointer input and swipe detection
/**
 * Convert screen coordinates to canvas-relative coordinates
 * @param {PointerEvent|MouseEvent|TouchEvent} e - Input event
 * @returns {Object} Normalized position {x, y} relative to canvas
 */
function normalizeEventPosition(e) {
  const rect = CANVAS.getBoundingClientRect();
  return { x: (e.clientX - rect.left), y: (e.clientY - rect.top) };
}

/**
 * Handle pointer down events and start tracking
 * @param {PointerEvent} e - Pointer down event
 */
function onPointerDown(e) {
  CANVAS.focus();
  const pos = normalizeEventPosition(e);
  const id = e.pointerId || 0;
  state.inputs.pointers.set(id, { 
    x: pos.x, y: pos.y, dx: 0, dy: 0, 
    startX: pos.x, startY: pos.y, 
    lastT: e.timeStamp, downT: e.timeStamp, turned: false 
  });
}

/**
 * Handle pointer move events and track swipe gestures
 * @param {PointerEvent} e - Pointer move event
 */
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
    const totalDx = p.x - p.startX;
    const totalDy = p.y - p.startY;
    if (!p.turned) {
      // Horizontal swipe => turn left/right
      if (Math.abs(totalDx) > 36 && Math.abs(totalDx) > Math.abs(totalDy) * 1.3) {
        if (totalDx < 0) turnLeft(); else turnRight();
        p.turned = true;
      } else if (Math.abs(totalDy) > 36 && Math.abs(totalDy) > Math.abs(totalDx) * 1.3) {
        // Vertical swipe => up/down movement control
        if (totalDy < 0) {
          if (typeof swipeUp === 'function') swipeUp();
        } else {
          if (typeof swipeDown === 'function') swipeDown();
        }
        p.turned = true;
      }
    }
  }
}

function onPointerUpOrCancel(e) {
  const id = e.pointerId || 0;
  const p = state.inputs.pointers.get(id);
  if (p) {
    if (!p.turned) {
      const dx = p.x - p.startX;
      const dy = p.y - p.startY;
      const mag = Math.hypot(dx, dy);
      if (mag > 24) {
        if (Math.abs(dx) > Math.abs(dy) * 1.2) {
          if (dx < 0) turnLeft(); else turnRight();
        } else if (Math.abs(dy) > Math.abs(dx) * 1.2) {
          if (dy < 0) { if (typeof swipeUp === 'function') swipeUp(); }
          else { if (typeof swipeDown === 'function') swipeDown(); }
        } else {
          const isSmallMove = mag <= 14;
          const dur = (p.downT != null) ? (e.timeStamp - p.downT) : 1e9;
          const isShortPress = dur <= 280;
          if (isSmallMove || isShortPress) {
            doJump();
          }
        }
      } else {
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
