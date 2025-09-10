"use strict";
/**
 * Ultra-simple multiplayer client for RabbitWine.
 * Maintains a WebSocket to the server; sends periodic updates and buffers others for smooth rendering.
 * Ghosts are rendered as wireframe boxes using the existing trail cube pipeline.
 */

// Config
const __MP_SCHEME = (location.protocol === 'https:' ? 'wss' : 'ws');
const __MP_DEFAULT = ((window.MP_SERVER && window.MP_SERVER.trim()) || (`${__MP_SCHEME}://${location.hostname}:42666`)).replace(/\/$/, "");
let MP_SERVER = __MP_DEFAULT; // WebSocket endpoint (ws:// or wss://)
const MP_TTL_MS = 3000;
const MP_UPDATE_MS = 100; // 10 Hz
const GHOST_Y_OFFSET = 0.32; // raise wireframe so the bottom doesn't clip into the ground
// Channel / Level segmentation defaults (channel can be changed at runtime via settings modal)
let MP_CHANNEL = 'DEFAULT';
const MP_LEVEL = 'ROOT';

// Attempt to restore previously chosen channel from localStorage
try {
  if (typeof localStorage !== 'undefined') {
    const savedCh = localStorage.getItem('mp_channel');
    if (savedCh && /^[A-Za-z0-9_\-]{1,32}$/.test(savedCh)) {
      MP_CHANNEL = savedCh;
    }
  }
} catch(_) {}

// GUID per session/boot
const MP_ID = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2)+Date.now());

// Init log so it’s clear the module is active
try { console.log('[MP] init (WebSocket)', { server: MP_SERVER, id: MP_ID }); } catch(_) {}

// Helper to get global state across script scoping variations
function __mp_getState(){
  try {
    // Prefer a direct binding if present
    if (typeof state !== 'undefined' && state) return state;
  } catch(_) {}
  // Fallback to window
  if (window && window.state) return window.state;
  return null;
}
// Bridge: if we can see a direct binding, attach to window for others
try { if (!window.state && typeof state !== 'undefined') window.state = state; } catch(_) {}

// Ghost repository with buffered samples for interpolation
/** @type {Map<string,{
 *  samples: Array<{t:number, x:number,y:number,z:number, state:'good'|'ball', rot?:number, frozen?:boolean}>,
 *  renderPos:{x:number,y:number,z:number}, renderRot:number, renderState:'good'|'ball', renderFrozen?:boolean,
 *  lastSeen:number
 *}>
 */
const ghosts = new Map();

// Map diff client-side: maintain adds/removes relative to base v0
const mpMap = { version: 0, adds: new Set(), removes: new Set() };
window.mpGetMapVersion = ()=> mpMap.version;
function mpApplyFullMap(version, ops){
  mpMap.adds.clear(); mpMap.removes.clear();
  for (const op of (ops||[])){
    if (!op || typeof op.key!=='string') continue;
    if (op.op === 'add') {
      // Encode hazard flag by storing key#1 in adds set
      if (op.t === 1) mpMap.adds.add(op.key+'#1'); else mpMap.adds.add(op.key);
    }
    else if (op.op === 'remove') mpMap.removes.add(op.key);
  }
  mpMap.version = version|0;
  try { console.log('[MP] map_full applied v', mpMap.version, 'adds=', mpMap.adds.size, 'removes=', mpMap.removes.size); } catch(_){ }
  try { __mp_rebuildWorldFromDiff(); } catch(_){ }
}
function mpApplyOps(version, ops){
  for (const op of (ops||[])){
    if (!op || typeof op.key!=='string') continue;
    if (op.op === 'add'){
      const addKey = (op.t===1) ? (op.key+'#1') : op.key;
      if (mpMap.removes.has(op.key)) mpMap.removes.delete(op.key); else mpMap.adds.add(addKey);
    } else if (op.op === 'remove'){
      if (mpMap.adds.has(op.key)) mpMap.adds.delete(op.key); else if (mpMap.adds.has(op.key+'#1')) mpMap.adds.delete(op.key+'#1'); else mpMap.removes.add(op.key);
    }
  }
  mpMap.version = version|0;
  try { console.log('[MP] map_ops applied v', mpMap.version, 'adds=', mpMap.adds.size, 'removes=', mpMap.removes.size); } catch(_){ }
  try { __mp_rebuildWorldFromDiff(); } catch(_){ }
}

