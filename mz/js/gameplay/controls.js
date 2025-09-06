/**
 * Player control functions for movement and input handling.
 * Provides turn controls, keyboard input processing, and jump mechanics.
 * Exports: turnLeft(), turnRight(), handleKeyboard(), doJump(), startDash() functions.
 * Dependencies: state.player and state.inputs from state.js, showSwipeGlow() from UI. Side effects: Modifies player angle, velocity, and input state.
 */

// Controls: turns, keyboard, jump, and dash
/**
 * Turn player 90 degrees to the left
 */
function turnLeft(){ 
  if (!state.player.canTurn) return;
  state.player.angle -= Math.PI/2; 
  showSwipeGlow('left'); 
  // SFX: turn left (35%)
  try { if (window.sfx) sfx.play('./sfx/Menu_Move.mp3', { volume: 0.35 }); } catch(_){}
}

/**
 * Turn player 90 degrees to the right
 */
function turnRight(){ 
  if (!state.player.canTurn) return;
  state.player.angle += Math.PI/2; 
  showSwipeGlow('right'); 
  // SFX: turn right (35%)
  try { if (window.sfx) sfx.play('./sfx/Menu_Move.mp3', { volume: 0.35 }); } catch(_){}
}

/**
 * Engage acceleration mode (swipe up)
 */
function swipeUp(){
  state.player.movementMode = 'accelerate';
  if (typeof showSwipeGlow === 'function') showSwipeGlow('up');
  // SFX: move forward (35%)
  try { if (window.sfx) sfx.play('./sfx/Menu_Select.mp3', { volume: 0.35 }); } catch(_){}
}

/**
 * Engage deceleration/stop or 180-flip when stationary (swipe down)
 */
function swipeDown(){
  const p = state.player;
  if (!p.canBack) return;
  if (p.movementMode === 'stationary' && (p.speed||0) <= 0.001){
    // 180 and start accelerating in opposite direction
    p.angle += Math.PI;
    p.movementMode = 'accelerate';
  } else {
    p.movementMode = 'stationary';
  }
  if (typeof showSwipeGlow === 'function') showSwipeGlow('down');
  // SFX: back/stop (35%)
  try { if (window.sfx) sfx.play('./sfx/Menu_Back.mp3', { volume: 0.35 }); } catch(_){}
}

// --- Dash helpers ---
function startFreeze(){
  const p = state.player;
  if (!p.hasDash || !p.canDash) return;
  if (p.dashUsed) return;
  if (p.isFrozen || p.isDashing) return;
  p.isFrozen = true;
  // SFX: entering freeze
  try { if (window.sfx) sfx.play('./sfx/VHS_Laser6.mp3'); } catch(_){}
  // Save current motion state
  p._savedSpeed = p.speed;
  p._savedVy = p.vy;
  p._savedMode = p.movementMode;
  // Pause motion
  p.speed = 0.0;
  p.vy = 0.0;
}

function resumeFromFreeze(){
  const p = state.player;
  if (!p.isFrozen) return;
  p.isFrozen = false;
  // Restore motion
  p.speed = p._savedSpeed || 0.0;
  p.vy = p._savedVy || 0.0;
  p.movementMode = p._savedMode || 'stationary';
}

/**
 * Begin a dash in a given direction relative to player facing.
 * dir: 'up'|'down'|'left'|'right'
 */
