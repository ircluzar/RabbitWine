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
let MP_LEVEL = 'ROOT';

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
// Ground tile overrides (e.g., HALF) replicated by server
const mpTiles = { version: 0, set: new Map() }; // key: "gx,gy" -> value (tile id)
window.mpGetMapVersion = ()=> mpMap.version;
function mpApplyFullMap(version, ops){
  mpMap.adds.clear(); mpMap.removes.clear();
  for (const op of (ops||[])){
    if (!op || typeof op.key!=='string') continue;
    if (op.op === 'add') {
      // Encode type flag by storing key#N in adds set where N in {1,2,3,4,5,9}
      const tt = (op.t===1||op.t===2||op.t===3||op.t===4||op.t===5||op.t===9) ? op.t|0 : 0;
      if (tt===1) mpMap.adds.add(op.key+'#1');
      else if (tt===2) mpMap.adds.add(op.key+'#2');
      else if (tt===3) mpMap.adds.add(op.key+'#3');
      else if (tt===4) mpMap.adds.add(op.key+'#4');
      else if (tt===5) mpMap.adds.add(op.key+'#5');
      else if (tt===9) mpMap.adds.add(op.key+'#9');
      else mpMap.adds.add(op.key);
    }
    else if (op.op === 'remove') mpMap.removes.add(op.key);
  }
  mpMap.version = version|0;
  try { console.log('[MP] map_full applied v', mpMap.version, 'adds=', mpMap.adds.size, 'removes=', mpMap.removes.size); } catch(_){ }
  try { __mp_rebuildWorldFromDiff(); } catch(_){ }
  // On first snapshot after switching levels, unfreeze movement
  try {
    if (__mp_levelLoading){
      __mp_levelLoading = false;
      if (__mp_levelUnfreezeTimer){ clearTimeout(__mp_levelUnfreezeTimer); __mp_levelUnfreezeTimer = null; }
      __mp_unfreezePlayer();
      console.log('[MP] level data received; unfreezing player');
    }
  } catch(_){ }
  try { __mp_clearBootWatch(); } catch(_){ }
}
function mpApplyOps(version, ops){
  for (const op of (ops||[])){
    if (!op || typeof op.key!=='string') continue;
    if (op.op === 'add'){
      const tt = (op.t===1||op.t===2||op.t===3||op.t===4||op.t===5||op.t===9) ? op.t|0 : 0;
      const addKey = (tt===1)? (op.key+'#1') : (tt===2)? (op.key+'#2') : (tt===3)? (op.key+'#3') : (tt===4)? (op.key+'#4') : (tt===5)? (op.key+'#5') : (tt===9)? (op.key+'#9') : op.key;
      if (mpMap.removes.has(op.key)) mpMap.removes.delete(op.key); else mpMap.adds.add(addKey);
    } else if (op.op === 'remove'){
      if (mpMap.adds.has(op.key)) mpMap.adds.delete(op.key);
      else if (mpMap.adds.has(op.key+'#1')) mpMap.adds.delete(op.key+'#1');
      else if (mpMap.adds.has(op.key+'#2')) mpMap.adds.delete(op.key+'#2');
      else if (mpMap.adds.has(op.key+'#3')) mpMap.adds.delete(op.key+'#3');
      else if (mpMap.adds.has(op.key+'#4')) mpMap.adds.delete(op.key+'#4');
      else if (mpMap.adds.has(op.key+'#5')) mpMap.adds.delete(op.key+'#5');
      else if (mpMap.adds.has(op.key+'#9')) mpMap.adds.delete(op.key+'#9');
      else mpMap.removes.add(op.key);
    }
  }
  mpMap.version = version|0;
  try { console.log('[MP] map_ops applied v', mpMap.version, 'adds=', mpMap.adds.size, 'removes=', mpMap.removes.size); } catch(_){ }
  try { __mp_rebuildWorldFromDiff(); } catch(_){ }
  try {
    if (__mp_levelLoading){
      __mp_levelLoading = false;
      if (__mp_levelUnfreezeTimer){ clearTimeout(__mp_levelUnfreezeTimer); __mp_levelUnfreezeTimer = null; }
      __mp_unfreezePlayer();
      console.log('[MP] map ops applied; unfreezing player');
    }
  } catch(_){ }
  try { __mp_clearBootWatch(); } catch(_){ }
}