// Rebuild columnSpans from current diff each time (simple; can be optimized later)
function __mp_rebuildWorldFromDiff(){
  if (typeof window === 'undefined' || !window.columnSpans || !window.setSpansAt) return;
  // Start from original base map? For now we assume base map already loaded and we overlay diffs add/remove.
  // We'll apply adds (voxels) then removes (carves) on top of existing spans.
  // Each key format: gx,gy,y
  const addByCell = new Map();
  for (const rawKey of mpMap.adds){
    const hazard = rawKey.endsWith('#1');
    const key = hazard ? rawKey.slice(0,-2) : rawKey;
    const parts = key.split(','); if (parts.length!==3) continue;
    const gx = parseInt(parts[0],10), gy = parseInt(parts[1],10), y = parseInt(parts[2],10);
    if (!Number.isFinite(gx)||!Number.isFinite(gy)||!Number.isFinite(y)) continue;
    const cellK = gx+','+gy;
    let set = addByCell.get(cellK); if (!set){ set = new Set(); addByCell.set(cellK,set); }
    set.add(JSON.stringify({ y, t: hazard?1:0 }));
  }
  // Apply adds into spans (ensure contiguity)
  for (const [cellK, ys] of addByCell.entries()){
    // Expand and sort by y
    const arrObjs = Array.from(ys.values()).map(s=>{ try { return JSON.parse(s); } catch(_) { return null; } }).filter(o=>o && Number.isFinite(o.y));
    arrObjs.sort((a,b)=>a.y-b.y);
    const spans = [];
    if (arrObjs.length){
      let b = arrObjs[0].y; let prev = arrObjs[0].y; let hazard = arrObjs[0].t|0; // merge hazard if ANY voxel hazard inside span
      for (let i=1;i<arrObjs.length;i++){
        const yObj = arrObjs[i]; const y = yObj.y|0; const hz = yObj.t|0;
        if (y === prev + 1){ prev = y; if (hz) hazard = 1; continue; }
        spans.push(hazard? { b, h: (prev - b + 1)|0, t:1 } : { b, h:(prev - b + 1)|0 });
        b = y; prev = y; hazard = hz;
      }
      spans.push(hazard? { b, h: (prev - b + 1)|0, t:1 } : { b, h:(prev - b + 1)|0 });
    }
    // Merge with existing spans first (so base map blocks persist unless removed)
    const [gx,gy] = cellK.split(',').map(n=>parseInt(n,10));
    let baseSpans = window.columnSpans.get(cellK) || [];
    // Add new spans then normalize merge
    baseSpans = baseSpans.concat(spans);
    baseSpans.sort((p,q)=>p.b-q.b);
    const merged=[]; for (const s of baseSpans){ if (!merged.length){ merged.push({ b:s.b|0, h:s.h|0, ...(s.t===1?{t:1}:{}) }); continue;} const t=merged[merged.length-1]; if (s.b <= t.b+t.h){ const top=Math.max(t.b+t.h, s.b+s.h); t.h = top - t.b; if (s.t===1) t.t=1; } else merged.push({ b:s.b|0, h:s.h|0, ...(s.t===1?{t:1}:{}) }); }
    window.setSpansAt(gx,gy,merged.map(s=>({ b:s.b, h:s.h, ...(s.t===1?{t:1}:{}) })));
  }
  // Apply removals: removing a single voxel from any span.
  for (const key of mpMap.removes){
    const parts = key.split(','); if (parts.length!==3) continue;
    const gx = parseInt(parts[0],10), gy = parseInt(parts[1],10), y = parseInt(parts[2],10);
    if (!Number.isFinite(gx)||!Number.isFinite(gy)||!Number.isFinite(y)) continue;
    const cellK = gx+','+gy;
    let spans = window.columnSpans.get(cellK) || [];
    if (!spans.length) continue;
    const out=[]; for (const s of spans){ const sb=s.b|0, sh=s.h|0, top=sb+sh-1; if (y < sb || y > top){ out.push(s); continue;} if (sh===1){ /* drop */ } else if (y===sb){ out.push({ b:sb+1, h:sh-1 }); } else if (y===top){ out.push({ b:sb, h:sh-1 }); } else { const h1=y-sb; const h2=top-y; if (h1>0) out.push({ b:sb, h:h1 }); if (h2>0) out.push({ b:y+1, h:h2 }); } }
    if (out.length){ window.setSpansAt(gx,gy,out); } else { window.setSpansAt(gx,gy,[]); }
  }
  try { if (typeof window.rebuildInstances === 'function') window.rebuildInstances(); } catch(_){ }
}

