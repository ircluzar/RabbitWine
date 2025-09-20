/**
 * Player control functions for movement, input handling, and advanced mechanics.
 * Provides comprehensive input processing including directional movement, jumping, dashing,
 * keyboard input handling, and audio-visual feedback for player actions.
 * 
 * This module handles the complete player control system from basic movement to advanced
 * abilities like freeze-dash mechanics, with integrated music management and sound effects.
 * All controls respect the progressive ability unlock system managed by action-distributor.
 * 
 * @fileoverview Complete player input and control system with ability progression
 * @exports turnLeft() - 90-degree left turn with visual/audio feedback
 * @exports turnRight() - 90-degree right turn with visual/audio feedback  
 * @exports swipeUp() - Forward acceleration with music startup
 * @exports swipeDown() - Deceleration/reverse with dash cancellation
 * @exports doJump() - Jump mechanics with wall-jump integration
 * @exports startDash() - Freeze-and-dash system initiation
 * @exports handleKeyboard() - Comprehensive keyboard input processing
 * @dependencies state.player, state.inputs from state.js, showSwipeGlow() from UI, music/sfx systems
 * @sideEffects Modifies player state, triggers audio, displays visual feedback, manages music playback
 */

// ============================================================================
// Music Integration System
// ============================================================================

/**
 * Music startup flag to ensure background music only starts once per session
 * @type {boolean}
 */
let __mzMusicStarted = false;

/**
 * Initialize background music on first movement-related action
 * Handles volume persistence, audio unlocking, and multiplayer music synchronization.
 * Only starts music once per session to avoid multiple overlapping tracks.
 */
function startMusicOnce(){
  if (__mzMusicStarted) return;
  __mzMusicStarted = true;
  try {
    if (window.music){
      // Respect persisted volume preference, only set default if no saved value exists
      try {
        const saved = localStorage.getItem('mz_music_vol');
        if (!saved) {
          // Only apply default volume if currently at module initial value to avoid clobbering user adjustments
          if (typeof music.volume === 'number' && music.volume <= 0.21) {
            music.volume = 0.5;
          }
        }
      } catch(_) {}
      
      const src = './music/vrun64.mp3';
      // Handle audio context unlocking (required by many browsers)
      if (!music.isUnlocked) music.unlock(src);
      else music.play(src);
      
      // Synchronize with multiplayer server music position if available
      try {
        if (typeof window.mpRequestMusicPos === 'function'){
          window.mpRequestMusicPos((resp)=>{
            try {
              if (!resp || typeof resp.posMs !== 'number') return;
              const posSec = Math.max(0, (resp.posMs|0) / 1000);
              if (window.music && typeof music.setCurrentTimeSeconds === 'function'){
                music.setCurrentTimeSeconds(posSec);
              }
            } catch(_){ }
          });
        }
      } catch(_){ }
    }
  } catch(_){}
}

// ============================================================================
// Basic Directional Controls
// ============================================================================

/**
 * Turn player 90 degrees counterclockwise (left turn)
 * Respects ball mode and ability unlock restrictions, provides audio-visual feedback
 */
function turnLeft(){ 
  if (state.player.isBallMode) return; // No turning in ball mode
  if (!state.player.canTurn) return;   // Respect ability lock
  
  state.player.angle -= Math.PI/2;     // 90-degree left rotation
  showSwipeGlow('left');               // Visual feedback 
  
  // Audio feedback: turn left (35% volume)
  try { if (window.sfx) sfx.play('./sfx/Menu_Move.mp3', { volume: 0.35 }); } catch(_){}
}

/**
 * Turn player 90 degrees clockwise (right turn)
 * Respects ball mode and ability unlock restrictions, provides audio-visual feedback
 */
function turnRight(){ 
  if (state.player.isBallMode) return; // No turning in ball mode
  if (!state.player.canTurn) return;   // Respect ability lock
  
  state.player.angle += Math.PI/2;     // 90-degree right rotation
  showSwipeGlow('right');              // Visual feedback
  
  // Audio feedback: turn right (35% volume)
  try { if (window.sfx) sfx.play('./sfx/Menu_Move.mp3', { volume: 0.35 }); } catch(_){}
}

// ============================================================================
// Movement Mode Controls  
// ============================================================================

/**
 * Engage acceleration mode (forward movement initiation)
 * Triggered by swipe up or forward input, starts background music on first use
 */
