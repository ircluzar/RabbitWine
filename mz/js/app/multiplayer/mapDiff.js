"use strict";
/**
 * Map diff processing and world reconstruction for RabbitWine multiplayer.
 * Extracted from multiplayer.js for better modularity and testing.
 * 
 * Original location: multiplayer.js lines 107-460 (map diff application and world rebuild)
 * Handles map operation application, span reconstruction, and type hint management.
 */

/**
 * Apply a full map snapshot replacing current state.
 * @param {number} version - Map version number
 * @param {Array} ops - Array of map operations {op:'add'|'remove', key:string, t?:number}
 */
function mpApplyFullMap(version, ops){
  // Clear existing state - assumes mpMap is globally available
  if (typeof window !== 'undefined' && window.mpMap) {
    window.mpMap.adds.clear(); 
    window.mpMap.removes.clear();
  }
  
  let sawLock = false;
  for (const op of (ops||[])){
    if (!op || typeof op.key!=='string') continue;
    if (op.op === 'add') {
      // Encode type flag by storing key#N in adds set where N in {1,2,3,4,5,6,9}
      let tt = (op.t===1||op.t===2||op.t===3||op.t===4||op.t===5||op.t===6||op.t===9) ? op.t|0 : 0;
      if (!tt && typeof window.__mp_hintGet === 'function'){ 
        const hint = window.__mp_hintGet(op.key); 
        if (hint) tt = hint; 
      }
      
      if (window.mpMap) {
        if (tt===1) window.mpMap.adds.add(op.key+'#1');
        else if (tt===2) window.mpMap.adds.add(op.key+'#2');
        else if (tt===3) window.mpMap.adds.add(op.key+'#3');
        else if (tt===4) window.mpMap.adds.add(op.key+'#4');
        else if (tt===5) window.mpMap.adds.add(op.key+'#5');
        else if (tt===6){ window.mpMap.adds.add(op.key+'#6'); sawLock = true; }
        else if (tt===9) window.mpMap.adds.add(op.key+'#9');
        else window.mpMap.adds.add(op.key);
      }
    }
    else if (op.op === 'remove' && window.mpMap) {
      window.mpMap.removes.add(op.key);
    }
  }
  
  if (window.mpMap) {
    window.mpMap.version = version|0;
  }
  
  // Update lock replay gate if locks detected
  if (sawLock && typeof window.__mp_lockReplayGate !== 'undefined') {
    window.__mp_lockReplayGate = true;
  }
  
  // Count lock keys for instrumentation
  let lockCount = 0; 
  try { 
    if (window.mpMap) {
      for (const k of window.mpMap.adds){ 
        if (k.endsWith('#6')) { lockCount++; } 
      } 
    }
  } catch(_){ }
  
  try { 
    const version = window.mpMap ? window.mpMap.version : 0;
    const addsSize = window.mpMap ? window.mpMap.adds.size : 0;
    const removesSize = window.mpMap ? window.mpMap.removes.size : 0;
    const gate = (typeof window.__mp_lockReplayGate !== 'undefined') ? window.__mp_lockReplayGate : false;
    console.log('[MP] map_full applied v', version, 'adds=', addsSize, 'removes=', removesSize, 'locks=', lockCount, 'gate=', gate); 
  } catch(_){ }
  
  try { __mp_rebuildWorldFromDiff(); } catch(_){ }
  
  // Self-healing reconciliation: for legacy snapshots missing #6 typed keys, reinsert locally & optionally rebroadcast.
  try { if (typeof window.mpReconcileLockTypesAfterFull === 'function') window.mpReconcileLockTypesAfterFull(); } catch(_){ }
  
  // Replay any locally persisted Lock placements not yet in diff (offline persistence layer)
  try { if (typeof window.__mp_replayPersistedLocks === 'function') window.__mp_replayPersistedLocks(); } catch(_){ }
  
  // On first snapshot after switching levels, unfreeze movement
  try {
    if (typeof window.__mp_levelLoading !== 'undefined' && window.__mp_levelLoading){
      window.__mp_levelLoading = false;
      if (typeof window.__mp_levelUnfreezeTimer !== 'undefined' && window.__mp_levelUnfreezeTimer){ 
        clearTimeout(window.__mp_levelUnfreezeTimer); 
        window.__mp_levelUnfreezeTimer = null; 
      }
      if (typeof window.__mp_unfreezePlayer === 'function') window.__mp_unfreezePlayer();
      console.log('[MP] level data received; unfreezing player');
    }
  } catch(_){ }
  
  try { if (typeof window.__mp_clearBootWatch === 'function') window.__mp_clearBootWatch(); } catch(_){ }
}