// Time sync with server for interpolation
const timeSync = { offsetMs: 0, rttMs: 0, ready: false };
const INTERP_DELAY_MS = 150;   // render slightly in the past for smooth playback
const MAX_EXTRAP_MS = 250;     // cap extrapolation when missing newer samples
const GHOST_DESPAWN_MS = 2000; // if no updates > 2s, despawn
const MP_FAIL_COOLDOWN_MS = 10000; // cap: wait up to 10s between retries
const MP_FAIL_BASE_MS = 2000;      // initial backoff 2s
const MP_FAIL_JITTER_MS = 400;     // +/- jitter to avoid thundering herd

// WebSocket connection state and helpers
let mpWS = null;
let mpWSState = 'closed'; // 'closed' | 'connecting' | 'open'
let mpNextConnectAt = 0;   // wall-clock ms for next allowed connect attempt
let __mp_cooldownActive = false;
let __mp_retryMs = MP_FAIL_BASE_MS; // exponential backoff that caps at MP_FAIL_COOLDOWN_MS
let __mp_pingTimer = null;         // keep-alive/time-sync ping timer
let __mp_sendWatchTimer = null;    // watchdog to ensure updates resume
let __mp_lastSendReal = 0;         // last real-time send moment

function mpComputeOffset(serverNow){
  try {
    const localNow = Date.now();
    const est = (typeof serverNow === 'number') ? (serverNow - localNow) : timeSync.offsetMs;
    const alpha = timeSync.ready ? 0.1 : 0.5;
    timeSync.offsetMs = (1 - alpha) * timeSync.offsetMs + alpha * est;
    timeSync.ready = true;
  } catch(_){}
}

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
    try { console.log('[MP] items_full applied count=', shadowItems.length); } catch(_){ }
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
  }
  // Expose a lightweight debug accessor
  try { window.mpListShadowItems = ()=> shadowItems.map(it=>({ ...it })); } catch(_){ }
  ws.onopen = ()=>{
    mpWSState = 'open';
  __mp_cooldownActive = false; mpNextConnectAt = 0; __mp_retryMs = MP_FAIL_BASE_MS;
    try { console.log('[MP] WS connected'); } catch(_){}
    // Introduce ourselves so the server can send a snapshot
    try { ws.send(JSON.stringify({ type:'hello', id: MP_ID, channel: MP_CHANNEL, level: MP_LEVEL })); } catch(_){ }
  // If we don't get a map_full within 2s, request sync explicitly
  try { setTimeout(()=>{ if (mpMap.version === 0 && mpWS && mpWS.readyState===WebSocket.OPEN){ try { mpWS.send(JSON.stringify({ type:'map_sync', have: mpMap.version })); } catch(_){} } }, 2000); } catch(_){ }
    // Reset rate limiter so we don't wait to resume updates
    mpLastNetT = 0;
    // Send an immediate one-shot update to re-announce presence
    try { mpSendUpdateOneShot(); } catch(_){}
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
              mpSendUpdateOneShot();
            }
          }
        } catch(_){}
      }, 800);
    } catch(_){}
  };
  ws.onmessage = (ev)=>{
    let msg = null; try { msg = JSON.parse(ev.data); } catch(_){ return; }
    const t = msg && msg.type;
  if (t === 'items_full'){ try { console.log('[MP][items] recv items_full', (msg.items||[]).length); } catch(_){ } __mp_applyItemsFull(msg.items||[]); return; }
  if (t === 'item_ops'){ try { console.log('[MP][items] recv item_ops', msg.ops); } catch(_){ } __mp_applyItemOps(msg.ops||[]); return; }
    if (t === 'snapshot'){
      const serverNow = msg.now || 0; mpComputeOffset(serverNow);
      if (Array.isArray(msg.players)){
        for (const o of msg.players){
          if (!o || typeof o.id !== 'string') continue;
          if (o.id === MP_ID) continue;
          let g = ghosts.get(o.id);
          if (!g){
            g = { samples: [], renderPos: {x:o.pos.x, y:o.pos.y, z:o.pos.z}, renderRot: (o.rotation||0), renderState: (o.state==='ball'?'ball':'good'), renderFrozen: !!o.frozen, lastSeen: 0 };
            ghosts.set(o.id, g);
          }
          const st = Math.max(0, serverNow - (o.ageMs || 0));
          g.samples.push({ t: st, x:o.pos.x, y:o.pos.y, z:o.pos.z, state:(o.state==='ball'?'ball':'good'), rot: (typeof o.rotation==='number'? o.rotation : undefined), frozen: !!o.frozen });
          const cutoff = st - 2000; let k = 0; for (let i=0;i<g.samples.length;i++){ if (g.samples[i].t >= cutoff){ g.samples[k++] = g.samples[i]; } } g.samples.length = k;
          g.lastSeen = Date.now();
        }
      }
    } else if (t === 'update'){
      const serverNow = msg.now || 0; mpComputeOffset(serverNow);
      const o = msg;
      if (!o || typeof o.id !== 'string') return;
      if (o.id === MP_ID) return;
      let g = ghosts.get(o.id);
      if (!g){
        g = { samples: [], renderPos: {x:o.pos.x, y:o.pos.y, z:o.pos.z}, renderRot: (o.rotation||0), renderState: (o.state==='ball'?'ball':'good'), renderFrozen: !!o.frozen, lastSeen: 0 };
        ghosts.set(o.id, g);
      }
      const st = serverNow;
      g.samples.push({ t: st, x:o.pos.x, y:o.pos.y, z:o.pos.z, state:(o.state==='ball'?'ball':'good'), rot: (typeof o.rotation==='number'? o.rotation : undefined), frozen: !!o.frozen });
      const cutoff = st - 2000; let k = 0; for (let i=0;i<g.samples.length;i++){ if (g.samples[i].t >= cutoff){ g.samples[k++] = g.samples[i]; } } g.samples.length = k;
      g.lastSeen = Date.now();
    } else if (t === 'pong'){
      const serverNow = msg.now || 0; mpComputeOffset(serverNow);
    } else if (t === 'map_full'){
      mpApplyFullMap(msg.version||0, msg.ops||[]);
    } else if (t === 'map_ops'){
      // Ensure ordering: if version not sequential, request full sync
      const nextV = msg.version|0;
      if (nextV <= mpMap.version){ return; }
      if (nextV !== mpMap.version + 1){
        try { mpWS.send(JSON.stringify({ type:'map_sync', have: mpMap.version })); } catch(_){ }
        return;
      }
      mpApplyOps(nextV, msg.ops||[]);
    }
  };
  const startCooldown = (ev)=>{
    // Prevent double cooldown escalation when both onerror and onclose fire
    if (__mp_cooldownActive && mpWSState === 'closed') return;
    if (mpWSState === 'open' || mpWSState === 'connecting'){
      try { ws.close(); } catch(_){ }
    }
    mpWSState = 'closed'; mpWS = null;
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
  };
  ws.onerror = (e)=>{ startCooldown(e); };
  ws.onclose = (e)=>{ startCooldown(e); };
}

