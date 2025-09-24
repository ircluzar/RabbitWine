// Safe Mode (Mobile) Editor Bootstrap
// Lightweight adapter providing block add/remove using existing desktop editor primitives.
(function(){
  if (typeof window === 'undefined') return;
  if (window.__SAFE_EDITOR_BOOTSTRAPPED) return; // idempotent
  window.__SAFE_EDITOR_BOOTSTRAPPED = true;

  function log(msg){ try { console.log('[safe-editor]', msg); } catch(_){} }

  function ensureStyles(){
    if (document.getElementById('safe-editor-style')) return;
    const link = document.createElement('link');
    link.id = 'safe-editor-style';
    link.rel = 'stylesheet';
    // Path relative to editor/ page; asset lives in mz/css/
    link.href = '../mz/css/editor.safe.css';
    document.head.appendChild(link);
  }

  function createUI(){
    if (document.getElementById('safe-editor-root')) return;
    const root = document.createElement('div');
    root.id = 'safe-editor-root';
    root.className = 'safe-mode';
    root.innerHTML = [
      '<div class="se-toolbar" role="toolbar" aria-label="Editor actions">',
        '<button type="button" class="se-btn" data-act="add" aria-label="Add Block">＋</button>',
        '<button type="button" class="se-btn" data-act="reorder" aria-label="Reorder Blocks">⇅</button>',
        '<button type="button" class="se-btn" data-act="mode-toggle" aria-label="Switch to Desktop Editor">Desktop</button>',
      '</div>',
      '<div class="se-blocklist" id="se-blocklist" aria-label="Blocks"></div>',
      '<div class="se-sheet" id="se-add-sheet" hidden>',
        '<div class="se-sheet-head">Add Block <button class="se-close" data-close>×</button></div>',
          '<div class="se-sheet-body" id="se-add-body"></div>',
          '<form class="se-coord-form" id="se-coord-form" autocomplete="off" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">'
            + '<label style="flex:1 1 30%;min-width:80px;font-size:11px;opacity:.8;">X<input type="number" id="se-gx" style="width:100%;margin-top:2px;padding:6px;background:#1c1d20;border:1px solid #333;color:#fff;border-radius:4px;font-size:13px;" min="0"></label>'
            + '<label style="flex:1 1 30%;min-width:80px;font-size:11px;opacity:.8;">Y<input type="number" id="se-gy" style="width:100%;margin-top:2px;padding:6px;background:#1c1d20;border:1px solid #333;color:#fff;border-radius:4px;font-size:13px;" min="0"></label>'
            + '<label style="flex:1 1 30%;min-width:80px;font-size:11px;opacity:.8;">Base<input type="number" id="se-base" value="0" style="width:100%;margin-top:2px;padding:6px;background:#1c1d20;border:1px solid #333;color:#fff;border-radius:4px;font-size:13px;" min="0"></label>'
            + '<label id="se-dest-wrap" style="display:none;flex:1 1 100%;font-size:11px;opacity:.8;">Destination<input type="text" id="se-dest" placeholder="e.g. ROOT" style="width:100%;margin-top:2px;padding:6px;background:#1c1d20;border:1px solid #333;color:#fff;border-radius:4px;font-size:13px;" maxlength="32"></label>'
            + '<div style="flex:1 1 100%;display:flex;gap:8px;margin-top:4px;">'
              + '<button type="submit" class="se-btn" style="flex:1;">Place</button>'
              + '<button type="button" class="se-btn" data-close style="flex:1;background:#222;">Cancel</button>'
            + '</div>'
          + '</form>',
      '</div>',
      '<div class="se-sheet" id="se-reorder-sheet" hidden>',
        '<div class="se-sheet-head">Reorder <button class="se-close" data-close>×</button></div>',
        '<ol class="se-reorder-list" id="se-reorder-list"></ol>',
        '<div class="se-reorder-actions">',
          '<button class="se-btn" data-save-order>Save Order</button>',
          '<button class="se-btn" data-close>Cancel</button>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(root);
  }

  // Placeholder in-memory block collection (until wired to real model)
  const model = { blocks: [] };
  function addBlock(type){ onTypeChosen(type); }
  function removeBlock(id){
    const entry = model.blocks.find(b=>b.id===id);
    if (entry){ safeRemoveBlock(entry); model.blocks = model.blocks.filter(b=>b.id!==id); }
    renderBlocks();
  }
  function renderBlocks(){
    const list = document.getElementById('se-blocklist'); if (!list) return;
    if (!model.blocks.length){ list.innerHTML = '<div class="se-empty">No blocks yet</div>'; return; }
    list.innerHTML = model.blocks.map(b=>{
      const label = b.type + ' ('+b.gx+','+b.gy+','+b.base+')' + (b.dest? ' → '+b.dest : '');
      return '<div class="se-block" data-id="'+b.id+'"><span>'+label+'</span><button class="se-remove" data-rm="'+b.id+'" aria-label="Delete">×</button></div>';
    }).join('');
  }

  function openSheet(id){ const el=document.getElementById(id); if (el){ el.hidden=false; el.setAttribute('aria-hidden','false'); } }
  function closeSheet(el){ if (!el) return; el.hidden=true; el.setAttribute('aria-hidden','true'); }
  function closeAllSheets(){ document.querySelectorAll('#safe-editor-root .se-sheet').forEach(closeSheet); }

  function populateAddSheet(){
    const body = document.getElementById('se-add-body'); if (!body) return;
    const TYPES = [ 'BASE','BAD','HALF','FENCE','BADFENCE','LEVELCHANGE','NOCLIMB','LOCK' ];
    body.innerHTML = TYPES.map(t=>'<button class="se-type" data-type="'+t+'" style="flex:1 1 calc(50% - 8px);">'+t+'</button>').join('');
  }

  function enterSafeMode(){
    ensureStyles();
    createUI();
    populateAddSheet();
    renderBlocks();
    wireEvents();
    log('Safe mode active');
  }

  function wireEvents(){
    const root = document.getElementById('safe-editor-root'); if (!root) return;
    root.addEventListener('click', (e)=>{
      const act = e.target.getAttribute('data-act');
      if (act === 'add'){ openSheet('se-add-sheet'); return; }
      if (act === 'reorder'){ openSheet('se-reorder-sheet'); buildReorderList(); return; }
      if (act === 'mode-toggle'){ try { localStorage.setItem('editorModePref','desktop'); } catch(_){ } window.location.search = updateQuery('editorMode','desktop'); return; }
      if (e.target.matches('[data-close]')){ closeAllSheets(); return; }
      if (e.target.matches('.se-type')){ onTypeChosen(e.target.getAttribute('data-type')); return; }
      if (e.target.matches('.se-remove')){ removeBlock(e.target.getAttribute('data-rm')); return; }
      if (e.target.hasAttribute('data-save-order')){ applyReorder(); closeAllSheets(); return; }
    });
    const form = document.getElementById('se-coord-form');
    if (form){
      form.addEventListener('submit', (ev)=>{ ev.preventDefault(); placeFromForm(); });
    }
  }

  let _pendingType = null;
  function onTypeChosen(t){
    _pendingType = t;
    const destWrap = document.getElementById('se-dest-wrap');
    if (destWrap) destWrap.style.display = (t==='LEVELCHANGE') ? 'block' : 'none';
    try { document.getElementById('se-gx').focus(); } catch(_){ }
  }

  function clamp(v,lo,hi){ v|=0; if (v<lo) v=lo; if (v>hi) v=hi; return v; }

  function placeFromForm(){
    if (!_pendingType) return;
    const gxEl=document.getElementById('se-gx');
    const gyEl=document.getElementById('se-gy');
    const bEl=document.getElementById('se-base');
    const dEl=document.getElementById('se-dest');
    let gx=parseInt(gxEl.value||'0',10), gy=parseInt(gyEl.value||'0',10), base=parseInt(bEl.value||'0',10);
    const MW=(typeof window.MAP_W==='number')?window.MAP_W:128;
    const MH=(typeof window.MAP_H==='number')?window.MAP_H:128;
    gx=clamp(gx,0,MW-1); gy=clamp(gy,0,MH-1); base=Math.max(0,base|0);
    gxEl.value=gx; gyEl.value=gy; bEl.value=base;
    const dest=(_pendingType==='LEVELCHANGE') ? (dEl.value||'').trim() : '';
    if (safeAddBlock({ type:_pendingType, gx, gy, y: base, dest })){ recordModelEntry(_pendingType,gx,gy,base,dest); renderBlocks(); _pendingType=null; closeAllSheets(); }
  }

  function recordModelEntry(type,gx,gy,base,dest){
    const id = blockId(type,gx,gy,base);
    if (!model.blocks.some(b=>b.id===id)) model.blocks.push({ id, type, gx, gy, base, dest: dest||'' });
  }
  function blockId(type,gx,gy,base){ return type+'@'+gx+','+gy+','+base; }

  function buildReorderList(){
    const ol = document.getElementById('se-reorder-list'); if (!ol) return;
    ol.innerHTML = model.blocks.map((b,i)=>'<li data-id="'+b.id+'">'
      + '<span>'+b.type+'</span>'
      + '<div class="se-row-btns">'
        + '<button data-mv="up" aria-label="Move Up">▲</button>'
        + '<button data-mv="down" aria-label="Move Down">▼</button>'
      + '</div>'
    + '</li>').join('');
    ol.addEventListener('click', onReorderClick, { once: true });
  }
  function onReorderClick(e){
    const btn = e.target.closest('button[data-mv]');
    if (!btn) return;
    const li = btn.closest('li'); if (!li) return;
    const id = li.getAttribute('data-id');
    const idx = model.blocks.findIndex(b=>b.id===id); if (idx<0) return;
    if (btn.getAttribute('data-mv')==='up' && idx>0){ const t=model.blocks[idx-1]; model.blocks[idx-1]=model.blocks[idx]; model.blocks[idx]=t; buildReorderList(); }
    else if (btn.getAttribute('data-mv')==='down' && idx<model.blocks.length-1){ const t=model.blocks[idx+1]; model.blocks[idx+1]=model.blocks[idx]; model.blocks[idx]=t; buildReorderList(); }
  }
  function applyReorder(){ renderBlocks(); }

  function updateQuery(key,val){
    try {
      const u = new URL(window.location.href);
      u.searchParams.set(key,val); return u.search;
    } catch(_){ return '?'+key+'='+encodeURIComponent(val); }
  }
  // ---- Real block operations (adapter to spans/map similar to desktop logic) ----
  function safeAddBlock(cfg){
    if (!cfg || !cfg.type) return false;
    const { type, gx, gy, y, dest } = cfg; // y = base
    try {
      if (typeof window.__getSpans !== 'function' || typeof window.__setSpans !== 'function') return false;
      const key = gx+','+gy;
      const spansBefore = window.__getSpans(gx,gy) || [];
      const mapArr = (typeof window.map !== 'undefined') ? window.map : null;
      const TILE = (typeof window.TILE !== 'undefined') ? window.TILE : {};
      const idx = (typeof window.mapIdx === 'function') ? window.mapIdx(gx,gy) : -1;
      function rebuild(){ try { if (typeof window.rebuildInstances === 'function') window.rebuildInstances(); } catch(_){} }
      function sendTile(op){ try { if (window.mpSendTileOps) window.mpSendTileOps([op]); } catch(_){} }
      function sendMap(op){ try { if (window.mpSendMapOps) window.mpSendMapOps([op]); } catch(_){} }
      function sendPortal(op){ try { if (window.mpSendPortalOps) window.mpSendPortalOps([op]); } catch(_){} }
      if (type === 'LOCK'){
        let spans = spansBefore.slice();
        if (spans.some(s=> s && (s.t|0)===6 && y >= (s.b|0) && y < (s.b|0)+(Number(s.h)||0))) return false;
        spans.push({ b:y, h:1, t:6 }); spans = window.__normalize(spans); window.__setSpans(gx,gy,spans); sendMap({ op:'add', key:key+','+y, t:6 }); rebuild(); return true;
      }
      if (type === 'LEVELCHANGE'){
        if (y===0){ if (mapArr && idx>=0){ if (mapArr[idx]===TILE.LEVELCHANGE) return false; mapArr[idx]=TILE.LEVELCHANGE; if (!(window.portalDestinations instanceof Map)) window.portalDestinations=new Map(); if (dest) window.portalDestinations.set(key,dest); sendTile({ op:'set', gx, gy, v: TILE.LEVELCHANGE }); if (dest) sendPortal({ op:'set', k:key, dest }); rebuild(); return true; } return false; }
        let spans = spansBefore.slice(); if (spans.some(s=> s && (s.t|0)===5 && (s.b|0)===y)) return false; spans.push({ b:y, h:1, t:5 }); spans = window.__normalize(spans); window.__setSpans(gx,gy,spans); sendMap({ op:'add', key:key+','+y, t:5 }); if (!(window.portalDestinations instanceof Map)) window.portalDestinations=new Map(); if (dest) { window.portalDestinations.set(key,dest); sendPortal({ op:'set', k:key, dest }); } rebuild(); return true;
      }
      if (type === 'HALF'){
        if (y===0){ if (mapArr && idx>=0){ if (mapArr[idx]===TILE.HALF) return false; mapArr[idx]=TILE.HALF; sendTile({ op:'set', gx, gy, v: TILE.HALF }); rebuild(); return true; } return false; }
        let spans = spansBefore.slice(); for (const s of spans){ if (!s) continue; const sb=s.b|0, sh=Number(s.h)||0; if (y>=sb && y<sb+sh) return false; } spans.push({ b:y, h:0.5 }); spans = spans.filter(s=>s && (Number(s.h)||0)>0).sort((a,b)=>a.b-b.b); window.__setSpans(gx,gy,spans); sendMap({ op:'add', key:key+','+y, t:4 }); rebuild(); return true;
      }
      if (type === 'NOCLIMB'){
        if (y===0){ if (mapArr && idx>=0){ if (mapArr[idx]===TILE.NOCLIMB) return false; mapArr[idx]=TILE.NOCLIMB; sendTile({ op:'set', gx, gy, v: TILE.NOCLIMB }); rebuild(); return true; } return false; }
        let spans = spansBefore.slice(); if (spans.some(s=> s && (s.t|0)===9 && y >= (s.b|0) && y < (s.b|0)+(Number(s.h)||0))) return false; spans.push({ b:y, h:1, t:9 }); spans = window.__normalize(spans); window.__setSpans(gx,gy,spans); sendMap({ op:'add', key:key+','+y, t:9 }); rebuild(); return true;
      }
      if (type === 'FENCE' || type === 'BADFENCE'){
        const tId = (type==='FENCE')?2:3; const tileTarget = (type==='FENCE')?TILE.FENCE:TILE.BADFENCE;
        if (y===0){ if (mapArr && idx>=0){ if (mapArr[idx]===tileTarget) return false; mapArr[idx]=tileTarget; sendTile({ op:'set', gx, gy, v: tileTarget }); rebuild(); return true; } return false; }
        let spans = spansBefore.slice(); if (spans.some(s=> s && (s.t|0)===tId && y >= (s.b|0) && y < (s.b|0)+(Number(s.h)||0))) return false; spans.push({ b:y, h:1, t:tId }); spans = window.__normalize(spans); window.__setSpans(gx,gy,spans); sendMap({ op:'add', key:key+','+y, t:tId }); rebuild(); return true;
      }
      // BASE / BAD generic
      const isBad = (type==='BAD'); let spans = spansBefore.slice(); for (const s of spans){ if (s && y >= (s.b|0) && y < (s.b|0)+(Number(s.h)||0)) return false; }
      spans.push(isBad? { b:y, h:1, t:1 } : { b:y, h:1 }); spans = window.__normalize(spans); window.__setSpans(gx,gy,spans);
      if (y===0 && mapArr && idx>=0){ mapArr[idx] = isBad ? TILE.BAD : TILE.WALL; sendTile({ op:'set', gx, gy, v: mapArr[idx] }); }
      sendMap({ op:'add', key:key+','+y, t: isBad?1:0 }); rebuild(); return true;
    } catch(err){ console.warn('[safe-editor] add error', err); }
    return false;
  }

  function safeRemoveBlock(cfg){
    if (!cfg || !cfg.type) return false;
    const { type, gx, gy, base } = cfg; const y = base|0; try {
      if (typeof window.__getSpans !== 'function') return false;
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
      // BASE / BAD generic removal
      let spans=spansBefore.slice(); let changed=false; const out=[]; for (const s of spans){ if (!s) continue; const b=s.b|0,h=Number(s.h)||0,t=(s.t|0)||0; const top=b+h-1; if (y<b || y>top){ out.push(s); continue;} changed=true; if (h===1){} else if (y===b){ out.push({ b:b+1,h:h-1, ...(t===1?{t:1}:{}) }); } else if (y===top){ out.push({ b:b,h:h-1, ...(t===1?{t:1}:{}) }); } else { const h1=y-b,h2=top-y; if (h1>0) out.push({ b:b,h:h1, ...(t===1?{t:1}:{}) }); if (h2>0) out.push({ b:y+1,h:h2, ...(t===1?{t:1}:{}) }); } } if (!changed) return false; out.sort((a,b)=>a.b-b.b); window.__setSpans(gx,gy,out); sendMap({ op:'remove', key: gx+','+gy+','+y }); rebuild(); return true;
    } catch(err){ console.warn('[safe-editor] remove error', err); }
    return false;
  }

  window.SafeEditor = {
    enter: enterSafeMode,
    addBlock: addBlock,
    removeBlock: (id)=>removeBlock(id),
    listBlocks: ()=>model.blocks.slice(),
    addBlockDirect: safeAddBlock,
    removeBlockDirect: safeRemoveBlock
  };

  // Auto-enter if resolver says so (and desktop editor not already active)
  function auto(){
    const mode = (typeof window.__resolveEditorMode === 'function') ? window.__resolveEditorMode() : 'desktop';
    if (mode === 'safe') enterSafeMode();
  }
  setTimeout(auto, 0);
})();
