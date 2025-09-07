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
  }
  // Show/hide editor button only in debug mode
  const EDITOR_TOGGLE = document.getElementById('editor-toggle');
  if (EDITOR_TOGGLE){ EDITOR_TOGGLE.style.display = state.debugVisible ? 'inline-block' : 'none'; }
}

// Expose for DOM event listeners
if (typeof window !== 'undefined'){
  window.onToggleDebug = onToggleDebug;
}
