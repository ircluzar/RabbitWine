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

// Seam drag
SEAM_HANDLE.addEventListener('pointerdown', onSeamPointerDown);
SEAM_HANDLE.addEventListener('pointermove', onSeamPointerMove);
SEAM_HANDLE.addEventListener('pointerup', onSeamPointerEnd);
SEAM_HANDLE.addEventListener('pointercancel', onSeamPointerEnd);
