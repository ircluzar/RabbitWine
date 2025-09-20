"use strict";
/**
 * WebSocket connection management for RabbitWine multiplayer.
 * Extracted from multiplayer.js for better modularity.
 * 
 * Original location: multiplayer.js lines 462-900 (connection state and lifecycle)
 * Handles connection establishment, backoff, ping/pong, message routing, and error recovery.
 */

// WebSocket connection state
let mpWS = null;
let mpWSState = 'closed'; // 'closed' | 'connecting' | 'open'
let mpNextConnectAt = 0;   // wall-clock ms for next allowed connect attempt
let __mp_cooldownActive = false;
let __mp_retryMs = MP_FAIL_BASE_MS; // exponential backoff that caps at MP_FAIL_COOLDOWN_MS
let __mp_pingTimer = null;         // keep-alive/time-sync ping timer
let __mp_sendWatchTimer = null;    // watchdog to ensure updates resume
let __mp_lastSendReal = 0;         // last real-time send moment

// One-shot callbacks waiting for a music_pos reply
let __mp_musicPosWaiters = [];

// Level loading freeze management
let __mp_levelLoading = false;     // true while waiting for server data after level switch
let __mp_levelUnfreezeTimer = null;// fallback unfreeze timer id

// Offline fallback flags
let __mp_offlineLoadedForLevel = null; // tracks last level loaded from local maps to avoid refetch spam

// Boot-time aggressive fallback watchdogs
let __mp_bootConnectWatch = null;
let __mp_bootMapWatch = null;

function __mp_clearBootWatch(){
  try { if (__mp_bootConnectWatch){ clearTimeout(__mp_bootConnectWatch); __mp_bootConnectWatch = null; } } catch(_){ }
  try { if (__mp_bootMapWatch){ clearTimeout(__mp_bootMapWatch); __mp_bootMapWatch = null; } } catch(_){ }
}

function __mp_freezePlayer(){
  try {
    const s = (typeof __mp_getState === 'function') ? __mp_getState() : (window.state || null);
    if (!s || !s.player) return;
    s.player.isFrozen = true;
    s.player.movementMode = 'stationary';
    s.player.speed = 0.0;
  } catch(_){ }
}

function __mp_unfreezePlayer(){
  try {
    const s = (typeof __mp_getState === 'function') ? __mp_getState() : (window.state || null);
    if (!s || !s.player) return;
    s.player.isFrozen = false;
  } catch(_){ }
}

/**
 * Ensure WebSocket connection is established or attempting to connect.
 * Handles exponential backoff and cooldown periods.
 * @param {number} nowMs - Current timestamp for cooldown checking
 */
function mpEnsureWS(nowMs){
  if (mpWSState === 'open' || mpWSState === 'connecting') return;
  // Use wall-clock for cooldown gating to avoid mismatch with game timebases
  if (Date.now() < mpNextConnectAt) return; // cooldown
  
  let url = MP_SERVER.replace(/\/$/, '');
  // Allow users to provide http(s) and convert scheme
  if (/^https?:\/\//i.test(url)){
    url = url.replace(/^http/i, (location.protocol === 'https:' ? 'wss' : 'ws'));
  }
  
  try { console.log('[MP] WS connecting', url); } catch(_){}
  mpWSState = 'connecting';
  __mp_cooldownActive = false;
  const ws = new WebSocket(url);
  mpWS = ws;
  
  setupWebSocketHandlers(ws);
}

/**
 * Setup WebSocket event handlers for connection lifecycle and message processing.
 * @param {WebSocket} ws - WebSocket instance to configure
 */