let mpLastNetT = 0;
function mpTickNet(nowMs){
  // Always drive WS connection state, even if gameplay state isn't ready yet
  mpEnsureWS(nowMs);
  const s = __mp_getState();
  if (!s || !s.player){
    if (!mpTickNet._warned){ console.log('[MP] waiting for state...'); mpTickNet._warned = true; }
    return;
  }
  if (mpWSState !== 'open') return;
  if ((nowMs - mpLastNetT) < MP_UPDATE_MS - 1) return; // rate
  mpLastNetT = nowMs;
  const p = s.player;
  const myState = p.isBallMode ? 'ball' : 'good';
  // Derive a simple rotation for ball mode using spin start + speed (rad/sec)
  let rotDeg = 0;
  if (p.isBallMode) {
    const nowSec = (state.nowSec || (performance.now()/1000));
    const seed = p._ballStartSec || nowSec;
    const speed = (p._ballSpinSpeed || 1.0); // radians/sec
    const angRad = speed * Math.max(0, nowSec - seed);
    rotDeg = ((angRad * 180/Math.PI) % 360 + 360) % 360;
  }
  const frozen = (()=>{ try { return !!(s && s.player && !s.player.isBallMode && s.player.isFrozen); } catch(_){ return false; } })();
  const payload = { type: 'update', id: MP_ID, pos: { x: p.x, y: p.y, z: p.z }, state: myState, channel: MP_CHANNEL, level: MP_LEVEL };
  if (myState === 'ball') payload.rotation = rotDeg;
  if (frozen) payload.frozen = true;
  try { mpWS && mpWS.send(JSON.stringify(payload)); } catch(_){ }
  __mp_lastSendReal = Date.now();
}

