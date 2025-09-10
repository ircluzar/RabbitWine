/**
 * HUD updates and visual feedback for player interactions.
 * Manages swipe glow effects, FPS display, and other UI feedback elements.
 * Exports: showSwipeGlow(), updateHUD() functions.
 * Dependencies: state.fps and timing from state.js, GLOW_L/GLOW_R from dom.js. Side effects: Modifies DOM element classes and text content.
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
  HUD.textContent = [
    `FPS ${state.fps} | t ${safeFixed(elapsed,1)}s | DPR ${safeFixed(state.dpr,2)}`,
    `Canvas ${CANVAS && CANVAS.width || 0}x${CANVAS && CANVAS.height || 0} (px) | seam ${safeFixed((state.seamRatio*100),1)}%`,
    `Present ${lb.w||0}x${lb.h||0} css @ (${lb.x||0},${lb.y||0})`,
    `Player grid=${gridX},${gridY} | world=${safeFixed(state.player && state.player.x,2)} ,${safeFixed(state.player && state.player.z,2)} | ang=${safeFixed((state.player && state.player.angle)*180/Math.PI,0)} speed=${safeFixed(state.player && state.player.speed,2)} mode=${(state.player && state.player.movementMode) || 'n/a'}`,
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