// Apply full tile overrides list
function mpApplyFullTiles(version, tiles){
  try { mpTiles.set.clear(); } catch(_){ mpTiles.set = new Map(); }
  if (Array.isArray(tiles)){
    for (const t of tiles){
      if (!t || typeof t.k !== 'string') continue;
      const v = (typeof t.v === 'number') ? t.v|0 : null;
      if (v === null) continue;
      mpTiles.set.set(t.k, v);
    }
  }
  mpTiles.version = version|0;
  // Apply into runtime map and rebuild
  try {
    if (typeof window.mapIdx === 'function' && typeof window.map !== 'undefined'){
      for (const [k,v] of mpTiles.set.entries()){
        const [gx,gy] = k.split(',').map(n=>parseInt(n,10));
        if (!Number.isFinite(gx)||!Number.isFinite(gy)) continue;
        try { window.map[window.mapIdx(gx,gy)] = v; } catch(_){ }
      }
      if (typeof window.rebuildInstances === 'function') window.rebuildInstances();
    }
  } catch(_){ }
  // Unfreeze if we were waiting for level load and tiles arrived first
  try {
    if (__mp_levelLoading){
      __mp_levelLoading = false;
      if (__mp_levelUnfreezeTimer){ clearTimeout(__mp_levelUnfreezeTimer); __mp_levelUnfreezeTimer = null; }
      __mp_unfreezePlayer();
      console.log('[MP] tile snapshot applied; unfreezing player');
    }
  } catch(_){ }
  try { __mp_clearBootWatch(); } catch(_){ }
}

function mpApplyTileOps(version, ops){
  for (const op of (ops||[])){
    if (!op || typeof op.k !== 'string') continue;
    const v = (typeof op.v === 'number') ? op.v|0 : null;
    if (v === null) continue;
    mpTiles.set.set(op.k, v);
    // Patch runtime
    try { const parts = op.k.split(','); const gx=parts[0]|0, gy=parts[1]|0; if (typeof window.mapIdx==='function' && window.map){ window.map[window.mapIdx(gx,gy)] = v; } } catch(_){ }
  }
  mpTiles.version = version|0;
  try { if (typeof window.rebuildInstances === 'function') window.rebuildInstances(); } catch(_){ }
  try {
    if (__mp_levelLoading){
      __mp_levelLoading = false;
      if (__mp_levelUnfreezeTimer){ clearTimeout(__mp_levelUnfreezeTimer); __mp_levelUnfreezeTimer = null; }
      __mp_unfreezePlayer();
      console.log('[MP] tile ops applied; unfreezing player');
    }
  } catch(_){ }
  try { __mp_clearBootWatch(); } catch(_){ }
}

