/**
 * @fileoverview Lightweight persistent save system for MZ game
 * @description Manages player state persistence, item collection tracking,
 * level progress, and UI preferences. Supports both legacy and new save formats
 * with automatic migration and backward compatibility.
 * 
 * @author MZ Team
 * @version 1.0.0
 * 
 * @requires None - Standalone save system
 * @exports {Object} Global save system methods added to window
 */

"use strict";

(function(){
  if (typeof window === 'undefined') return;
  
  /** @const {string} LocalStorage key for save data */
  const SAVE_KEY = 'mz-save-v1';
  
  // === Legacy Save Data Structures (for backward compatibility) ===
  /** @type {Set<string>} Legacy collected items by world position (x,z) */
  const collected = new Set();
  
  /** @type {Set<string>} Legacy global payloads collection */
  const collectedPayloads = new Set();
  
  /** @type {Map<string, Set<string>>} Legacy purple items by level -> Set(x,z) */
  const purpleCollected = new Map();
  
  // === New Save Data Structures ===
  /** @type {Map<string, Set<string>>} Yellow items by levelId -> Set(payload) */
  const yellowByLevel = new Map();
  
  /** @type {Map<string, Set<string>>} Purple items by levelId -> Set("x,y,z") */
  const purple3DByLevel = new Map();
  
  /** @type {Map<string, number>} Purple item totals per level (for statistics) */
  const purpleTotalsByLevel = new Map();
  
  /** @type {Set<string>} Completed levels set */
  const completedLevels = new Set();
  
  /** @type {number|null} Autosave timer ID */
  let autosaveId = null;
  
  /** @type {boolean} Flag to temporarily disable saving (for bulk operations) */
  let suppressSaving = false;
  
  /**
   * Browser beforeunload handler to ensure save on page close
   */
  function onBeforeUnloadHandler(){ 
    try { 
      if (!suppressSaving) saveNow(); 
    } catch(_){ 
      // Ignore save errors during unload
    } 
  }

  /**
   * Rounds number to 2 decimal places for consistent coordinate storage
   * @param {number} n - Number to round
   * @returns {number} Rounded number
   */
  function round2(n){ 
    return Math.round(n * 100) / 100; 
  }
  
  /**
   * Creates legacy 2D item key from x,z coordinates
   * @param {number} x - X coordinate
   * @param {number} z - Z coordinate  
   * @returns {string} Item key in format "x,z"
   */
  function itemKey(x, z){ 
    return `${round2(x)},${round2(z)}`; 
  }
  
  /**
   * Creates 3D item key from x,y,z coordinates
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} z - Z coordinate
   * @returns {string} Item key in format "x,y,z"
   */
  function xyzKey(x, y, z){ 
    return `${round2(x)},${round2(y)},${round2(z)}`; 
  }
  
  /**
   * Gets current level name from global state
   * @returns {string} Level name (e.g., 'ROOT', '1A', '2-3')
   */
  function getLevelName(){
    try { 
      if (typeof window !== 'undefined' && typeof window.MP_LEVEL === 'string' && window.MP_LEVEL) {
        return String(window.MP_LEVEL); 
      }
    } catch(_){ }
    
    try { 
      if (typeof MP_LEVEL === 'string' && MP_LEVEL) {
        return MP_LEVEL; 
      }
    } catch(_){ }
    
    return 'ROOT';
  }
  
  /**
   * Gets current level ID for save scoping
   * @returns {string} Level identifier
   */
  function getLevelId(){
    // Prefer the full level name for per-level scoping
    try { 
      if (typeof window !== 'undefined' && typeof window.MP_LEVEL === 'string' && window.MP_LEVEL) {
        return String(window.MP_LEVEL); 
      }
    } catch(_){ }
    
    try { 
      if (typeof MP_LEVEL === 'string' && MP_LEVEL) {
        return MP_LEVEL; 
      }
    } catch(_){ }
    
    // Fallback to numeric group id if name is unavailable
    try { 
      if (state && state.level && state.level.id != null) {
        return String(state.level.id); 
      }
    } catch(_){ }
    
    return 'ROOT';
  }

  /**
   * Builds save payload from current game state
   * @returns {Object} Save data object with all persistent game state
   */
  function buildPayload(){
    const p = state.player || {};
    const payload = {
      v: 1, // Save format version
      t: Date.now(), // Timestamp
      levelName: getLevelName(),
      player: {
        x: p.x || 0, 
        y: p.y || 0, 
        z: p.z || 0,
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
      net: {
        forceOffline: (typeof window !== 'undefined' && window.mpForceOffline === true) ? 1 : 0
      },
  items: Array.from(collected), // legacy
  itemPayloads: Array.from(collectedPayloads), // legacy
  purple: Array.from(purpleCollected.entries()).map(([lvl,set])=>[lvl, Array.from(set)]), // legacy
  yellowComposite: Array.from(yellowByLevel.entries()).map(([lvl,set])=>[lvl, Array.from(set)]),
  purple3d: Array.from(purple3DByLevel.entries()).map(([lvl,set])=>[lvl, Array.from(set)]),
  purpleTotals: Array.from(purpleTotalsByLevel.entries()),
  completedLevels: Array.from(completedLevels)
    };
    // New: persist typed map diffs (adds/removes) so lock blocks and other types survive reloads in single-player
    try {
      if (typeof window.__mp_getMapSnapshot === 'function'){
        payload.mapDiff = window.__mp_getMapSnapshot();
      }
    } catch(_){ }
    return payload;
  }

  function applyLoaded(data){
    try {
      if (!data || typeof data !== 'object') return;
      // If a levelName exists but wasn't handled earlier, propagate palette and window.MP_LEVEL as a fallback
      try {
        const lvl = (typeof data.levelName === 'string' && data.levelName.trim()) ? data.levelName.trim() : null;
        if (lvl){
          // Set global for modules that consult window.MP_LEVEL (e.g., map-data builder gating)
          try { window.MP_LEVEL = lvl; } catch(_){ }
          // Update palette group to match saved level naming convention
          try { if (typeof window.parseLevelGroupId === 'function' && typeof window.setLevel === 'function'){ const gid = window.parseLevelGroupId(lvl); window.setLevel(gid); } } catch(_){ }
        }
      } catch(_){ }
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
      if (data.net && typeof data.net === 'object'){
        try { if (data.net.forceOffline){ window.mpForceOffline = true; } } catch(_){ }
      }
      // Apply saved map diff snapshot early so world geometry (typed spans) is restored offline
      try {
        if (data.mapDiff && typeof window.__mp_applyMapSnapshot === 'function'){
          window.__mp_applyMapSnapshot(data.mapDiff);
        }
      } catch(_){ }
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
      // Purple totals per level
      if (Array.isArray(data.purpleTotals)){
        purpleTotalsByLevel.clear();
        for (const row of data.purpleTotals){
          if (Array.isArray(row) && row.length===2){
            const lvl = String(row[0]); const tot = row[1]|0; purpleTotalsByLevel.set(lvl, Math.max(0, tot));
          }
        }
      }
      // Completed levels
      if (Array.isArray(data.completedLevels)){
        completedLevels.clear();
        for (const lvl of data.completedLevels){ if (typeof lvl === 'string') completedLevels.add(lvl); }
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

  // Defer a level switch until the multiplayer layer is ready; ensures correct base map (ROOT sample vs. blank) and server sync
  function scheduleSwitchLevelIfPossible(levelName){
    try {
      const name = (typeof levelName === 'string' && levelName.trim()) ? levelName.trim() : 'ROOT';
      // Small guard to avoid scheduling multiple times
      if (window._mzBootSwitchScheduled) return;
      window._mzBootSwitchScheduled = true;
      const tryOnce = () => {
        try {
          if (typeof window.mpSwitchLevel === 'function'){ window.mpSwitchLevel(name); return true; }
        } catch(_){ }
        return false;
      };
      if (tryOnce()) return;
      // Retry briefly while scripts finish wiring up
      let tries = 0;
      const id = setInterval(() => {
        tries++;
        if (tryOnce() || tries > 50){ // ~5s max
          try { clearInterval(id); } catch(_){ }
        }
      }, 100);
      // Also attempt on DOMContentLoaded/load to cover late availability
      try { window.addEventListener('DOMContentLoaded', tryOnce, { once: true }); } catch(_){ }
      try { window.addEventListener('load', tryOnce, { once: true }); } catch(_){ }
    } catch(_){ }
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
      // On boot, if a saved level name exists and a player payload is present, set the boot level first
      try {
        const lvl = (typeof data.levelName === 'string' && data.levelName.trim()) ? data.levelName.trim() : null;
        const hasPos = !!(data.player && (typeof data.player.x === 'number' || typeof data.player.z === 'number'));
        if (lvl && hasPos){
          // Expose level name early for modules that gate ROOT vs others
          try { window.MP_LEVEL = lvl; } catch(_){ }
          // Align palette to saved level group id immediately (best-effort)
          try { if (typeof window.parseLevelGroupId === 'function' && typeof window.setLevel === 'function'){ const gid = window.parseLevelGroupId(lvl); window.setLevel(gid); } } catch(_){ }
          // Schedule a proper level switch once multiplayer/bootstrap are ready
          // Important: Do NOT schedule a switch for ROOT on boot, because switching to ROOT
          // will rebuild the SampleMap and re-apply the spawn, overwriting saved X/Z.
          // The ROOT base map is already built during module init; we only need to switch
          // for non-ROOT saves.
          if (lvl !== 'ROOT') scheduleSwitchLevelIfPossible(lvl);
        }
      } catch(_){ }
      applyLoaded(data);
      return data;
    } catch(_){ return null; }
  }
  function clear(){
    try { localStorage.removeItem(SAVE_KEY); } catch(_){ }
    collected.clear();
    collectedPayloads.clear();
    purpleCollected.clear();
    yellowByLevel.clear();
    purple3DByLevel.clear();
    purpleTotalsByLevel.clear();
    completedLevels.clear();
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
    ,
    // Purple totals per room/level
    setPurpleTotalForCurrentRoom(total){ try { const lvl = getLevelId(); purpleTotalsByLevel.set(lvl, Math.max(0, total|0)); } catch(_){ } },
    getPurpleCountsForCurrentRoom(){
      const lvl = getLevelId();
      const cur = (purple3DByLevel.get(lvl) || new Set()).size;
      const total = purpleTotalsByLevel.has(lvl) ? (purpleTotalsByLevel.get(lvl)|0) : 0;
      return { cur, total };
    },
    // Rooms completion tracking
    markLevelCompleted(levelId){ try { const lvl = String(levelId||getLevelId()); completedLevels.add(lvl); } catch(_){ } },
    isLevelCompleted(levelId){ try { const lvl = String(levelId||getLevelId()); return completedLevels.has(lvl); } catch(_){ return false; } },
    getRoomsCompleted(){ return completedLevels.size; }
  };
  window.gameSave = api;

  // Load immediately and start autosave
  load();
  startAuto();
})();