// One-shot update helper used after reconnect to immediately re-announce presence
function mpSendUpdateOneShot(){
  const s = __mp_getState();
  if (!s || !s.player || !mpWS || mpWS.readyState !== WebSocket.OPEN) return;
  const p = s.player; const myState = p.isBallMode ? 'ball' : 'good';
  let rotDeg = 0;
  if (p.isBallMode) {
    const nowSec = (state.nowSec || (performance.now()/1000));
    const seed = p._ballStartSec || nowSec;
    const speed = (p._ballSpinSpeed || 1.0);
    const angRad = speed * Math.max(0, nowSec - seed);
    rotDeg = ((angRad * 180/Math.PI) % 360 + 360) % 360;
  }
  const frozen = (()=>{ try { return !!(s && s.player && !s.player.isBallMode && s.player.isFrozen); } catch(_){ return false; } })();
  const payload = { type: 'update', id: MP_ID, pos: { x: p.x, y: p.y, z: p.z }, state: myState, channel: MP_CHANNEL, level: MP_LEVEL };
  if (myState === 'ball') payload.rotation = rotDeg;
  if (frozen) payload.frozen = true;
  try { mpWS.send(JSON.stringify(payload)); } catch(_){ }
  __mp_lastSendReal = Date.now();
}

// Local interpolation (called every frame)
function mpUpdateGhosts(dt){
  const localNow = Date.now();
  const serverRenderTime = timeSync.ready ? (localNow + timeSync.offsetMs - INTERP_DELAY_MS) : localNow - INTERP_DELAY_MS;
  for (const g of ghosts.values()){
    const arr = g.samples;
    if (!arr || arr.length === 0) continue;
    // Find bracketing samples
    let a = null, b = null;
    for (let i=arr.length-1;i>=0;i--){
      if (arr[i].t <= serverRenderTime){ a = arr[i]; b = arr[i+1] || null; break; }
    }
    if (!a){ a = arr[0]; b = arr[1] || null; }
    if (!b){
      // Extrapolate using last two samples if possible
      const n = arr.length;
      if (n >= 2){
        const p0 = arr[n-2], p1 = arr[n-1];
        const dtMs = Math.max(1, p1.t - p0.t);
        const vx = (p1.x - p0.x) / dtMs;
        const vy = (p1.y - p0.y) / dtMs;
        const vz = (p1.z - p0.z) / dtMs;
        const lookahead = Math.min(MAX_EXTRAP_MS, serverRenderTime - p1.t);
        g.renderPos = { x: p1.x + vx * lookahead, y: p1.y + vy * lookahead, z: p1.z + vz * lookahead };
        g.renderState = p1.state;
        g.renderFrozen = !!p1.frozen;
        if (p1.state === 'ball' && typeof p1.rot === 'number') g.renderRot = p1.rot;
      } else {
        g.renderPos = { x: arr[0].x, y: arr[0].y, z: arr[0].z };
        g.renderState = arr[0].state;
        g.renderFrozen = !!arr[0].frozen;
        if (arr[0].state === 'ball' && typeof arr[0].rot === 'number') g.renderRot = arr[0].rot;
      }
      continue;
    }
    const span = Math.max(1, b.t - a.t);
    const u = Math.max(0, Math.min(1, (serverRenderTime - a.t) / span));
    g.renderPos = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
    // Choose state from newer sample to reduce flicker
  g.renderState = (u < 0.5 ? a.state : b.state);
  g.renderFrozen = (u < 0.5 ? !!a.frozen : !!b.frozen);
    // Rotation smoothing (shortest arc) if ball and both have rotation
    const ra = (typeof a.rot === 'number') ? ((a.rot%360)+360)%360 : null;
    const rb = (typeof b.rot === 'number') ? ((b.rot%360)+360)%360 : null;
    if (g.renderState === 'ball' && ra !== null && rb !== null){
      let diff = rb - ra; if (diff > 180) diff -= 360; if (diff < -180) diff += 360;
      g.renderRot = ra + diff * u;
    } else if (ra !== null) { g.renderRot = ra; }
  }
  // Despawn check: remove ghosts stale for >2s; spawn FX if on-screen
  const nowSec = (state && (state.nowSec || performance.now()/1000)) || (performance.now()/1000);
  const toDelete = [];
  for (const [id, g] of ghosts){
    if ((Date.now() - (g.lastSeen || 0)) > GHOST_DESPAWN_MS){
      // Try to spawn floating lines if visible
      try {
        if (g.renderPos && typeof spawnFloatingLinesCustom === 'function'){
          const rp = g.renderPos;
          const color = (g.renderState === 'ball') ? {r:1.0,g:0.2,b:0.2} : (g.renderFrozen ? {r:1.0,g:1.0,b:1.0} : {r:0.1,g:1.0,b:0.1});
          const inner = (g.renderState === 'ball') ? {r:1.0,g:0.6,b:0.6} : {r:1.0,g:1.0,b:1.0};
          const y = rp.y + (typeof GHOST_Y_OFFSET === 'number' ? GHOST_Y_OFFSET : 0);
          const visible = (typeof window.isWorldPointVisibleAny === 'function') ? window.isWorldPointVisibleAny(rp.x, y, rp.z)
                         : (typeof window.isWorldPointVisible === 'function') ? window.isWorldPointVisible(rp.x, y, rp.z)
                         : true; // if no helper, just spawn
          if (visible){
            console.log('[MP] ghost despawn FX', { x: rp.x, y, z: rp.z, state: g.renderState, frozen: !!g.renderFrozen });
            spawnFloatingLinesCustom(rp.x, y, rp.z, color, inner, 0.54, 0.34);
          }
        }
      } catch(_){ }
      toDelete.push(id);
    }
  }
  for (const id of toDelete){ ghosts.delete(id); }
}

