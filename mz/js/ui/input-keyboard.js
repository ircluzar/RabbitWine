/**
 * Keyboard input handling for game controls.
 * Manages keyboard state tracking by adding/removing keys from the global input state.
 * Exports: onKey() event handler function.
 * Dependencies: state.inputs from state.js. Side effects: Modifies state.inputs.keys Set.
 */

// Keyboard input
/**
 * Handle keyboard events and update input state
 * @param {KeyboardEvent} e - Keyboard event (keydown/keyup)
 */
function onKey(e) {
  if (e.type === 'keydown') state.inputs.keys.add(e.key);
  else state.inputs.keys.delete(e.key);
}