// Rebuild columnSpans from current diff each time (simple; can be optimized later)
function __mp_rebuildWorldFromDiff(){
  if (typeof window === 'undefined' || !window.columnSpans || !window.setSpansAt) return;
  // Start from original base map? For now we assume base map already loaded and we overlay diffs add/remove.
  // We'll apply adds (voxels) then removes (carves) on top of existing spans.
  // Each key format: gx,gy,y
  const addByCell = new Map();
  for (const rawKey of mpMap.adds){
  const is1 = rawKey.endsWith('#1');
  const is2 = rawKey.endsWith('#2');
  const is3 = rawKey.endsWith('#3');
  const is4 = rawKey.endsWith('#4');
  const is5 = rawKey.endsWith('#5');
  const is9 = rawKey.endsWith('#9');
  const tt = is1?1 : is2?2 : is3?3 : is4?4 : is5?5 : is9?9 : 0;
  const key = (tt? rawKey.slice(0,-2) : rawKey);
    const parts = key.split(','); if (parts.length!==3) continue;
    const gx = parseInt(parts[0],10), gy = parseInt(parts[1],10), y = parseInt(parts[2],10);
    if (!Number.isFinite(gx)||!Number.isFinite(gy)||!Number.isFinite(y)) continue;
    const cellK = gx+','+gy;
    let set = addByCell.get(cellK); if (!set){ set = new Set(); addByCell.set(cellK,set); }
  set.add(JSON.stringify({ y, t: tt }));
  }
  // Apply adds into spans (ensure contiguity)
  for (const [cellK, ys] of addByCell.entries()){
    // Expand and sort by y
    const arrObjs = Array.from(ys.values()).map(s=>{ try { return JSON.parse(s); } catch(_) { return null; } }).filter(o=>o && Number.isFinite(o.y));
    arrObjs.sort((a,b)=>a.y-b.y);
    const spans = [];
    if (arrObjs.length){
      // Separate unit voxels vs half-slabs (t=4). Treat portal markers (t=5) separately so they never color entire solid spans.
      const solidUnits = arrObjs.filter(o=> { const tt=(o.t|0); return !(tt===2||tt===3||tt===4||tt===5); });
      const portalUnits = arrObjs.filter(o=> (o.t|0)===5);
      const slabs = arrObjs.filter(o=> (o.t|0) === 4);
      // Build contiguous spans for solid units, segmented by type to avoid cross-type infection (0 normal, 1 BAD, 9 NOCLIMB)
      if (solidUnits.length){
        let b = solidUnits[0].y|0; let prev = solidUnits[0].y|0; let curType = solidUnits[0].t|0;
        for (let i=1;i<solidUnits.length;i++){
          const yObj = solidUnits[i]; const y = yObj.y|0; const tcur = yObj.t|0;
          if (y === prev + 1 && tcur === curType){ prev = y; continue; }
          spans.push(curType? { b, h: (prev - b + 1), t:curType } : { b, h:(prev - b + 1) });
          b = y; prev = y; curType = tcur;
        }
        spans.push(curType? { b, h: (prev - b + 1), t:curType } : { b, h:(prev - b + 1) });
      }
      // Build contiguous portal spans independently (pure triggers, non-solid)
      if (portalUnits.length){
        let b = portalUnits[0].y|0; let prev = portalUnits[0].y|0;
        for (let i=1;i<portalUnits.length;i++){
          const yObj = portalUnits[i]; const y = yObj.y|0;
          if (y === prev + 1){ prev = y; continue; }
          spans.push({ b, h:(prev - b + 1), t:5 });
          b = y; prev = y;
        }
        spans.push({ b, h:(prev - b + 1), t:5 });
      }
      // Add half-slabs individually (b=y, h=0.5)
      for (const s of slabs){ spans.push({ b: s.y|0, h: 0.5 }); }
    }
    // Merge with existing spans: insert without cross-type infection
    const [gx,gy] = cellK.split(',').map(n=>parseInt(n,10));
    const isSolid = (t)=>{ const tt=(t|0)||0; return (tt===0||tt===1||tt===9); };
    const sameType = (a,b)=>(((a|0)||0) === ((b|0)||0));
    // Start from existing spans, normalized by merging same-type overlaps/adjacency
    let merged = (window.columnSpans.get(cellK) || []).map(s=>({ b: s.b|0, h: (typeof s.h==='number'? s.h : (s.h|0)), t: ((s.t===1||s.t===2||s.t===3||s.t===4||s.t===5||s.t===9)?(s.t|0):0) }));
    const mergeSameType = ()=>{
      merged.sort((a,b)=> (a.b - b.b) || (((a.t|0)||0) - ((b.t|0)||0)) );
      const out=[];
      for (const s of merged){
        if (!out.length){ out.push({ ...s }); continue; }
        const t = out[out.length-1];
        const sT=((s.t|0)||0), tT=((t.t|0)||0);
        if (sameType(sT,tT) && s.b <= t.b + t.h + 1e-6){
          const top = Math.max(t.b + t.h, s.b + s.h); t.h = top - t.b;
        } else { out.push({ ...s }); }
      }
      merged = out;
    };
    mergeSameType();
    // Insert each new span
    const newSpans = spans.map(s=>({ b: s.b|0, h: (typeof s.h==='number'? s.h : (s.h|0)), t: ((s.t===1||s.t===2||s.t===3||s.t===4||s.t===5||s.t===9)?(s.t|0):0) }));
    for (const s of newSpans){
      if (!(s.h > 0)) continue;
      const sT=((s.t|0)||0);
      // Non-solid (portal/half/fence markers) do not split solids; append
      if (!isSolid(sT)) { merged.push({ ...s }); continue; }
      const sStart = s.b, sEnd = s.b + s.h;
      // Split conflicting solid spans of different type
      const next=[];
      for (const e of merged){
        const eT=((e.t|0)||0);
        const eStart = e.b, eEnd = e.b + e.h;
        if (!isSolid(eT) || sameType(eT, sT)) { next.push(e); continue; }
        // Check overlap
        const overlapStart = Math.max(eStart, sStart);
        const overlapEnd   = Math.min(eEnd, sEnd);
        if (overlapEnd <= overlapStart + 1e-6){ next.push(e); continue; }
        // Keep left piece
        if (overlapStart - eStart > 1e-6){ next.push({ b: eStart, h: overlapStart - eStart, ...(eT?{t:eT}:{}) }); }
        // Keep right piece
        if (eEnd - overlapEnd > 1e-6){ next.push({ b: overlapEnd, h: eEnd - overlapEnd, ...(eT?{t:eT}:{}) }); }
        // Drop middle (it will be replaced by s)
      }
      merged = next;
      // Insert s
      merged.push({ ...s });
      // Merge adjacent same-type
      mergeSameType();
    }
    // Final write
    window.setSpansAt(gx,gy,merged.map(s=>({ b:s.b, h:s.h, ...(s.t===1?{t:1}:(s.t===2?{t:2}:(s.t===3?{t:3}:(s.t===4?{t:4}:(s.t===5?{t:5}:(s.t===9?{t:9}:{})))))) })));
  }
  // Apply removals: removing a single voxel from any span.
  for (const key of mpMap.removes){
    const parts = key.split(','); if (parts.length!==3) continue;
    const gx = parseInt(parts[0],10), gy = parseInt(parts[1],10), y = parseInt(parts[2],10);
    if (!Number.isFinite(gx)||!Number.isFinite(gy)||!Number.isFinite(y)) continue;
    const cellK = gx+','+gy;
    let spans = window.columnSpans.get(cellK) || [];
    if (!spans.length) continue;
    const out=[]; 
    for (const s of spans){ 
      const sb=s.b|0; const sh=(typeof s.h==='number')? s.h : (s.h|0); const tt=(s.t===1||s.t===2||s.t===3||s.t===4||s.t===5||s.t===9)?(s.t|0):0;
      const segStart = sb; const segEnd = sb + sh; // [segStart, segEnd)
      const remStart = y; const remEnd = y + 1;       // remove [y, y+1)
      if (remEnd <= segStart || remStart >= segEnd){ out.push(s); continue; }
      // left piece [segStart, min(segEnd, remStart))
      const leftStart = segStart; const leftEnd = Math.min(segEnd, remStart);
      if (leftEnd - leftStart > 1e-6){ out.push({ b: leftStart|0, h: leftEnd - leftStart, ...(tt?{t:tt}:{}) }); }
      // right piece [max(segStart, remEnd), segEnd)
      const rightStart = Math.max(segStart, remEnd); const rightEnd = segEnd;
      if (rightEnd - rightStart > 1e-6){ out.push({ b: rightStart|0, h: rightEnd - rightStart, ...(tt?{t:tt}:{}) }); }
    }
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

// Offline items applier (replicates spawn logic used in network path)
function __mp_offlineApplyItemsFull(list){
  try {
    if (!Array.isArray(list)) return;
    // Clear all existing runtime items
    if (typeof window.removeItemsAtWorld === 'function' && typeof window.MAP_W==='number' && typeof window.MAP_H==='number'){
      for (let y=0;y<window.MAP_H;y++) for (let x=0;x<window.MAP_W;x++){
        const w = { x:(x+0.5)-window.MAP_W*0.5, z:(y+0.5)-window.MAP_H*0.5 };
        try { window.removeItemsAtWorld(w.x, w.z); } catch(_){ }
      }
    }
    const worldFromGrid = (gx,gy)=>{ let W=window.MAP_W||128, H=window.MAP_H||128; return { x:(gx+0.5)-W*0.5, z:(gy+0.5)-H*0.5 }; };
    for (const it of list){
      if (!it || typeof it.gx!== 'number' || typeof it.gy!=='number') continue;
      const gx=it.gx|0, gy=it.gy|0; const y=(typeof it.y==='number')? it.y : 0.75; const kind=(it.kind===1)?1:0; const payload=(kind===0 && typeof it.payload==='string')? it.payload : '';
      const w = worldFromGrid(gx,gy);
      let ghost = false;
      try {
        if (window.gameSave){
          if (kind===0 && payload && gameSave.isYellowPayloadCollected && gameSave.isYellowPayloadCollected(payload)) ghost = true;
          if (kind===1 && gameSave.isPurpleCollected){ if (gameSave.isPurpleCollected(null, w.x, y, w.z) || gameSave.isPurpleCollected(null, w.x, 0.75, w.z) || gameSave.isPurpleCollected(null, w.x, 0, w.z)) ghost = true; }
        }
      } catch(_){ }
      try {
        if (kind===1){ if (typeof window.spawnPurpleItemWorld==='function') window.spawnPurpleItemWorld(w.x, y, w.z, { ghost }); }
        else { if (typeof window.spawnItemWorld==='function') window.spawnItemWorld(w.x, y, w.z, payload, { ghost }); }
      } catch(_){ }
    }
    // Update purple total for current room based on list (0 if none)
    try {
      const totalPurple = Array.isArray(list) ? list.reduce((n,e)=> n + ((e && (e.kind===1 || e.kind==="1"))?1:0), 0) : 0;
      if (window.gameSave && typeof gameSave.setPurpleTotalForCurrentRoom === 'function') gameSave.setPurpleTotalForCurrentRoom(totalPurple|0);
    } catch(_){ }
  } catch(_){ }
}

// Offline map loader: fetch maps/{LEVEL}.json and apply as full snapshots
async function mpLoadOfflineLevel(levelName){
  try {
    const lvl = (typeof levelName==='string' && levelName.trim()) ? levelName.trim() : 'ROOT';
    // Avoid refetch spam for same level unless explicitly switching
    if (__mp_offlineLoadedForLevel === lvl) return false;
    const base = (window.__MP_MAPS_BASE || 'maps');
    const url = `${base}/${encodeURIComponent(lvl)}.json`;
    console.log('[MP][offline] loading', url);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok){ console.warn('[MP][offline] fetch failed', res.status); __mp_offlineLoadedForLevel = null; return false; }
    const data = await res.json();
    // Validate structure minimally
    const mapObj = (data && data.map) || {};
    const addsRaw = mapObj.adds;
    const removesList = Array.isArray(mapObj.removes) ? mapObj.removes : [];
    const tilesRaw = data.tiles;
    const portalsRaw = data.portals;
    const itemsList = Array.isArray(data.items) ? data.items : [];
    // Build ops array compatible with mpApplyFullMap
    const ops = [];
    if (Array.isArray(addsRaw)){
      for (const e of addsRaw){ if (!e) continue; if (typeof e === 'string'){ ops.push({ op:'add', key:e }); } else if (typeof e.key === 'string'){ const rec = { op:'add', key:e.key }; if (e.t===1||e.t===2||e.t===3||e.t===4||e.t===5||e.t===9) rec.t = (e.t|0); ops.push(rec); } }
      try { console.log('[MP][offline] adds: list format', addsRaw.length); } catch(_){ }
    } else if (addsRaw && typeof addsRaw === 'object'){
      // Object mapping { key: type }
      for (const k in addsRaw){ if (!Object.prototype.hasOwnProperty.call(addsRaw,k)) continue; const v = addsRaw[k]; const rec = { op:'add', key: String(k) }; const t = (v|0); if (t===1||t===2||t===3||t===4||t===5||t===9) rec.t = t; ops.push(rec); }
      try { console.log('[MP][offline] adds: object map with', Object.keys(addsRaw).length, 'keys'); } catch(_){ }
    }
    for (const k of removesList){ if (typeof k === 'string') ops.push({ op:'remove', key:k }); }
    // Apply map
    try { mpApplyFullMap((data.version|0)||1, ops); } catch(_){ }
    // Normalize tiles into list of {k,v}
    let tilesList = [];
    if (Array.isArray(tilesRaw)){
      tilesList = tilesRaw;
      try { console.log('[MP][offline] tiles: list format', tilesList.length); } catch(_){ }
    } else if (tilesRaw && typeof tilesRaw === 'object'){
      for (const k in tilesRaw){ if (!Object.prototype.hasOwnProperty.call(tilesRaw,k)) continue; const v = tilesRaw[k]; if (typeof v === 'number') tilesList.push({ k, v: v|0 }); }
      try { console.log('[MP][offline] tiles: object map with', tilesList.length, 'entries'); } catch(_){ }
    }
    try { mpApplyFullTiles(1, tilesList); } catch(_){ }
    // Apply portals
    try {
      if (!(window.portalDestinations instanceof Map)) window.portalDestinations = new Map();
      window.portalDestinations.clear();
      if (Array.isArray(portalsRaw)){
        for (const p of portalsRaw){ if (!p||typeof p.k!=='string'||typeof p.dest!=='string') continue; window.portalDestinations.set(p.k, p.dest); }
        try { console.log('[MP][offline] portals: list format', portalsRaw.length); } catch(_){ }
      } else if (portalsRaw && typeof portalsRaw === 'object'){
        const keys = Object.keys(portalsRaw);
        for (const k of keys){ const dest = portalsRaw[k]; if (typeof k==='string' && typeof dest==='string') window.portalDestinations.set(k, dest); }
        try { console.log('[MP][offline] portals: object map with', keys.length, 'entries'); } catch(_){ }
      }
      if (typeof window.rebuildInstances === 'function') window.rebuildInstances();
    } catch(_){ }
    // Apply items
    try { __mp_offlineApplyItemsFull(itemsList); } catch(_){ }
    // Unfreeze the player now that offline state is ready
    try { __mp_levelLoading = false; if (__mp_levelUnfreezeTimer){ clearTimeout(__mp_levelUnfreezeTimer); __mp_levelUnfreezeTimer=null; } __mp_unfreezePlayer(); } catch(_){ }
    __mp_offlineLoadedForLevel = lvl;
    console.log('[MP][offline] loaded map for', lvl);
    try { __mp_clearBootWatch(); } catch(_){ }
    return true;
  } catch(err){
    console.warn('[MP][offline] load failed', err);
    try { __mp_levelLoading = false; if (__mp_levelUnfreezeTimer){ clearTimeout(__mp_levelUnfreezeTimer); __mp_levelUnfreezeTimer=null; } __mp_unfreezePlayer(); } catch(_){ }
    __mp_offlineLoadedForLevel = null;
    return false;
  }
}
window.mpLoadOfflineLevel = mpLoadOfflineLevel;

function __mp_freezePlayer(){
  try {
    const s = __mp_getState();
    if (!s || !s.player) return;
    s.player.isFrozen = true;
    s.player.movementMode = 'stationary';
    s.player.speed = 0.0;
  } catch(_){ }
}
function __mp_unfreezePlayer(){
  try {
    const s = __mp_getState();
    if (!s || !s.player) return;
    s.player.isFrozen = false;
  } catch(_){ }
}

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
  __mp_cooldownActive = false; mpNextConnectAt = 0; __mp_retryMs = MP_FAIL_BASE_MS;
    try { console.log('[MP] WS connected'); } catch(_){}
    try { __mp_offlineLoadedForLevel = null; } catch(_){ }
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
    if (t === 'music_pos'){
      try {
        const list = __mp_musicPosWaiters.slice();
        __mp_musicPosWaiters.length = 0;
        for (const cb of list){ try { if (typeof cb === 'function') cb(msg); } catch(_){} }
      } catch(_){ }
      return;
    }
    if (t === 'items_full'){ try { console.log('[MP][items] recv items_full', (msg.items||[]).length); } catch(_){ } __mp_applyItemsFull(msg.items||[]); return; }
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
    } else if (t === 'tiles_full'){
      mpApplyFullTiles(msg.version||0, msg.tiles||[]);
    } else if (t === 'tile_ops'){
      const nextV = msg.version|0;
      if (nextV <= mpTiles.version){ return; }
      if (nextV !== mpTiles.version + 1){ try { mpWS.send(JSON.stringify({ type:'tiles_sync', have: mpTiles.version })); } catch(_){ } return; }
      mpApplyTileOps(nextV, msg.ops||[]);
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
    // Attempt offline fallback load for current level
    try { mpLoadOfflineLevel(MP_LEVEL); } catch(_){ }
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
  // Sanitize position to avoid invalid_pos server closes
  const safeNum = (v, def=0)=>{ const n=Number(v); return Number.isFinite(n)? n : def; };
  // Clamp within reasonable world extents (grid +/- a safety margin); fall back to 0 if not yet set
  const W = (typeof MAP_W==='number')? MAP_W : (window.MAP_W||128);
  const H = (typeof MAP_H==='number')? MAP_H : (window.MAP_H||128);
  const maxX = W, maxZ = H; // world coords are roughly -W/2..+W/2; server likely tolerates
  const sx = Math.max(-maxX, Math.min(maxX, safeNum(p.x, 0)));
  const sy = Math.max(-64, Math.min(256, safeNum(p.y, 0)));
  const sz = Math.max(-maxZ, Math.min(maxZ, safeNum(p.z, 0)));
  const payload = { type: 'update', id: MP_ID, pos: { x: sx, y: sy, z: sz }, state: myState, channel: MP_CHANNEL, level: MP_LEVEL };
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
  const safeNum = (v, def=0)=>{ const n=Number(v); return Number.isFinite(n)? n : def; };
  const W = (typeof MAP_W==='number')? MAP_W : (window.MAP_W||128);
  const H = (typeof MAP_H==='number')? MAP_H : (window.MAP_H||128);
  const maxX = W, maxZ = H;
  const sx = Math.max(-maxX, Math.min(maxX, safeNum(p.x, 0)));
  const sy = Math.max(-64, Math.min(256, safeNum(p.y, 0)));
  const sz = Math.max(-maxZ, Math.min(maxZ, safeNum(p.z, 0)));
  const payload = { type: 'update', id: MP_ID, pos: { x: sx, y: sy, z: sz }, state: myState, channel: MP_CHANNEL, level: MP_LEVEL };
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
  // Keep player frozen while level is loading to avoid falling through
  try { if (__mp_levelLoading){ const s = __mp_getState(); if (s && s.player){ s.player.isFrozen = true; } } } catch(_){ }
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

// Request the current server music position; invokes cb once with
// { type:'music_pos', posMs:number, durationMs:number, now:number, enabled:boolean }
window.mpRequestMusicPos = function(cb){
  try {
    if (!mpWS || mpWS.readyState !== WebSocket.OPEN) return false;
    if (cb && typeof cb === 'function') __mp_musicPosWaiters.push(cb);
    mpWS.send(JSON.stringify({ type:'music_pos' }));
    return true;
  } catch(_){ return false; }
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
    if (o.op==='add' && (o.t===1 || o.t===2 || o.t===3 || o.t===4 || o.t===5 || o.t===9)) rec.t = (o.t|0);
  clean.push(rec);
      if (clean.length >= 512) break; // clamp
    }
    if (!clean.length) return false;
    mpWS.send(JSON.stringify({ type:'map_edit', ops: clean }));
    return true;
  } catch(_){ return false; }
};

