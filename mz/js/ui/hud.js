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
  
  // Update FPS every 500ms
  if (now - state.lastFpsT >= 500) {
    state.fps = Math.round((state.frames * 1000) / (now - state.lastFpsT));
    state.frames = 0;
    state.lastFpsT = now;
  }
  const pointerLines = [];
  state.inputs.pointers.forEach((p, id) => {
    pointerLines.push(`#${id}: x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} dx=${p.dx.toFixed(1)} dy=${p.dy.toFixed(1)}`);
  });
  // Convert world coordinates (origin-centered) to grid coordinates (0..MAP_W-1, 0..MAP_H-1)
  const gridX = Math.floor(state.player.x + MAP_W * 0.5);
  const gridY = Math.floor(state.player.z + MAP_H * 0.5);
  HUD.textContent = [
    `FPS ${state.fps} | t ${elapsed.toFixed(1)}s | DPR ${state.dpr.toFixed(2)}`,
    `Canvas ${CANVAS.width}x${CANVAS.height} (px) | seam ${(state.seamRatio*100).toFixed(1)}%`,
    `Present ${state.letterboxCss.w}x${state.letterboxCss.h} css @ (${state.letterboxCss.x},${state.letterboxCss.y})`,
    `Player grid=${gridX},${gridY} | world=${state.player.x.toFixed(2)},${state.player.z.toFixed(2)} | ang=${(state.player.angle*180/Math.PI).toFixed(0)} speed=${state.player.speed.toFixed(2)} mode=${state.player.movementMode}`,
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
