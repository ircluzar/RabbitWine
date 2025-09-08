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
  // Prevent canvas pointer handlers from interfering with the button on desktop
  ALT_LOCK_BTN.addEventListener('pointerdown', (e)=>{
    e.stopPropagation();
  }, { passive: true });
  ALT_LOCK_BTN.addEventListener('pointerup', (e)=>{
    e.stopPropagation();
  }, { passive: true });
  ALT_LOCK_BTN.addEventListener('click', (e)=>{
    e.stopPropagation();
    onToggleAltControlLock(e);
  });
}

// Settings button + modal
(function setupSettings(){
  if (!SETTINGS_BTN) return;
  // Inject cog icon SVG once
  try {
    const cogSVG = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><g fill="none" stroke="#fff" stroke-width="10" stroke-linecap="square" stroke-linejoin="miter"><path d="M30 10 h40 M85 35 v30 M70 90 h-40 M15 65 v-30" opacity="0.0001"/></g><g fill="none" stroke="#e9f3ff" stroke-width="8"><path d="M50 28 l8 3 l6 -6 l10 6 l-2 9 l7 7 l-7 7 l2 9 l-10 6 l-6 -6 l-8 3 l-8 -3 l-6 6 l-10 -6 l2 -9 l-7 -7 l7 -7 l-2 -9 l10 -6 l6 6 l8 -3 z"/><circle cx="50" cy="50" r="10"/></g></svg>';
    SETTINGS_BTN.innerHTML = cogSVG;
  } catch(_){ }

  function closeSettings(){
    const ov = document.getElementById('mz-settings-overlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    try { SETTINGS_BTN.setAttribute('aria-expanded','false'); } catch(_){}
    // Return focus to canvas so keys work
    setTimeout(()=>{ try { if (CANVAS && CANVAS.focus) CANVAS.focus(); } catch(_){} }, 0);
  }

  function openSettings(){
    // Overlay
    const ov = document.createElement('div');
    ov.className = 'mz-settings-overlay';
    ov.id = 'mz-settings-overlay';
    ov.setAttribute('role','dialog');
    ov.setAttribute('aria-modal','true');
    // Card
    const card = document.createElement('div');
    card.className = 'mz-settings-card';
    const h = document.createElement('div');
    h.className = 'mz-settings-title';
    h.textContent = 'Settings';
    // Channel section
    const channelWrap = document.createElement('div');
    channelWrap.style.margin = '0 0 18px';
    channelWrap.style.display = 'flex';
    channelWrap.style.flexDirection = 'column';
    channelWrap.style.gap = '6px';
    const channelLabel = document.createElement('label');
    channelLabel.textContent = 'Multiplayer Channel';
    channelLabel.style.fontSize = '12px';
    channelLabel.style.opacity = '0.85';
    const channelRow = document.createElement('div');
    channelRow.style.display = 'flex';
    channelRow.style.gap = '8px';
    const channelInput = document.createElement('input');
    channelInput.type = 'text';
    channelInput.placeholder = 'DEFAULT';
    channelInput.maxLength = 32;
    channelInput.value = (window.MP_CHANNEL || 'DEFAULT');
    channelInput.style.flex = '1';
    channelInput.style.padding = '8px 10px';
    channelInput.style.background = '#121722';
    channelInput.style.color = '#d8e2ff';
    channelInput.style.border = '1px solid #2e3648';
    channelInput.style.font = 'inherit';
    channelInput.style.fontSize = '13px';
    channelInput.style.outline = 'none';
    channelInput.addEventListener('keydown', (e)=>{ if (e.key === 'Enter'){ e.preventDefault(); btnApplyChannel.click(); }});
    const btnApplyChannel = document.createElement('button');
    btnApplyChannel.type = 'button';
    btnApplyChannel.textContent = 'Apply';
    btnApplyChannel.style.background = '#1b2030';
    btnApplyChannel.style.color = '#fff';
    btnApplyChannel.style.border = '1px solid #343a52';
    btnApplyChannel.style.cursor = 'pointer';
    btnApplyChannel.style.font = 'inherit';
    btnApplyChannel.style.padding = '8px 14px';
    btnApplyChannel.addEventListener('click', ()=>{
      const val = channelInput.value.trim();
      if (/^[A-Za-z0-9_\-]{1,32}$/.test(val)){
        const ok = (typeof window.mpSetChannel === 'function') ? window.mpSetChannel(val) : false;
        if (ok){
          try { btnApplyChannel.textContent = 'Applied'; setTimeout(()=>{ btnApplyChannel.textContent = 'Apply'; }, 1600); } catch(_){ }
        } else {
          try { btnApplyChannel.textContent = 'Error'; setTimeout(()=>{ btnApplyChannel.textContent = 'Apply'; }, 1600); } catch(_){ }
        }
      } else {
        try { btnApplyChannel.textContent = 'Invalid'; setTimeout(()=>{ btnApplyChannel.textContent = 'Apply'; }, 1600); } catch(_){ }
      }
    });
    channelRow.appendChild(channelInput);
    channelRow.appendChild(btnApplyChannel);
    channelWrap.appendChild(channelLabel);
    channelWrap.appendChild(channelRow);
  const actions = document.createElement('div');
    actions.className = 'mz-settings-actions';
  const btnRestart = document.createElement('button');
  btnRestart.type = 'button';
  btnRestart.className = 'mz-settings-btn';
  btnRestart.textContent = 'Restart the game';
  const btnReset = document.createElement('button');
  btnReset.type = 'button';
  btnReset.className = 'mz-settings-btn';
  btnReset.textContent = 'Reset Progress';
    const btnReturn = document.createElement('button');
    btnReturn.type = 'button';
    btnReturn.className = 'mz-settings-btn';
    btnReturn.textContent = 'Return';
  actions.appendChild(btnRestart);
  actions.appendChild(btnReset);
    actions.appendChild(btnReturn);
    card.appendChild(h);
  card.appendChild(channelWrap);
  card.appendChild(actions);
    ov.appendChild(card);
    document.body.appendChild(ov);
    SETTINGS_BTN.setAttribute('aria-expanded','true');

    // Wire actions
    btnReturn.addEventListener('click', (e)=>{ e.stopPropagation(); closeSettings(); });
    btnRestart.addEventListener('click', (e)=>{
      e.stopPropagation();
      try { if (window.location && window.location.reload) window.location.reload(); } catch(_){}
    });
    btnReset.addEventListener('click', (e)=>{
      e.stopPropagation();
  try { if (window.gameSave) { gameSave.suspendSaving(); gameSave.stopAuto(); gameSave.clear(); } } catch(_){ }
      try { if (window.location && window.location.reload) window.location.reload(); } catch(_){}
    });
    // Close by clicking backdrop
    ov.addEventListener('click', (e)=>{ if (e.target === ov) closeSettings(); });
    // Close with Escape
    window.addEventListener('keydown', function esc(e){ if (e.key === 'Escape'){ closeSettings(); window.removeEventListener('keydown', esc, true); } }, true);
  }

  // Prevent canvas focus stealing and bubbling
  SETTINGS_BTN.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); });
  SETTINGS_BTN.addEventListener('pointerup', (e)=>{ e.stopPropagation(); });
  SETTINGS_BTN.addEventListener('click', (e)=>{ e.stopPropagation(); openSettings(); });
})();

