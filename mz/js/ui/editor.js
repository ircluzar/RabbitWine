"use strict";
// Editor FPS mode (desktop-only): noclip fly, grid visor, structure modal with preview and save.
(function(){
  if (typeof window === 'undefined') return;

  const rootId = 'mz-editor-modal-root';
  function ensureRoot(){
    let r = document.getElementById(rootId);
    if (!r){ r = document.createElement('div'); r.id = rootId; document.body.appendChild(r); }
    return r;
  }

  function isDesktop(){ return matchMedia('(pointer:fine)').matches; }

  function onPointerLockChange(){
    const locked = document.pointerLockElement === CANVAS;
    state.editor.pointerLocked = !!locked;
    // Do not auto-open modal on unlock. Modal should open only via explicit actions (e.g., middle mouse).
  }

  function onToggleEditorMode(){
    if (!isDesktop()) { showTopNotification('Editor available on desktop only'); return; }
    if (state.editor.mode !== 'fps') enterEditor(); else exitEditor();
  }

  function enterEditor(){
    state.editor.mode = 'fps';
    state.editor.modalOpen = false;
    state.snapTopFull = false; state.snapBottomFull = false; // keep split by default
    const EDITOR_TOGGLE = document.getElementById('editor-toggle');
    if (EDITOR_TOGGLE){
      EDITOR_TOGGLE.setAttribute('aria-pressed','true');
      EDITOR_TOGGLE.textContent = 'Editor: FPS';
      // Avoid keeping focus on the button so Space doesn't trigger it again
      try { EDITOR_TOGGLE.blur(); } catch(_){ }
    }
    // Seed camera from player
    const p = state.player; const e = state.editor.fps;
    e.x = p.x; e.y = Math.max(0.6, p.y + 1.8); e.z = p.z; e.yaw = p.angle; e.pitch = 0;
    // Hide player while editing
    state._hidePlayer = true;
    // Try to lock pointer on canvas click
    CANVAS.requestPointerLock = CANVAS.requestPointerLock || CANVAS.mozRequestPointerLock;
    if (document.pointerLockElement !== CANVAS) {
      try { CANVAS.requestPointerLock(); } catch(_){ }
    }
    // Ensure keyboard focus goes to the canvas
    try { CANVAS.focus(); } catch(_){ }
    // Clear any lingering inputs to avoid stuck movement upon transition
    try { state.inputs.keys.clear(); } catch(_){ }
    // Show crosshair
  try { const c = document.getElementById('editor-crosshair'); if (c) c.style.display = 'block'; } catch(_){ }
  // Block type bar
  try { ensureBlockTypeBar && ensureBlockTypeBar(); } catch(_){ }
  }
  // Mouse wheel to pull/push visor distance along the view ray (zoom the interaction point)
  window.addEventListener('wheel', (ev)=>{
    if (state.editor.mode !== 'fps' || state.editor.modalOpen) return;
    // Only act when the canvas is the intended target area to avoid conflicting with other UI
    // If the event originated within the editor modal panel, ignore.
    const root = document.getElementById('mz-editor-modal-root');
    if (root && root.contains(ev.target)) return;
  // Adjust distance in world units; invert so wheel up pushes visor away
  const dz = (ev.deltaY || 0) * 0.01; // positive = push back, negative = pull closer
  const e = state.editor;
  const prev = e.visorDist || 6.0;
  let next = prev - dz; // wheel up (negative deltaY) increases distance
    // Clamp to reasonable range
    next = Math.max(0.5, Math.min(60.0, next));
    e.visorDist = next;
    // Prevent page scrolling when editing
    ev.preventDefault();
  }, { passive: false });

  // Helpers to mutate spans at the visor
  function __getSpans(gx, gy){
    const key = `${gx},${gy}`;
    try { return (window.columnSpans.get(key) || []).slice(); } catch(_){ return []; }
  }
  function __setSpans(gx, gy, spans){ try { window.setSpansAt(gx, gy, spans); } catch(_){} }
  function __normalize(spans){
    // Normalize spans and merge only same-type overlaps/adjacency to avoid type infection
    const arr = (Array.isArray(spans)?spans:[])
      .filter(s=>s && (Number(s.h)||0) > 0)
      .map(s=>{
        const tt = (s.t|0)||0;
        const o = { b: (s.b|0), h: (typeof s.h==='number'? s.h : (s.h|0)) };
        if (tt===1||tt===2||tt===3||tt===4||tt===5||tt===6||tt===9) o.t = tt;
        return o;
      });
    arr.sort((a,b)=> (a.b - b.b) || (((a.t|0)||0) - ((b.t|0)||0)) );
    const out=[];
    for (const s of arr){
      if (!out.length){ out.push({ ...s }); continue; }
      const t = out[out.length-1];
      const sT = (s.t|0)||0; const tT = (t.t|0)||0;
      if (sT===tT && s.b <= t.b + t.h + 1e-6){
        const top = Math.max(t.b + t.h, s.b + s.h); t.h = top - t.b;
      } else { out.push({ ...s }); }
    }
    return out;
  }

  // World solidity query at (x,z) for a given y-level (treat spans and walls as solid if y is inside)
  function __isSolidAtWorld(x, y, z){
    const gx = Math.floor(x + MAP_W*0.5);
    const gy = Math.floor(z + MAP_H*0.5);
    if (gx<0||gy<0||gx>=MAP_W||gy>=MAP_H) return true; // outside == solid bounds
    const key = `${gx},${gy}`;
    let spans = null;
    try {
      spans = (typeof columnSpans !== 'undefined' && columnSpans instanceof Map) ? columnSpans.get(key)
            : (typeof window !== 'undefined' && window.columnSpans instanceof Map) ? window.columnSpans.get(key)
            : null;
    } catch(_){ spans = null; }
    let list = Array.isArray(spans) ? spans : [];
    if (!list.length){
      // synthesize from columns and map wall
      try {
        if (columnHeights && columnHeights.has(key)){
          let b = 0; let h = columnHeights.get(key) || 0;
          if (h>0){
            try {
              if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = columnBases.get(key) || 0;
              else if (typeof window !== 'undefined' && window.columnBases instanceof Map && window.columnBases.has(key)) b = window.columnBases.get(key) || 0;
            } catch(_){ }
            list = [{ b: b|0, h: h|0 }];
          }
        }
      } catch(_){ }
      try { if (map[mapIdx(gx,gy)] === TILE.WALL) list.push({ b:0, h:1 }); } catch(_){ }
    }
    if (!list.length) return false;
    for (const s of list){ if (!s) continue; const b=s.b|0, h=s.h|0; if (h>0 && y > b - 1e-3 && y < (b+h) - 1e-3) return true; }
    return false;
  }

  // Ray march along axis from origin to first solid, returns distance (max if none)
  function __castDistance(x, y, z, dx, dy, dz, maxDist){
    const step = 0.05; // meters
    const eps = 1e-3;
    let t = eps; // start a hair away so we don't hit our own cube
    const maxT = Math.max(0.0, maxDist||60.0);
    while (t <= maxT){
      const wx = x + dx * t;
      const wy = y + dy * t;
      const wz = z + dz * t;
      if (__isSolidAtWorld(wx, wy, wz)) return t;
      // stop if out of bounds
      const gx = Math.floor(wx + MAP_W*0.5);
      const gy = Math.floor(wz + MAP_H*0.5);
      if (gx<0||gy<0||gx>=MAP_W||gy>=MAP_H) return t;
      t += step;
    }
    return maxT;
  }
  function addBlockAtVisor(){
    const vs = state.editor.visor; if (!vs || vs.gx<0) return false;
    const gx=vs.gx, gy=vs.gy, y=vs.base|0; const key=`${gx},${gy}`;
    const set = (state.editor.blockSet||'A');
    // In Set B, only slot 1 (Lock) is active; other slots are disabled/no-op
    if (set === 'B' && (state.editor.blockSlot|0) !== 1){
      try { if (typeof showTopNotification === 'function') showTopNotification('Set B only has Lock (1)'); } catch(_){ }
      return false;
    }
    // Set B, slot 1: Lock (t:6), non-solid, outline only
    try {
      if (set==='B' && (state.editor.blockSlot|0)===1){
        let spans = __getSpans(gx,gy);
        const exists = spans.some(s=> s && ((s.t|0)===6) && y >= (s.b|0) && y < ((s.b|0) + (Number(s.h)||0)));
        if (exists) return false;
        spans.push({ b: y, h: 1, t: 6 });
        spans = __normalize(spans);
        __setSpans(gx,gy,spans);
        try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
        try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'add', key:`${gx},${gy},${y}`, t: 6 }]); } } catch(_){ }
        if (typeof showTopNotification === 'function') showTopNotification('Lock placed');
        return true;
      }
    } catch(_){ }
    // LEVELCHANGE placement (slot 8)
    try {
      if ((state.editor.blockSlot|0) === 8){
        if (typeof map !== 'undefined' && typeof TILE !== 'undefined'){
          const idx = mapIdx(gx, gy);
          // Prompt destination
          let def = '';
          try { if (window.portalDestinations instanceof Map){ const d = window.portalDestinations.get(key); if (typeof d === 'string') def = d; } } catch(_){ }
          const dest = (window.prompt('Enter destination level (e.g., ROOT, 1A, 2B, 1-1, 1Shell):', def) || '').trim();
          if (!dest){ if (typeof showTopNotification === 'function') showTopNotification('Portal cancelled'); return false; }
          // Ensure metadata map exists
          try { if (!(window.portalDestinations instanceof Map)) window.portalDestinations = new Map(); } catch(_){ }
          try { window.portalDestinations.set(key, dest); } catch(_){ }
          if (y === 0){
            // Ground-level portal tile for orange visual
            if (map[idx] !== TILE.LEVELCHANGE){
              map[idx] = TILE.LEVELCHANGE;
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendTileOps) mpSendTileOps([{ op:'set', gx, gy, v: TILE.LEVELCHANGE }]); } catch(_){ }
            }
          } else {
            // Elevated portal as a non-solid span marker (t:5)
            let spans = __getSpans(gx,gy);
            const exists = spans.some(s=>s && ((s.b|0)===y) && (((s.t|0)||0)===5));
            if (!exists){
              spans.push({ b: y, h: 1, t: 5 });
              spans = spans.filter(s=>s && (Number(s.h)||0) > 0).map(s=>({ b:(s.b|0), h: Number(s.h)||0, ...( ((s.t|0)===1)?{t:1}:((s.t|0)===2?{t:2}:((s.t|0)===3?{t:3}:((s.t|0)===4?{t:4}:((s.t|0)===5?{t:5}:{})))) ) }));
              spans.sort((p,q)=>p.b-q.b);
              __setSpans(gx,gy,spans);
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'add', key:`${gx},${gy},${y}`, t: 5 }]); } } catch(_){ }
            }
          }
          // Replicate portal metadata
          try { if (window.mpSendPortalOps) mpSendPortalOps([{ op:'set', k:key, dest }]); } catch(_){ }
          if (typeof showTopNotification === 'function') showTopNotification('Portal → ' + dest);
          return true;
        }
        return false;
      }
    } catch(_){ }
    // HALF tile placement (slot 5)
    try {
      if ((state.editor.blockSlot|0) === 5){
        if (typeof map !== 'undefined' && typeof TILE !== 'undefined'){
          if (y === 0){
            const idx = mapIdx(gx, gy);
            if (map[idx] !== TILE.HALF){
              map[idx] = TILE.HALF;
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendTileOps) mpSendTileOps([{ op:'set', gx, gy, v: TILE.HALF }]); } catch(_){ }
              return true;
            }
            return false;
          } else {
            // Elevated half-step as fractional slab: b=y, h=0.5, t=0
            let spans = __getSpans(gx,gy);
            // Prevent overlapping duplicate at same base range (y..y+0.5)
            for (const s of spans){ if (!s) continue; const sb=(s.b|0), sh=Number(s.h)||0; const top = sb + sh; if (y >= sb && y < top) return false; }
            spans.push({ b: y, h: 0.5 });
            // Normalize preserving fractional heights and t flags
            spans = spans.filter(s=>s && (Number(s.h)||0) > 0).map(s=>({ b:(s.b|0), h: Number(s.h)||0, ...( ((s.t|0)===1)?{t:1}:((s.t|0)===2?{t:2}:{}) ) }));
            spans.sort((p,q)=>p.b-q.b);
            __setSpans(gx,gy,spans);
            try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
            // Network: approximate elevated half-step as t:4 marker at integer base y
            try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'add', key:`${gx},${gy},${y}`, t: 4 }]); } } catch(_){ }
            return true;
          }
        }
        return false;
      }
    } catch(_){ }
    // NOCLIMB placement (slot 9): ground-only
    try {
      if ((state.editor.blockSlot|0) === 9){
        if (typeof map !== 'undefined' && typeof TILE !== 'undefined'){
          if (y === 0){
            const idx = mapIdx(gx, gy);
            if (map[idx] !== TILE.NOCLIMB){
              map[idx] = TILE.NOCLIMB;
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendTileOps) mpSendTileOps([{ op:'set', gx, gy, v: TILE.NOCLIMB }]); } catch(_){ }
              return true;
            }
            return false;
          } else {
            // Elevated NOCLIMB span marker (solid, disables wall-jump). Add {b:y,h:1,t:9} if absent
            let spans = __getSpans(gx,gy);
            for (const s of spans){ if (s && ((s.t|0)===9) && y >= (s.b|0) && y < ((s.b|0)+(Number(s.h)||0))) return false; }
            spans.push({ b: y, h: 1, t: 9 });
            spans = spans.filter(s=>s && (Number(s.h)||0)>0).map(s=>({ b:(s.b|0), h: Number(s.h)||0, ...( ((s.t|0)===1)?{t:1}:((s.t|0)===2?{t:2}:((s.t|0)===3?{t:3}:((s.t|0)===4?{t:4}:((s.t|0)===5?{t:5}:((s.t|0)===9?{t:9}:{})))) ) ) })).sort((p,q)=>p.b-q.b);
            __setSpans(gx,gy,spans);
            try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
            try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'add', key:`${gx},${gy},${y}`, t: 9 }]); } } catch(_){ }
            return true;
          }
        }
        return false;
      }
    } catch(_){ }
    // FENCE placement (slot 6)
    try {
      if ((state.editor.blockSlot|0) === 6){
        if (typeof map !== 'undefined' && typeof TILE !== 'undefined'){
          if (y === 0){
            const idx = mapIdx(gx, gy);
            if (map[idx] !== TILE.FENCE){
              map[idx] = TILE.FENCE;
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendTileOps) mpSendTileOps([{ op:'set', gx, gy, v: TILE.FENCE }]); } catch(_){ }
              return true;
            }
            return false;
          } else {
            let spans = __getSpans(gx,gy);
            for (const s of spans){ if (s && ((s.t|0)===2) && y >= (s.b|0) && y < ((s.b|0)+(Number(s.h)||0))) return false; }
            spans.push({ b: y, h: 1, t: 2 });
            spans = spans.filter(s=>s && (Number(s.h)||0)>0).map(s=>({ b:(s.b|0), h: Number(s.h)||0, ...( ((s.t|0)===1)?{t:1}:((s.t|0)===2?{t:2}:((s.t|0)===3?{t:3}:{})) ) })).sort((p,q)=>p.b-q.b);
            __setSpans(gx,gy,spans);
            try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
            try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'add', key:`${gx},${gy},${y}`, t: 2 }]); } } catch(_){ }
            return true;
          }
        }
        return false;
      }
    } catch(_){ }
    // BADFENCE placement (slot 7)
    try {
      if ((state.editor.blockSlot|0) === 7){
        if (typeof map !== 'undefined' && typeof TILE !== 'undefined'){
          if (y === 0){
            const idx = mapIdx(gx, gy);
            if (map[idx] !== TILE.BADFENCE){
              map[idx] = TILE.BADFENCE;
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendTileOps) mpSendTileOps([{ op:'set', gx, gy, v: TILE.BADFENCE }]); } catch(_){ }
              return true;
            }
            return false;
          } else {
            let spans = __getSpans(gx,gy);
            for (const s of spans){ if (s && ((s.t|0)===3) && y >= (s.b|0) && y < ((s.b|0)+(Number(s.h)||0))) return false; }
            spans.push({ b: y, h: 1, t: 3 });
            spans = spans.filter(s=>s && (Number(s.h)||0)>0).map(s=>({ b:(s.b|0), h: Number(s.h)||0, ...( ((s.t|0)===1)?{t:1}:((s.t|0)===2?{t:2}:((s.t|0)===3?{t:3}:{})) ) })).sort((p,q)=>p.b-q.b);
            __setSpans(gx,gy,spans);
            try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
            try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'add', key:`${gx},${gy},${y}`, t: 3 }]); } } catch(_){ }
            return true;
          }
        }
        return false;
      }
    } catch(_){ }
    // Default: BASE/BAD voxel span (Set A; Set B falls back to BASE unless explicitly handled)
    {
      let spans = __getSpans(gx,gy);
      // check if block exists at y
      for (const s of spans){ if (s && y >= (s.b|0) && y < (s.b|0)+( (Number(s.h)||0) )) return false; }
      const isBad = (state.editor.blockSlot === 2);
      spans.push(isBad ? { b:y, h:1, t:1 } : { b:y, h:1 });
      spans = __normalize(spans);
      __setSpans(gx,gy,spans);
      if (y===0 && typeof map !== 'undefined' && typeof TILE !== 'undefined'){
        try { map[mapIdx(gx,gy)] = isBad ? TILE.BAD : TILE.WALL; } catch(_){ }
      }
      try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
      try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'add', key:`${gx},${gy},${y}`, t: isBad?1:0 }]); } } catch(_){ }
      return true;
    }
  }
  function removeBlockAtVisor(){
    const vs = state.editor.visor; if (!vs || vs.gx<0) return false;
    const gx=vs.gx, gy=vs.gy, y=vs.base|0;
    const set = (state.editor.blockSet||'A');
    // In Set B, only slot 1 (Lock) is active; other slots are disabled/no-op
    if (set === 'B' && (state.editor.blockSlot|0) !== 1){
      try { if (typeof showTopNotification === 'function') showTopNotification('Set B only has Lock (1)'); } catch(_){ }
      return false;
    }
    // Set B, slot 1 removal: Lock (t:6)
    try {
      if (set==='B' && (state.editor.blockSlot|0)===1){
        let spans = __getSpans(gx,gy);
        let changed=false; const out=[];
        for (const s of spans){
          if (!s) continue; const b=(s.b|0), h=(Number(s.h)||0), t=((s.t|0)||0); const top=b+h-1;
          if (t!==6 || y < b || y > top){ out.push(s); continue; }
          changed=true;
          if (h===1){ /* drop */ }
          else if (y===b){ out.push({ b:b+1, h:h-1, t:6 }); }
          else if (y===top){ out.push({ b:b, h:h-1, t:6 }); }
          else { const h1=y-b, h2=top-y; if (h1>0) out.push({ b:b, h:h1, t:6 }); if (h2>0) out.push({ b:y+1, h:h2, t:6 }); }
        }
        if (!changed) return false;
        out.sort((p,q)=>p.b-q.b);
        __setSpans(gx,gy,out);
        try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
        try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'remove', key:`${gx},${gy},${y}`, t: 6 }]); } } catch(_){ }
        if (typeof showTopNotification === 'function') showTopNotification('Lock removed');
        return true;
      }
    } catch(_){ }
    // LEVELCHANGE removal (slot 8)
    try {
      if ((state.editor.blockSlot|0) === 8){
        if (typeof map !== 'undefined' && typeof TILE !== 'undefined'){
          const idx = mapIdx(gx, gy);
          if (y === 0){
            if (map[idx] === TILE.LEVELCHANGE){
              map[idx] = TILE.OPEN;
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendTileOps) mpSendTileOps([{ op:'set', gx, gy, v: TILE.OPEN }]); } catch(_){ }
              const key = `${gx},${gy}`;
              try { if (window.portalDestinations instanceof Map) window.portalDestinations.delete(key); } catch(_){ }
              try { if (window.mpSendPortalOps) mpSendPortalOps([{ op:'remove', k:key }]); } catch(_){ }
              if (typeof showTopNotification === 'function') showTopNotification('Portal removed');
              return true;
            }
          } else {
            // Elevated portal removal (t:5)
            let spans = __getSpans(gx,gy);
            const before = spans.length;
            spans = spans.filter(s=>!(s && ((s.b|0)===y) && (((s.t|0)||0)===5)));
            if (spans.length !== before){
              __setSpans(gx,gy,spans);
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'remove', key:`${gx},${gy},${y}`, t: 5 }]); } } catch(_){ }
              if (typeof showTopNotification === 'function') showTopNotification('Elevated portal removed');
              return true;
            }
          }
        }
        return false;
      }
    } catch(_){ }
    // HALF removal (slot 5)
    try {
      if ((state.editor.blockSlot|0) === 5){
        if (y === 0){
          if (typeof map !== 'undefined' && typeof TILE !== 'undefined'){
            const idx = mapIdx(gx, gy);
            if (map[idx] === TILE.HALF){
              map[idx] = TILE.OPEN;
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendTileOps) mpSendTileOps([{ op:'set', gx, gy, v: TILE.OPEN }]); } catch(_){ }
              return true;
            }
          }
          return false;
        } else {
          // Elevated half-slab removal: spans encoded as { b:y, h:0.5 }
          let spans = __getSpans(gx,gy);
          if (!spans || !spans.length) return false;
          let changed = false; const out = [];
          for (const s of spans){
            if (!s){ continue; }
            const sb = s.b|0; const sh = (typeof s.h === 'number') ? s.h : (s.h|0);
            if (sh < 1 && Math.abs(sh - 0.5) < 1e-6 && sb === y){ changed = true; continue; }
            out.push(s);
          }
          if (!changed) return false;
          out.sort((p,q)=> (p.b|0) - (q.b|0));
          __setSpans(gx,gy,out.map(s=>({ b:(s.b|0), h: (typeof s.h==='number')? s.h : (s.h|0), ...( ((s.t|0)===1)?{t:1}:((s.t|0)===2?{t:2}:((s.t|0)===3?{t:3}:((s.t|0)===4?{t:4}:{}) )) ) })));
          try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
          try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'remove', key:`${gx},${gy},${y}`, t: 4 }]); } } catch(_){ }
          return true;
        }
      }
    } catch(_){ }
    // NOCLIMB removal (slot 9)
    try {
      if ((state.editor.blockSlot|0) === 9){
        if (y === 0){
          if (typeof map !== 'undefined' && typeof TILE !== 'undefined'){
            const idx = mapIdx(gx, gy);
            if (map[idx] === TILE.NOCLIMB){
              map[idx] = TILE.OPEN;
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendTileOps) mpSendTileOps([{ op:'set', gx, gy, v: TILE.OPEN }]); } catch(_){ }
              return true;
            }
          }
          return false;
        } else {
          // Elevated NOCLIMB removal: carve one layer from any span with t:9 covering y
          let spans = __getSpans(gx,gy);
          let changed=false; const out=[];
          for (const s of spans){
            if (!s){ continue; }
            const b=s.b|0, h=(Number(s.h)||0), t=(s.t|0)||0; const top=b+h-1;
            if (t!==9 || y < b || y > top){ out.push(s); continue; }
            changed=true;
            if (h===1){ /* drop */ }
            else if (y===b){ out.push({ b:b+1, h:h-1, t:9 }); }
            else if (y===top){ out.push({ b:b, h:h-1, t:9 }); }
            else { const h1=y-b, h2=top-y; if (h1>0) out.push({ b:b, h:h1, t:9 }); if (h2>0) out.push({ b:y+1, h:h2, t:9 }); }
          }
          if (!changed) return false;
          out.sort((p,q)=>p.b-q.b);
          __setSpans(gx,gy,out);
          try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
          try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'remove', key:`${gx},${gy},${y}`, t: 9 }]); } } catch(_){ }
          return true;
        }
      }
    } catch(_){ }
    // FENCE removal (slot 6)
    try {
      if ((state.editor.blockSlot|0) === 6){
        if (typeof map !== 'undefined' && typeof TILE !== 'undefined'){
          if (y === 0){
            const idx = mapIdx(gx, gy);
            if (map[idx] === TILE.FENCE){
              map[idx] = TILE.OPEN;
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendTileOps) mpSendTileOps([{ op:'set', gx, gy, v: TILE.OPEN }]); } catch(_){ }
              return true;
            }
            return false;
          } else {
            let spans = __getSpans(gx,gy);
            let changed=false; const out=[];
            for (const s of spans){
              if (!s){ continue; }
              const b=s.b|0, h=(Number(s.h)||0), t=(s.t|0)||0; const top=b+h-1;
              if (t!==2 || y < b || y > top){ out.push(s); continue; }
              changed=true;
              if (h===1){ /* drop */ }
              else if (y===b){ out.push({ b:b+1, h:h-1, t:2 }); }
              else if (y===top){ out.push({ b:b, h:h-1, t:2 }); }
              else { const h1=y-b, h2=top-y; if (h1>0) out.push({ b:b, h:h1, t:2 }); if (h2>0) out.push({ b:y+1, h:h2, t:2 }); }
            }
            if (!changed) return false;
            out.sort((p,q)=>p.b-q.b);
            __setSpans(gx,gy,out);
            try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
            try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'remove', key:`${gx},${gy},${y}`, t: 2 }]); } } catch(_){ }
            return true;
          }
        }
        return false;
      }
    } catch(_){ }
    // BADFENCE removal (slot 7)
    try {
      if ((state.editor.blockSlot|0) === 7){
        if (typeof map !== 'undefined' && typeof TILE !== 'undefined'){
          if (y === 0){
            const idx = mapIdx(gx, gy);
            if (map[idx] === TILE.BADFENCE){
              map[idx] = TILE.OPEN;
              try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
              try { if (window.mpSendTileOps) mpSendTileOps([{ op:'set', gx, gy, v: TILE.OPEN }]); } catch(_){ }
              return true;
            }
            return false;
          } else {
            let spans = __getSpans(gx,gy);
            let changed=false; const out=[];
            for (const s of spans){
              if (!s){ continue; }
              const b=s.b|0, h=(Number(s.h)||0), t=(s.t|0)||0; const top=b+h-1;
              if (t!==3 || y < b || y > top){ out.push(s); continue; }
              changed=true;
              if (h===1){ /* drop */ }
              else if (y===b){ out.push({ b:b+1, h:h-1, t:3 }); }
              else if (y===top){ out.push({ b:b, h:h-1, t:3 }); }
              else { const h1=y-b, h2=top-y; if (h1>0) out.push({ b:b, h:h1, t:3 }); if (h2>0) out.push({ b:y+1, h:h2, t:3 }); }
            }
            if (!changed) return false;
            out.sort((p,q)=>p.b-q.b);
            __setSpans(gx,gy,out);
            try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
            try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'remove', key:`${gx},${gy},${y}`, t: 3 }]); } } catch(_){ }
            return true;
          }
        }
        return false;
      }
    } catch(_){ }
    // Default: remove one layer of a generic span
    {
      let spans = __getSpans(gx,gy);
      let changed=false; const out=[];
      for (const s of spans){
        if (!s){ continue; }
        const b=s.b|0, h=(Number(s.h)||0); const top=b+h-1;
        if (y < b || y > top){ out.push(s); continue; }
        changed=true;
        if (h===1){ /* drop */ }
        else if (y===b){ out.push({ b:b+1, h:h-1, ...( ((s.t|0)===1)?{t:1}:{} ) }); }
        else if (y===top){ out.push({ b:b, h:h-1, ...( ((s.t|0)===1)?{t:1}:{} ) }); }
        else { const h1=y-b, h2=top-y; if (h1>0) out.push({ b:b, h:h1, ...( ((s.t|0)===1)?{t:1}:{} ) }); if (h2>0) out.push({ b:y+1, h:h2, ...( ((s.t|0)===1)?{t:1}:{} ) }); }
      }
      if (!changed) return false;
      out.sort((p,q)=>p.b-q.b);
      __setSpans(gx,gy,out);
      try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){ }
      try { if (window.mpSendMapOps){ mpSendMapOps([{ op:'remove', key:`${gx},${gy},${y}` }]); } } catch(_){ }
      return true;
    }
  }

  // FPS input handler (noclip fly and look)
  function handleEditorInput(dt){
    if (state.editor.mode !== 'fps' || state.editor.modalOpen) return;
    const e = state.editor.fps;
    const keys = state.inputs.keys;
    // WASD / arrows
    let fwd = 0, strafe = 0;
    if (keys.has('w') || keys.has('ArrowUp')) fwd += 1;
    if (keys.has('s') || keys.has('ArrowDown')) fwd -= 1;
    if (keys.has('a') || keys.has('ArrowLeft')) strafe -= 1;
    if (keys.has('d') || keys.has('ArrowRight')) strafe += 1;
    // Vertical: space up, ctrl down
    let up = 0;
    if (keys.has('space')) up += 1;
    if (keys.has('Control') || keys.has('control')) up -= 1;
    // Speed modifiers
    const boost = (keys.has('shift') || keys.has('Shift')) ? 2.0 : 1.0;
    const sp = (e.moveSpeed || 6.0) * boost;
    // Move relative to yaw (ignore pitch for horizontal plane)
    const yaw = e.yaw;
    const dirX = Math.sin(yaw);
    const dirZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = Math.sin(yaw);
    const velX = (dirX * fwd + rightX * strafe) * sp * dt;
    const velZ = (dirZ * fwd + rightZ * strafe) * sp * dt;
    const velY = up * sp * dt;
    e.x += velX; e.z += velZ; e.y = Math.max(0.1, e.y + velY);
  }

  // Mouse look while pointer-locked
  function onEditorMouseMove(ev){
    if (state.editor.mode !== 'fps' || state.editor.modalOpen) return;
    if (document.pointerLockElement !== CANVAS) return;
    const e = state.editor.fps;
    const sens = 0.0025;
    e.yaw += (ev.movementX || 0) * sens;
    e.pitch -= (ev.movementY || 0) * sens;
    const lim = Math.PI/2 - 0.01;
    if (e.pitch >  lim) e.pitch =  lim;
    if (e.pitch < -lim) e.pitch = -lim;
  }
  window.addEventListener('mousemove', onEditorMouseMove);

  // Safe-exit on Escape while editor is active
  window.addEventListener('keydown', (e)=>{
    if (e.key !== 'Escape') return;
    if (state.editor.mode !== 'fps') return;
    e.preventDefault();
    e.stopPropagation();
    // Close modal if open, then fully exit editor and free mouse
    try { if (state.editor.modalOpen) closeEditorModal(); } catch(_){ }
    try { exitEditor(); } catch(_){ }
    // Return focus to canvas for consistency
    setTimeout(()=>{ try { if (CANVAS && CANVAS.focus) CANVAS.focus(); } catch(_){ } }, 0);
  }, true);

  // Exit editor and restore gameplay
  function exitEditor(){
    state.editor.mode = 'none';
    state.editor.modalOpen = false;
    state._hidePlayer = false;
    // Close and clear any open editor modal UI
    try {
      const root = document.getElementById('mz-editor-modal-root');
      if (root){ root.innerHTML = ''; root.style.pointerEvents = 'none'; }
    } catch(_){ }
    // Clear lingering inputs so movement doesn't stick after exiting
    try { state.inputs.keys.clear(); } catch(_){ }
    try { state.editor.preview = []; } catch(_){}
    try { const c = document.getElementById('editor-crosshair'); if (c) c.style.display = 'none'; } catch(_){}
    try { if (document.pointerLockElement === CANVAS && document.exitPointerLock) document.exitPointerLock(); } catch(_){}
  try { const bt=document.getElementById('mz-editor-blockbar'); if (bt) bt.remove(); } catch(_){ }
  }

  // Mouse buttons while in editor:
  // - Left (0): place a single block at visor if absent
  // - Middle (1): open modal (release pointer lock first)
  // - Right (2): remove a single block at visor if present
  CANVAS.addEventListener('mousedown', (ev)=>{
    if (state.editor.mode !== 'fps') return;
    if (state.editor.modalOpen) return;
    // Item placement modes (slot 3 = payload item, slot 4 = purple collectible)
    if (ev.button === 0){
      if (state.editor.blockSlot === 3){
        try {
          const vs = state.editor.visor; if (!vs || vs.gx < 0) return;
          const worldX = (vs.gx - MAP_W*0.5 + 0.5);
          const worldZ = (vs.gy - MAP_H*0.5 + 0.5);
          const worldY = (vs.base|0) + 0.75; // float a bit above base
          let defPayload = (window._lastEditorItemPayload)||'';
          const payload = window.prompt('Enter item payload string:', defPayload) || '';
          if (!payload.trim()) { showTopNotification && showTopNotification('Item cancelled (empty payload)'); ev.preventDefault(); return; }
          window._lastEditorItemPayload = payload.trim();
          if (typeof spawnItemWorld === 'function') spawnItemWorld(worldX, worldY, worldZ, payload.trim());
          // Network persist
          try { if (window.mpSendItemOps) mpSendItemOps([{ op:'add', gx: vs.gx, gy: vs.gy, y: worldY, kind:0, payload: payload.trim() }]); } catch(_){ }
          // Track for export (grid coords + payload + world y)
          if (!window._editorPlacedItems) window._editorPlacedItems = [];
          window._editorPlacedItems.push({ gx: vs.gx, gy: vs.gy, payload: payload.trim(), yWorld: worldY });
          if (typeof showTopNotification === 'function') showTopNotification('Item placed: ' + payload.trim());
        } catch(_){ }
        ev.preventDefault();
        return;
      } else if (state.editor.blockSlot === 4){
        try {
          const vs = state.editor.visor; if (!vs || vs.gx < 0) return;
          const worldX = (vs.gx - MAP_W*0.5 + 0.5);
          const worldZ = (vs.gy - MAP_H*0.5 + 0.5);
          const worldY = (vs.base|0) + 0.75;
          if (typeof spawnPurpleItemWorld === 'function') spawnPurpleItemWorld(worldX, worldY, worldZ);
          if (!window._editorPlacedPurpleItems) window._editorPlacedPurpleItems = [];
          window._editorPlacedPurpleItems.push({ gx: vs.gx, gy: vs.gy, yWorld: worldY });
          if (typeof showTopNotification === 'function') showTopNotification('Purple item placed');
          try { if (window.mpSendItemOps) mpSendItemOps([{ op:'add', gx: vs.gx, gy: vs.gy, y: worldY, kind:1 }]); } catch(_){ }
        } catch(_){ }
        ev.preventDefault();
        return;
      }
      addBlockAtVisor(); ev.preventDefault(); return;
    }
    if (ev.button === 1){ if (document.pointerLockElement === CANVAS){ if (document.exitPointerLock) document.exitPointerLock(); } openEditorModal(); ev.preventDefault(); return; }
    if (ev.button === 2){
      if (state.editor.blockSlot === 3 || state.editor.blockSlot === 4){
        // Remove item(s) at visor grid cell (by world X/Z match tolerance)
        try {
          const vs = state.editor.visor; if (vs && vs.gx>=0){
            const wx = (vs.gx - MAP_W*0.5 + 0.5);
            const wz = (vs.gy - MAP_H*0.5 + 0.5);
            if (typeof removeItemsAtWorld === 'function'){
              const removed = removeItemsAtWorld(wx, wz);
              if (removed>0 && typeof showTopNotification === 'function') showTopNotification('Removed ' + removed + ' item'+(removed>1?'s':'')+' at cell');
            }
            // Also prune from editor placed list
            if (Array.isArray(window._editorPlacedItems)){
              window._editorPlacedItems = window._editorPlacedItems.filter(it=> !(it.gx===vs.gx && it.gy===vs.gy));
            }
            if (Array.isArray(window._editorPlacedPurpleItems)){
              window._editorPlacedPurpleItems = window._editorPlacedPurpleItems.filter(it=> !(it.gx===vs.gx && it.gy===vs.gy));
            }
            // Send generic remove ops for both kinds (server will remove matches)
            try { if (window.mpSendItemOps) mpSendItemOps([{ op:'remove', gx: vs.gx, gy: vs.gy, kind:0 }, { op:'remove', gx: vs.gx, gy: vs.gy, kind:1 }]); } catch(_){ }
          }
        } catch(_){ }
        ev.preventDefault();
        return;
      }
      removeBlockAtVisor(); ev.preventDefault(); return; }
  });

  function raycastGridFromEditor(){
    // Raycast from camera through view direction (yaw + pitch), updating visor to match flying height and aim
    const e = state.editor.fps;
  const dirX = Math.sin(e.yaw) * Math.cos(e.pitch);
  const dirY = Math.sin(e.pitch);
  const dirZ = -Math.cos(e.yaw) * Math.cos(e.pitch);
    // Choose target distance along the ray, but keep old DDA stepping as fallback to keep last-in-bounds cell
    const targetDist = Math.max(0.01, Math.min(60.0, (state.editor.visorDist || 6.0)));
    // DDA-ish stepping, small step for stable selection
    let t=0, hitGX=-1, hitGY=-1, hitBase=0;
    const maxT = Math.min(60.0, targetDist + 8.0); // allow a bit beyond target for stability
    const step = 0.075;
    let bestAtTarget = null;
    for (; t<maxT; t+=step){
      const wx = e.x + dirX * t;
      const wy = e.y + dirY * t;
      const wz = e.z + dirZ * t;
      const gx = Math.floor(wx + MAP_W*0.5);
      const gy = Math.floor(wz + MAP_H*0.5);
      if (gx<0||gy<0||gx>=MAP_W||gy>=MAP_H) break;
      // Track the sample closest to the requested distance
      const distErr = Math.abs(t - targetDist);
      if (!bestAtTarget || distErr < bestAtTarget.err){ bestAtTarget = { gx, gy, base: Math.max(0, Math.floor(wy)), err: distErr }; }
      hitGX = gx; hitGY = gy; hitBase = Math.max(0, Math.floor(wy));
    }
    let outGX, outGY, outBase;
    if (bestAtTarget){ outGX = bestAtTarget.gx; outGY = bestAtTarget.gy; outBase = bestAtTarget.base; }
    else if (hitGX >= 0){ outGX = hitGX; outGY = hitGY; outBase = hitBase; }
    else {
      // If we didn’t hit anything in range, fallback to camera cell and base per camera height
      outGX = Math.floor(e.x + MAP_W*0.5);
      outGY = Math.floor(e.z + MAP_H*0.5);
      outBase = Math.max(0, Math.floor(e.y));
    }
    state.editor.visor = { gx: outGX, gy: outGY, yCenter: outBase + 0.5, base: outBase, height: 1 };
  }

  // Modal builder
  function openEditorModal(){
  // Only allow opening when BASE block type (slot 1) is selected
  try {
    const slot = (state && state.editor) ? ((state.editor.blockSlot|0) || 0) : 0;
    const set = (state && state.editor) ? (state.editor.blockSet || 'A') : 'A';
    // Require Set A and slot 1 (BASE). If Set B is active (Lock) or any other slot, block modal.
    if (slot !== 1 || set !== 'A'){
      if (typeof showTopNotification === 'function') showTopNotification('Structure Builder requires BASE (1) selected');
      // Do not auto re-lock pointer; modal opens only when explicitly requested
      return; // do not open modal
    }
  } catch(_){ /* fail safe: if state is odd, fall through and allow default behavior */ }
  state.editor.mode = 'fps';
    state.snapTopFull = false; state.snapBottomFull = false; // keep split by default
    const EDITOR_TOGGLE = document.getElementById('editor-toggle');
    if (EDITOR_TOGGLE){
      EDITOR_TOGGLE.setAttribute('aria-pressed','true');
      EDITOR_TOGGLE.textContent = 'Editor: FPS';
      // Avoid keeping focus on the button so Space doesn't trigger it again
      try { EDITOR_TOGGLE.blur(); } catch(_){ }
    }
  state.editor.modalOpen = true;
    // Seed camera from player
    const p = state.player; const e = state.editor.fps;
    e.x = p.x; e.y = Math.max(0.6, p.y + 1.8); e.z = p.z; e.yaw = p.angle; e.pitch = 0;
    // Hide player while editing
    state._hidePlayer = true;
    // Ensure keyboard focus goes to the canvas
    try { CANVAS.focus(); } catch(_){ }
    // Clear any lingering inputs to avoid stuck movement upon transition
    try { state.inputs.keys.clear(); } catch(_){ }
    // Show crosshair
  try { const c = document.getElementById('editor-crosshair'); if (c) c.style.display = 'none'; } catch(_){ }

  // Build modal DOM (bottom-center, non-blocking overlay)
  const root = ensureRoot();
  try { root.style.pointerEvents = 'auto'; } catch(_){ }
  const panel = document.createElement('div');
  panel.style.position = 'fixed';
  panel.style.left = '50%';
  panel.style.bottom = '16px';
  panel.style.transform = 'translateX(-50%)';
  panel.style.minWidth = '260px';
  panel.style.maxWidth = '80vw';
  panel.style.padding = '16px';
  panel.style.background = 'rgba(0,0,0,0.69)';
  panel.style.border = '2px solid #ffffff';
  panel.style.borderRadius = '0';
  panel.style.fontFamily = "'DEGRADE', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
  panel.style.fontSize = '14px';
  panel.style.zIndex = '2000';
  panel.style.pointerEvents = 'auto';
  const title = document.createElement('div');
  title.textContent = 'Structure Builder';
  title.style.fontWeight = '700';
  title.style.margin = '0 0 8px 0';
  const form = document.createElement('div');
  form.style.display = 'grid';
  form.style.gridTemplateColumns = '1fr 1fr';
  form.style.gap = '6px 8px';

    function addField(label, input){
      const L = document.createElement('label'); L.textContent = label; L.style.opacity='0.85';
      form.appendChild(L); form.appendChild(input);
    }
  const fDir = document.createElement('select'); ['N','E','S','W'].forEach(d=>{ const o=document.createElement('option'); o.value=d; o.textContent=d; fDir.appendChild(o); });
  // Origin controls (grid coordinates)
  const fGX = document.createElement('input'); fGX.type='number'; fGX.value=String((state.editor.visor.gx|0)); fGX.min='0'; fGX.max=String(MAP_W-1);
  const fGY = document.createElement('input'); fGY.type='number'; fGY.value=String((state.editor.visor.gy|0)); fGY.min='0'; fGY.max=String(MAP_H-1);
    const fType = document.createElement('select'); ['Fill Rect','Outline Rect','Pillar(s)','Carve Remove'].forEach((t,i)=>{ const o=document.createElement('option'); o.value=String(i); o.textContent=t; fType.appendChild(o); });
    const fW = document.createElement('input'); fW.type='number'; fW.value='1'; fW.min='1';
    const fH = document.createElement('input'); fH.type='number'; fH.value='1'; fH.min='1';
    const fY = document.createElement('input'); fY.type='number'; fY.value=String(state.editor.visor.base|0);
    const fHeight = document.createElement('input'); fHeight.type='number'; fHeight.value='1'; fHeight.min='1';
  addField('Origin X', fGX);
  addField('Origin Y', fGY);
  addField('Direction', fDir);
    addField('Type', fType);
    addField('Width (tiles)', fW);
    addField('Height (tiles)', fH);
    addField('Base Y', fY);
    addField('Column Height', fHeight);
  const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='8px'; btnRow.style.padding='10px 12px'; btnRow.style.borderTop='1px solid #2a3a4a';
    const btnSave = document.createElement('button'); btnSave.textContent='Save'; btnSave.style.padding='6px 10px';
  const btnCancel = document.createElement('button'); btnCancel.textContent='Cancel'; btnCancel.style.padding='6px 10px';
  const btnQuit = document.createElement('button'); btnQuit.textContent='Quit FPS'; btnQuit.style.padding='6px 10px'; btnQuit.style.marginLeft='auto';
  btnRow.appendChild(btnSave); btnRow.appendChild(btnCancel); btnRow.appendChild(btnQuit);
  panel.appendChild(title); panel.appendChild(form); panel.appendChild(btnRow);
  root.appendChild(panel);

    function clampInt(v, lo, hi){ v|=0; if (v<lo) v=lo; if (v>hi) v=hi; return v; }
    function updatePreview(){
      // Build preview using forward/right basis so all directions behave consistently and origin can be adjusted.
      const gx0 = clampInt(parseInt(fGX.value||'0',10), 0, MAP_W-1);
      const gy0 = clampInt(parseInt(fGY.value||'0',10), 0, MAP_H-1);
      // Keep fields clamped in UI too
      fGX.value = String(gx0); fGY.value = String(gy0);
      const w = Math.max(1, parseInt(fW.value||'1',10));
      const h = Math.max(1, parseInt(fH.value||'1',10));
      const dir = (fDir.value || 'N');
      const base = parseInt(fY.value||'0',10)|0;
      const ch = Math.max(1, parseInt(fHeight.value||'1',10)|0);
  // Lock top camera target roughly to this origin/base for better preview
  state.editor.modalOrigin = { gx: gx0, gy: gy0, base };
      // Forward vector f (gx,gy) and right vector r (perpendicular, clockwise)
      let fx=0, fy=-1; // N default
      if (dir==='E'){ fx=1; fy=0; }
      else if (dir==='S'){ fx=0; fy=1; }
      else if (dir==='W'){ fx=-1; fy=0; }
      const rx = -fy, ry = fx; // right = rotate forward +90°
      const pts = [];
      for (let j=0; j<h; j++){
        for (let i=0; i<w; i++){
          const gx = gx0 + rx*i + fx*j;
          const gy = gy0 + ry*i + fy*j;
          if (gx>=0 && gy>=0 && gx<MAP_W && gy<MAP_H){ pts.push({ gx, gy, b: base, h: ch }); }
        }
      }
      state.editor.preview = pts;
    }
  fGX.addEventListener('input', updatePreview);
  fGY.addEventListener('input', updatePreview);
  fDir.addEventListener('change', updatePreview);
    fW.addEventListener('input', updatePreview);
    fH.addEventListener('input', updatePreview);
    fY.addEventListener('input', updatePreview);
    fHeight.addEventListener('input', updatePreview);
    updatePreview();

    btnSave.addEventListener('click', ()=>{
      applyStructureFromForm();
      rebuildInstances && rebuildInstances();
      closeEditorModal();
      // Do not auto-lock pointer; user explicitly resumes by clicking canvas or middle-clicking for modal
      // After applying structure, send aggregated ops for preview spans (each block)
      try {
        if (window.mpSendMapOps){
          const pts = (state.editor.preview||[]).slice();
          const ops = [];
          const isBad = (state.editor.blockSlot === 2);
          for (const it of pts){
            for (let dy=0; dy<(it.h|0); dy++){
              ops.push({ op:'add', key:`${it.gx},${it.gy},${(it.b|0)+dy}`, t: isBad?1:0 });
            }
          }
          if (ops.length) mpSendMapOps(ops);
        }
      } catch(_){ }
    });
    btnCancel.addEventListener('click', ()=>{
      // Close the modal and return to FPS mode without saving
      closeEditorModal();
      // Do not auto-lock pointer
    });
    btnQuit.addEventListener('click', ()=>{ closeEditorModal(); exitEditor(); });

    // Hide visor while editing
    try { state.editor._hideVisorWhileEditing = true; } catch(_){}

  // Optional: could add a small drag handle on the panel header if needed
  }

  function closeEditorModal(){
    const root = document.getElementById(rootId);
    if (root) root.innerHTML = '';
  try { if (root) root.style.pointerEvents = 'none'; } catch(_){ }
    state.editor.modalOpen = false;
  // Restore visor drawing
  try { state.editor._hideVisorWhileEditing = false; } catch(_){}
  }

  function applyStructureFromForm(){
    // Use column API to add spans for preview set
    const pts = state.editor.preview || [];
    const isBad = (state.editor.blockSlot === 2);
    for (const it of pts){
      const key = `${it.gx},${it.gy}`;
      let spans = (window.columnSpans.get(key) || []).map(s=>({ b:s.b|0, h:s.h|0, t: ((s.t|0)||0) }));
      const newT = isBad ? 1 : 0;
      const nb = it.b|0; const nh = it.h|0; if (!(nh>0)) continue;
      // Split out overlaps of different type
      const out=[]; const nStart=nb, nEnd=nb+nh;
      for (const s of spans){
        const sT=(s.t|0)||0; const sStart=s.b, sEnd=s.b+s.h;
        if (sT===newT){ out.push(s); continue; }
        const overlapStart = Math.max(sStart, nStart);
        const overlapEnd   = Math.min(sEnd, nEnd);
        if (overlapEnd <= overlapStart){ out.push(s); continue; }
        if (overlapStart - sStart > 0){ out.push({ b:sStart, h: overlapStart - sStart, ...(sT?{t:sT}:{}) }); }
        if (sEnd - overlapEnd > 0){ out.push({ b:overlapEnd, h: sEnd - overlapEnd, ...(sT?{t:sT}:{}) }); }
      }
      spans = out;
      // Insert new span
      spans.push(newT? { b: nb, h: nh, t: newT } : { b: nb, h: nh });
      // Merge same-type adjacency
      spans.sort((a,b)=> (a.b-b.b) || (((a.t|0)||0)-((b.t|0)||0)) );
      const merged=[];
      for (const s of spans){
        if (!merged.length){ merged.push({ ...s }); continue; }
        const t = merged[merged.length-1];
        const sT=(s.t|0)||0, tT=(t.t|0)||0;
        if (sT===tT && s.b <= t.b + t.h){ const top=Math.max(t.b+t.h, s.b+s.h); t.h = top - t.b; } else { merged.push({ ...s }); }
      }
      const norm = merged
        .filter(s=>s && (s.h|0)>0)
        .map(s=>{ const tt=((s.t|0)||0); const o={ b:(s.b|0), h:(s.h|0) }; if (tt===1||tt===2||tt===3||tt===4||tt===5||tt===6||tt===9) o.t=tt; return o; });
      window.setSpansAt(it.gx, it.gy, norm);
      // Also set ground tile if base==0 to WALL for visibility
      if ((it.b|0) === 0 && typeof map !== 'undefined' && typeof TILE !== 'undefined'){
        const idx = mapIdx(it.gx, it.gy); map[idx] = isBad ? TILE.BAD : TILE.WALL;
      }
    }
  }

  // Drawing helpers used by pipelines/bootstrap
  function drawEditorVisorAndPreview(mvp){
    if (state.editor.mode !== 'fps') return;
    // Ensure these wireframes are always on top
    const prevDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    const prevBlend = gl.isEnabled(gl.BLEND);
    const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
    if (prevDepthTest) gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    // Visor cube wireframe at targeted cell
  const vs = state.editor.visor; if (!state.editor._hideVisorWhileEditing && vs && vs.gx>=0){
      const cx = (vs.gx - MAP_W*0.5 + 0.5);
      const cz = (vs.gy - MAP_H*0.5 + 0.5);
      const y = (vs.base|0) + 0.5;

      // Check if a block already exists at this grid cell and base Y
      let occupied = false;
      try {
        const key = `${vs.gx},${vs.gy}`;
        const spans = (window.columnSpans.get(key) || []);
        for (const s of spans){ const b=s.b|0, h=s.h|0; if ((vs.base|0) >= b && (vs.base|0) < b+h){ occupied = true; break; } }
      } catch(_){ occupied = false; }

      // If occupied, draw a soft translucent white fill as a highlight
      try {
        if (occupied && typeof window._drawSolidCubeOnceForEditor === 'function'){
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          window._drawSolidCubeOnceForEditor(mvp, vs.gx, vs.gy, (vs.base|0), 1, [1,1,1], 0.30);
        }
      } catch(_){ }
      gl.useProgram(trailCubeProgram);
      gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
      gl.uniform1f(tc_u_scale, 1.0);
      gl.uniform1f(tc_u_now, state.nowSec || (performance.now()/1000));
      gl.uniform1f(tc_u_ttl, 1.0);
      gl.uniform1i(tc_u_dashMode, 0);
      // Dynamic visor outline alpha using same camera fade logic as preview stacks
      let visorAlpha = 0.9;
      try {
        if (state && state.camera) {
          const camY = state.camera.position ? state.camera.position[1] : state.camera.y || 0;
          // Map camera Y (0-64) to fade (1 -> 0.25)
          const t = Math.min(1, Math.max(0, camY / 64));
          visorAlpha = 0.9 * (0.25 + 0.75 * (1 - t));
        }
      } catch(_){ }
      gl.uniform1f(tc_u_mulAlpha, visorAlpha);
      gl.uniform3f(tc_u_lineColor, 1.0, 0.9, 0.2);
      if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 0);
      gl.bindVertexArray(trailCubeVAO);
      // Per-instance corners for single visor outline: jitter on top view, zeros on bottom
      if (typeof trailCubeVBO_Corners !== 'undefined'){
        if (state.cameraKindCurrent === 'top' && typeof getTrailCornerOffsetsBuffer === 'function'){
          const packed = getTrailCornerOffsetsBuffer([`editor@${vs.gx},${vs.gy},${y.toFixed(2)}`], state.nowSec || (performance.now()/1000));
          gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
          gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
        } else {
          const zeros = new Float32Array(8 * 3);
          gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
          gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
        }
      }
      // axis buffer for 1 instance
      if (typeof trailCubeVBO_Axis !== 'undefined' && trailCubeVBO_Axis){
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3), gl.DYNAMIC_DRAW);
      }
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); // default additive for visor (not for lock blocks)
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
      const tNow = state.nowSec || (performance.now()/1000);
      // Single pass for visor (thickness jitter not critical and reduces over-brightness)
      const instOne = new Float32Array([cx, y, cz, tNow]);
      gl.bufferData(gl.ARRAY_BUFFER, instOne, gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.LINES, 0, 24, 1);
      // leave blend enabled for previews, restore after
      gl.bindVertexArray(null);

      // If empty, add slim collision-aware guide lines along visor edges for better 3D localization
      if (!occupied && typeof fxLinesProgram !== 'undefined' && fxLinesProgram && typeof fxLinesVAO !== 'undefined'){
        try {
          gl.useProgram(fxLinesProgram);
          gl.uniformMatrix4fv(fxl_u_mvp, false, mvp);
          gl.uniform1f(fxl_u_now, state.nowSec || (performance.now()/1000));
          gl.uniform1f(fxl_u_speed, 0.0);
          gl.uniform1f(fxl_u_rotSpeed, 0.0);
          gl.uniform1f(fxl_u_mulAlpha, 0.85);
          gl.bindVertexArray(fxLinesVAO);
          const ttl = 1e6;  // very long TTL so alpha ~1
          const spawnT = state.nowSec || (performance.now()/1000);
          const ox=cx, oy=y, oz=cz;
          const edges = [];
          const maxLen = 200.0;
          const ttlPer = ttl;
          // Helper to add a one-sided segment along axis with color
          const addSegment = (px,py,pz, axis, len, col)=>{
            // Orient along axis (edge), drift dir unused, spin zero
            // Shift origin by +len/2 along axis to make segment from midpoint -> +axis
            const ox2 = px + axis[0]*(len*0.5);
            const oy2 = py + axis[1]*(len*0.5);
            const oz2 = pz + axis[2]*(len*0.5);
            edges.push(
              ox2,oy2,oz2,spawnT,   0,0,0,   axis[0],axis[1],axis[2],   0,0,0,   len,ttlPer,   col[0],col[1],col[2]
            );
          };
          // For each of the 12 cube edges, cast in +axis and -axis and add segments with RGB coloring by axis
          // X-axis edges
          for (let sy of [-0.5, 0.5]) for (let sz of [-0.5, 0.5]){
            const ex = ox, ey = oy+sy, ez = oz+sz;
            const plus = __castDistance(ex, ey, ez, 1,0,0, maxLen);
            const minus = __castDistance(ex, ey, ez, -1,0,0, maxLen);
            if (plus>1e-3) addSegment(ex,ey,ez, [1,0,0], plus, [1.0,0.25,0.25]);
            if (minus>1e-3) addSegment(ex,ey,ez, [-1,0,0], minus, [1.0,0.25,0.25]);
          }
          // Y-axis edges
          for (let sx of [-0.5, 0.5]) for (let sz of [-0.5, 0.5]){
            const ex = ox+sx, ey = oy, ez = oz+sz;
            const plus = __castDistance(ex, ey, ez, 0,1,0, maxLen);
            const minus = __castDistance(ex, ey, ez, 0,-1,0, maxLen);
            if (plus>1e-3) addSegment(ex,ey,ez, [0,1,0], plus, [0.25,1.0,0.25]);
            if (minus>1e-3) addSegment(ex,ey,ez, [0,-1,0], minus, [0.25,1.0,0.25]);
          }
          // Z-axis edges
          for (let sx of [-0.5, 0.5]) for (let sy of [-0.5, 0.5]){
            const ex = ox+sx, ey = oy+sy, ez = oz;
            const plus = __castDistance(ex, ey, ez, 0,0,1, maxLen);
            const minus = __castDistance(ex, ey, ez, 0,0,-1, maxLen);
            if (plus>1e-3) addSegment(ex,ey,ez, [0,0,1], plus, [0.25,0.45,1.0]);
            if (minus>1e-3) addSegment(ex,ey,ez, [0,0,-1], minus, [0.25,0.45,1.0]);
          }
          const STRIDE = (4+3+3+3+2+3);
          const N = edges.length / STRIDE;
          const arr = new Float32Array(edges);
          // inst (4)
          const bufInst = new Float32Array(N*4);
          for (let i=0;i<N;i++) for (let k=0;k<4;k++) bufInst[i*4+k] = arr[i*STRIDE + k];
          gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, bufInst, gl.DYNAMIC_DRAW);
          // dir (3) - outward drift dir is unused (speed=0), keep zeros
          const bufDir = new Float32Array(N*3);
          for (let i=0;i<N;i++) for (let k=0;k<3;k++) bufDir[i*3+k] = arr[i*STRIDE + 4 + k];
          gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Dir); gl.bufferData(gl.ARRAY_BUFFER, bufDir, gl.DYNAMIC_DRAW);
          // edge (3) - orientation axis (we use the same axis as direction)
          const bufEdge = new Float32Array(N*3);
          for (let i=0;i<N;i++) for (let k=0;k<3;k++) bufEdge[i*3+k] = arr[i*STRIDE + 7 + k];
          gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Edge); gl.bufferData(gl.ARRAY_BUFFER, bufEdge, gl.DYNAMIC_DRAW);
          // spin (3) zeros
          const bufSpin = new Float32Array(N*3);
          gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Spin); gl.bufferData(gl.ARRAY_BUFFER, bufSpin, gl.DYNAMIC_DRAW);
          // len/ttl (2)
          const bufLenTtl = new Float32Array(N*2);
          for (let i=0;i<N;i++) for (let k=0;k<2;k++) bufLenTtl[i*2+k] = arr[i*STRIDE + 13 + k];
          gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_LenTtl); gl.bufferData(gl.ARRAY_BUFFER, bufLenTtl, gl.DYNAMIC_DRAW);
          // color (3)
          const bufColor = new Float32Array(N*3);
          for (let i=0;i<N;i++) for (let k=0;k<3;k++) bufColor[i*3+k] = arr[i*STRIDE + 15 + k];
          gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Color); gl.bufferData(gl.ARRAY_BUFFER, bufColor, gl.DYNAMIC_DRAW);
          // draw
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.drawArraysInstanced(gl.LINES, 0, 2, N);
          gl.bindVertexArray(null);
        } catch(_){ }
      }
    }
    // Preview stacks as outlines for each voxel height
    const prev = state.editor.preview || [];
    if (prev.length){
      gl.useProgram(trailCubeProgram);
      gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
      gl.uniform1f(tc_u_now, state.nowSec || (performance.now()/1000));
      gl.uniform1i(tc_u_dashMode, 0);
      if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 0);
      gl.bindVertexArray(trailCubeVAO);
      if (typeof trailCubeVBO_Axis !== 'undefined' && trailCubeVBO_Axis){
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(prev.length * 3), gl.DYNAMIC_DRAW);
      }
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  const [baseR, baseG, baseB] = (window.getLevelBaseColorRGB ? window.getLevelBaseColorRGB() : [0.2,0.9,0.9]);
    // Compute camera Y fade factor once: higher camera => lower preview alpha
    let camFade = 1.0; try { if (state && state.camera){ const camY = state.camera.position ? state.camera.position[1] : state.camera.y || 0; const t = Math.min(1, Math.max(0, camY / 64)); camFade = 0.25 + 0.75 * (1 - t); } } catch(_){ }
  for (const it of prev){
        const cx = (it.gx - MAP_W*0.5 + 0.5);
        const cz = (it.gy - MAP_H*0.5 + 0.5);
        for (let level=0; level<it.h; level++){
          const y = (it.b + level) + 0.5;
          gl.uniform1f(tc_u_scale, 1.0);
          gl.uniform1f(tc_u_ttl, 1.0);
          // Determine base alpha; default preview alpha was 0.8. We customize for Lock (t=6) blocks.
          let alphaMul = 0.8;
          // If camera lock mode is active (heuristic: state.camera && state.camera.isLocked or pointer lock?), we dim Locks harder
          let cameraLocked = false;
          try {
            cameraLocked = !!(state && state.camera && (state.camera.isLocked || state.camera.lockMode));
          } catch(_){ }
          // If this cell contains a Lock span at this level, use pastel blue for outlines and custom alpha
          let isLockHere = false;
          let col = [baseR, baseG, baseB];
          try {
            const key = `${it.gx},${it.gy}`; const spans = (window.columnSpans && window.columnSpans.get) ? window.columnSpans.get(key) : null;
            if (Array.isArray(spans)){
              for (const s of spans){ if (!s) continue; const t=((s.t|0)||0), b=(s.b|0), h=(Number(s.h)||0); if (t===6 && h>0 && (it.b+level) >= b && (it.b+level) < b+h){ col = [0.65, 0.80, 1.0]; isLockHere = true; break; } }
            }
          } catch(_){ }
          if (isLockHere){
            // Further dim per user request: "barely even visible" and allow disappearing toward bottom based on camera.
            const restAlpha = (window.__LOCK_OUTLINE_ALPHA_REST !== undefined) ? window.__LOCK_OUTLINE_ALPHA_REST : 0.06; // slightly higher than 0.04 for visibility
            const lockModeAlpha = (window.__LOCK_OUTLINE_ALPHA_LOCK !== undefined) ? window.__LOCK_OUTLINE_ALPHA_LOCK : 0.02;
            // Vertical fade: blocks near bottom (y relative to camera) fade faster when camera looks down.
            let verticalFade = 1.0;
            try {
              if (state && state.camera){
                const camY = state.camera.position ? state.camera.position[1] : state.camera.y || 0;
                const dy = Math.max(0, camY - y); // how far above this block the camera is
                // Fade if camera is more than 4 units above the block; vanish by 24 units difference.
                const vf = 1 - Math.min(1, Math.max(0, (dy - 4) / 20));
                verticalFade *= vf;
                // Additional fade if block is below some world baseline (e.g., y<2)
                if (y < 2) verticalFade *= (y / 2);
              }
            } catch(_){ }
            alphaMul = (cameraLocked ? lockModeAlpha : restAlpha) * camFade * verticalFade;
            col = [0.58, 0.68, 0.82];
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          } else {
            gl.blendFunc(gl.ONE, gl.ONE);
            alphaMul = alphaMul * camFade;
          }
          gl.uniform1f(tc_u_mulAlpha, alphaMul);
          gl.uniform3f(tc_u_lineColor, col[0], col[1], col[2]);
          gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
          const tNow2 = state.nowSec || (performance.now()/1000);
          // Multi-pass jitter for thickness
          const jitter2 = isLockHere ? [ [0,0,0] ] : [ [0,0,0], [0.01,0,0], [-0.01,0,0], [0,0.01,0], [0,-0.01,0] ];
          for (let i=0;i<jitter2.length;i++){
            const j = jitter2[i];
            const instOne = new Float32Array([cx + j[0], y + j[1], cz + j[2], tNow2]);
            gl.bufferData(gl.ARRAY_BUFFER, instOne, gl.DYNAMIC_DRAW);
            gl.drawArraysInstanced(gl.LINES, 0, 24, 1);
          }
        }
      }
      // keep blend state to restore uniformly after
      gl.bindVertexArray(null);
    }
    // Restore GL state
    if (!prevBlend) gl.disable(gl.BLEND);
    gl.depthMask(prevDepthMask);
    if (prevDepthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
  }

  // Expose
  window.onPointerLockChange = onPointerLockChange;
  window.onToggleEditorMode = onToggleEditorMode;
  window.editorHandleInput = handleEditorInput;
  window.editorRaycastVisor = raycastGridFromEditor;
  window.drawEditorVisorAndPreview = drawEditorVisorAndPreview;

  // Block type definitions & UI (BASE + BAD now, rest placeholders)
  function getBaseBlockColor(){
    return (window.getLevelBaseColor && window.getLevelBaseColor()) || '#0fd5db';
  }
  const BLOCK_TYPES = {
    1: { name: 'BASE', get color(){ return getBaseBlockColor(); } },
    2: { name: 'BAD', color: '#d92b2f' },
    3: { name: 'ITEM', color: '#f5d938' },
  4: { name: 'P-ITEM', color: '#b04bff' },
  5: { name: 'HALF', get color(){ return getBaseBlockColor(); } },
  6: { name: 'FENCE', get color(){
      try {
        const c = (window.getLevelWallColorRGB && window.getLevelWallColorRGB()) || [0.06,0.45,0.48];
        const b = [Math.min(1, c[0]*1.35+0.05), Math.min(1, c[1]*1.35+0.05), Math.min(1, c[2]*1.35+0.05)];
        const hex = '#'+b.map(v=>('0'+Math.round(v*255).toString(16)).slice(-2)).join('');
        return hex;
      } catch(_){ return '#9bdfe9'; }
    } },
  7: { name: 'BADFENCE', color: '#d92b2f' },
  8: { name: 'LEVELCHANGE', color: '#ff8c2b' },
  9: { name: 'NOCLIMB', color: '#777777' },
  };
  function ensureBlockTypeBar(){
    if (state.editor.mode !== 'fps') return;
    let bar = document.getElementById('mz-editor-blockbar');
    if (!bar){
      bar = document.createElement('div');
      bar.id = 'mz-editor-blockbar';
      bar.style.position='fixed';
      bar.style.top='10px';
      bar.style.left='50%';
      bar.style.transform='translateX(-50%)';
      bar.style.display='flex';
      bar.style.gap='6px';
      bar.style.padding='6px 10px';
  bar.style.background='rgba(0,0,0,0.69)';
  bar.style.border='2px solid #ffffff';
  bar.style.borderRadius='0';
  bar.style.fontFamily="'DEGRADE', system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
  bar.style.fontSize='14px';
      bar.style.zIndex='2500';
      bar.style.pointerEvents='none';
      document.body.appendChild(bar);
    }
    updateBlockTypeBar();
  }
  function updateBlockTypeBar(){
    const bar = document.getElementById('mz-editor-blockbar'); if (!bar) return;
    const active = state.editor.blockSlot|0;
    const set = state.editor.blockSet || 'A';
    bar.innerHTML='';
    for (let i=1;i<=9;i++){
      const el = document.createElement('div');
      el.style.width='22px';
      el.style.height='22px';
      el.style.boxSizing='border-box';
      el.style.borderRadius='4px';
      el.style.transition='background 0.15s, opacity 0.15s, border-color 0.15s';
      if (set === 'B'){
        const lockHex = '#a6c9ff';
        const isLock = (i===1);
        el.setAttribute('aria-label', 'Slot ' + i + ' ' + (isLock ? 'Lock' : 'Empty'));
        el.style.border = '2px solid ' + (isLock ? lockHex : 'rgba(255,255,255,0.25)');
        el.style.background = (isLock && i===active) ? lockHex : 'transparent';
        el.style.opacity = isLock ? '1' : '0.25';
      } else {
        const info = BLOCK_TYPES[i] || BLOCK_TYPES[1];
        el.setAttribute('aria-label', 'Slot ' + i + ' ' + (BLOCK_TYPES[i]? info.name : 'BASE'));
        el.style.border='2px solid ' + info.color;
        el.style.background = (i===active) ? info.color : 'transparent';
        el.style.opacity = BLOCK_TYPES[i] ? '1' : '0.25';
      }
      bar.appendChild(el);
    }
    const label = document.createElement('div');
    label.style.marginLeft='8px';
    label.style.display='flex';
    label.style.alignItems='center';
    label.style.fontWeight='600';
    label.style.color='#ddd';
    // Label includes set indicator and Lock name when on Set B, slot 1
    let name = (BLOCK_TYPES[active] ? BLOCK_TYPES[active].name : 'BASE');
    if (set==='B' && active===1) name = 'Lock';
    label.textContent='Set '+set+' • Slot '+active+': ' + name;
    bar.appendChild(label);
  }
  window.ensureBlockTypeBar = ensureBlockTypeBar;
  // Keyboard 1-9 selection
  window.addEventListener('keydown', (ev)=>{
    if (state.editor.mode !== 'fps') return;
    if (ev.key >= '1' && ev.key <= '9'){
      const set = state.editor.blockSet || 'A';
      if (set === 'B'){
        if (ev.key !== '1'){
          try { if (typeof showTopNotification === 'function') showTopNotification('Set B only has Lock (1)'); } catch(_){ }
          // keep slot at 1 in Set B
          state.editor.blockSlot = 1;
        } else {
          state.editor.blockSlot = 1;
        }
      } else {
        state.editor.blockSlot = parseInt(ev.key,10);
      }
      updateBlockTypeBar();
    }
    // '0' cycles the active set A -> B -> A
    if (ev.key === '0'){
      const cur = state.editor.blockSet || 'A';
      state.editor.blockSet = (cur === 'A') ? 'B' : 'A';
      // Force slot 1 on switching sets to avoid stale slot carryover
      state.editor.blockSlot = 1;
      updateBlockTypeBar();
    }
  });
})();
