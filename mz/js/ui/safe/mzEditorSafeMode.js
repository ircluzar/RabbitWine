// MZ Safe Mode Editor UI (reuses global SafeEditor from site editor if present, else lightweight stub)
(function(){
  if (typeof window==='undefined') return;
  if (window.__MZ_SAFE_MODE_BOOTSTRAPPED) return; window.__MZ_SAFE_MODE_BOOTSTRAPPED = true;

  // If the full SafeEditor from the standalone editor page is already loaded, reuse it.
  function hasFullSafe(){ return typeof window.SafeEditor==='object' && typeof window.SafeEditor.enter==='function'; }

  function injectStyles(){
    if (document.getElementById('mz-safe-editor-style')) return;
    const link = document.createElement('link');
    link.id='mz-safe-editor-style'; link.rel='stylesheet';
    link.href='./js/ui/safe/mzEditorSafeMode.css';
    document.head.appendChild(link);
  }

  function buildUI(){
    if (document.getElementById('mz-safe-editor-root')) return;
    const wrap = document.createElement('div');
    wrap.id='mz-safe-editor-root';
    wrap.className='mz-safe-editor';
    wrap.innerHTML = '<div class="mzse-bar">'
      + '<span class="mzse-title">Safe Editor</span>'
      + '<span id="mzse-target" class="mzse-target" style="margin-left:6px;opacity:.8;font-size:11px;">Target: (--,--)</span>'
      + '<button type="button" id="mzse-add" class="mzse-btn" style="margin-left:auto;">Add</button>'
  + '<button type="button" id="mzse-collapse" class="mzse-btn mzse-toggle-collapse" aria-pressed="false" title="Collapse/expand editor">Collapse</button>'
      + '<button type="button" id="mzse-exit" class="mzse-btn">Exit</button>'
      + '</div>'
      + '<div class="mzse-tools">'
        + '<button type="button" id="mzse-autobase" class="mzse-btn" aria-pressed="true" title="Toggle auto base height tracking">AutoBase</button>'
        + '<button type="button" id="mzse-nograv" class="mzse-btn" aria-pressed="false" title="Toggle no gravity mode">NoGravity</button>'
      + '</div>'
      + '<div id="mzse-add-panel" class="mzse-panel" hidden>'
        + '<form id="mzse-form" autocomplete="off">'
          + '<div class="row"><label>Type<select id="mzse-type"><option>BASE</option><option>BAD</option><option>HALF</option><option>FENCE</option><option>BADFENCE</option><option>LEVELCHANGE</option><option>NOCLIMB</option><option>LOCK</option></select></label></div>'
          + '<div class="row"><label>X<input type="number" id="mzse-gx" min="0" value="0"></label><label>Y<input type="number" id="mzse-gy" min="0" value="0"></label><label>Base<input type="number" id="mzse-base" min="0" value="0"></label></div>'
          + '<div class="row" id="mzse-dest-wrap" style="display:none"><label>Destination<input type="text" id="mzse-dest" maxlength="32" placeholder="LEVEL"></label></div>'
          + '<div class="row buttons">'
            + '<button type="submit" id="mzse-add-btn" class="mzse-btn">Add</button>'
            + '<button type="button" id="mzse-remove-btn" class="mzse-btn">Remove</button>'
            + '<button type="button" id="mzse-cancel" class="mzse-btn alt">Close</button>'
          + '</div>'
        + '</form>'
      + '</div>';
    document.body.appendChild(wrap);
  }

  let currentType = 'BASE';
  let rafId = 0; let lastTargetGX = -1, lastTargetGY = -1;
  let followBase = true; // auto-sync base field with player's height
  // 3D visor integration: we reuse existing drawEditorVisorAndPreview pipeline if present
  // by temporarily populating state.editor.visor while safe mode is open.
  let overlayBox = null; // legacy 2D overlay (kept as fallback if GL draw unavailable)
  let use3DVisor = false;

  function clamp(v,lo,hi){ return v<lo?lo:(v>hi?hi:v); }
  function computeTarget(){
    try {
      if (!window.state || !state.player) return null;
      const p = state.player; // Expect: x,z, angle (radians)
      const dist = 2; // 2 blocks ahead
      // Player coordinates are world-centered (-MAP_W*0.5 .. +MAP_W*0.5). Convert to grid indices by adding half size.
      const MW = (typeof window.MAP_W==='number')?window.MAP_W:128;
      const MH = (typeof window.MAP_H==='number')?window.MAP_H:128;
  // Forward vector in movement code uses (sin(angle), -cos(angle)) for (x,z).
  const fwdX = Math.sin(p.angle) * dist;
  const fwdZ = -Math.cos(p.angle) * dist;
  const tx = p.x + fwdX; // world X (centered)
  const tz = p.z + fwdZ; // world Z (centered)
      // Use floor on translated coordinates for stable cell targeting (consistent with other systems using floor(player.x + MAP_W*0.5)).
      const gx = Math.floor(tx + MW * 0.5);
      const gy = Math.floor(tz + MH * 0.5);
      return { gx: clamp(gx,0,MW-1), gy: clamp(gy,0,MH-1) };
    } catch(_){ return null; }
  }
  function updateTargetLoop(){
    const tgt = computeTarget();
    if (tgt){
      // Update UI only when cell changed
      const changed = (tgt.gx!==lastTargetGX || tgt.gy!==lastTargetGY);
      if (changed){
        lastTargetGX = tgt.gx; lastTargetGY = tgt.gy;
        const span = document.getElementById('mzse-target');
        if (span) span.textContent = 'Target: ('+tgt.gx+','+tgt.gy+')';
      }
      // Live sync inputs (unless user is typing)
      try {
        const gxEl=document.getElementById('mzse-gx'); const gyEl=document.getElementById('mzse-gy');
        if (gxEl && !gxEl.matches(':focus')) gxEl.value = tgt.gx;
        if (gyEl && !gyEl.matches(':focus')) gyEl.value = tgt.gy;
      } catch(_){ }
      // Auto-sync base unless user disabled or is editing base input
      try {
        if (followBase && window.state && state.player){
          const be = document.getElementById('mzse-base');
          if (be && !be.matches(':focus')){
            const pb = Math.max(0, Math.floor(state.player.y || 0));
            if (be.value !== String(pb)) be.value = String(pb);
          }
        }
      } catch(_){ }
      if (use3DVisor){
        try {
          if (window.state && state.editor){
            const baseEl = document.getElementById('mzse-base');
            let base = 0; if (baseEl){ const v=parseInt(baseEl.value||'0',10); if (!isNaN(v) && v>=0) base = v; }
            state.editor.safeModeVisorActive = true;
            // Always refresh visor each frame so it tracks subtle movement within same cell
            state.editor.visor = { gx: tgt.gx, gy: tgt.gy, base, yCenter: base + 0.5, height:1 };
            state.editor._hideVisorWhileEditing = false;
          }
        } catch(_){ }
      } else if (changed) {
        drawOverlay(tgt.gx, tgt.gy);
      }
    }
    rafId = requestAnimationFrame(updateTargetLoop);
  }
  function startLoop(){ if (!rafId) rafId = requestAnimationFrame(updateTargetLoop); }
  function stopLoop(){ if (rafId){ cancelAnimationFrame(rafId); rafId=0; } }


  function placeViaFull(type,gx,gy,base,dest){
    if (hasFullSafe()) return window.SafeEditor.addBlockDirect({ type, gx, gy, y: base, dest });
    // Fallback inline implementation (mirrors standalone safe editor logic)
    try {
      if (typeof window.__getSpans !== 'function' || typeof window.__setSpans !== 'function') return false;
      const y = base|0; if (y<0) return false;
      const key = gx+','+gy;
      const spansBefore = window.__getSpans(gx,gy) || [];
      const mapArr = (typeof window.map !== 'undefined') ? window.map : null;
      const TILE = (typeof window.TILE !== 'undefined') ? window.TILE : {};
      const idx = (typeof window.mapIdx === 'function') ? window.mapIdx(gx,gy) : -1;
      function rebuild(){ try { if (typeof window.rebuildInstances === 'function') window.rebuildInstances(); } catch(_){} }
      function sendTile(op){ try { if (window.mpSendTileOps) window.mpSendTileOps([op]); } catch(_){} }
      function sendMap(op){ try { if (window.mpSendMapOps) window.mpSendMapOps([op]); } catch(_){} }
      function sendPortal(op){ try { if (window.mpSendPortalOps) window.mpSendPortalOps([op]); } catch(_){} }
      // LOCK
      if (type==='LOCK'){
        let spans = spansBefore.slice(); if (spans.some(s=> s && (s.t|0)===6 && y >= (s.b|0) && y < (s.b|0)+(Number(s.h)||0))) return false;
        spans.push({ b:y, h:1, t:6 }); spans = window.__normalize(spans); window.__setSpans(gx,gy,spans); sendMap({ op:'add', key:key+','+y, t:6 }); rebuild(); return true;
      }
      // LEVELCHANGE
      if (type==='LEVELCHANGE'){
        if (y===0){ if (mapArr && idx>=0){ if (mapArr[idx]===TILE.LEVELCHANGE) return false; mapArr[idx]=TILE.LEVELCHANGE; if (!(window.portalDestinations instanceof Map)) window.portalDestinations=new Map(); if (dest) window.portalDestinations.set(key,dest); sendTile({ op:'set', gx, gy, v: TILE.LEVELCHANGE }); if (dest) sendPortal({ op:'set', k:key, dest }); rebuild(); return true; } return false; }
        let spans = spansBefore.slice(); if (spans.some(s=> s && (s.t|0)===5 && (s.b|0)===y)) return false; spans.push({ b:y, h:1, t:5 }); spans = window.__normalize(spans); window.__setSpans(gx,gy,spans); sendMap({ op:'add', key:key+','+y, t:5 }); if (!(window.portalDestinations instanceof Map)) window.portalDestinations=new Map(); if (dest) { window.portalDestinations.set(key,dest); sendPortal({ op:'set', k:key, dest }); } rebuild(); return true;
      }
      // HALF
      if (type==='HALF'){
        if (y===0){ if (mapArr && idx>=0){ if (mapArr[idx]===TILE.HALF) return false; mapArr[idx]=TILE.HALF; sendTile({ op:'set', gx, gy, v: TILE.HALF }); rebuild(); return true; } return false; }
        let spans = spansBefore.slice(); for (const s of spans){ if (!s) continue; const sb=s.b|0, sh=Number(s.h)||0; if (y>=sb && y<sb+sh) return false; } spans.push({ b:y, h:0.5 }); spans = spans.filter(s=>s && (Number(s.h)||0)>0).sort((a,b)=>a.b-b.b); window.__setSpans(gx,gy,spans); sendMap({ op:'add', key:key+','+y, t:4 }); rebuild(); return true;
      }
      // NOCLIMB
      if (type==='NOCLIMB'){
        if (y===0){ if (mapArr && idx>=0){ if (mapArr[idx]===TILE.NOCLIMB) return false; mapArr[idx]=TILE.NOCLIMB; sendTile({ op:'set', gx, gy, v: TILE.NOCLIMB }); rebuild(); return true; } return false; }
        let spans = spansBefore.slice(); if (spans.some(s=> s && (s.t|0)===9 && y >= (s.b|0) && y < (s.b|0)+(Number(s.h)||0))) return false; spans.push({ b:y, h:1, t:9 }); spans = window.__normalize(spans); window.__setSpans(gx,gy,spans); sendMap({ op:'add', key:key+','+y, t:9 }); rebuild(); return true;
      }
      // FENCE / BADFENCE
      if (type==='FENCE' || type==='BADFENCE'){
        const tId = (type==='FENCE')?2:3; const tileTarget = (type==='FENCE')?TILE.FENCE:TILE.BADFENCE;
        if (y===0){ if (mapArr && idx>=0){ if (mapArr[idx]===tileTarget) return false; mapArr[idx]=tileTarget; sendTile({ op:'set', gx, gy, v: tileTarget }); rebuild(); return true; } return false; }
        let spans = spansBefore.slice(); if (spans.some(s=> s && (s.t|0)===tId && y >= (s.b|0) && y < (s.b|0)+(Number(s.h)||0))) return false; spans.push({ b:y, h:1, t:tId }); spans = window.__normalize(spans); window.__setSpans(gx,gy,spans); sendMap({ op:'add', key:key+','+y, t:tId }); rebuild(); return true;
      }
      // BASE / BAD generic
      const isBad = (type==='BAD'); let spans = spansBefore.slice(); for (const s of spans){ if (s && y >= (s.b|0) && y < (s.b|0)+(Number(s.h)||0)) return false; }
      spans.push(isBad? { b:y, h:1, t:1 } : { b:y, h:1 }); spans = window.__normalize(spans); window.__setSpans(gx,gy,spans);
      if (y===0 && mapArr && idx>=0){ mapArr[idx] = isBad ? TILE.BAD : TILE.WALL; sendTile({ op:'set', gx, gy, v: mapArr[idx] }); }
      sendMap({ op:'add', key:key+','+y, t: isBad?1:0 }); rebuild(); return true;
    } catch(err){ console.warn('[mz-safe-editor] add error', err); }
    return false;
  }
  function removeViaFull(type,gx,gy,base){
    if (hasFullSafe()) return window.SafeEditor.removeBlockDirect({ type, gx, gy, base });
    // Fallback inline removal logic (mirrors standalone safe editor)
    try {
      if (typeof window.__getSpans !== 'function') return false; const y = base|0;
      const spansBefore = window.__getSpans(gx,gy) || [];
      const mapArr = (typeof window.map !== 'undefined') ? window.map : null;
      const TILE = (typeof window.TILE !== 'undefined') ? window.TILE : {};
      const idx = (typeof window.mapIdx === 'function') ? window.mapIdx(gx,gy) : -1;
      function rebuild(){ try { if (typeof window.rebuildInstances === 'function') window.rebuildInstances(); } catch(_){} }
      function sendTile(op){ try { if (window.mpSendTileOps) window.mpSendTileOps([op]); } catch(_){} }
      function sendMap(op){ try { if (window.mpSendMapOps) window.mpSendMapOps([op]); } catch(_){} }
      function sendPortal(op){ try { if (window.mpSendPortalOps) window.mpSendPortalOps([op]); } catch(_){} }
      if (type==='LOCK'){
        let spans=spansBefore.slice(); let changed=false; const out=[]; for (const s of spans){ if (!s) continue; const b=s.b|0,h=Number(s.h)||0,t=(s.t|0)||0; const top=b+h-1; if (t!==6 || y<b || y>top){ out.push(s); continue;} changed=true; if (h===1){} else if (y===b){ out.push({ b:b+1,h:h-1,t:6 }); } else if (y===top){ out.push({ b:b,h:h-1,t:6 }); } else { const h1=y-b,h2=top-y; if (h1>0) out.push({ b:b,h:h1,t:6 }); if (h2>0) out.push({ b:y+1,h:h2,t:6 }); } } if (!changed) return false; out.sort((a,b)=>a.b-b.b); window.__setSpans(gx,gy,out); sendMap({ op:'remove', key: gx+','+gy+','+y, t:6 }); rebuild(); return true;
      }
      if (type==='LEVELCHANGE'){
        if (y===0){ if (mapArr && idx>=0 && mapArr[idx]===TILE.LEVELCHANGE){ mapArr[idx]=TILE.OPEN; sendTile({ op:'set', gx, gy, v: TILE.OPEN }); const key=gx+','+gy; if (window.portalDestinations instanceof Map) window.portalDestinations.delete(key); sendPortal({ op:'remove', k:key }); rebuild(); return true; } return false; }
        let spans=spansBefore.slice(); const before=spans.length; spans = spans.filter(s=> !(s && (s.t|0)===5 && (s.b|0)===y)); if (spans.length===before) return false; window.__setSpans(gx,gy,spans); sendMap({ op:'remove', key: gx+','+gy+','+y, t:5 }); rebuild(); return true;
      }
      if (type==='HALF'){
        if (y===0){ if (mapArr && idx>=0 && mapArr[idx]===TILE.HALF){ mapArr[idx]=TILE.OPEN; sendTile({ op:'set', gx, gy, v: TILE.OPEN }); rebuild(); return true; } return false; }
        let spans=spansBefore.slice(); let changed=false; const out=[]; for (const s of spans){ if (!s) continue; const sb=s.b|0; const sh=(typeof s.h==='number')?s.h:(s.h|0); if (Math.abs(sh-0.5)<1e-6 && sb===y){ changed=true; continue;} out.push(s);} if (!changed) return false; out.sort((a,b)=>a.b-b.b); window.__setSpans(gx,gy,out); sendMap({ op:'remove', key: gx+','+gy+','+y, t:4 }); rebuild(); return true;
      }
      if (type==='NOCLIMB'){
        if (y===0){ if (mapArr && idx>=0 && mapArr[idx]===TILE.NOCLIMB){ mapArr[idx]=TILE.OPEN; sendTile({ op:'set', gx, gy, v: TILE.OPEN }); rebuild(); return true; } return false; }
        let spans=spansBefore.slice(); let changed=false; const out=[]; for (const s of spans){ if (!s) continue; const b=s.b|0,h=Number(s.h)||0,t=(s.t|0)||0; const top=b+h-1; if (t!==9 || y<b || y>top){ out.push(s); continue;} changed=true; if (h===1){} else if (y===b){ out.push({ b:b+1,h:h-1,t:9 }); } else if (y===top){ out.push({ b:b,h:h-1,t:9 }); } else { const h1=y-b,h2=top-y; if (h1>0) out.push({ b:b,h:h1,t:9 }); if (h2>0) out.push({ b:y+1,h:h2,t:9 }); } } if (!changed) return false; out.sort((a,b)=>a.b-b.b); window.__setSpans(gx,gy,out); sendMap({ op:'remove', key: gx+','+gy+','+y, t:9 }); rebuild(); return true;
      }
      if (type==='FENCE' || type==='BADFENCE'){
        const tId = (type==='FENCE')?2:3; const tileTarget=(type==='FENCE')?TILE.FENCE:TILE.BADFENCE;
        if (y===0){ if (mapArr && idx>=0 && mapArr[idx]===tileTarget){ mapArr[idx]=TILE.OPEN; sendTile({ op:'set', gx, gy, v: TILE.OPEN }); rebuild(); return true; } return false; }
        let spans=spansBefore.slice(); let changed=false; const out=[]; for (const s of spans){ if (!s) continue; const b=s.b|0,h=Number(s.h)||0,t=(s.t|0)||0; const top=b+h-1; if (t!==tId || y<b || y>top){ out.push(s); continue;} changed=true; if (h===1){} else if (y===b){ out.push({ b:b+1,h:h-1,t:tId }); } else if (y===top){ out.push({ b:b,h:h-1,t:tId }); } else { const h1=y-b,h2=top-y; if (h1>0) out.push({ b:b,h:h1,t:tId }); if (h2>0) out.push({ b:y+1,h:h2,t:tId }); } } if (!changed) return false; out.sort((a,b)=>a.b-b.b); window.__setSpans(gx,gy,out); sendMap({ op:'remove', key: gx+','+gy+','+y, t:tId }); rebuild(); return true;
      }
      // BASE / BAD
      let spans=spansBefore.slice(); let changed=false; const out=[]; for (const s of spans){ if (!s) continue; const b=s.b|0,h=Number(s.h)||0,t=(s.t|0)||0; const top=b+h-1; if (y<b || y>top){ out.push(s); continue;} changed=true; if (h===1){} else if (y===b){ out.push({ b:b+1,h:h-1, ...(t===1?{t:1}:{}) }); } else if (y===top){ out.push({ b:b,h:h-1, ...(t===1?{t:1}:{}) }); } else { const h1=y-b,h2=top-y; if (h1>0) out.push({ b:b,h:h1, ...(t===1?{t:1}:{}) }); if (h2>0) out.push({ b:y+1,h:h2, ...(t===1?{t:1}:{}) }); } } if (!changed) return false; out.sort((a,b)=>a.b-b.b); window.__setSpans(gx,gy,out); sendMap({ op:'remove', key: gx+','+gy+','+y }); rebuild(); return true;
    } catch(err){ console.warn('[mz-safe-editor] remove error', err); }
    return false;
  }

  function showAdd(){
    document.getElementById('mzse-add-panel').hidden=false;
    // Prefill with current target
    const tgt = computeTarget();
    if (tgt){
      const gxEl=document.getElementById('mzse-gx'); const gyEl=document.getElementById('mzse-gy');
      if (gxEl) gxEl.value = tgt.gx;
      if (gyEl) gyEl.value = tgt.gy;
    }
    // Reflect current type selection
    try { const sel=document.getElementById('mzse-type'); if (sel) sel.value=currentType; } catch(_){ }
  }
  function hideAdd(){ document.getElementById('mzse-add-panel').hidden=true; }

  // Minimal 2D overlay visor (approximate) using canvas bounding box mapping.
  function ensureOverlay(){
    if (overlayBox && document.body.contains(overlayBox)) return overlayBox;
    overlayBox = document.createElement('div');
    overlayBox.id='mzse-visor';
    overlayBox.style.position='absolute';
    overlayBox.style.zIndex='1180';
    overlayBox.style.pointerEvents='none';
    overlayBox.style.border='2px solid rgba(255,255,255,0.55)';
    overlayBox.style.boxShadow='0 0 6px rgba(255,255,255,0.4)';
    overlayBox.style.transition='border-color .15s, box-shadow .15s';
    document.body.appendChild(overlayBox);
    return overlayBox;
  }

  function worldToScreen(gx,gy){
    try {
      const cvs = document.getElementById('app'); if (!cvs) return null;
      const rect = cvs.getBoundingClientRect();
      // Use simple proportional mapping: assumes orthographic top-down simplification for safe mode.
      // If a real projection is implemented later, replace this.
      const MW = (typeof window.MAP_W==='number')?window.MAP_W:128;
      const MH = (typeof window.MAP_H==='number')?window.MAP_H:128;
      const cellW = rect.width / MW;
      const cellH = rect.height / MH;
      return { x: rect.left + gx*cellW, y: rect.top + gy*cellH, w: cellW, h: cellH };
    } catch(_){ return null; }
  }

  function drawOverlay(gx,gy){
    const box = ensureOverlay();
    const scr = worldToScreen(gx,gy); if (!scr){ box.style.display='none'; return; }
    box.style.display='block';
    box.style.left = scr.x + 'px';
    box.style.top = scr.y + 'px';
    box.style.width = Math.max(4, scr.w) + 'px';
    box.style.height = Math.max(4, scr.h) + 'px';
  }

  function removeOverlay(){ if (overlayBox){ try { overlayBox.remove(); } catch(_){ } overlayBox=null; } }

  function wire(){
    const addBtn = document.getElementById('mzse-add'); if (addBtn) addBtn.addEventListener('click', showAdd);
    const exitBtn = document.getElementById('mzse-exit'); if (exitBtn) exitBtn.addEventListener('click', hideSafeMode);
    const collapseBtn = document.getElementById('mzse-collapse'); if (collapseBtn){
      collapseBtn.addEventListener('click', ()=>{
        const root = document.getElementById('mz-safe-editor-root');
        if (!root) return;
        const isCollapsed = root.classList.toggle('collapsed');
        collapseBtn.setAttribute('aria-pressed', isCollapsed? 'true':'false');
        collapseBtn.textContent = isCollapsed? 'Expand':'Collapse';
      });
    }
    const autoBtn = document.getElementById('mzse-autobase'); if (autoBtn){
      autoBtn.addEventListener('click', ()=>{
        followBase = !followBase;
        autoBtn.setAttribute('aria-pressed', followBase ? 'true' : 'false');
        if (followBase){
          try { if (window.state && state.player){ const be=document.getElementById('mzse-base'); if (be && !be.matches(':focus')) be.value = Math.max(0, Math.floor(state.player.y||0)); } } catch(_){ }
        }
      });
    }
    const noGravBtn = document.getElementById('mzse-nograv'); if (noGravBtn){
      noGravBtn.addEventListener('click', ()=>{
        try {
          if (state && state.editor){
            state.editor.safeNoGravity = !state.editor.safeNoGravity;
            noGravBtn.setAttribute('aria-pressed', state.editor.safeNoGravity ? 'true':'false');
          }
        } catch(_){ }
      });
    }
    const form = document.getElementById('mzse-form'); if (form){
      form.addEventListener('submit', (e)=>{
        e.preventDefault();
        const type = document.getElementById('mzse-type').value.trim();
        const gx = parseInt(document.getElementById('mzse-gx').value||'0',10);
        const gy = parseInt(document.getElementById('mzse-gy').value||'0',10);
        const base = parseInt(document.getElementById('mzse-base').value||'0',10);
        const dest = (type==='LEVELCHANGE') ? (document.getElementById('mzse-dest').value||'').trim() : '';
        if (type==='LEVELCHANGE') document.getElementById('mzse-dest-wrap').style.display='block'; else document.getElementById('mzse-dest-wrap').style.display='none';
        if (placeViaFull(type,gx,gy,base,dest)){ hideAdd(); }
      });
      const removeBtn = document.getElementById('mzse-remove-btn');
      if (removeBtn){
        removeBtn.addEventListener('click', ()=>{
          const type = document.getElementById('mzse-type').value.trim();
          const gx = parseInt(document.getElementById('mzse-gx').value||'0',10);
          const gy = parseInt(document.getElementById('mzse-gy').value||'0',10);
          const base = parseInt(document.getElementById('mzse-base').value||'0',10);
          // Remove via full safe editor if present
          removeViaFull(type,gx,gy,base);
        });
      }
    }
    const typeSel = document.getElementById('mzse-type'); if (typeSel){
      typeSel.addEventListener('change', ()=>{
        const t = typeSel.value; currentType = t;
        document.getElementById('mzse-dest-wrap').style.display = (t==='LEVELCHANGE')? 'block':'none';
      });
    }
    const baseEl = document.getElementById('mzse-base'); if (baseEl){
      baseEl.addEventListener('focus', ()=>{ followBase=false; const ab=document.getElementById('mzse-autobase'); if (ab) ab.setAttribute('aria-pressed','false'); });
    }
  const cancel = document.getElementById('mzse-cancel'); if (cancel) cancel.addEventListener('click', ()=>{ hideSafeMode(); });
  }

  function hideSafeMode(){
    stopLoop();
    try { if (state && state.editor){ state.editor.safeModeVisorActive = false; } } catch(_){ }
    removeOverlay();
    const r=document.getElementById('mz-safe-editor-root'); if (r) r.remove();
    try { localStorage.setItem('mzEditorModePref','desktop'); } catch(_){ }
  }

  function enter(){
    injectStyles(); buildUI(); wire();
    // Detect availability of GL visor draw path
    use3DVisor = (typeof window.drawEditorVisorAndPreview === 'function' && typeof window.state==='object' && state.editor);
    if (!use3DVisor) ensureOverlay();
    startLoop();
  }

  // Removed auto-enter: safe mode now only appears after the user explicitly presses the Editor button.
  // (Previously: auto() would enter immediately on mobile heuristics.)

  // Expose minimal API
  window.MZSafeEditor = { enter };
})();