// Seam drag
SEAM_HANDLE.addEventListener('pointerdown', onSeamPointerDown);
SEAM_HANDLE.addEventListener('pointermove', onSeamPointerMove);
SEAM_HANDLE.addEventListener('pointerup', onSeamPointerEnd);
SEAM_HANDLE.addEventListener('pointercancel', onSeamPointerEnd);

// Keep the lock button visibility synced each frame via a lightweight rAF
(function syncAltLockBtn(){
  try {
    if (ALT_LOCK_BTN){
      const canTurn = !!(state.player && state.player.canTurn);
      const hide = !!state.snapBottomFull || !canTurn;
  const hiddenStr = hide ? 'true' : 'false';
  ALT_LOCK_BTN.dataset.hidden = hiddenStr;
  ALT_LOCK_BTN.setAttribute('aria-hidden', hiddenStr);
  ALT_LOCK_BTN.style.display = hide ? 'none' : 'inline-flex';
  // Only update text/icon when visibility state changes or pressed changes; avoid frequent rewrites
      ALT_LOCK_BTN.setAttribute('aria-pressed', state.altBottomControlLocked ? 'true' : 'false');
    }
    if (SEAM_HANDLE){
      const canTurn = !!(state.player && state.player.canTurn);
      const seamHide = !canTurn; // hide until unlocked; remains visible even if bottom fullscreen so user can unsnap
      const hiddenStr2 = seamHide ? 'true' : 'false';
      SEAM_HANDLE.dataset.hidden = hiddenStr2;
      SEAM_HANDLE.setAttribute('aria-hidden', hiddenStr2);
      SEAM_HANDLE.style.display = seamHide ? 'none' : 'block';
    }
  } catch(_){}
  requestAnimationFrame(syncAltLockBtn);
})();

// Initialize the lock icon once on load
try { if (typeof window.setAltLockButtonIcon === 'function') window.setAltLockButtonIcon(); } catch(_){}

// Pointer lock state tracking for editor
document.addEventListener('pointerlockchange', onPointerLockChange);
document.addEventListener('mozpointerlockchange', onPointerLockChange);
