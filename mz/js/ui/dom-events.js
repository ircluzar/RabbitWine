/**
 * Global DOM event wiring / lifecycle hooks.
 *
 * Responsibilities:
 *  - Attach core input handlers (pointer, keyboard) defined in input-* scripts.
 *  - Manage resize + orientation events and forward to resizeCanvasToViewport.
 *  - Provide UI control bindings (debug toggle, editor mode toggle, alt control lock button, seam drag, settings modal, stats updater).
 *  - Maintain lightweight rAF loops for UI components requiring per-frame sync (alt lock button + camera status, stats box numbers).
 *  - Initialize settings + confirm reset modal logic (created lazily upon first click).
 *
 * Event Overview (non-exhaustive):
 *  - Pointer: pointerdown @CANVAS, pointermove/up/cancel @window for robust tracking.
 *  - Keyboard: keydown/keyup @window -> onKey.
 *  - Resize / orientationchange -> resizeCanvasToViewport.
 *  - contextmenu suppression (window + CANVAS) to keep right-click free for editor.
 *  - pointerlockchange -> onPointerLockChange (editor pointer lock state sync).
 *  - rAF loops: syncAltLockBtn(), statsUpdater().
 *
 * Side Effects:
 *  - Mutates DOM element attributes (aria-hidden, aria-pressed, aria-disabled, dataset.hidden).
 *  - Injects SVG markup into SETTINGS_BTN.
 *  - Creates / removes overlay DOM nodes for settings + confirm reset dialogs.
 *  - Persists / restores volume sliders via localStorage.
 *
 * Export Pattern:
 *  - No explicit exports; relies on globally available handler functions and constants populated earlier.
 *
 * Defensive Notes:
 *  - All optional elements (buttons, stats spans) are existence-checked before binding/usage.
 *  - CANVAS access guarded—script becomes a no-op subset if missing to avoid hard crash.
 */

// Centralized DOM event bindings
// Context menu prevention
window.addEventListener('contextmenu', (e) => e.preventDefault(), { passive: false });