// One-time fixer: resend t:9 flags for elevated NOCLIMB spans currently in the world.
// Use this if previously-saved diffs lacked t:9 and reload shows BASE instead of NOCLIMB above ground.
// Call from console: mpFixNoClimbTypes()
window.mpFixNoClimbTypes = function(){
  try {
    if (!mpWS || mpWS.readyState !== WebSocket.OPEN) { console.warn('[MP] fix: WS not open'); return false; }
    if (!window || !window.columnSpans || typeof window.columnSpans.entries !== 'function') { console.warn('[MP] fix: no columnSpans'); return false; }
    const BATCH_MAX = 480; // leave headroom under server clamp 512
    let batch = [];
    for (const [key, spans] of window.columnSpans.entries()){
      if (!Array.isArray(spans) || spans.length===0) continue;
      const parts = key.split(','); if (parts.length!==2) continue;
      const gx = parseInt(parts[0],10), gy = parseInt(parts[1],10);
      if (!Number.isFinite(gx)||!Number.isFinite(gy)) continue;
      for (const s of spans){
        if (!s) continue; const t=(s.t|0)||0; if (t!==9) continue;
        const b=(s.b|0), h=((typeof s.h==='number')?s.h:(s.h|0));
        const top = b + Math.max(0, h|0) - 1;
        for (let y=b; y<=top; y++){
          batch.push({ op:'add', key: `${gx},${gy},${y}`, t: 9 });
          if (batch.length >= BATCH_MAX){ try { window.mpSendMapOps(batch); } catch(_){} batch = []; }
        }
      }
    }
    if (batch.length){ try { window.mpSendMapOps(batch); } catch(_){} }
    console.log('[MP] fix: sent NOCLIMB type updates');
    return true;
  } catch(err){ console.warn('[MP] fix failed', err); return false; }
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

// Send tile edit ops: array of {op:'set', gx,gy,v}
window.mpSendTileOps = function(ops){
  try {
    if (!mpWS || mpWS.readyState !== WebSocket.OPEN) return false;
    if (!Array.isArray(ops) || !ops.length) return false;
    const clean=[];
    for (const o of ops){
      if (!o || o.op!=='set') continue;
      const gx = o.gx|0, gy = o.gy|0; const v = o.v|0;
      const k = gx+','+gy; clean.push({ op:'set', k, v });
      if (clean.length >= 256) break;
    }
    if (!clean.length) return false;
    mpWS.send(JSON.stringify({ type:'tile_edit', ops: clean }));
    return true;
  } catch(_){ return false; }
}

// Manual force sync (in case initial items_full missed, or for debugging)
window.mpForceItemsSync = function(){
  try { if (mpWS && mpWS.readyState === WebSocket.OPEN){ mpWS.send(JSON.stringify({ type:'items_sync' })); console.log('[MP][items] items_sync requested'); return true; } } catch(_){ }
  return false;
};

// Send portal metadata ops: array of { op:'set'|'remove', k:'gx,gy', dest? }
window.mpSendPortalOps = function(ops){
  try {
    if (!mpWS || mpWS.readyState !== WebSocket.OPEN) return false;
    if (!Array.isArray(ops) || !ops.length) return false;
    const clean=[];
    for (const o of ops){
      if (!o || (o.op!=='set' && o.op!=='remove')) continue;
      if (typeof o.k !== 'string') continue;
      const rec = { op: o.op, k: o.k };
      if (o.op === 'set'){
        if (typeof o.dest !== 'string' || !o.dest || o.dest.length>64) continue;
        rec.dest = o.dest;
      }
      clean.push(rec);
      if (clean.length >= 256) break;
    }
    if (!clean.length) return false;
    mpWS.send(JSON.stringify({ type:'portal_edit', ops: clean }));
    return true;
  } catch(_){ return false; }
};

// Switch to a new named level: clears local world to blank (no sample), requests server syncs, updates palette via parseLevelGroupId
window.mpSwitchLevel = function(levelName){
  try {
    const name = (typeof levelName==='string' && levelName.trim()) ? levelName.trim() : 'ROOT';
  MP_LEVEL = name;
  window.MP_LEVEL = MP_LEVEL;
  // Reset purple totals for the new room; item loaders will set the correct total shortly
  try { if (window.gameSave && typeof gameSave.setPurpleTotalForCurrentRoom === 'function') gameSave.setPurpleTotalForCurrentRoom(0); } catch(_){ }
    // If we're about to switch levels, ensure any previous offline-load guard is cleared
    // so that offline diffs will re-apply after we rebuild the base (e.g., ROOT sample).
    try { __mp_offlineLoadedForLevel = null; } catch(_){ }
  // Freeze player while loading new level
  __mp_levelLoading = true;
  __mp_freezePlayer();
  if (__mp_levelUnfreezeTimer){ try { clearTimeout(__mp_levelUnfreezeTimer); } catch(_){ } __mp_levelUnfreezeTimer = null; }
  // For ROOT, prepare to rebuild the sample map as the base before applying server diffs
  const isRoot = (MP_LEVEL === 'ROOT');
    // Reset client-side map and tile diffs so no old level data is re-applied
    try {
      if (mpMap && mpMap.adds && mpMap.removes){ mpMap.adds.clear(); mpMap.removes.clear(); mpMap.version = 0; }
      if (mpTiles && mpTiles.set){ mpTiles.set.clear(); mpTiles.version = 0; }
    } catch(_){ }
    // Update palette group based on leading number
    try { if (typeof window.parseLevelGroupId === 'function' && typeof window.setLevel === 'function'){ const gid = window.parseLevelGroupId(name); window.setLevel(gid); } } catch(_){ }
    // Clear world: for ROOT rebuild the sample map; for others, clear to blank base
    try {
      // Always clear portals across level switch
      if (window.portalDestinations instanceof Map) window.portalDestinations.clear();
      // Clear caches common to both paths
      if (typeof window.columnSpans !== 'undefined' && window.columnSpans && window.columnSpans.clear) window.columnSpans.clear();
      if (typeof window.columnHeights !== 'undefined' && window.columnHeights && window.columnHeights.clear) window.columnHeights.clear();
      if (typeof window.columnBases !== 'undefined' && window.columnBases && window.columnBases.clear) window.columnBases.clear();
      try { if (Array.isArray(window.extraColumns)) window.extraColumns.length = 0; } catch(_){ }
      try { if (Array.isArray(window.removeVolumes)) window.removeVolumes.length = 0; } catch(_){ }
      // Clear any pending builder outputs from sample map module
      try { delete window._pendingMapHeights; } catch(_){ }
      try { delete window._pendingItems; } catch(_){ }
      // Clear existing runtime items before rebuilding or blanking
      if (typeof window.removeItemsAtWorld === 'function' && typeof window.MAP_W==='number' && typeof window.MAP_H==='number'){
        for (let y=0;y<window.MAP_H;y++) for (let x=0;x<window.MAP_W;x++){ const w={ x:(x+0.5)-window.MAP_W*0.5, z:(y+0.5)-window.MAP_H*0.5 }; try { window.removeItemsAtWorld(w.x, w.z); } catch(_){ }
        }
      }
      if (isRoot){
        // Restore sample base terrain first
        if (typeof window.map !== 'undefined' && typeof window.MAP_W==='number' && typeof window.MAP_H==='number' && typeof window.mapIdx==='function'){
          for (let y=0;y<window.MAP_H;y++) for (let x=0;x<window.MAP_W;x++){ try { window.map[window.mapIdx(x,y)] = (window.TILE && window.TILE.OPEN)||0; } catch(_){ } }
        }
        if (typeof window.buildSampleMap === 'function') window.buildSampleMap();
        if (typeof window.rebuildInstances === 'function') window.rebuildInstances();
      } else {
        // Blank base for non-root levels; wait for server diffs
        if (typeof window.map !== 'undefined' && typeof window.MAP_W==='number' && typeof window.MAP_H==='number' && typeof window.mapIdx==='function'){
          for (let y=0;y<window.MAP_H;y++) for (let x=0;x<window.MAP_W;x++){ try { window.map[window.mapIdx(x,y)] = (window.TILE && window.TILE.OPEN)||0; } catch(_){ } }
        }
        if (typeof window.rebuildInstances === 'function') window.rebuildInstances();
      }
    } catch(_){ }
    // Request syncs from server for this level
    try {
      if (mpWS && mpWS.readyState === WebSocket.OPEN){
        mpWS.send(JSON.stringify({ type:'level_change', level: MP_LEVEL }));
      } else {
        // No server? Try offline fallback
        mpLoadOfflineLevel(MP_LEVEL);
      }
    } catch(_){ }
    // UX hint
    try { console.log('[MP] switched to level', MP_LEVEL); } catch(_){ }
    // Safety: unfreeze if no data arrives within 3 seconds
    try {
      __mp_levelUnfreezeTimer = setTimeout(() => { __mp_levelLoading = false; __mp_unfreezePlayer(); __mp_levelUnfreezeTimer = null; }, 3000);
    } catch(_){ }
    return true;
  } catch(_){ return false; }
};

// Allow UI to set level name without switching immediately (for gating buildSampleMap)
window.mpSetLevelName = function(name){ try { MP_LEVEL = String(name||'ROOT'); window.MP_LEVEL = MP_LEVEL; } catch(_){ } };

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

// Aggressive boot-time fallback to prevent falling through when server is unreachable
try {
  // Freeze player immediately until a map (online or offline) is applied
  __mp_levelLoading = true;
  __mp_freezePlayer();
  // Kick a WS connect attempt now; don't wait for first frame
  mpEnsureWS(Date.now());
  // If WS is not open very quickly, try loading offline map
  __mp_bootConnectWatch = setTimeout(() => {
    try {
      if (mpWSState !== 'open' && (mpMap.version|0) === 0){
        console.warn('[MP] WS slow at boot; fast offline map fallback');
        mpLoadOfflineLevel(MP_LEVEL);
      }
    } catch(_){ }
  }, 150);
  // Secondary guard at ~1s in case first attempt races
  __mp_bootMapWatch = setTimeout(() => {
    try {
      if ((mpMap.version|0) === 0){
        console.warn('[MP] No map after 1s; forcing offline fallback');
        mpLoadOfflineLevel(MP_LEVEL);
      }
    } catch(_){ }
  }, 1000);
} catch(_){ }

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
