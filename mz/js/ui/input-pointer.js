// Pointer input and swipe detection
function normalizeEventPosition(e) {
  const rect = CANVAS.getBoundingClientRect();
  return { x: (e.clientX - rect.left), y: (e.clientY - rect.top) };
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
    const totalDx = p.x - p.startX;
    const totalDy = p.y - p.startY;
    if (!p.turned && Math.abs(totalDx) > 36 && Math.abs(totalDx) > Math.abs(totalDy) * 1.3) {
      if (totalDx < 0) turnLeft(); else turnRight();
      p.turned = true;
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
      if (mag > 24 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) turnLeft(); else turnRight();
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