// Rendering helpers using existing trail cube pipeline
function drawGhosts(mvp){
  if (!ghosts.size) return;
  const now = state.nowSec || performance.now()/1000;
  const N = ghosts.size;
  // Build buffers for N instances
  const inst = new Float32Array(N*4);
  const zeros3 = new Float32Array(N*3); // axis=0
  const corners = new Float32Array(N*8*3); // no jitter
  let i = 0;
  for (const g of ghosts.values()){
    const rp = g.renderPos || {x:0,y:0,z:0};
    inst[i*4+0] = rp.x; inst[i*4+1] = rp.y + GHOST_Y_OFFSET; inst[i*4+2] = rp.z; inst[i*4+3] = now;
    i++;
  }
  gl.useProgram(trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  gl.uniform1f(tc_u_scale, 0.54);
  gl.uniform1f(tc_u_now, now);
  gl.uniform1f(tc_u_ttl, 9999.0);
  gl.uniform1i(tc_u_dashMode, 0);
  gl.uniform1f(tc_u_mulAlpha, 0.9);
  // We’ll push color per-state by two passes for simplicity

  gl.bindVertexArray(trailCubeVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis); gl.bufferData(gl.ARRAY_BUFFER, zeros3, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners); gl.bufferData(gl.ARRAY_BUFFER, corners, gl.DYNAMIC_DRAW);

  // First pass: GOOD (green)
    gl.uniform3f(tc_u_lineColor, 0.1, 1.0, 0.1); // Set color for good ghosts
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  // Draw only those with state good by issuing individual draws; cheap for small N
  let idx = 0;
  for (const g of ghosts.values()){
    if ((g.renderState || 'good') !== 'ball'){
      const rp = g.renderPos || {x:0,y:0,z:0};
  const localInst = new Float32Array([rp.x, rp.y + GHOST_Y_OFFSET, rp.z, now]);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, localInst, gl.DYNAMIC_DRAW);
        if (g.renderFrozen) gl.uniform3f(tc_u_lineColor, 1.0, 1.0, 1.0); else gl.uniform3f(tc_u_lineColor, 0.1, 1.0, 0.1);
      gl.drawArraysInstanced(gl.LINES, 0, 24, 1);
    }
    idx++;
  }

  // Second pass: BALL (red) with spin about Z using u_useAnim + rotation proxy
  if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 1);
  if (typeof tc_u_rotSpeed !== 'undefined' && tc_u_rotSpeed) gl.uniform1f(tc_u_rotSpeed, 1.0); // angle = 1*(now - seed)
  if (typeof tc_u_wobbleAmp !== 'undefined' && tc_u_wobbleAmp) gl.uniform1f(tc_u_wobbleAmp, 0.0);
  if (typeof tc_u_wobbleSpeed !== 'undefined' && tc_u_wobbleSpeed) gl.uniform1f(tc_u_wobbleSpeed, 0.0);
  gl.uniform3f(tc_u_lineColor, 1.0, 0.2, 0.2);
  for (const g of ghosts.values()){
    if ((g.renderState || 'good') === 'ball'){
      // Encode the desired angle in the seed by back-solving: angle = rotSpeed*(now-seed). Using rotSpeed=1 rad/s -> seed = now - angleRad
      const rp = g.renderPos || {x:0,y:0,z:0};
      const angleRad = ((g.renderRot||0) * Math.PI/180);
  const instOne = new Float32Array([rp.x, rp.y + GHOST_Y_OFFSET, rp.z, now - angleRad]);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, instOne, gl.DYNAMIC_DRAW);
      // Axis = +Z spin
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0,1]), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.LINES, 0, 24, 1);
    }
  }

  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