function startDash(dir){
  const p = state.player;
  if (!p.canDash || !p.hasDash || p.dashUsed) return;
  // Must be midair freeze or midair
  if (p.grounded) return;
  // End freeze if active
  if (p.isFrozen) p.isFrozen = false;
  p.isDashing = true;
  // SFX: dash start
  try { if (window.sfx) sfx.play('./sfx/VHS_Deflect4.mp3'); } catch(_){}
  p.dashTime = 0.666; // seconds of gravity ignore
  p.dashUsed = true; // consume dash for this jump
  // During dash we "walk in midair"
  p.vy = 0.0;
  // Compute direction vector in XZ plane
  const ang = p.angle;
  // forward
  let vx = Math.sin(ang), vz = -Math.cos(ang);
  if (dir === 'down') { vx = -vx; vz = -vz; }
  else if (dir === 'left') { // strafe left (rotate -90°)
    const a = ang - Math.PI/2; vx = Math.sin(a); vz = -Math.cos(a);
  } else if (dir === 'right') { // strafe right (rotate +90°)
    const a = ang + Math.PI/2; vx = Math.sin(a); vz = -Math.cos(a);
  }
  // Normalize just in case
  const len = Math.hypot(vx, vz) || 1;
  p._dashDirX = vx/len;
  p._dashDirZ = vz/len;
  // Immediately rotate player angle to face dash direction so camera starts rotating now
  if (dir === 'up') {
    // keep current angle
  } else if (dir === 'down') {
    p.angle = p.angle + Math.PI;
  } else if (dir === 'left') {
    p.angle = p.angle - Math.PI/2;
  } else if (dir === 'right') {
    p.angle = p.angle + Math.PI/2;
  }
  if (typeof normalizeAngle === 'function') p.angle = normalizeAngle(p.angle);
  // Set displayed speed to max instantly (actual step handled in physics)
  try {
    const base = 3.0; const max = base * seamSpeedFactor();
    p.speed = max * 1.25;
  } catch(e) {
    p.speed = 6.25;
  }
  if (typeof showSwipeGlow === 'function') showSwipeGlow(dir);
}

/**
 * Process keyboard input for player controls
 * @param {number} dt - Delta time (unused)
 */
function handleKeyboard(dt){
  const p = state.player;
  if (state.inputs.keys.has('ArrowLeft') || state.inputs.keys.has('a')) {
  if (p.isFrozen && !p.isDashing && p.hasDash && p.canDash && !p.dashUsed) { startDash('left'); }
  else { turnLeft(); }
    state.inputs.keys.delete('ArrowLeft'); 
    state.inputs.keys.delete('a');
  }
  if (state.inputs.keys.has('ArrowRight') || state.inputs.keys.has('d')) {
  if (p.isFrozen && !p.isDashing && p.hasDash && p.canDash && !p.dashUsed) { startDash('right'); }
  else { turnRight(); }
    state.inputs.keys.delete('ArrowRight'); 
    state.inputs.keys.delete('d');
  }
  // Optional keyboard for up/down swipes
  if (state.inputs.keys.has('ArrowUp') || state.inputs.keys.has('w')){
  if (p.isFrozen && !p.isDashing && p.hasDash && p.canDash && !p.dashUsed) { startDash('up'); }
    else { swipeUp(); }
    state.inputs.keys.delete('ArrowUp');
    state.inputs.keys.delete('w');
  }
  if (state.inputs.keys.has('ArrowDown') || state.inputs.keys.has('s')){
  if (p.isFrozen && !p.isDashing && p.hasDash && p.canDash && !p.dashUsed) { startDash('down'); }
    else { swipeDown(); }
    state.inputs.keys.delete('ArrowDown');
    state.inputs.keys.delete('s');
  }
  if (state.inputs.keys.has(' ') || state.inputs.keys.has('Space') || state.inputs.keys.has('Spacebar')){
    doJump();
    state.inputs.keys.delete(' ');
    state.inputs.keys.delete('Space');
    state.inputs.keys.delete('Spacebar');
  }
}

/**
 * Make player jump if grounded
 */
function doJump(){
  const p = state.player;
  if (!p.canJump) {
    // Even without jump, allow toggling freeze/dash if enabled and midair
    if (p.hasDash && p.canDash && !p.dashUsed){
      if (p.isFrozen){ resumeFromFreeze(); }
      else if (!p.isDashing) { startFreeze(); }
    }
    return;
  }
  if (p.grounded){
    p.vy = 8.5;
    p.grounded = false;
    p.jumpStartY = p.y;
    p.dashUsed = false; // new jump allows dash
  // SFX: normal jump
  try { if (window.sfx) sfx.play('./sfx/VHS_Jump1.mp3'); } catch(_){}
    return;
  }
  // Midair: handle freeze/dash toggle
  if (p.hasDash && p.canDash && !p.dashUsed){
    if (p.isFrozen){
      resumeFromFreeze();
    } else if (!p.isDashing) {
      startFreeze();
    }
  }
}

// Expose select functions to global scope for other modules using script tags
window.startDash = startDash;
window.turnLeft = turnLeft;
window.turnRight = turnRight;
window.swipeUp = swipeUp;
window.swipeDown = swipeDown;
window.doJump = doJump;
window.handleKeyboard = handleKeyboard;