function swipeUp(){
  if (state.player.isBallMode) return; // No movement changes in ball mode
  
  state.player.movementMode = 'accelerate'; // Switch to forward acceleration
  startMusicOnce();                         // Initialize background music
  
  // Provide visual and audio feedback
  if (typeof showSwipeGlow === 'function') showSwipeGlow('up');
  try { if (window.sfx) sfx.play('./sfx/Menu_Select.mp3', { volume: 0.35 }); } catch(_){}
}

/**
 * Engage deceleration/stop mode or execute 180-degree flip when stationary
 * Triggered by swipe down or backward input, includes dash cancellation logic.
 * Behavior depends on current movement state and unlocked abilities.
 */
function swipeDown(){
  if (state.player.isBallMode) return; // No movement changes in ball mode
  
  const p = state.player;
  
  // Priority: Cancel dash immediately if currently dashing (regardless of back ability)
  if (p.isDashing){
    p.isDashing = false;
    p.dashTime = 0.0;
    // Clamp speed to normal maximum (exit dash boost)
    try {
      const base = 3.0; const max = base; // Note: seam scaling removed
      if (p.speed > max) p.speed = max;
    } catch(_){ /* ignore clamp errors */ }
  }
  
  // Exit early if back ability is locked (only dash cancel above is allowed)
  if (!p.canBack) return;
  
  // Behavior varies based on current movement state
  if (p.movementMode === 'stationary' && (p.speed||0) <= 0.001){
    // When completely stopped: execute 180-degree turn and start accelerating in opposite direction
    p.angle += Math.PI;
    p.movementMode = 'accelerate';
    startMusicOnce(); // Initialize background music on movement
  } else {
    // When moving: switch to deceleration mode to gradually stop
    p.movementMode = 'stationary';
  }
  
  // Provide visual and audio feedback
  if (typeof showSwipeGlow === 'function') showSwipeGlow('down');
  try { if (window.sfx) sfx.play('./sfx/Menu_Back.mp3', { volume: 0.35 }); } catch(_){}
}

// ============================================================================
// Advanced Dash Mechanics System
// ============================================================================

/**
 * Initiate freeze mode for precision dash targeting
 * When player has dash ability, this allows them to freeze in midair and
 * precisely aim their dash direction before executing the movement.
 */
function startFreeze(){
  if (state.player.isBallMode) return; // No dashing in ball mode
  
  const p = state.player;
  if (!p.hasDash || !p.canDash) return; // Requires dash ability unlock
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
  if (state.player.isBallMode) return;
  const p = state.player;
  if (!p.canDash || !p.hasDash || p.dashUsed) return;
  // Must be midair freeze or midair
  if (p.grounded) return;
  // End freeze if active
  if (p.isFrozen) p.isFrozen = false;
  p.isDashing = true;
  // Movement event: ensure music started
  startMusicOnce();
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
    const base = 3.0; p.speed = base * 1.25;
  } catch(e) {
    p.speed = 3.0 * 1.25;
  }
  if (typeof showSwipeGlow === 'function') showSwipeGlow(dir);
}

// --- Bottom-fullscreen alternate control helpers (cardinal heading) ---
/**
 * Set player yaw to a cardinal direction if turning is allowed.
 * card: 'north'|'south'|'west'|'east'
 */
function setHeadingCardinal(card){
  const p = state.player;
  if (p.isBallMode) return;
  // Respect turn lock: if turning is disabled and the new heading differs, skip
  let target = p.angle;
  if (card === 'north') target = 0.0;
  else if (card === 'east') target = Math.PI/2;
  else if (card === 'south') target = Math.PI;
  else if (card === 'west') target = -Math.PI/2;
  if (!p.canTurn){ return; }
  p.angle = (typeof normalizeAngle === 'function') ? normalizeAngle(target) : target;
}

/** Move toward a cardinal heading (sets heading, then accelerates). */
function moveHeadingCardinal(card){
  const p = state.player; if (p.isBallMode) return;
  setHeadingCardinal(card);
  swipeUp();
}

/** Dash toward a cardinal heading (sets heading, then dashes forward). */
function dashHeadingCardinal(card){
  const p = state.player; if (p.isBallMode) return;
  // Only valid midair with dash ability; set heading first, then dash forward
  setHeadingCardinal(card);
  startDash('up');
}

