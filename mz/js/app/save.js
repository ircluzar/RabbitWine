"use strict";
// Lightweight persistent save system: stores player state, unlock flags, UI flags, and collected items.
(function(){
  if (typeof window === 'undefined') return;
  const SAVE_KEY = 'mz-save-v1';
  const collected = new Set();
  let autosaveId = null;
  let suppressSaving = false;
  function onBeforeUnloadHandler(){ try { if (!suppressSaving) saveNow(); } catch(_){ } }

  function round2(n){ return Math.round(n * 100) / 100; }
  // Identify items by x,z only (y may vary slightly or be implicit)
  function itemKey(x, z){ return `${round2(x)},${round2(z)}`; }

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
      items: Array.from(collected)
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
    isItemCollected(x, yOrZ, maybeZ){
      // Support isItemCollected(x, z) or isItemCollected(x, y, z)
      const z = (typeof maybeZ === 'number') ? maybeZ : yOrZ;
      return collected.has(itemKey(x, z));
    },
    markItemCollected(it){ try { collected.add(itemKey(it.x, it.z)); } catch(_){ } },
  };
  window.gameSave = api;

  // Load immediately and start autosave
  load();
  startAuto();
})();