/**
 * Apply incremental map operations to current state.
 * @param {number} version - New map version number
 * @param {Array} ops - Array of map operations to apply
 */
function mpApplyOps(version, ops){
  let sawLock = false;
  for (const op of (ops||[])){
    if (!op || typeof op.key!=='string') continue;
    if (op.op === 'add'){
      let tt = (op.t===1||op.t===2||op.t===3||op.t===4||op.t===5||op.t===6||op.t===9) ? op.t|0 : 0;
      if (!tt && typeof window.__mp_hintGet === 'function'){ 
        const hint = window.__mp_hintGet(op.key); 
        if (hint) tt = hint; 
      }
      const addKey = (tt===1)? (op.key+'#1') : (tt===2)? (op.key+'#2') : (tt===3)? (op.key+'#3') : (tt===4)? (op.key+'#4') : (tt===5)? (op.key+'#5') : (tt===6)? (op.key+'#6') : (tt===9)? (op.key+'#9') : op.key;
      
      if (window.mpMap) {
        if (window.mpMap.removes.has(op.key)) window.mpMap.removes.delete(op.key); 
        else window.mpMap.adds.add(addKey);
      }
      if (tt===6) sawLock = true;
    } else if (op.op === 'remove' && window.mpMap){
      if (window.mpMap.adds.has(op.key)) window.mpMap.adds.delete(op.key);
      else if (window.mpMap.adds.has(op.key+'#1')) window.mpMap.adds.delete(op.key+'#1');
      else if (window.mpMap.adds.has(op.key+'#2')) window.mpMap.adds.delete(op.key+'#2');
      else if (window.mpMap.adds.has(op.key+'#3')) window.mpMap.adds.delete(op.key+'#3');
      else if (window.mpMap.adds.has(op.key+'#4')) window.mpMap.adds.delete(op.key+'#4');
      else if (window.mpMap.adds.has(op.key+'#5')) window.mpMap.adds.delete(op.key+'#5');
      else if (window.mpMap.adds.has(op.key+'#6')) window.mpMap.adds.delete(op.key+'#6');
      else if (window.mpMap.adds.has(op.key+'#9')) window.mpMap.adds.delete(op.key+'#9');
      else window.mpMap.removes.add(op.key);
    }
  }
  
  if (window.mpMap) {
    window.mpMap.version = version|0;
  }
  
  // Update lock replay gate if locks detected
  if (sawLock && typeof window.__mp_lockReplayGate !== 'undefined') {
    window.__mp_lockReplayGate = true;
  }
  
  let lockCount = 0; 
  try { 
    if (window.mpMap) {
      for (const k of window.mpMap.adds){ 
        if (k.endsWith('#6')) lockCount++; 
      } 
    }
  } catch(_){ }
  
  try { 
    const version = window.mpMap ? window.mpMap.version : 0;
    const addsSize = window.mpMap ? window.mpMap.adds.size : 0;
    const removesSize = window.mpMap ? window.mpMap.removes.size : 0;
    const gate = (typeof window.__mp_lockReplayGate !== 'undefined') ? window.__mp_lockReplayGate : false;
    console.log('[MP] map_ops applied v', version, 'adds=', addsSize, 'removes=', removesSize, 'locks=', lockCount, 'gate=', gate); 
  } catch(_){ }
  
  try { __mp_rebuildWorldFromDiff(); } catch(_){ }
  
  try {
    if (typeof window.__mp_levelLoading !== 'undefined' && window.__mp_levelLoading){
      window.__mp_levelLoading = false;
      if (typeof window.__mp_levelUnfreezeTimer !== 'undefined' && window.__mp_levelUnfreezeTimer){ 
        clearTimeout(window.__mp_levelUnfreezeTimer); 
        window.__mp_levelUnfreezeTimer = null; 
      }
      if (typeof window.__mp_unfreezePlayer === 'function') window.__mp_unfreezePlayer();
      console.log('[MP] map ops applied; unfreezing player');
    }
  } catch(_){ }
  
  try { if (typeof window.__mp_clearBootWatch === 'function') window.__mp_clearBootWatch(); } catch(_){ }
}

/**
 * Local-only application of map ops when offline / WS closed.
 * Mirrors mpApplyOps but does not rely on server version. We bump mpMap.version locally.
 * @param {Array} ops - Array of operations to apply locally
 * @returns {boolean} True if changes were applied
 */