/**
 * Convert a screen-direction to a world cardinal based on the top camera yaw.
 * Only used when altBottomControlLocked is true (camera yaw locked).
 * screenDir: 'north'|'south'|'west'|'east' (up/down/left/right on screen)
 * returns cardinal 'north'|'east'|'south'|'west'
 */
function cardinalRelativeToCamera(screenDir){
  // Base index from camera yaw (0: north, 1: east, 2: south, 3: west)
  const ninety = Math.PI * 0.5;
  let idx = Math.round((state.camYaw || 0) / ninety);
  idx = ((idx % 4) + 4) % 4;
  // Offsets for screen directions
  let off = 0;
  if (screenDir === 'east') off = 1; // right
  else if (screenDir === 'south') off = 2; // down
  else if (screenDir === 'west') off = 3; // left
  const out = (idx + off) & 3;
  return out === 0 ? 'north' : out === 1 ? 'east' : out === 2 ? 'south' : 'west';
}

// --- Alt-mode: stop-or-move logic ---
function angleOfCard(card){
  return card === 'north' ? 0.0 : card === 'east' ? Math.PI/2 : card === 'south' ? Math.PI : -Math.PI/2;
}

/**
 * If pressing the opposite of current movement, stop (like down in normal controls).
 * Otherwise, move toward that cardinal.
 */
function maybeStopOrMoveCardinal(card){
  const p = state.player;
  if (p.isBallMode) return;
  // Helper: current motion heading (dash vector if dashing, else player angle)
  const tgt = angleOfCard(card);
  const motionAngle = (function(){
    if (p.isDashing && typeof p._dashDirX === 'number' && typeof p._dashDirZ === 'number'){
      // dash vector -> angle where dirX = sin(a), dirZ = -cos(a)
      return Math.atan2(p._dashDirX || 0, -(p._dashDirZ || 0));
    }
    return (typeof normalizeAngle === 'function') ? normalizeAngle(p.angle) : p.angle;
  })();
  const diff = (typeof normalizeAngle === 'function') ? normalizeAngle(tgt - motionAngle) : (tgt - motionAngle);
  const isOpp = Math.cos(diff) <= -0.99; // ~ PI apart
  // When currently dashing: opposite cancels; otherwise set heading now (applies post-dash)
  if (p.isDashing){ if (isOpp) { swipeDown(); } else { setHeadingCardinal(card); } return; }
  // If frozen or back ability is locked, just attempt to move (freeze will hold speed at 0)
  if (p.isFrozen || !p.canBack){ moveHeadingCardinal(card); return; }
  const moving = (p.movementMode === 'accelerate') && (p.speed || 0) > 0.001;
  if (moving){
    if (isOpp){
      // Stop without changing heading; reuse swipeDown for sfx/dash-cancel, but only when moving
      swipeDown();
      return;
    }
  }
  // If stationary or not opposite, just move toward requested cardinal
  moveHeadingCardinal(card);
}

/**
 * Process keyboard input for player controls
 * @param {number} dt - Delta time (unused)
 */