// Hooks into main loop
function __mp_onFrame(dt, nowMs){
  __mp_onFrame._count = ( __mp_onFrame._count || 0 ) + 1;
  mpTickNet(nowMs);
  mpUpdateGhosts(dt);
}

// Export globals
window.drawGhosts = drawGhosts;
window.__mp_onFrame = __mp_onFrame;
window.MP_ID = MP_ID;
window.MP_SERVER = MP_SERVER;
window.MP_CHANNEL = MP_CHANNEL;
// Expose a minimal helper for gameplay to check collisions against damaging ghosts (in red/ball state)
window.mpGetDangerousGhosts = function(){
  const out = [];
  try {
    for (const g of ghosts.values()){
      if ((g.renderState || 'good') === 'ball'){
        const rp = g.renderPos || {x:0,y:0,z:0};
        out.push({ x: rp.x, y: rp.y, z: rp.z });
      }
    }
  } catch(_){ }
  return out;
};

// Allow runtime channel switching from UI. Forces reconnect + clears ghosts.
window.mpSetChannel = function(newChannel){
  try {
    if (typeof newChannel !== 'string') return false;
    const trimmed = newChannel.trim().slice(0, 32);
    if (!trimmed) return false;
    if (!/^[A-Za-z0-9_\-]+$/.test(trimmed)) return false; // simple safe charset
    if (trimmed === MP_CHANNEL) return true;
    MP_CHANNEL = trimmed;
    window.MP_CHANNEL = MP_CHANNEL;
    try { localStorage.setItem('mp_channel', MP_CHANNEL); } catch(_){ }
    try { console.log('[MP] switching channel ->', MP_CHANNEL); } catch(_){ }
    // Force a reconnect
    try { if (mpWS) mpWS.close(); } catch(_){ }
    ghosts.clear();
    mpWSState = 'closed';
    mpNextConnectAt = 0;
    mpEnsureWS(Date.now());
    return true;
  } catch(_) { return false; }
};

// Send batch of map edit ops (array of {op,key})
window.mpSendMapOps = function(ops){
  try {
    if (!mpWS || mpWS.readyState !== WebSocket.OPEN) return false;
    if (!Array.isArray(ops) || !ops.length) return false;
    const clean = [];
    for (const o of ops){
      if (!o || (o.op!=='add' && o.op!=='remove')) continue;
      if (typeof o.key !== 'string' || !o.key || o.key.length > 64) continue;
  const rec = { op:o.op, key:o.key };
  if (o.op==='add' && (o.t===1)) rec.t = 1;
  clean.push(rec);
      if (clean.length >= 512) break; // clamp
    }
    if (!clean.length) return false;
    mpWS.send(JSON.stringify({ type:'map_edit', ops: clean }));
    return true;
  } catch(_){ return false; }
};

