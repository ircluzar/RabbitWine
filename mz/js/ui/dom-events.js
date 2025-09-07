/**
 * Centralized DOM event binding and management.
 * Sets up all event listeners for input handling, resize events, and UI interactions.
 * Exports: None (side effects only). Registers event handlers at module load time.
 * Dependencies: Event handler functions from input modules, DOM elements from dom.js. Side effects: Registers global event listeners.
 */

// Centralized DOM event bindings
// Context menu prevention
window.addEventListener('contextmenu', (e) => e.preventDefault(), { passive: false });

// Pointer events
CANVAS.addEventListener('pointerdown', onPointerDown);
// Prevent default context menu on right-click so editor can use it
CANVAS.addEventListener('contextmenu', (e)=>{ e.preventDefault(); }, { passive:false });
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUpOrCancel);
window.addEventListener('pointercancel', onPointerUpOrCancel);

// Keyboard
window.addEventListener('keydown', onKey);
window.addEventListener('keyup', onKey);

// Resize/orientation
window.addEventListener('resize', resizeCanvasToViewport);
window.addEventListener('orientationchange', resizeCanvasToViewport);

// Debug toggle button
if (DEBUG_TOGGLE){
  DEBUG_TOGGLE.addEventListener('click', onToggleDebug);
}
// Editor toggle button
const EDITOR_TOGGLE = document.getElementById('editor-toggle');
if (EDITOR_TOGGLE){
  EDITOR_TOGGLE.addEventListener('click', onToggleEditorMode);
}

// Alt control lock button
if (typeof onToggleAltControlLock === 'function' && ALT_LOCK_BTN){
  ALT_LOCK_BTN.addEventListener('click', onToggleAltControlLock);
}

// Seam drag
SEAM_HANDLE.addEventListener('pointerdown', onSeamPointerDown);
SEAM_HANDLE.addEventListener('pointermove', onSeamPointerMove);
SEAM_HANDLE.addEventListener('pointerup', onSeamPointerEnd);
SEAM_HANDLE.addEventListener('pointercancel', onSeamPointerEnd);

// Keep the lock button visibility synced each frame via a lightweight rAF
(function syncAltLockBtn(){
  try {
    if (ALT_LOCK_BTN){
      const hide = !!state.snapBottomFull;
      ALT_LOCK_BTN.dataset.hidden = hide ? 'true' : 'false';
      ALT_LOCK_BTN.setAttribute('aria-hidden', hide ? 'true' : 'false');
      ALT_LOCK_BTN.textContent = state.altBottomControlLocked ? 'Unlock' : 'Lock';
      ALT_LOCK_BTN.setAttribute('aria-pressed', state.altBottomControlLocked ? 'true' : 'false');
    }
  } catch(_){}
  requestAnimationFrame(syncAltLockBtn);
})();

// Pointer lock state tracking for editor
document.addEventListener('pointerlockchange', onPointerLockChange);
document.addEventListener('mozpointerlockchange', onPointerLockChange);
