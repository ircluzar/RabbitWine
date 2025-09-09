"use strict";
// Lightweight persistent save system: stores player state, unlock flags, UI flags, and collected items.
(function(){
  if (typeof window === 'undefined') return;
  const SAVE_KEY = 'mz-save-v1';
  // LEGACY (pre-composite) simple collected world-pos keys (x,z) - retained for backward compat
  const collected = new Set();
  const collectedPayloads = new Set(); // legacy global payloads
  const purpleCollected = new Map();   // legacy level -> Set(x,z)
  // NEW: Yellow items keyed by (levelId + '|' + payload)
  const yellowByLevel = new Map(); // levelId -> Set(payload)
  // NEW: Purple items keyed by (levelId + '|' + x,y,z) with rounded coords
  const purple3DByLevel = new Map(); // levelId -> Set("x,y,z")
  let autosaveId = null;
  let suppressSaving = false;
  function onBeforeUnloadHandler(){ try { if (!suppressSaving) saveNow(); } catch(_){ } }

  function round2(n){ return Math.round(n * 100) / 100; }
  // Identify items by x,z only (y may vary slightly or be implicit)
  function itemKey(x, z){ return `${round2(x)},${round2(z)}`; } // legacy 2D key
  function xyzKey(x,y,z){ return `${round2(x)},${round2(y)},${round2(z)}`; }
  function getLevelId(){
    try { if (state && state.level && state.level.id) return String(state.level.id); } catch(_){ }
    try { if (typeof MP_LEVEL === 'string') return MP_LEVEL; } catch(_){ }
    return 'ROOT';
  }

  function buildPayload(){
    const p = state.player || {};
    return {
      v: 1,
      t: Date.now(),
      player: {
        x: p.x || 0, y: p.y || 0, z: p.z || 0,
        angle: p.angle || 0,
        speed: p.speed || 0,
        movementMode: p.movementMode || 'stationary'
      },
      unlocks: {
        canBack: !!p.canBack,
        canTurn: !!p.canTurn,
        canJump: !!p.canJump,
        canWallJump: !!p.canWallJump,
        canDash: !!p.canDash,
        hasDash: !!p.hasDash
      },
      ui: {
        altBottomControlLocked: !!state.altBottomControlLocked,
        lockCameraYaw: !!state.lockCameraYaw,
        seamRatio: state.seamRatio
      },
  items: Array.from(collected), // legacy
  itemPayloads: Array.from(collectedPayloads), // legacy
  purple: Array.from(purpleCollected.entries()).map(([lvl,set])=>[lvl, Array.from(set)]), // legacy
  yellowComposite: Array.from(yellowByLevel.entries()).map(([lvl,set])=>[lvl, Array.from(set)]),
  purple3d: Array.from(purple3DByLevel.entries()).map(([lvl,set])=>[lvl, Array.from(set)])
    };
  }

  function applyLoaded(data){
    try {
      if (!data || typeof data !== 'object') return;
      const p = state.player;
      if (data.player){
        const d = data.player;
        p.x = +d.x || 0; p.y = +d.y || 0; p.z = +d.z || 0;
        p.angle = +d.angle || 0;
        if (typeof d.speed === 'number') p.speed = d.speed;
        if (typeof d.movementMode === 'string') p.movementMode = d.movementMode;
      }
      if (data.unlocks){
        const u = data.unlocks;
        p.canBack = !!u.canBack;
        p.canTurn = !!u.canTurn;
        p.canJump = !!u.canJump;
        p.canWallJump = !!u.canWallJump;
        p.canDash = !!u.canDash;
        p.hasDash = !!u.hasDash;
      }
      if (data.ui){
        state.altBottomControlLocked = !!data.ui.altBottomControlLocked;
        state.lockCameraYaw = !!data.ui.lockCameraYaw;
        if (typeof data.ui.seamRatio === 'number') state.seamRatio = Math.min(0.95, Math.max(0.05, data.ui.seamRatio));
      }
  if (Array.isArray(data.items)){
        collected.clear();
        for (const k of data.items){ if (typeof k === 'string') collected.add(k); }
      }
      if (Array.isArray(data.itemPayloads)){
        collectedPayloads.clear();
        for (const pld of data.itemPayloads){ if (typeof pld === 'string') collectedPayloads.add(pld); }
      }
      if (Array.isArray(data.purple)){
        purpleCollected.clear();
        for (const row of data.purple){
          if (Array.isArray(row) && row.length===2){
            const lvl = row[0]; const arr = row[1];
            if (!purpleCollected.has(lvl)) purpleCollected.set(lvl, new Set());
            const set = purpleCollected.get(lvl);
            if (Array.isArray(arr)) for (const k of arr){ if (typeof k === 'string') set.add(k); }
          }
        }
      }
      // New composite yellow
      if (Array.isArray(data.yellowComposite)){
        yellowByLevel.clear();
        for (const row of data.yellowComposite){
          if (Array.isArray(row) && row.length===2){
            const lvl = row[0]; const arr = row[1];
            if (!yellowByLevel.has(lvl)) yellowByLevel.set(lvl, new Set());
            const set = yellowByLevel.get(lvl);
            if (Array.isArray(arr)) for (const p of arr){ if (typeof p === 'string') set.add(p); }
          }
        }
      } else {
        // Migration heuristic: map old global collectedPayloads into current level ROOT if present
        if (collectedPayloads.size){
          const lvl = 'ROOT';
            yellowByLevel.set(lvl, new Set(collectedPayloads));
        }
      }
      // New composite purple 3D
      if (Array.isArray(data.purple3d)){
        purple3DByLevel.clear();
        for (const row of data.purple3d){
          if (Array.isArray(row) && row.length===2){
            const lvl = row[0]; const arr = row[1];
            if (!purple3DByLevel.has(lvl)) purple3DByLevel.set(lvl, new Set());
            const set = purple3DByLevel.get(lvl);
            if (Array.isArray(arr)) for (const k of arr){ if (typeof k === 'string') set.add(k); }
          }
        }
      }
      // Always spawn stationary on load so first swipe counts as first accel
      try {
        p.speed = 0.0;
        p.movementMode = 'stationary';
  state.firstAccelFired = false;
  state.firstAccelSlowUntil = 0;
  state.firstAccelStartSec = 0;
  state.firstAccelDuration = 0;
      } catch(_){ }
    } catch(_){ }
  // After applying, update seam position and UI quickly
  try { if (typeof window.resizeCanvasToViewport === 'function') resizeCanvasToViewport(); } catch(_){ }
  }

  function saveNow(){
    if (suppressSaving) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(buildPayload())); } catch(_){ }
  }
  function load(){
    try {
      const s = localStorage.getItem(SAVE_KEY);
      if (!s) return null;
      const data = JSON.parse(s);
      applyLoaded(data);
      return data;
    } catch(_){ return null; }
  }
  function clear(){
    try { localStorage.removeItem(SAVE_KEY); } catch(_){ }
    collected.clear();
  }
  function startAuto(){
    if (autosaveId) return autosaveId;
    autosaveId = setInterval(saveNow, 3000);
    window.addEventListener('beforeunload', onBeforeUnloadHandler);
    return autosaveId;
  }
  function stopAuto(){
    if (autosaveId){
      clearInterval(autosaveId);
      autosaveId = null;
    }
    try { window.removeEventListener('beforeunload', onBeforeUnloadHandler); } catch(_){ }
  }
  function suspendSaving(){ suppressSaving = true; }
  function resumeSaving(){ suppressSaving = false; }

  // Public API
  const api = {
    saveNow, load, clear, startAuto, stopAuto, suspendSaving, resumeSaving,
    // LEGACY query (kept so old code still filters builder items)
    isItemCollected(x, yOrZ, maybeZ){
      const z = (typeof maybeZ === 'number') ? maybeZ : yOrZ;
      return collected.has(itemKey(x, z));
    },
    // New yellow composite checks
    isYellowCollected(levelId, payload){
      try { const lvl = String(levelId||getLevelId()); const set = yellowByLevel.get(lvl); return !!(set && set.has(String(payload||''))); } catch(_){ return false; }
    },
    markYellowCollected(levelId, payload){
      try { const lvl = String(levelId||getLevelId()); if (!yellowByLevel.has(lvl)) yellowByLevel.set(lvl, new Set()); yellowByLevel.get(lvl).add(String(payload||'')); } catch(_){ }
    },
    // Backward compat alias
    markItemCollected(it){ try { if (it && it.payload) api.markYellowCollected(getLevelId(), it.payload); } catch(_){ } },
    isYellowPayloadCollected(payload){ return api.isYellowCollected(getLevelId(), payload); },
    // Purple 3D composite
    isPurpleCollected(levelId, x,y,z){ try { const lvl = String(levelId||getLevelId()); const set = purple3DByLevel.get(lvl); return !!(set && set.has(xyzKey(x,y,z))); } catch(_){ return false; } },
    trackPurpleItemCollected(it){
      try { const lvl = getLevelId(); const key3 = xyzKey(it.x, it.y, it.z); if (!purple3DByLevel.has(lvl)) purple3DByLevel.set(lvl, new Set()); purple3DByLevel.get(lvl).add(key3); } catch(_){ }
    },
    getPurpleProgress(){ const lvl = getLevelId(); const set = purple3DByLevel.get(lvl); return set ? set.size : 0; }
  };
  window.gameSave = api;

  // Load immediately and start autosave
  load();
  startAuto();
})();
