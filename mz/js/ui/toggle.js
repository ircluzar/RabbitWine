/**
 * Fill/native scaling toggle control for viewport scaling mode.
 * Manages the toggle button that switches between fill viewport and native scaling modes.
 * Exports: onToggleFill() function for button click handling.
 * Dependencies: state.fillViewport from state.js, FILL_TOGGLE from dom.js, resizeCanvasToViewport() from resize.js. Side effects: Modifies button state and triggers canvas resize.
 */

// Fill/native scaling toggle
/**
 * Toggle between fill viewport and native scaling modes
 */
function onToggleFill(){
  state.fillViewport = !state.fillViewport;
  FILL_TOGGLE.setAttribute('aria-pressed', state.fillViewport ? 'true' : 'false');
  FILL_TOGGLE.textContent = `Fill: ${state.fillViewport ? 'ON' : 'OFF'}`;
  resizeCanvasToViewport();
}
