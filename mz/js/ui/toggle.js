/**
 * Debug HUD toggle control.
 * Manages the button that toggles visibility of the debug HUD and coordinates display.
 * Exports: onToggleDebug() function for button click handling.
 * Dependencies: state.debugVisible from state.js, DEBUG_TOGGLE and HUD from dom.js. Side effects: Modifies button state and HUD aria.
 */

// Debug HUD toggle
/**
 * Toggle debug HUD visibility
 */
function onToggleDebug(){
  state.debugVisible = !state.debugVisible;
  DEBUG_TOGGLE.setAttribute('aria-pressed', state.debugVisible ? 'true' : 'false');
  DEBUG_TOGGLE.textContent = `Debug: ${state.debugVisible ? 'ON' : 'OFF'}`;
  // Update HUD aria-hidden to reflect visibility; updateHUD will render text when visible
  HUD.setAttribute('aria-hidden', state.debugVisible ? 'false' : 'true');
  try { if (typeof window.setAltLockButtonIcon === 'function') window.setAltLockButtonIcon(); } catch(_){ }
  try { if (typeof window.setCameraStatusLabel === 'function') window.setCameraStatusLabel(); } catch(_){ }

  // When debug is ON, unlock all abilities for convenience
  if (state.debugVisible && state.player){
    const p = state.player;
    p.canTurn = true;
    p.canBack = true;
    p.canJump = true;
    p.canWallJump = true;
    p.canDash = true;
    p.hasDash = true;
    p.dashUsed = false; // ensure dash is available immediately
    // Reveal lock button if allowed (canTurn) and not bottom-fullscreen
    try {
      if (typeof ALT_LOCK_BTN !== 'undefined' && ALT_LOCK_BTN){
        const hide = !!state.snapBottomFull || !p.canTurn;
        ALT_LOCK_BTN.dataset.hidden = hide ? 'true' : 'false';
        ALT_LOCK_BTN.setAttribute('aria-hidden', hide ? 'true' : 'false');
        if (typeof window.setAltLockButtonIcon === 'function') window.setAltLockButtonIcon();
      }
    } catch(_){ }
  }
  // Show/hide editor button only in debug mode
  const EDITOR_TOGGLE = document.getElementById('editor-toggle');
  if (EDITOR_TOGGLE){ EDITOR_TOGGLE.style.display = state.debugVisible ? 'inline-block' : 'none'; }
}

// Expose for DOM event listeners
if (typeof window !== 'undefined'){
  window.onToggleDebug = onToggleDebug;
  // Helper: set lock button icon using inline SVGs (white, thick)
  window.setAltLockButtonIcon = function setAltLockButtonIcon(){
    if (typeof ALT_LOCK_BTN === 'undefined' || !ALT_LOCK_BTN) return;
    const pressed = state.altBottomControlLocked ? 'true' : 'false';
    ALT_LOCK_BTN.setAttribute('aria-pressed', pressed);
    // SVGs (white, thick strokes)
    const lockSVG = (
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
      + '<g stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none">'
      // Cross (vertical + horizontal)
      + '<path d="M50 10 L50 90"/>'
      + '<path d="M10 50 L90 50"/>'
      // Arrowheads: North
      + '<path d="M50 10 L44 20"/>'
      + '<path d="M50 10 L56 20"/>'
      // South
      + '<path d="M50 90 L44 80"/>'
      + '<path d="M50 90 L56 80"/>'
      // West
      + '<path d="M10 50 L20 44"/>'
      + '<path d="M10 50 L20 56"/>'
      // East
      + '<path d="M90 50 L80 44"/>'
      + '<path d="M90 50 L80 56"/>'
      + '</g></svg>'
    );
    const unlockSVG = (
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
      + '<g stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none">'
      + '<path d="M20 50 L80 50"/>'
      + '<path d="M30 35 L20 50 L30 65"/>'
      + '<path d="M70 35 L80 50 L70 65"/>'
      + '</g></svg>'
    );
    ALT_LOCK_BTN.innerHTML = (pressed === 'true') ? lockSVG : unlockSVG;
    ALT_LOCK_BTN.title = (pressed === 'true') ? 'Unlock (return to normal controls)' : 'Lock controls (camera-relative)';
  };
  // Update the floating camera status label text
  window.setCameraStatusLabel = function setCameraStatusLabel(){
    if (!CAMERA_STATUS) return;
  let mode = 'Auto';
  if (state.lockedCameraForced){ mode = 'Locked'; }
  else if (state.altBottomControlLocked){ mode = 'Fixed'; }
  CAMERA_STATUS.textContent = `Camera - ${mode}`;
  };
  // Alt control lock toggle: when on, use bottom-fullscreen controls without bottom being fullscreen.
  window.onToggleAltControlLock = function onToggleAltControlLock(){
    try {
      state.altBottomControlLocked = !state.altBottomControlLocked;
      // When locking, freeze camera yaw; when unlocking, allow normal yaw follow
      state.lockCameraYaw = !!state.altBottomControlLocked;
      // On unlock, snap camera yaw back to player's facing immediately
      if (!state.lockCameraYaw && state.player){
        const target = (typeof normalizeAngle === 'function') ? normalizeAngle(state.player.angle) : state.player.angle;
        state.camYaw = target;
      }
  if (typeof window.setAltLockButtonIcon === 'function') window.setAltLockButtonIcon();
  if (typeof window.setCameraStatusLabel === 'function') window.setCameraStatusLabel();
  // Remove focus from the button to avoid accidental Space re-activation; return focus to canvas (next tick)
  setTimeout(()=>{
    try { if (typeof ALT_LOCK_BTN !== 'undefined' && ALT_LOCK_BTN) ALT_LOCK_BTN.blur(); } catch(_){ }
    try { if (typeof CANVAS !== 'undefined' && CANVAS && typeof CANVAS.focus === 'function') CANVAS.focus(); } catch(_){ }
  }, 0);
    } catch(_){ }
  };
}