function setupWebSocketHandlers(ws) {
  // --- Item replication integration (replaces former items-net.js) ---
  // Shadow store of authoritative items for the current level (from server). Each entry: {gx,gy,y,kind,payload}
  // kind: 0 = yellow(payload), 1 = purple
  let shadowItems = [];
  
  function __mp_worldFromGrid(gx, gy){
    // Prefer lexical MAP_W/MAP_H (declared via const in map-data.js) instead of window properties (const doesn't attach to window)
    let W, H;
    try { if (typeof MAP_W === 'number') W = MAP_W; } catch(_){ }
    try { if (typeof MAP_H === 'number') H = MAP_H; } catch(_){ }
    if (typeof W !== 'number') W = (typeof window !== 'undefined' && typeof window.MAP_W === 'number') ? window.MAP_W : 128;
    if (typeof H !== 'number') H = (typeof window !== 'undefined' && typeof window.MAP_H === 'number') ? window.MAP_H : 128;
    return { x: (gx + 0.5) - W*0.5, z: (gy + 0.5) - H*0.5 };
  }
  
  function __mp_clearRuntimeItems(){
    if (typeof window.removeItemsAtWorld !== 'function') return;
    try {
      for (const it of shadowItems){
        const w = __mp_worldFromGrid(it.gx, it.gy);
        window.removeItemsAtWorld(w.x, w.z);
      }
    } catch(_){ }
  }
  
  function __mp_applyItemsFull(list){
    if (!Array.isArray(list)) return;
    __mp_clearRuntimeItems();
    shadowItems = [];
    for (const it of list){
      if (!it || typeof it.gx !== 'number' || typeof it.gy !== 'number') continue;
      const gx = it.gx|0, gy = it.gy|0;
      const y = (typeof it.y === 'number') ? it.y : 0.75;
      const kind = (it.kind === 1) ? 1 : 0;
      const payload = (kind===0 && typeof it.payload === 'string') ? it.payload : '';
      const w = __mp_worldFromGrid(gx, gy);
      // Determine ghost state instead of skipping spawn
      let ghost = false;
      try {
        if (window.gameSave){
          if (kind===0 && payload && gameSave.isYellowPayloadCollected && gameSave.isYellowPayloadCollected(payload)) ghost = true;
          if (kind===1 && gameSave.isPurpleCollected){
            if (gameSave.isPurpleCollected(null, w.x, y, w.z) || gameSave.isPurpleCollected(null, w.x, 0.75, w.z) || gameSave.isPurpleCollected(null, w.x, 0, w.z)) ghost = true;
          }
        }
      } catch(_){ }
      try {
        if (kind === 1){
          if (typeof window.spawnPurpleItemWorld === 'function') window.spawnPurpleItemWorld(w.x, y, w.z, { ghost });
        } else {
          if (typeof window.spawnItemWorld === 'function') window.spawnItemWorld(w.x, y, w.z, payload, { ghost });
        }
        shadowItems.push({ gx, gy, y, kind, payload });
      } catch(_){ }
    }
    // Baseline injection for empty ROOT authoritative snapshot
    try {
      if ((!list || list.length === 0) && typeof window.spawnRootBaselineItemsIfEmpty === 'function') window.spawnRootBaselineItemsIfEmpty();
    } catch(_){ }
    try { console.log('[MP] items_full applied count=', shadowItems.length); } catch(_){ }
    // Update purple total for current room based on snapshot (0 if none)
    try {
      const totalPurple = Array.isArray(shadowItems) ? shadowItems.reduce((n,it)=> n + ((it && it.kind===1)?1:0), 0) : 0;
      if (window.gameSave && typeof gameSave.setPurpleTotalForCurrentRoom === 'function') gameSave.setPurpleTotalForCurrentRoom(totalPurple|0);
    } catch(_){ }
  }
  
  function __mp_applyItemOps(ops){
    if (!Array.isArray(ops)) return;
    for (const op of ops){
      if (!op || typeof op.op !== 'string') continue;
      const kind = (op.kind===1)?1:0;
      if (op.op === 'add'){
        const gx = op.gx|0, gy = op.gy|0; const y = (typeof op.y==='number')? op.y : 0.75;
        const w = __mp_worldFromGrid(gx, gy);
        // Skip spawning if we already have a recently suppressed local add marker
        let suppress = false;
        try {
          if (window.__mp_localAddSuppress){
            const key = kind+':'+gx+','+gy+','+y+(op.payload?':'+op.payload:'');
            if (window.__mp_localAddSuppress.has(key)){
              suppress = true;
              window.__mp_localAddSuppress.delete(key);
              if (!window.__mp_localAddSuppress.size) delete window.__mp_localAddSuppress;
            }
          }
        } catch(_){ }
        if (kind === 1){
          let ghost = false; try { if (window.gameSave && gameSave.isPurpleCollected && (gameSave.isPurpleCollected(null, w.x, y, w.z) || gameSave.isPurpleCollected(null, w.x, 0.75, w.z) || gameSave.isPurpleCollected(null, w.x, 0, w.z))) ghost = true; } catch(_){ }
          if (!suppress){ try { if (typeof window.spawnPurpleItemWorld === 'function') window.spawnPurpleItemWorld(w.x, y, w.z, { ghost, fadeIn:false }); } catch(_){ } }
          shadowItems.push({ gx, gy, y, kind:1, payload:'' });
        } else {
          const payload = (typeof op.payload === 'string') ? op.payload : '';
          let ghost = false; try { if (window.gameSave && payload && gameSave.isYellowPayloadCollected && gameSave.isYellowPayloadCollected(payload)) ghost = true; } catch(_){ }
          if (!suppress){ try { if (typeof window.spawnItemWorld === 'function') window.spawnItemWorld(w.x, y, w.z, payload, { ghost, fadeIn:false }); } catch(_){ } }
          shadowItems.push({ gx, gy, y, kind:0, payload });
        }
      } else if (op.op === 'remove'){
        const gx = op.gx|0, gy = op.gy|0;
        const w = __mp_worldFromGrid(gx, gy);
        try { if (typeof window.removeItemsAtWorld === 'function') window.removeItemsAtWorld(w.x, w.z); } catch(_){ }
        shadowItems = shadowItems.filter(it => !(it.gx===gx && it.gy===gy && (op.kind==null || it.kind===kind)));
      }
    }
    // Recompute purple total after ops
    try {
      const totalPurple = shadowItems.reduce((n,it)=> n + ((it && it.kind===1)?1:0), 0);
      if (window.gameSave && typeof gameSave.setPurpleTotalForCurrentRoom === 'function') gameSave.setPurpleTotalForCurrentRoom(totalPurple|0);
    } catch(_){ }
  }
  
  // Expose a lightweight debug accessor
  try { window.mpListShadowItems = ()=> shadowItems.map(it=>({ ...it })); } catch(_){ }
  
  ws.onopen = ()=>{
    mpWSState = 'open';
    __mp_cooldownActive = false; 
    mpNextConnectAt = 0; 
    __mp_retryMs = MP_FAIL_BASE_MS;
    try { console.log('[MP] WS connected'); } catch(_){}
    try { __mp_offlineLoadedForLevel = null; } catch(_){ }
    
    // Introduce ourselves so the server can send a snapshot
    try { ws.send(JSON.stringify({ type:'hello', id: MP_ID, channel: MP_CHANNEL, level: MP_LEVEL })); } catch(_){ }
    
    // If we don't get a map_full within 2s, request sync explicitly
    try { setTimeout(()=>{ if (mpMap.version === 0 && mpWS && mpWS.readyState===WebSocket.OPEN){ try { mpWS.send(JSON.stringify({ type:'map_sync', have: mpMap.version })); } catch(_){} } }, 2000); } catch(_){ }
    
    // Reset rate limiter so we don't wait to resume updates
    if (typeof window.mpSendUpdateOneShot === 'function') {
      window.mpLastNetT = 0;
      // Send an immediate one-shot update to re-announce presence
      try { window.mpSendUpdateOneShot(); } catch(_){}
    }
    
    // Start periodic ping for liveness and time sync
    try { if (__mp_pingTimer) { clearInterval(__mp_pingTimer); __mp_pingTimer = null; } } catch(_){}
    try {
      __mp_pingTimer = setInterval(() => {
        try {
          if (mpWS && mpWS.readyState === WebSocket.OPEN) {
            mpWS.send(JSON.stringify({ type: 'ping' }));
          }
        } catch(_){}
      }, 10000);
    } catch(_){}
    
    // Start send watchdog: if no update sent in >1.2s while open, force one
    try { if (__mp_sendWatchTimer) { clearInterval(__mp_sendWatchTimer); __mp_sendWatchTimer = null; } } catch(_){}
    try {
      __mp_lastSendReal = Date.now();
      __mp_sendWatchTimer = setInterval(() => {
        try {
          if (mpWS && mpWS.readyState === WebSocket.OPEN) {
            if ((Date.now() - __mp_lastSendReal) > 1200) {
              if (typeof window.mpSendUpdateOneShot === 'function') {
                window.mpSendUpdateOneShot();
              }
            }
          }
        } catch(_){}
      }, 800);
    } catch(_){}
  };
  
  ws.onmessage = (ev)=>{
    let msg = null; 
    try { msg = JSON.parse(ev.data); } catch(_){ return; }
    const t = msg && msg.type;
    
    if (t === 'music_pos'){
      try {
        const list = __mp_musicPosWaiters.slice();
        __mp_musicPosWaiters.length = 0;
        for (const cb of list){ try { if (typeof cb === 'function') cb(msg); } catch(_){} }
      } catch(_){ }
      return;
    }
    
    if (t === 'items_full'){ 
      try { console.log('[MP][items] recv items_full', (msg.items||[]).length); } catch(_){ } 
      __mp_applyItemsFull(msg.items||[]); 
      return; 
    }
    
    if (t === 'portal_full'){
      try { if (!(window.portalDestinations instanceof Map)) window.portalDestinations = new Map(); window.portalDestinations.clear(); } catch(_){ }
      try {
        if (Array.isArray(msg.portals)){
          for (const p of msg.portals){ if (!p||typeof p.k!=='string'||typeof p.dest!=='string') continue; window.portalDestinations.set(p.k, p.dest); }
          if (typeof window.rebuildInstances === 'function') window.rebuildInstances();
        }
      } catch(_){ }
      try { console.log('[MP][portals] recv portal_full', (msg.portals||[]).length); } catch(_){ }
      return;
    }
    
    if (t === 'portal_ops'){
      try {
        if (!(window.portalDestinations instanceof Map)) window.portalDestinations = new Map();
        for (const op of (msg.ops||[])){
          if (!op || typeof op.k!=='string') continue;
          if (op.op === 'set' && typeof op.dest === 'string') window.portalDestinations.set(op.k, op.dest);
          else if (op.op === 'remove') window.portalDestinations.delete(op.k);
        }
      } catch(_){ }
      return;
    }
    
    if (t === 'item_ops'){ 
      try { console.log('[MP][items] recv item_ops', msg.ops); } catch(_){ } 
      __mp_applyItemOps(msg.ops||[]); 
      return; 
    }
    
    if (t === 'snapshot'){
      const serverNow = msg.now || 0; 
      if (typeof window.mpComputeOffset === 'function') window.mpComputeOffset(serverNow);
      if (typeof window.updateGhostsFromSnapshot === 'function') {
        window.updateGhostsFromSnapshot(msg.players, serverNow);
      }
    } else if (t === 'update'){
      const serverNow = msg.now || 0; 
      if (typeof window.mpComputeOffset === 'function') window.mpComputeOffset(serverNow);
      if (typeof window.updateGhostFromUpdate === 'function') {
        window.updateGhostFromUpdate(msg, serverNow);
      }
    } else if (t === 'pong'){
      const serverNow = msg.now || 0; 
      if (typeof window.mpComputeOffset === 'function') window.mpComputeOffset(serverNow);
    } else if (t === 'map_full'){
      if (typeof window.mpApplyFullMap === 'function') {
        window.mpApplyFullMap(msg.version||0, msg.ops||[]);
      }
    } else if (t === 'map_ops'){
      // Ensure ordering: if version not sequential, request full sync
      const nextV = msg.version|0;
      if (typeof window.mpMap !== 'undefined' && window.mpMap) {
        if (nextV <= window.mpMap.version){ return; }
        if (nextV !== window.mpMap.version + 1){
          try { mpWS.send(JSON.stringify({ type:'map_sync', have: window.mpMap.version })); } catch(_){ }
          return;
        }
        if (typeof window.mpApplyOps === 'function') {
          window.mpApplyOps(nextV, msg.ops||[]);
        }
      }
    } else if (t === 'tiles_full'){
      if (typeof window.mpApplyFullTiles === 'function') {
        window.mpApplyFullTiles(msg.version||0, msg.tiles||[]);
      }
    } else if (t === 'tile_ops'){
      const nextV = msg.version|0;
      if (typeof window.mpTiles !== 'undefined' && window.mpTiles) {
        if (nextV <= window.mpTiles.version){ return; }
        if (nextV !== window.mpTiles.version + 1){ 
          try { mpWS.send(JSON.stringify({ type:'tiles_sync', have: window.mpTiles.version })); } catch(_){ } 
          return; 
        }
        if (typeof window.mpApplyTileOps === 'function') {
          window.mpApplyTileOps(nextV, msg.ops||[]);
        }
      }
    }
  };
  
  const startCooldown = (ev)=>{
    // Prevent double cooldown escalation when both onerror and onclose fire
    if (__mp_cooldownActive && mpWSState === 'closed') return;
    if (mpWSState === 'open' || mpWSState === 'connecting'){
      try { ws.close(); } catch(_){ }
    }
    mpWSState = 'closed'; 
    mpWS = null;
    __mp_cooldownActive = true;
    try { if (__mp_pingTimer) { clearInterval(__mp_pingTimer); __mp_pingTimer = null; } } catch(_){}
    try { if (__mp_sendWatchTimer) { clearInterval(__mp_sendWatchTimer); __mp_sendWatchTimer = null; } } catch(_){}
    
    // compute next attempt time with backoff + jitter
    const jitter = (Math.random()*2 - 1) * MP_FAIL_JITTER_MS;
    const wait = Math.min(MP_FAIL_COOLDOWN_MS, __mp_retryMs) + jitter;
    mpNextConnectAt = Date.now() + Math.max(0, wait|0);
    __mp_retryMs = Math.min(MP_FAIL_COOLDOWN_MS, Math.max(MP_FAIL_BASE_MS, __mp_retryMs * 2));
    
    try {
      const code = ev && typeof ev.code === 'number' ? ev.code : undefined;
      const reason = ev && typeof ev.reason === 'string' ? ev.reason : '';
      console.warn(`[MP] WS closed; retry in ~${Math.max(0, wait|0)}ms`, { code, reason });
    } catch(_){}
    
    // Attempt offline fallback load for current level
    try { 
      if (typeof window.mpLoadOfflineLevel === 'function') {
        window.mpLoadOfflineLevel(MP_LEVEL); 
      }
    } catch(_){ }
  };
  
  ws.onerror = (e)=>{ startCooldown(e); };
  ws.onclose = (e)=>{ startCooldown(e); };
}

