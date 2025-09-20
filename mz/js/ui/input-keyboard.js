/**
 * Keyboard input handling.
 *
 * Responsibilities:
 *  - Normalize browser key identifiers to a small stable token set (e.g. 'ArrowLeft', 'a', 'ShiftLeft').
 *  - Maintain a dual representation in state.inputs.keys: both raw event.key and normalized token.
 *  - Provide a single onKey handler (keydown + keyup) for dom-events.js to bind.
 *
 * Data Sources (read):
 *  - state.editor (to avoid capturing gameplay keys while editor modal / FPS mode has focus).
 *
 * Side Effects (write):
 *  - Mutates state.inputs.keys (a Set) adding/removing raw + normalized tokens.
 *
 * Exported API (window):
 *  - onKey(e: KeyboardEvent)
 *  - normalizeKeyToken(k: string)
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

// Global exports
try {
  if (typeof window !== 'undefined'){
    window.onKey = onKey;
    window.normalizeKeyToken = normalizeKeyToken;
  }
} catch(_){ }