// Pointer events (guard in case CANVAS not yet present)
if (typeof CANVAS !== 'undefined' && CANVAS){
  CANVAS.addEventListener('pointerdown', onPointerDown);
  // Prevent default context menu on right-click so editor can use it
  CANVAS.addEventListener('contextmenu', (e)=>{ e.preventDefault(); }, { passive:false });
}
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
    // Mark this as a pointer-originated interaction (used to guard the subsequent synthetic click)
    try { ALT_LOCK_BTN.__lastPointerDownTS = e.timeStamp || performance.now(); } catch(_){ }
    e.stopPropagation();
  }, { passive: true });
  ALT_LOCK_BTN.addEventListener('pointerup', (e)=>{
    // Treat pointerup as the primary activator for toggling; prevents cases where click may be suppressed
    e.stopPropagation();
    try {
      if (state && state.lockedCameraForced){
        e.preventDefault();
        return;
      }
    } catch(_){ }
    // Prevent the ensuing synthetic click from double-toggling
    try { ALT_LOCK_BTN.__handledPointerClick = (e.timeStamp || performance.now()); } catch(_){ }
    e.preventDefault();
    onToggleAltControlLock(e);
  }, { passive: false });
  ALT_LOCK_BTN.addEventListener('click', (e)=>{
    e.stopPropagation();
    // If this click immediately follows a pointerup we already handled, ignore to avoid double toggle
    try {
      const tClick = e.timeStamp || performance.now();
      const tPtr = ALT_LOCK_BTN.__handledPointerClick || 0;
      if (tPtr && Math.abs(tClick - tPtr) < 500){
        return;
      }
    } catch(_){ }
    // If forced camera lock is active, do nothing
    try {
      if (state && state.lockedCameraForced){
        e.preventDefault();
        return;
      }
    } catch(_){ }
    // Keyboard activation path (Space/Enter) comes here
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
    channelWrap.className = 'mz-section';
    const channelLabel = document.createElement('label');
    channelLabel.textContent = 'Multiplayer Channel';
    // Use section title visuals but keep default cursor
    channelLabel.className = 'mz-section-title';
    channelLabel.style.cursor = 'default';
    const channelRow = document.createElement('div');
    channelRow.className = 'mz-field-row';
    const channelInput = document.createElement('input');
    channelInput.type = 'text';
    channelInput.placeholder = 'DEFAULT';
    channelInput.maxLength = 32;
    channelInput.value = (window.MP_CHANNEL || 'DEFAULT');
    channelInput.className = 'mz-input';
    channelInput.addEventListener('keydown', (e)=>{ if (e.key === 'Enter'){ e.preventDefault(); btnApplyChannel.click(); }});
    const btnApplyChannel = document.createElement('button');
    btnApplyChannel.type = 'button';
    btnApplyChannel.textContent = 'Apply';
    btnApplyChannel.className = 'mz-btn-inline';
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
    audioWrap.className = 'mz-section';
    const audioTitle = document.createElement('div');
    audioTitle.textContent = 'Audio';
    audioTitle.className = 'mz-section-title';
    // Helper to build a slider row
    function makeSliderRow(labelText, id, initial, onChange){
      const row = document.createElement('div');
      row.className = 'mz-field-row';
      const lab = document.createElement('label');
      lab.textContent = labelText;
      lab.setAttribute('for', id);
      lab.className = 'mz-field-label';
      const valSpan = document.createElement('span');
      valSpan.id = id + '-val';
      valSpan.textContent = String(initial);
      valSpan.className = 'mz-slider-val';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(initial);
      input.id = id;
      input.className = 'mz-slider';
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
    // Click on the Audio title resets both sliders to defaults
    audioTitle.addEventListener('click', ()=>{
      const defaults = { music: 20, sfx: 45 };
      const musicInput = document.getElementById('mz-music-vol');
      const sfxInput = document.getElementById('mz-sfx-vol');
      const musicVal = document.getElementById('mz-music-vol-val');
      const sfxVal = document.getElementById('mz-sfx-vol-val');
      if (musicInput && musicVal){
        musicInput.value = String(defaults.music);
        musicVal.textContent = String(defaults.music);
        try { if (window.music) music.volume = defaults.music/100; } catch(_){ }
        try { localStorage.setItem('mz_music_vol', String(defaults.music)); } catch(_){ }
      }
      if (sfxInput && sfxVal){
        sfxInput.value = String(defaults.sfx);
        sfxVal.textContent = String(defaults.sfx);
        try { if (window.sfx) sfx.volume = defaults.sfx/100; } catch(_){ }
        try { localStorage.setItem('mz_sfx_vol', String(defaults.sfx)); } catch(_){ }
      }
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
  // Server settings section
  const serverWrap = document.createElement('div');
  serverWrap.className = 'mz-section';
  const serverTitle = document.createElement('div');
  serverTitle.textContent = 'Server / Networking';
  serverTitle.className = 'mz-section-title';
  const serverRow1 = document.createElement('div'); serverRow1.className='mz-field-row';
  const offLabel = document.createElement('label'); offLabel.textContent = 'Run as Offline'; offLabel.className='mz-field-label';
  const offToggle = document.createElement('input'); offToggle.type='checkbox'; offToggle.className='mz-checkbox';
  try { offToggle.checked = (window.mpForceOffline === true); } catch(_){ }
  offToggle.addEventListener('change', ()=>{
    try { if (typeof window.setForceOffline === 'function') setForceOffline(offToggle.checked); else { window.mpForceOffline = offToggle.checked; } } catch(_){ }
  });
  serverRow1.appendChild(offLabel); serverRow1.appendChild(offToggle);
  const serverRow2 = document.createElement('div'); serverRow2.className='mz-field-row';
  const cacheBtn = document.createElement('button'); cacheBtn.type='button'; cacheBtn.textContent='Clear Local Map Cache'; cacheBtn.className='mz-btn-inline';
  cacheBtn.addEventListener('click', ()=>{
    try {
      const ok = (typeof window.mpClearLocalMapCache === 'function') ? mpClearLocalMapCache() : false;
      cacheBtn.textContent = ok ? 'Cleared' : 'Failed';
      setTimeout(()=>{ cacheBtn.textContent = 'Clear Local Map Cache'; }, 1600);
    } catch(_){ }
  });
  serverRow2.appendChild(cacheBtn);
  serverWrap.appendChild(serverTitle);
  serverWrap.appendChild(serverRow1);
  serverWrap.appendChild(serverRow2);

  card.appendChild(audioWrap);
  card.appendChild(serverWrap);
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
      // Close settings and open confirm dialog
      closeSettings();
      openConfirmReset();
    });
    // Close by clicking backdrop
    ov.addEventListener('click', (e)=>{ if (e.target === ov) closeSettings(); });
    // Close with Escape
    window.addEventListener('keydown', function esc(e){ if (e.key === 'Escape'){ closeSettings(); window.removeEventListener('keydown', esc, true); } }, true);
  }

  function openConfirmReset(){
    // Confirmation overlay
    const ov = document.createElement('div');
    ov.className = 'mz-settings-overlay';
    ov.id = 'mz-confirm-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    // Card
    const card = document.createElement('div');
    card.className = 'mz-settings-card';
    const title = document.createElement('div');
    title.className = 'mz-settings-title';
    title.textContent = 'Confirm Reset';
    const msg = document.createElement('div');
    msg.style.margin = '6px 0 16px';
    msg.style.fontSize = '14px';
    msg.style.lineHeight = '1.3';
    msg.textContent = 'Are you sure you want to Reset Progress? This will undo everything you have ever done and send you back to the beginning.';
    const actions = document.createElement('div');
    actions.className = 'mz-settings-actions';
    const btnYes = document.createElement('button');
    btnYes.type = 'button';
    btnYes.className = 'mz-settings-btn';
    btnYes.textContent = 'Yes';
    const btnNo = document.createElement('button');
    btnNo.type = 'button';
    btnNo.className = 'mz-settings-btn';
    btnNo.textContent = 'No';
    actions.appendChild(btnYes);
    actions.appendChild(btnNo);
    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(actions);
    ov.appendChild(card);
    document.body.appendChild(ov);

    function closeConfirm(){
      try { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); } catch(_){}
      // Return focus to canvas so keys work
      setTimeout(()=>{ try { if (CANVAS && CANVAS.focus) CANVAS.focus(); } catch(_){} }, 0);
    }

    // Wire buttons
    btnNo.addEventListener('click', (e)=>{ e.stopPropagation(); closeConfirm(); });
    btnYes.addEventListener('click', (e)=>{
      e.stopPropagation();
      try { if (window.gameSave) { gameSave.suspendSaving(); gameSave.stopAuto(); gameSave.clear(); } } catch(_){ }
      try { if (window.location && window.location.reload) window.location.reload(); } catch(_){}
    });
    // Backdrop click closes confirm
    ov.addEventListener('click', (e)=>{ if (e.target === ov) closeConfirm(); });
    // Close with Escape
    window.addEventListener('keydown', function esc(e){ if (e.key === 'Escape'){ closeConfirm(); window.removeEventListener('keydown', esc, true); } }, true);
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
      ALT_LOCK_BTN.setAttribute('aria-disabled', state.lockedCameraForced ? 'true' : 'false');
      // Keep the icon/title in sync with forced lock vs normal pressed/unpressed
      try { if (typeof window.setAltLockButtonIcon === 'function') window.setAltLockButtonIcon(); } catch(_){ }
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

// Stats box updater (materials, purple per-room, rooms completed)
(function statsUpdater(){
  try {
    if (STATS_BOX){
      // Materials (general variable or getter)
      const materials = (typeof window.getMaterials === 'function') ? (window.getMaterials()|0)
                        : (typeof window.MATERIALS === 'number') ? (window.MATERIALS|0)
                        : (state && typeof state.materials === 'number') ? (state.materials|0)
                        : 0;
      if (STATS_MATERIALS) STATS_MATERIALS.textContent = String(materials);
      // Purple per-room
      let cur = 0, total = 0;
      if (window.gameSave && typeof gameSave.getPurpleCountsForCurrentRoom === 'function'){
        const k = gameSave.getPurpleCountsForCurrentRoom();
        if (k && typeof k.cur==='number' && typeof k.total==='number'){ cur = k.cur|0; total = k.total|0; }
      } else if (typeof window.getPurpleCountsForRoom === 'function'){
        const k = window.getPurpleCountsForRoom();
        if (k && typeof k.cur==='number' && typeof k.total==='number'){ cur = k.cur|0; total = k.total|0; }
      }
      if (STATS_PURPLE){
        STATS_PURPLE.textContent = `${cur}/${total}`;
        // Color teal if completed and there are purples in room
        if (total > 0 && cur >= total){
          STATS_PURPLE.classList.add('stats-complete');
          // Mark level completed once (idempotent)
          try { if (window.gameSave && typeof gameSave.markLevelCompleted==='function') gameSave.markLevelCompleted(); } catch(_){ }
        }
        else { STATS_PURPLE.classList.remove('stats-complete'); }
      }
      // Rooms completed
      const rooms = (window.gameSave && typeof gameSave.getRoomsCompleted === 'function') ? (gameSave.getRoomsCompleted()|0)
                   : (typeof window.getRoomsCompleted === 'function') ? (window.getRoomsCompleted()|0)
                   : (state && typeof state.roomsCompleted === 'number') ? (state.roomsCompleted|0)
                   : 0;
      if (STATS_ROOMS) STATS_ROOMS.textContent = String(rooms);
    }
  } catch(_){ }
  requestAnimationFrame(statsUpdater);
})();