function __mp_localApplyMapOps(ops){
  try {
    if (!Array.isArray(ops) || !ops.length) return false;
    let changed = false;
    for (const op of ops){
      if (!op || typeof op.key !== 'string') continue;
      if (op.op === 'add'){
        let tt = (op.t===1||op.t===2||op.t===3||op.t===4||op.t===5||op.t===6||op.t===9) ? (op.t|0) : 0;
        if (!tt && typeof window.__mp_hintGet === 'function'){ 
          const hint = window.__mp_hintGet(op.key); 
          if (hint) tt = hint; 
        }
        const addKey = (tt===1)? (op.key+'#1') : (tt===2)? (op.key+'#2') : (tt===3)? (op.key+'#3') : (tt===4)? (op.key+'#4') : (tt===5)? (op.key+'#5') : (tt===6)? (op.key+'#6') : (tt===9)? (op.key+'#9') : op.key;
        
        if (window.mpMap) {
          if (window.mpMap.removes.has(op.key)) window.mpMap.removes.delete(op.key); 
          else window.mpMap.adds.add(addKey);
        }
        
        // Record a hint so if we later reconnect and server echoes untyped we still retain type.
        if (op.t && typeof window.__mp_hintSet === 'function') window.__mp_hintSet(op.key, op.t|0);
        changed = true;
      } else if (op.op === 'remove' && window.mpMap){
        if (window.mpMap.adds.has(op.key)) window.mpMap.adds.delete(op.key);
        else if (window.mpMap.adds.has(op.key+'#1')) window.mpMap.adds.delete(op.key+'#1');
        else if (window.mpMap.adds.has(op.key+'#2')) window.mpMap.adds.delete(op.key+'#2');
        else if (window.mpMap.adds.has(op.key+'#3')) window.mpMap.adds.delete(op.key+'#3');
        else if (window.mpMap.adds.has(op.key+'#4')) window.mpMap.adds.delete(op.key+'#4');
        else if (window.mpMap.adds.has(op.key+'#5')) window.mpMap.adds.delete(op.key+'#5');
        else if (window.mpMap.adds.has(op.key+'#6')) window.mpMap.adds.delete(op.key+'#6');
        else if (window.mpMap.adds.has(op.key+'#9')) window.mpMap.adds.delete(op.key+'#9');
        else window.mpMap.removes.add(op.key);
        changed = true;
      }
    }
    if (!changed) return false;
    
    if (window.mpMap) {
      window.mpMap.version = (window.mpMap.version|0) + 1; // local bump
    }
    
    try { 
      const version = window.mpMap ? window.mpMap.version : 0;
      const addsSize = window.mpMap ? window.mpMap.adds.size : 0;
      const removesSize = window.mpMap ? window.mpMap.removes.size : 0;
      console.log('[MP] local map_ops applied v', version, 'adds=', addsSize, 'removes=', removesSize); 
    } catch(_){ }
    
    try { __mp_rebuildWorldFromDiff(); } catch(_){ }
    return true;
  } catch(err){ 
    try { console.warn('[MP] local apply failed', err); } catch(_){ } 
    return false; 
  }
}

/**
 * Rebuild columnSpans from current diff each time (simple; can be optimized later)
 * Converts map diff (adds/removes) into 3D span geometry for rendering and physics.
 */
