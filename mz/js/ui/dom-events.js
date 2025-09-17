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
  // Restore persisted audio volumes early (before user opens settings)
  try {
    const mv = parseFloat(localStorage.getItem('mz_music_vol')||'');
    if (!isNaN(mv) && mv >= 0 && mv <= 100 && window.music) { music.volume = mv/100; }
  } catch(_){}
  try {
    const sv = parseFloat(localStorage.getItem('mz_sfx_vol')||'');
    if (!isNaN(sv) && sv >= 0 && sv <= 100 && window.sfx) { sfx.volume = sv/100; }
  } catch(_){}
  // Inject cog icon SVG once
  try {
    const cogSVG = (
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
      + '<defs>'
      + '  <mask id="mz-cog-hole">'
      + '    <rect x="0" y="0" width="100" height="100" fill="#fff"/>'
      + '    <circle cx="50" cy="50" r="14" fill="#000"/>'
      + '  </mask>'
      + '</defs>'
      + '<g fill="#fff" mask="url(#mz-cog-hole)">'
      + '  <circle cx="50" cy="50" r="34"/>'
      + '  <!-- Teeth: identical radial length L=12 from base circle r=34 -->'
      + '  <rect x="44" y="4" width="12" height="12" rx="2" ry="2" transform="rotate(0 50 50)"/>'
      + '  <rect x="44" y="4" width="12" height="12" rx="2" ry="2" transform="rotate(45 50 50)"/>'
      + '  <rect x="44" y="4" width="12" height="12" rx="2" ry="2" transform="rotate(90 50 50)"/>'
      + '  <rect x="44" y="4" width="12" height="12" rx="2" ry="2" transform="rotate(135 50 50)"/>'
      + '  <rect x="44" y="4" width="12" height="12" rx="2" ry="2" transform="rotate(180 50 50)"/>'
      + '  <rect x="44" y="4" width="12" height="12" rx="2" ry="2" transform="rotate(225 50 50)"/>'
      + '  <rect x="44" y="4" width="12" height="12" rx="2" ry="2" transform="rotate(270 50 50)"/>'
      + '  <rect x="44" y="4" width="12" height="12" rx="2" ry="2" transform="rotate(315 50 50)"/>'
      + '</g>'
      + '</svg>'
    );
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
    // Audio section (Music + SFX volume)
    const audioWrap = document.createElement('div');
    audioWrap.style.margin = '0 0 20px';
    audioWrap.style.display = 'flex';
    audioWrap.style.flexDirection = 'column';
    audioWrap.style.gap = '8px';
    const audioTitle = document.createElement('div');
    audioTitle.textContent = 'Audio';
    audioTitle.style.fontSize = '12px';
    audioTitle.style.opacity = '0.85';
    audioTitle.style.marginBottom = '4px';
    // Helper to build a slider row
    function makeSliderRow(labelText, id, initial, onChange){
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      const lab = document.createElement('label');
      lab.textContent = labelText;
      lab.setAttribute('for', id);
      lab.style.flex = '0 0 90px';
      lab.style.fontSize = '13px';
      const valSpan = document.createElement('span');
      valSpan.id = id + '-val';
      valSpan.textContent = String(initial);
      valSpan.style.width = '34px';
      valSpan.style.textAlign = 'right';
      valSpan.style.fontSize = '12px';
      valSpan.style.opacity = '0.85';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(initial);
      input.id = id;
      input.style.flex = '1';
      input.style.appearance = 'none';
      input.style.height = '6px';
      input.style.background = '#1b2230';
      input.style.border = '1px solid #2e3648';
      input.style.borderRadius = '4px';
      input.addEventListener('input', ()=>{
        const v = parseInt(input.value,10); valSpan.textContent = String(v);
        try { onChange(v); } catch(_){}
      });
      row.appendChild(lab);
      row.appendChild(input);
      row.appendChild(valSpan);
      return row;
    }
    const curMusic = (window.music && typeof music.volume === 'number') ? Math.round(music.volume * 100) : 20;
    const curSFX = (window.sfx && typeof sfx.volume === 'number') ? Math.round(sfx.volume * 100) : 45;
    const musicRow = makeSliderRow('Music', 'mz-music-vol', curMusic, (v)=>{
      const norm = Math.max(0, Math.min(100, v));
      try { if (window.music) music.volume = norm/100; } catch(_){ }
      try { localStorage.setItem('mz_music_vol', String(norm)); } catch(_){ }
    });
    const sfxRow = makeSliderRow('SFX', 'mz-sfx-vol', curSFX, (v)=>{
      const norm = Math.max(0, Math.min(100, v));
      try { if (window.sfx) sfx.volume = norm/100; } catch(_){ }
      try { localStorage.setItem('mz_sfx_vol', String(norm)); } catch(_){ }
    });
    audioWrap.appendChild(audioTitle);
    audioWrap.appendChild(musicRow);
    audioWrap.appendChild(sfxRow);
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
  card.appendChild(audioWrap);
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
    // Update camera status label visibility and text to mirror lock button state
    if (CAMERA_STATUS){
      const canTurn = !!(state.player && state.player.canTurn);
      const hide = !!state.snapBottomFull || !canTurn;
      const hiddenStr = hide ? 'true' : 'false';
      CAMERA_STATUS.dataset.hidden = hiddenStr;
      CAMERA_STATUS.setAttribute('aria-hidden', hiddenStr);
      CAMERA_STATUS.style.display = hide ? 'none' : 'block';
      // Compute status: Auto (normal), Fixed (altBottomControlLocked true), Locked (future flag state.lockedCameraForced true)
  let mode = 'Auto';
  if (state.lockedCameraForced){ mode = 'Locked'; }
  else if (state.altBottomControlLocked){ mode = 'Fixed'; }
  CAMERA_STATUS.textContent = `Camera - ${mode}`;
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