// Send item edit ops (items persistence). Ops: {op:'add'|'remove', gx,gy,y?,kind(0|1),payload?}
window.mpSendItemOps = function(ops){
  try {
    if (!mpWS || mpWS.readyState !== WebSocket.OPEN) return false;
    if (!Array.isArray(ops) || !ops.length) return false;
    const clean = [];
    for (const o of ops){
      if (!o || (o.op!=='add' && o.op!=='remove')) continue;
      const rec = { op:o.op };
      try { rec.gx = o.gx|0; rec.gy = o.gy|0; } catch(_){ continue; }
      if (o.op === 'add'){
        rec.kind = (o.kind===1)?1:0;
        if (typeof o.y === 'number') rec.y = o.y;
        if (rec.kind===0 && typeof o.payload === 'string' && o.payload.length <= 128) rec.payload = o.payload;
      } else {
        rec.kind = (o.kind===1)?1:0;
        if (rec.kind===0 && typeof o.payload === 'string') rec.payload = o.payload; // allow targeted removal
      }
      clean.push(rec);
      if (clean.length >= 256) break;
    }
    if (!clean.length) return false;
    // Record suppression keys for local adds so we don't double-spawn when echoed back
    try {
      for (const r of clean){
        if (r.op==='add'){
          if (!window.__mp_localAddSuppress) window.__mp_localAddSuppress = new Set();
          const key = r.kind+':'+r.gx+','+r.gy+','+(typeof r.y==='number'?r.y:0.75)+(r.payload?':'+r.payload:'');
          window.__mp_localAddSuppress.add(key);
          // Prune if grows large
          if (window.__mp_localAddSuppress.size > 1024){
            try {
              // remove a few oldest arbitrarily (Set iteration order insertion-based)
              let c=0; for (const k of window.__mp_localAddSuppress){ window.__mp_localAddSuppress.delete(k); if (++c>128) break; }
            } catch(_){ }
          }
        }
      }
    } catch(_){ }
    mpWS.send(JSON.stringify({ type:'item_edit', ops: clean }));
    try { console.log('[MP][items] sent ops', clean); } catch(_){ }
    return true;
  } catch(_){ return false; }
};

// Manual force sync (in case initial items_full missed, or for debugging)
window.mpForceItemsSync = function(){
  try { if (mpWS && mpWS.readyState === WebSocket.OPEN){ mpWS.send(JSON.stringify({ type:'items_sync' })); console.log('[MP][items] items_sync requested'); return true; } } catch(_){ }
  return false;
};

// Network reachability hooks: reconnect immediately on regain; close on offline
try {
  window.addEventListener('online', () => {
    try { console.log('[MP] network online; attempting reconnect'); } catch(_){}
    mpNextConnectAt = 0; // clear cooldown
    mpEnsureWS(Date.now());
  });
  window.addEventListener('offline', () => {
    try { console.warn('[MP] network offline; closing WS'); } catch(_){}
    try { if (mpWS) mpWS.close(); } catch(_){}
    mpWS = null; mpWSState = 'closed';
  });
} catch(_){ }

// Attempt reconnect quickly when user focuses the tab or it becomes visible again
try {
  const triggerFastReconnect = () => {
    // Skip if already connected or connecting
    if (mpWSState === 'open' || mpWSState === 'connecting') return;
    mpNextConnectAt = 0; // clear cooldown
    mpEnsureWS(Date.now());
  };
  window.addEventListener('focus', triggerFastReconnect);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') triggerFastReconnect();
  });
  // Expose manual override for debugging
  window.__mp_forceReconnect = triggerFastReconnect;
} catch(_){ }

// Fallback: if the frame hook doesn't run within 1500ms, start a timer-based tick
setTimeout(() => {
  const ran = __mp_onFrame._count || 0;
  if (ran === 0){
    console.warn('[MP] frame hook not detected; starting fallback interval ticking');
    setInterval(() => { mpTickNet(Date.now()); }, MP_UPDATE_MS);
  } else {
    console.log('[MP] frame hook active');
  }
}, 1500);

// Try to resolve and bridge state for modules that load out of order
let __mp_state_probe_count = 0;
const __mp_state_probe = setInterval(() => {
  const s = __mp_getState();
  __mp_state_probe_count++;
  if (s && s.player){
    try { if (!window.state) window.state = s; } catch(_){ }
    console.log('[MP] bridged global state');
    clearInterval(__mp_state_probe);
  }
  if (__mp_state_probe_count > 50){ clearInterval(__mp_state_probe); }
}, 100);

// (channel/level constants moved near config above)