function __mp_rebuildWorldFromDiff(){
  if (typeof window === 'undefined' || !window.columnSpans || !window.setSpansAt || !window.mpMap) return;
  
  // Start from original base map? For now we assume base map already loaded and we overlay diffs add/remove.
  // We'll apply adds (voxels) then removes (carves) on top of existing spans.
  // Each key format: gx,gy,y
  const addByCell = new Map();
  for (const rawKey of window.mpMap.adds){
    const is1 = rawKey.endsWith('#1');
    const is2 = rawKey.endsWith('#2');
    const is3 = rawKey.endsWith('#3');
    const is4 = rawKey.endsWith('#4');
    const is5 = rawKey.endsWith('#5');
    const is6 = rawKey.endsWith('#6');
    const is9 = rawKey.endsWith('#9');
    const tt = is1?1 : is2?2 : is3?3 : is4?4 : is5?5 : is6?6 : is9?9 : 0;
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
      // Separate unit voxels vs markers:
      //  - HALF-SLAB (t=4) handled as individual half-height spans
      //  - PORTAL (t=5) non-solid trigger spans built independently
      //  - LOCK (t=6) is ALSO non-solid visual; must not merge into solid spans or it downgrades to base
      const solidUnits = arrObjs.filter(o=> { const tt=(o.t|0); return !(tt===2||tt===3||tt===4||tt===5||tt===6); });
      const portalUnits = arrObjs.filter(o=> (o.t|0)===5);
      const lockUnits = arrObjs.filter(o=> (o.t|0)===6);
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
      
      // Build contiguous lock spans independently (non-solid visual, outline-only)
      if (lockUnits.length){
        let b = lockUnits[0].y|0; let prev = lockUnits[0].y|0;
        for (let i=1;i<lockUnits.length;i++){
          const yObj = lockUnits[i]; const y = yObj.y|0;
          if (y === prev + 1){ prev = y; continue; }
          spans.push({ b, h:(prev - b + 1), t:6 });
          b = y; prev = y;
        }
        spans.push({ b, h:(prev - b + 1), t:6 });
      }
      
      // Add half-slabs individually (b=y, h=0.5)
      for (const s of slabs){ spans.push({ b: s.y|0, h: 0.5 }); }
    }
    
    // Merge with existing spans: insert without cross-type infection
    const [gx,gy] = cellK.split(',').map(n=>parseInt(n,10));
    const isSolid = (t)=>{ const tt=(t|0)||0; return (tt===0||tt===1||tt===9); };
    const sameType = (a,b)=>(((a|0)||0) === ((b|0)||0));
    
    // Start from existing spans, normalized by merging same-type overlaps/adjacency
    let merged = (window.columnSpans.get(cellK) || []).map(s=>({ b: s.b|0, h: (typeof s.h==='number'? s.h : (s.h|0)), t: ((s.t===1||s.t===2||s.t===3||s.t===4||s.t===5||s.t===6||s.t===9)?(s.t|0):0) }));
    
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
    const newSpans = spans.map(s=>({ b: s.b|0, h: (typeof s.h==='number'? s.h : (s.h|0)), t: ((s.t===1||s.t===2||s.t===3||s.t===4||s.t===5||s.t===6||s.t===9)?(s.t|0):0) }));
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
    window.setSpansAt(gx,gy,merged.map(s=>{ const o = { b:s.b, h:s.h }; if (s.t===1||s.t===2||s.t===3||s.t===4||s.t===5||s.t===6||s.t===9) o.t = s.t; return o; }));
  }
  
  // Apply removals: removing a single voxel from any span.
  for (const key of window.mpMap.removes){
    const parts = key.split(','); if (parts.length!==3) continue;
    const gx = parseInt(parts[0],10), gy = parseInt(parts[1],10), y = parseInt(parts[2],10);
    if (!Number.isFinite(gx)||!Number.isFinite(gy)||!Number.isFinite(y)) continue;
    const cellK = gx+','+gy;
    let spans = window.columnSpans.get(cellK) || [];
    if (!spans.length) continue;
    const out=[]; 
    for (const s of spans){ 
      const sb=s.b|0; const sh=(typeof s.h==='number')? s.h : (s.h|0); const tt=(s.t===1||s.t===2||s.t===3||s.t===4||s.t===5||s.t===6||s.t===9)?(s.t|0):0;
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

/**
 * Get current map diff snapshot for persistence.
 * @returns {Object} Snapshot with version, adds, and removes arrays
 */
function __mp_getMapSnapshot(){
  try {
    if (!window.mpMap) return { version: 0, adds: [], removes: [] };
    return {
      version: window.mpMap.version|0,
      adds: Array.from(window.mpMap.adds.values()),
      removes: Array.from(window.mpMap.removes.values()),
    };
  } catch(_){ return { version: 0, adds: [], removes: [] }; }
}

/**
 * Apply a saved map snapshot to current state.
 * @param {Object} snap - Snapshot object with version, adds, removes
 * @returns {boolean} True if successfully applied
 */
function __mp_applyMapSnapshot(snap){
  try {
    if (!snap || typeof snap !== 'object' || !window.mpMap) return false;
    window.mpMap.adds.clear(); 
    window.mpMap.removes.clear();
    if (Array.isArray(snap.adds)) for (const k of snap.adds){ if (typeof k === 'string') window.mpMap.adds.add(k); }
    if (Array.isArray(snap.removes)) for (const k of snap.removes){ if (typeof k === 'string') window.mpMap.removes.add(k); }
    window.mpMap.version = (snap.version|0) || 0;
    __mp_rebuildWorldFromDiff();
    return true;
  } catch(_){ return false; }
}

// Export functions for global window compatibility (legacy interface)
if (typeof window !== 'undefined') {
  window.mpApplyFullMap = mpApplyFullMap;
  window.mpApplyOps = mpApplyOps;
  window.__mp_localApplyMapOps = __mp_localApplyMapOps;
  window.__mp_rebuildWorldFromDiff = __mp_rebuildWorldFromDiff;
  window.__mp_getMapSnapshot = __mp_getMapSnapshot;
  window.__mp_applyMapSnapshot = __mp_applyMapSnapshot;
}