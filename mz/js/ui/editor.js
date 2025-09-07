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
    if (!locked && state.editor.mode === 'fps' && !state.editor.modalOpen){
      // Opening modal on unlock
      openEditorModal();
    }
  }

  function onToggleEditorMode(){
    if (!isDesktop()) { showTopNotification('Editor available on desktop only'); return; }
    if (state.editor.mode !== 'fps') enterEditor(); else exitEditor();
  }

  function enterEditor(){
    state.editor.mode = 'fps';
    state.snapTopFull = false; state.snapBottomFull = false; // keep split by default
    const EDITOR_TOGGLE = document.getElementById('editor-toggle');
    if (EDITOR_TOGGLE){
      EDITOR_TOGGLE.setAttribute('aria-pressed','true');
      EDITOR_TOGGLE.textContent = 'Editor: FPS';
      // Avoid keeping focus on the button so Space doesn't trigger it again
      try { EDITOR_TOGGLE.blur(); } catch(_){}
    }
    // Seed camera from player
    const p = state.player; const e = state.editor.fps;
    e.x = p.x; e.y = Math.max(0.6, p.y + 1.8); e.z = p.z; e.yaw = p.angle; e.pitch = 0;
    // Hide player while editing
    state._hidePlayer = true;
  // Try to lock pointer on canvas click
    CANVAS.requestPointerLock = CANVAS.requestPointerLock || CANVAS.mozRequestPointerLock;
    if (document.pointerLockElement !== CANVAS) {
      try { CANVAS.requestPointerLock(); } catch(_){}
    }
    // Ensure keyboard focus goes to the canvas
    try { CANVAS.focus(); } catch(_){}
  // Clear any lingering inputs to avoid stuck movement upon transition
  try { state.inputs.keys.clear(); } catch(_){}
  // Show crosshair
  try { const c = document.getElementById('editor-crosshair'); if (c) c.style.display = 'block'; } catch(_){}
  }

  function exitEditor(){
    state.editor.mode = 'none';
    state.editor.modalOpen = false;
    const EDITOR_TOGGLE = document.getElementById('editor-toggle');
    if (EDITOR_TOGGLE){ EDITOR_TOGGLE.setAttribute('aria-pressed','false'); EDITOR_TOGGLE.textContent = 'Editor'; }
    state._hidePlayer = false;
    if (document.exitPointerLock) try { document.exitPointerLock(); } catch(_){}
    closeEditorModal();
  // Clear inputs on exit to avoid stuck movement
  try { state.inputs.keys.clear(); } catch(_){}
  // Hide crosshair
  try { const c = document.getElementById('editor-crosshair'); if (c) c.style.display = 'none'; } catch(_){}
  }

  // Keyboard + mouse for FPS when active
  function handleEditorInput(dt){
    if (state.editor.mode !== 'fps' || state.editor.modalOpen) return;
    const e = state.editor.fps;
    const sp = e.moveSpeed;
    let vx=0, vz=0, vy=0;
  // WASD using normalized tokens from input-keyboard to avoid stuck-keys from mismatched variants
  if (state.inputs.keys.has('w')) vz += 1;
  if (state.inputs.keys.has('s')) vz -= 1;
  if (state.inputs.keys.has('a')) vx -= 1;
  if (state.inputs.keys.has('d')) vx += 1;
  if (state.inputs.keys.has('space')) vy += 1; // space up
  if (state.inputs.keys.has('shift')) vy -= 1; // shift down
    if (vx||vy||vz){
      const len = Math.hypot(vx,vz) || 1; const nx = vx/len, nz = vz/len;
      const sinY = Math.sin(e.yaw), cosY = Math.cos(e.yaw);
      const fwdX = sinY, fwdZ = -cosY; const rightX = cosY, rightZ = sinY;
      const moveX = (fwdX*nz + rightX*nx) * sp * dt;
      const moveZ = (fwdZ*nz + rightZ*nx) * sp * dt;
      e.x += moveX; e.z += moveZ; e.y += vy * sp * 0.75 * dt;
    }
  }

  // Mouse move to look when locked
  window.addEventListener('mousemove', (ev)=>{
    if (state.editor.mode !== 'fps' || !state.editor.pointerLocked || state.editor.modalOpen) return;
    const e = state.editor.fps;
    const sens = 0.0025; // radians per px
    e.yaw += ev.movementX * sens;
    e.pitch = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, e.pitch - ev.movementY * sens));
  });

  // Helpers to mutate spans at the visor
  function __getSpans(gx, gy){
    const key = `${gx},${gy}`;
    try { return (window.columnSpans.get(key) || []).slice(); } catch(_){ return []; }
  }
  function __setSpans(gx, gy, spans){ try { window.setSpansAt(gx, gy, spans); } catch(_){} }
  function __normalize(spans){
    const a = spans.filter(s=>s && (s.h|0)>0).map(s=>({ b:s.b|0, h:s.h|0 }));
    a.sort((p,q)=>p.b-q.b);
    // merge adjacent same-base? not necessary for single blocks, but compact overlaps
    const out=[];
    for (const s of a){
      if (!out.length) { out.push(s); continue; }
      const t = out[out.length-1];
      if (s.b <= t.b + t.h){
        const top = Math.max(t.b+t.h, s.b+s.h);
        t.h = top - t.b;
      } else out.push(s);
    }
    return out;
  }
  function addBlockAtVisor(){
    const vs = state.editor.visor; if (!vs || vs.gx<0) return false;
    const gx=vs.gx, gy=vs.gy, y=vs.base|0; const key=`${gx},${gy}`;
    let spans = __getSpans(gx,gy);
    // check if block exists at y
    for (const s of spans){ if (y >= (s.b|0) && y < (s.b|0)+(s.h|0)) return false; }
    // insert as its own span and normalize
    spans.push({ b:y, h:1 });
    spans = __normalize(spans);
    __setSpans(gx,gy,spans);
    // if ground-level, mark wall tile for visibility
    if (y===0 && typeof map !== 'undefined' && typeof TILE !== 'undefined'){
      try { map[mapIdx(gx,gy)] = TILE.WALL; } catch(_){}
    }
    try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){}
    return true;
  }
  function removeBlockAtVisor(){
    const vs = state.editor.visor; if (!vs || vs.gx<0) return false;
    const gx=vs.gx, gy=vs.gy, y=vs.base|0;
    let spans = __getSpans(gx,gy);
    let changed=false; const out=[];
    for (const s of spans){
      const b=s.b|0, h=s.h|0; const top=b+h-1;
      if (y < b || y > top){ out.push(s); continue; }
      changed=true;
      // split or shrink to remove just the one layer
      if (h===1){ /* drop span entirely */ }
      else if (y===b){ out.push({ b:b+1, h:h-1 }); }
      else if (y===top){ out.push({ b:b, h:h-1 }); }
      else {
        const h1 = y - b; const h2 = top - y;
        if (h1>0) out.push({ b:b, h:h1 });
        if (h2>0) out.push({ b:y+1, h:h2 });
      }
    }
    if (!changed) return false;
    out.sort((p,q)=>p.b-q.b);
    __setSpans(gx,gy,out);
    try { if (typeof rebuildInstances === 'function') rebuildInstances(); } catch(_){}
    return true;
  }

  // Mouse buttons while in editor:
  // - Left (0): place a single block at visor if absent
  // - Middle (1): open modal (release pointer lock first)
  // - Right (2): remove a single block at visor if present
  CANVAS.addEventListener('mousedown', (ev)=>{
    if (state.editor.mode !== 'fps') return;
    if (state.editor.modalOpen) return;
    if (ev.button === 0){ addBlockAtVisor(); ev.preventDefault(); return; }
    if (ev.button === 1){ if (document.pointerLockElement === CANVAS){ if (document.exitPointerLock) document.exitPointerLock(); } openEditorModal(); ev.preventDefault(); return; }
    if (ev.button === 2){ removeBlockAtVisor(); ev.preventDefault(); return; }
  });

  function raycastGridFromEditor(){
    // Raycast from camera through view direction (yaw + pitch), updating visor to match flying height and aim
    const e = state.editor.fps;
  const dirX = Math.sin(e.yaw) * Math.cos(e.pitch);
  const dirY = Math.sin(e.pitch);
  const dirZ = -Math.cos(e.yaw) * Math.cos(e.pitch);
    // DDA-ish stepping, small step for stable selection
    let t=0, hitGX=-1, hitGY=-1, hitBase=0;
    const maxT = 60.0;
    const step = 0.075;
    for (; t<maxT; t+=step){
      const wx = e.x + dirX * t;
      const wy = e.y + dirY * t;
      const wz = e.z + dirZ * t;
      const gx = Math.floor(wx + MAP_W*0.5);
      const gy = Math.floor(wz + MAP_H*0.5);
      if (gx<0||gy<0||gx>=MAP_W||gy>=MAP_H) break;
      hitGX = gx; hitGY = gy; hitBase = Math.max(0, Math.floor(wy));
    }
    // If we didn’t hit anything in range, fallback to camera cell and base per camera height
    if (hitGX < 0 || hitGY < 0){
      hitGX = Math.floor(e.x + MAP_W*0.5);
      hitGY = Math.floor(e.z + MAP_H*0.5);
      hitBase = Math.max(0, Math.floor(e.y));
    }
    state.editor.visor = { gx: hitGX, gy: hitGY, yCenter: hitBase + 0.5, base: hitBase, height: 1 };
  }

  // Modal builder
  function openEditorModal(){
    if (state.editor.modalOpen) return;
    state.editor.modalOpen = true;
    const root = ensureRoot();
    const wrap = document.createElement('div');
  wrap.style.pointerEvents = 'auto';
  wrap.style.padding = '8px';
  wrap.style.display = 'flex';
  // Anchor modal at the bottom; center horizontally
  wrap.style.width = '100%';
  wrap.style.boxSizing = 'border-box';
  wrap.style.justifyContent = 'center';
  wrap.style.alignItems = 'flex-end';
  const panel = document.createElement('div'); panel.id = 'mz-editor-modal-panel';
    panel.style.minWidth = 'min(96vw, 560px)';
    panel.style.maxWidth = 'min(96vw, 560px)';
    panel.style.background = 'rgba(10,15,20,0.9)';
    panel.style.border = '2px solid #234';
    panel.style.color = '#cfe4ff';
    panel.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif';
    panel.style.borderRadius = '6px 6px 0 0';
    panel.style.boxShadow = '0 0 0 3px rgba(0,0,0,0.6)';
  // Sit at the bottom of the window so the top screen remains unobstructed
  panel.style.margin = '0 auto 8px auto';
    const title = document.createElement('div'); title.textContent = 'Structure Builder'; title.style.fontWeight='700'; title.style.padding='10px 12px'; title.style.borderBottom='1px solid #2a3a4a';
  const form = document.createElement('div'); form.style.padding='10px 12px'; form.style.display='grid'; form.style.gridTemplateColumns='1fr 1fr'; form.style.gap='8px';

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
    wrap.appendChild(panel); root.appendChild(wrap);

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
      // Keep in FPS editor after save; lock again for continue placement
      if (CANVAS.requestPointerLock) try { CANVAS.requestPointerLock(); } catch(_){}
    });
    btnCancel.addEventListener('click', ()=>{
      // Close the modal and return to FPS mode without saving
      closeEditorModal();
      if (CANVAS.requestPointerLock) try { CANVAS.requestPointerLock(); } catch(_){ }
    });
    btnQuit.addEventListener('click', ()=>{ closeEditorModal(); exitEditor(); });

    // Hide visor while editing
    try { state.editor._hideVisorWhileEditing = true; } catch(_){}

    // Allow dragging the top camera by clicking outside the modal and dragging
    // We’ll capture mousedown/move/up on the root; ignore events over the panel
    function isOverPanel(ev){ return panel.contains(ev.target); }
    let lastPos = null;
    wrap.addEventListener('mousedown', (ev)=>{
      if (isOverPanel(ev)) return;
      state.editor.draggingTopCam = true;
      lastPos = { x: ev.clientX, y: ev.clientY };
      ev.preventDefault();
    });
    window.addEventListener('mousemove', (ev)=>{
      if (!state.editor.draggingTopCam) return;
      if (!lastPos) { lastPos = { x: ev.clientX, y: ev.clientY }; return; }
      // Convert drag delta to small yaw/position delta for the top camera follow
      const dx = ev.clientX - lastPos.x;
      const dy = ev.clientY - lastPos.y;
      lastPos = { x: ev.clientX, y: ev.clientY };
      // Adjust the editor FPS camera yaw/pitch subtly to provide view control
      const sens = 0.003;
      state.editor.fps.yaw += dx * sens;
      state.editor.fps.pitch = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, state.editor.fps.pitch - dy * sens * 0.5));
    });
    window.addEventListener('mouseup', ()=>{ state.editor.draggingTopCam = false; lastPos = null; });
  }

  function closeEditorModal(){
    const root = document.getElementById(rootId);
    if (root) root.innerHTML = '';
    state.editor.modalOpen = false;
  // Restore visor drawing
  try { state.editor._hideVisorWhileEditing = false; } catch(_){}
  }

  function applyStructureFromForm(){
    // Use column API to add spans for preview set
    const pts = state.editor.preview || [];
    for (const it of pts){
      const key = `${it.gx},${it.gy}`;
      const spans = window.columnSpans.get(key) || [];
      // Merge or replace span at same base with max height
      let replaced = false;
      for (let i=0;i<spans.length;i++){
        const s = spans[i]; if ((s.b|0) === (it.b|0)){ spans[i] = { b: it.b|0, h: Math.max(it.h|0, s.h|0) }; replaced = true; break; }
      }
      if (!replaced) spans.push({ b: it.b|0, h: it.h|0 });
      // normalize and apply
      const norm = spans.filter(s=>s && (s.h|0)>0).map(s=>({ b:s.b|0, h:s.h|0 }));
      window.setSpansAt(it.gx, it.gy, norm);
      // Also set ground tile if base==0 to WALL for visibility
      if ((it.b|0) === 0 && typeof map !== 'undefined' && typeof TILE !== 'undefined'){
        const idx = mapIdx(it.gx, it.gy); map[idx] = TILE.WALL;
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
      gl.useProgram(trailCubeProgram);
      gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
      gl.uniform1f(tc_u_scale, 1.0);
      gl.uniform1f(tc_u_now, state.nowSec || (performance.now()/1000));
      gl.uniform1f(tc_u_ttl, 1.0);
      gl.uniform1i(tc_u_dashMode, 0);
      gl.uniform1f(tc_u_mulAlpha, 0.9);
      gl.uniform3f(tc_u_lineColor, 1.0, 0.9, 0.2);
      if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 0);
      gl.bindVertexArray(trailCubeVAO);
      // axis buffer for 1 instance
      if (typeof trailCubeVBO_Axis !== 'undefined' && trailCubeVBO_Axis){
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3), gl.DYNAMIC_DRAW);
      }
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
      const tNow = state.nowSec || (performance.now()/1000);
      // Multi-pass jitter to fake thicker lines
      const jitter = [ [0,0,0], [0.01,0,0], [-0.01,0,0], [0,0.01,0], [0,-0.01,0] ];
      for (let i=0;i<jitter.length;i++){
        const j = jitter[i];
        const instOne = new Float32Array([cx + j[0], y + j[1], cz + j[2], tNow]);
        gl.bufferData(gl.ARRAY_BUFFER, instOne, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.LINES, 0, 24, 1);
      }
      // leave blend enabled for previews, restore after
      gl.bindVertexArray(null);
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
      for (const it of prev){
        const cx = (it.gx - MAP_W*0.5 + 0.5);
        const cz = (it.gy - MAP_H*0.5 + 0.5);
        for (let level=0; level<it.h; level++){
          const y = (it.b + level) + 0.5;
          gl.uniform1f(tc_u_scale, 1.0);
          gl.uniform1f(tc_u_ttl, 1.0);
          gl.uniform1f(tc_u_mulAlpha, 0.8);
          gl.uniform3f(tc_u_lineColor, 0.2, 0.9, 0.9);
          gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
          const tNow2 = state.nowSec || (performance.now()/1000);
          // Multi-pass jitter for thickness
          const jitter2 = [ [0,0,0], [0.01,0,0], [-0.01,0,0], [0,0.01,0], [0,-0.01,0] ];
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
})();
