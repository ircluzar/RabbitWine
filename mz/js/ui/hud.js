/**
 * Heads-Up Display (HUD) + swipe glow feedback system.
 *
 * Responsibilities:
 *  - Transient swipe direction glow (left / right / up / down) with simple timers.
 *  - Periodic debug / diagnostic text (FPS, time, DPR, canvas size, player world + grid position,
 *    active pointer summaries, pressed keys, seam ratio, letterbox metrics).
 *  - Respect the global debug visibility flag (state.debugVisible) and hide when disabled.
 *
 * Data Sources (read):
 *  - state: timing (timeStart, lastFpsT, frames, dpr), debugVisible, inputs (pointers, keys),
 *    player (x,y,z, angle, speed, movementMode), letterboxCss, seamRatio.
 *  - MAP_W / MAP_H for converting player world coords to grid coords.
 *  - CANVAS, HUD, GLOW_L, GLOW_R (DOM elements – see dom.js for definitions).
 *
 * Side Effects (write):
 *  - Mutates HUD.textContent with multiline debug text (\n separated).
 *  - Adds / removes the 'show' CSS class on glow elements and directional glow DOM nodes.
 *  - Sets HUD aria-hidden attribute to reflect debug visibility.
 *
 * Exported API (attached to window for non-module environment):
 *  - showSwipeGlow(dir: 'left'|'right'|'up'|'down')
 *  - updateHUD(now: DOMHighResTimeStamp)
 */

// HUD updates and swipe glow feedback
let glowTimerL = 0, glowTimerR = 0, glowTimerU = 0, glowTimerD = 0;

/**
 * Show swipe glow visual feedback
 * @param {string} dir - Direction 'left' or 'right'
 */
function showSwipeGlow(dir){
  const now = performance.now();
  const dur = 180; // Duration in milliseconds
  if (dir === 'left') { 
    glowTimerL = now + dur; 
    if (GLOW_L) GLOW_L.classList.add('show'); 
  } else if (dir === 'right') { 
    glowTimerR = now + dur; 
    if (GLOW_R) GLOW_R.classList.add('show'); 
  } else if (dir === 'up') {
    glowTimerU = now + dur;
    const el = document.getElementById('swipe-glow-up');
    if (el) el.classList.add('show');
  } else if (dir === 'down') {
    glowTimerD = now + dur;
    const el = document.getElementById('swipe-glow-down');
    if (el) el.classList.add('show');
  }
}

/**
 * Update HUD elements like FPS display
 * @param {number} now - Current timestamp
 */
function updateHUD(now) {
  if (!HUD) return; // If HUD element missing, silently skip
  const elapsed = (now - state.timeStart) / 1000;
  // Respect debug visibility: hide when off
  if (!state.debugVisible){
    if (HUD) HUD.setAttribute('aria-hidden', 'true');
    return;
  }
  if (HUD) HUD.setAttribute('aria-hidden', 'false');
  const safeFixed = (v, d=2, def='0') => {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(d) : def;
  };
  const safeInt = (v, def=0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : def;
  };
  
  // Update FPS every 500ms
  if (now - state.lastFpsT >= 500) {
    state.fps = Math.round((state.frames * 1000) / (now - state.lastFpsT));
    state.frames = 0;
    state.lastFpsT = now;
  }
  const pointerLines = [];
  try {
    state.inputs.pointers.forEach((p, id) => {
      if (!p) return;
      pointerLines.push(`#${id}: x=${safeFixed(p.x,1)} y=${safeFixed(p.y,1)} dx=${safeFixed(p.dx,1)} dy=${safeFixed(p.dy,1)}`);
    });
  } catch(_){ }
  // Convert world coordinates (origin-centered) to grid coordinates (0..MAP_W-1, 0..MAP_H-1)
  const gridX = safeInt((state.player && state.player.x) + MAP_W * 0.5);
  const gridY = safeInt((state.player && state.player.z) + MAP_H * 0.5);
  const lb = state.letterboxCss || { w: 0, h: 0, x: 0, y: 0 };
  const playerY = safeFixed(state.player && state.player.y, 2);
  const worldX = safeFixed(state.player && state.player.x, 2);
  const worldZ = safeFixed(state.player && state.player.z, 2);
  HUD.textContent = [
    `FPS ${state.fps} | t ${safeFixed(elapsed,1)}s | DPR ${safeFixed(state.dpr,2)}`,
    `Canvas ${CANVAS && CANVAS.width || 0}x${CANVAS && CANVAS.height || 0} (px) | seam ${safeFixed((state.seamRatio*100),1)}%`,
    `Present ${lb.w||0}x${lb.h||0} css @ (${lb.x||0},${lb.y||0})`,
    `Player grid=${gridX},${gridY} y=${playerY} | world=${worldX},${playerY},${worldZ} | ang=${safeFixed((state.player && state.player.angle)*180/Math.PI,0)} speed=${safeFixed(state.player && state.player.speed,2)} mode=${(state.player && state.player.movementMode) || 'n/a'}`,
    pointerLines.length ? `Pointers:\n${pointerLines.join('\n')}` : 'Pointers: none',
    state.inputs.keys.size ? `Keys: ${Array.from(state.inputs.keys).join(',')}` : 'Keys: none',
  ].join('\n');
  const nowMs = performance.now();
  if (GLOW_L && nowMs > glowTimerL) GLOW_L.classList.remove('show');
  if (GLOW_R && nowMs > glowTimerR) GLOW_R.classList.remove('show');
  const GU = document.getElementById('swipe-glow-up');
  const GD = document.getElementById('swipe-glow-down');
  if (GU && nowMs > glowTimerU) GU.classList.remove('show');
  if (GD && nowMs > glowTimerD) GD.classList.remove('show');
}

// Global export (non-module environment)
try {
  if (typeof window !== 'undefined'){
    window.showSwipeGlow = showSwipeGlow;
    window.updateHUD = updateHUD;
  }
} catch(_){ }