/**
 * Register a callback to be invoked when a music_pos response is received.
 * @param {Function} cb - Callback function to invoke with music position data
 */
function addMusicPosWaiter(cb) {
  if (cb && typeof cb === 'function') {
    __mp_musicPosWaiters.push(cb);
  }
}

/**
 * Get current WebSocket connection state.
 * @returns {string} 'closed' | 'connecting' | 'open'
 */
function getWSState() {
  return mpWSState;
}

/**
 * Get current WebSocket instance (may be null).
 * @returns {WebSocket|null}
 */
function getWS() {
  return mpWS;
}

/**
 * Force close current WebSocket connection.
 */
function closeWS() {
  try {
    if (mpWS) mpWS.close();
  } catch(_) {}
}

/**
 * Update the last send timestamp for watchdog tracking.
 */
function updateLastSendTime() {
  __mp_lastSendReal = Date.now();
}

// Export functions for global window compatibility (legacy interface)
if (typeof window !== 'undefined') {
  window.mpEnsureWS = mpEnsureWS;
  window.addMusicPosWaiter = addMusicPosWaiter;
  window.getWSState = getWSState;
  window.getWS = getWS;
  window.closeWS = closeWS;
  window.updateLastSendTime = updateLastSendTime;
  window.__mp_clearBootWatch = __mp_clearBootWatch;
  window.__mp_freezePlayer = __mp_freezePlayer;
  window.__mp_unfreezePlayer = __mp_unfreezePlayer;
}