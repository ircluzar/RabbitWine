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
function normalizeKeyToken(k){
  if (!k) return '';
  // Normalize common variants to stable tokens used across gameplay/editor
  const s = String(k);
  // Handle legacy spacebar/space and literal space
  if (s === ' ' || s.toLowerCase() === 'space' || s === 'Spacebar') return 'space';
  // Shift left/right -> shift
  if (s === 'Shift' || s === 'ShiftLeft' || s === 'ShiftRight') return 'shift';
  // Arrow keys
  if (/^Arrow(Left|Right|Up|Down)$/i.test(s)) return s.toLowerCase();
  // Single letters -> lowercase
  if (s.length === 1) return s.toLowerCase();
  return s;
}

function onKey(e) {
  // If editor modal has focus, do not accumulate gameplay keys
  if (state && state.editor && state.editor.mode === 'fps' && state.editor.modalOpen) return;
  const raw = e.key;
  const tok = normalizeKeyToken(raw);
  if (e.type === 'keydown'){
    state.inputs.keys.add(raw);
    state.inputs.keys.add(tok);
  } else {
    state.inputs.keys.delete(raw);
    state.inputs.keys.delete(tok);
  }
  // Escape safe-exit handled in editor.js to ensure modal closure and pointer unlock
}

// Clear keys on window blur or when tab becomes hidden to prevent stuck inputs
function __mzClearAllKeys(){ try { state.inputs.keys.clear(); } catch(_){} }
window.addEventListener('blur', __mzClearAllKeys);
document.addEventListener('visibilitychange', ()=>{ if (document.hidden) __mzClearAllKeys(); });