function handleKeyboard(dt){
  if (state && state.editor && state.editor.mode === 'fps') return; // editor takes over
  const p = state.player;
  if (p.isBallMode) return; // no controls in ball mode
  // Alt control mapping when bottom view is maximized or lock is on
  if (state.snapBottomFull || state.altBottomControlLocked){
    const wantNorth = state.inputs.keys.has('ArrowUp') || state.inputs.keys.has('arrowup') || state.inputs.keys.has('w');
    const wantSouth = state.inputs.keys.has('ArrowDown') || state.inputs.keys.has('arrowdown') || state.inputs.keys.has('s');
    const wantWest  = state.inputs.keys.has('ArrowLeft') || state.inputs.keys.has('arrowleft') || state.inputs.keys.has('a');
    const wantEast  = state.inputs.keys.has('ArrowRight') || state.inputs.keys.has('arrowright') || state.inputs.keys.has('d');
    const dashOK = p.isFrozen && p.hasDash && !p.dashUsed;
    function clearDirKeys(){
      ['ArrowUp','arrowup','w','ArrowDown','arrowdown','s','ArrowLeft','arrowleft','a','ArrowRight','arrowright','d']
        .forEach(k=>state.inputs.keys.delete(k));
    }
  // If lock is active, rotate inputs relative to camera yaw, except when bottom is fullscreen
  const rel = !!(state.altBottomControlLocked && !state.snapBottomFull);
    if (wantNorth){
      const card = rel ? cardinalRelativeToCamera('north') : 'north';
      dashOK ? dashHeadingCardinal(card) : maybeStopOrMoveCardinal(card); clearDirKeys();
    } else if (wantSouth){
      const card = rel ? cardinalRelativeToCamera('south') : 'south';
      dashOK ? dashHeadingCardinal(card) : maybeStopOrMoveCardinal(card); clearDirKeys();
    } else if (wantWest){
      const card = rel ? cardinalRelativeToCamera('west') : 'west';
      dashOK ? dashHeadingCardinal(card) : maybeStopOrMoveCardinal(card); clearDirKeys();
    } else if (wantEast){
      const card = rel ? cardinalRelativeToCamera('east') : 'east';
      dashOK ? dashHeadingCardinal(card) : maybeStopOrMoveCardinal(card); clearDirKeys();
    }
    // Space/jump handling remains as usual in alt mode
    if (state.inputs.keys.has(' ') || state.inputs.keys.has('Space') || state.inputs.keys.has('Spacebar') || state.inputs.keys.has('space')){
      doJump();
      state.inputs.keys.delete(' ');
      state.inputs.keys.delete('Space');
      state.inputs.keys.delete('Spacebar'); state.inputs.keys.delete('space');
    }
    return;
  }
  if (state.inputs.keys.has('ArrowLeft') || state.inputs.keys.has('arrowleft') || state.inputs.keys.has('a')) {
  if (p.isFrozen && !p.isDashing && p.hasDash && p.canDash && !p.dashUsed) { startDash('left'); }
  else { turnLeft(); }
    state.inputs.keys.delete('ArrowLeft'); 
    state.inputs.keys.delete('a'); state.inputs.keys.delete('arrowleft');
  }
  if (state.inputs.keys.has('ArrowRight') || state.inputs.keys.has('arrowright') || state.inputs.keys.has('d')) {
  if (p.isFrozen && !p.isDashing && p.hasDash && p.canDash && !p.dashUsed) { startDash('right'); }
  else { turnRight(); }
    state.inputs.keys.delete('ArrowRight'); 
    state.inputs.keys.delete('d'); state.inputs.keys.delete('arrowright');
  }
  // Optional keyboard for up/down swipes
  if (state.inputs.keys.has('ArrowUp') || state.inputs.keys.has('arrowup') || state.inputs.keys.has('w')){
  if (p.isFrozen && !p.isDashing && p.hasDash && p.canDash && !p.dashUsed) { startDash('up'); }
    else { swipeUp(); }
    state.inputs.keys.delete('ArrowUp');
    state.inputs.keys.delete('w'); state.inputs.keys.delete('arrowup');
  }
  if (state.inputs.keys.has('ArrowDown') || state.inputs.keys.has('arrowdown') || state.inputs.keys.has('s')){
  if (p.isFrozen && !p.isDashing && p.hasDash && p.canDash && !p.dashUsed) { startDash('down'); }
    else { swipeDown(); }
    state.inputs.keys.delete('ArrowDown');
    state.inputs.keys.delete('s'); state.inputs.keys.delete('arrowdown');
  }
  if (state.inputs.keys.has(' ') || state.inputs.keys.has('Space') || state.inputs.keys.has('Spacebar') || state.inputs.keys.has('space')){
    doJump();
    state.inputs.keys.delete(' ');
    state.inputs.keys.delete('Space');
  state.inputs.keys.delete('Spacebar'); state.inputs.keys.delete('space');
  }
}

/**
 * Make player jump if grounded
 */
function doJump(){
  const p = state.player;
  if (p.isBallMode) return;
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
window.setHeadingCardinal = setHeadingCardinal;
window.moveHeadingCardinal = moveHeadingCardinal;
window.dashHeadingCardinal = dashHeadingCardinal;
window.cardinalRelativeToCamera = cardinalRelativeToCamera;
window.maybeStopOrMoveCardinal = maybeStopOrMoveCardinal;
// Expose music-start helper so other modules (e.g., start-modal) can trigger when they initiate movement
window.startMusicOnce = startMusicOnce;
