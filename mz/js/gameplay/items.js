"use strict";
/**
 * Item system: spawn from map data, animate floating rotating yellow wireframe cubes, pickup on collision.
 * Public API:
 *  - initItemsFromBuilder(items: Array<{x:number,y:number,payload:string}>): world positions from grid
 *  - spawnItemWorld(x:number,y:number,z:number,payload:string)
 *  - drawItems(mvp): render all active items
 *  - updateItems(dt): update animation state and handle pickups
 */

// Internal store
const items = [];
const purpleItems = [];
// Default visual float height for items without explicit Y
const ITEM_DEFAULT_FLOAT_Y = 0.75;

function gridToWorld(gx, gy){
  return {
    x: (gx + 0.5) - MAP_W * 0.5,
    z: (gy + 0.5) - MAP_H * 0.5,
  };
}

function initItemsFromBuilder(list){
  items.length = 0;
  purpleItems.length = 0;
  if (!Array.isArray(list)) return;
  const t0 = (state.nowSec || performance.now()/1000);
  for (const it of list){
    if (!it || typeof it.x !== 'number' || typeof it.y !== 'number') continue;
    const w = gridToWorld(it.x, it.y);
  // Skip items previously collected (from save)
  try { if (window.gameSave && gameSave.isItemCollected(w.x, w.z)) continue; } catch(_){ }
    // random unit axis for 3D spin
    let ax = Math.random()*2-1, ay = Math.random()*2-1, az = Math.random()*2-1;
    const al = Math.hypot(ax,ay,az) || 1; ax/=al; ay/=al; az/=al;
  // inner cube axis (independent random unit axis)
  let ix = Math.random()*2-1, iy = Math.random()*2-1, iz = Math.random()*2-1;
  const il = Math.hypot(ix,iy,iz) || 1; ix/=il; iy/=il; iz/=il;
  // Default Y for legacy/sample content is 0.0; allow optional builder-provided Y
  // Default float height when not explicitly provided
  const iyOpt = (typeof it.yWorld === 'number') ? it.yWorld
         : (typeof it.yBase === 'number') ? it.yBase
         : (typeof it.y0 === 'number') ? it.y0
         : ITEM_DEFAULT_FLOAT_Y;
  items.push({ x: w.x, z: w.z, y: iyOpt, payload: String(it.payload || ''), spawnT: t0, gone: false, ax, ay, az, ix, iy, iz });
  }
}

function spawnItemWorld(x, y, z, payload){
  let ax = Math.random()*2-1, ay = Math.random()*2-1, az = Math.random()*2-1;
  const al = Math.hypot(ax,ay,az) || 1; ax/=al; ay/=al; az/=al;
  let ix = Math.random()*2-1, iy = Math.random()*2-1, iz = Math.random()*2-1;
  const il = Math.hypot(ix,iy,iz) || 1; ix/=il; iy/=il; iz/=il;
  items.push({ x, y, z, payload: String(payload || ''), spawnT: state.nowSec || performance.now()/1000, gone: false, ax, ay, az, ix, iy, iz });
}

function spawnPurpleItemWorld(x, y, z){
  let ax = Math.random()*2-1, ay = Math.random()*2-1, az = Math.random()*2-1;
  const al = Math.hypot(ax,ay,az) || 1; ax/=al; ay/=al; az/=al;
  let ix = Math.random()*2-1, iy = Math.random()*2-1, iz = Math.random()*2-1;
  const il = Math.hypot(ix,iy,iz) || 1; ix/=il; iy/=il; iz/=il;
  purpleItems.push({ x, y, z, spawnT: state.nowSec || performance.now()/1000, gone: false, ax, ay, az, ix, iy, iz });
}

// Remove items at (world x,z) cell (within small epsilon). Returns number removed.
function removeItemsAtWorld(x, z){
  let removed = 0;
  for (let i=items.length-1;i>=0;i--){
    const it = items[i]; if (!it || it.gone) continue;
    if (Math.abs(it.x - x) < 0.4 && Math.abs(it.z - z) < 0.4){ items.splice(i,1); removed++; }
  }
  for (let i=purpleItems.length-1;i>=0;i--){
    const it = purpleItems[i]; if (!it || it.gone) continue;
    if (Math.abs(it.x - x) < 0.4 && Math.abs(it.z - z) < 0.4){ purpleItems.splice(i,1); removed++; }
  }
  return removed;
}

// Query active items (for export or debug)
function listActiveItems(){ return items.filter(it=>!it.gone).map(it=>({ x: it.x, y: it.y, z: it.z, payload: it.payload })); }
function listActivePurpleItems(){ return purpleItems.filter(it=>!it.gone).map(it=>({ x: it.x, y: it.y, z: it.z })); }

function updateItems(dt){
  const p = state.player;
  const pr = Math.max(0.25, p.radius || 0.3);
  if (items.length){
    for (const it of items){
      if (it.gone) continue;
      const dx = it.x - p.x;
      const dz = it.z - p.z;
      const itemHalf = 0.24;
      const pTop = p.y + 0.25;
      const itemBottom = it.y - itemHalf;
      const itemTop = it.y + itemHalf;
      let dy = 0.0;
      if (pTop < itemBottom) dy = itemBottom - pTop; else if (pTop > itemTop) dy = pTop - itemTop;
      const dist2 = dx*dx + dz*dz + dy*dy;
      const r = pr + 0.26;
      if (dist2 <= r*r){
        it.gone = true;
        try { if (window.gameSave) gameSave.markItemCollected(it); } catch(_){ }
        if (typeof dispatchAction === 'function' && it.payload){ dispatchAction(it.payload, it); }
        try { if (window.sfx) sfx.play('./sfx/VRUN_HealthGet.mp3'); } catch(_){ }
        p.speed = 0.0; p.movementMode = 'stationary'; p.isDashing = false;
        const nowSec = state.nowSec || (performance.now()/1000);
        const age = Math.max(0, nowSec - (it.spawnT || nowSec));
        const outerAxis = { x: it.ax || 0, y: it.ay || 1, z: it.az || 0 };
        const innerAxis = { x: it.ix || 0, y: it.iy || 1, z: it.iz || 0 };
        const outerAngle = 0.35 * age;
        const innerAngle = 0.55 * age;
        if (typeof spawnPickupFloatingLinesWithRotation === 'function'){
          spawnPickupFloatingLinesWithRotation(it.x, it.y, it.z, 0.46, 0.28, outerAxis, outerAngle, innerAxis, innerAngle);
        } else if (typeof spawnPickupFloatingLines === 'function'){
          spawnPickupFloatingLines(it.x, it.y, it.z, 0.46, 0.28);
        }
      }
    }
  }
  // Always process purple items too
  if (typeof updatePurpleItems === 'function') updatePurpleItems(dt);
}

function updatePurpleItems(dt){
  if (!purpleItems.length) return;
  const p = state.player; const pr = Math.max(0.25, p.radius || 0.3);
  for (const it of purpleItems){
    if (it.gone) continue;
    const dx = it.x - p.x;
    const dz = it.z - p.z;
    const itemHalf = 0.24;
    const pTop = p.y + 0.25;
    const itemBottom = it.y - itemHalf;
    const itemTop = it.y + itemHalf;
    let dy = 0.0;
    if (pTop < itemBottom) dy = itemBottom - pTop; else if (pTop > itemTop) dy = pTop - itemTop;
    const dist2 = dx*dx + dz*dz + dy*dy;
    const r = pr + 0.26;
    if (dist2 <= r*r){
      it.gone = true;
      // Play distinct SFX
      try { if (window.sfx) sfx.play('./sfx/TunnelRun_EnterVRUN.mp3'); } catch(_){ }
      // Track purple collections per level
      try {
        if (window.gameSave && typeof window.trackPurpleItemCollected === 'function'){
          window.trackPurpleItemCollected(it);
        }
      } catch(_){ }
      // Enhanced FX: triple density, faster spin/drift, longer life
      try {
        if (typeof spawnPickupFloatingLinesWithRotation === 'function'){
          const nowSec = state.nowSec || (performance.now()/1000);
          const age = Math.max(0, nowSec - (it.spawnT || nowSec));
          const outerAxis = { x: it.ax || 0, y: it.ay || 1, z: it.az || 0 };
          const innerAxis = { x: it.ix || 0, y: it.iy || 1, z: it.iz || 0 };
          const outerAngle = 0.55 * age; // faster
          const innerAngle = 0.85 * age; // faster
          // Use only purple-tinted custom bursts (no yellow)
          if (typeof spawnFloatingLinesCustom === 'function'){
            for (let k=0;k<3;k++){
              spawnFloatingLinesCustom(it.x, it.y, it.z,
                {r:0.72,g:0.35,b:1.0},{r:0.95,g:0.85,b:1.0}, 0.50, 0.30,
                {axis:outerAxis, angle: outerAngle + k*0.35 + Math.random()*0.4},
                {axis:innerAxis, angle: innerAngle + k*0.5 + Math.random()*0.6});
            }
          }
          // Increase global FX speeds/TTLs temporarily (if supported) by duplicating lines with longer ttl via direct push not exposed -> skipped for now
        }
      } catch(_){ }
    }
  }
}

function drawItems(mvp){
  const active = items.filter(it => !it.gone);
  const activePurple = purpleItems.filter(it=>!it.gone);
  if (active.length === 0 && activePurple.length === 0) return;
  // Build instance buffer [x,y,z,spawnT] per item; animate in shader via spawnT
  const tNow = state.nowSec || (performance.now()/1000);
  const inst = new Float32Array(active.length * 4);
  const axis = new Float32Array(active.length * 3);
  const axisInner = new Float32Array(active.length * 3);
  for (let i=0;i<active.length;i++){
    const it = active[i];
    inst[i*4+0] = it.x;
    inst[i*4+1] = it.y; // already floating a bit above ground
    inst[i*4+2] = it.z;
    inst[i*4+3] = it.spawnT;
    axis[i*3+0] = it.ax || 0.0;
    axis[i*3+1] = it.ay || 1.0;
    axis[i*3+2] = it.az || 0.0;
    axisInner[i*3+0] = it.ix || 0.0;
    axisInner[i*3+1] = it.iy || 1.0;
    axisInner[i*3+2] = it.iz || 0.0;
  }
  gl.useProgram(trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  // Base scale: 0.50 would match the green player cube; use slightly smaller
  gl.uniform1f(tc_u_scale, 0.46);
  gl.uniform1f(tc_u_now, tNow);
  gl.uniform1f(tc_u_ttl, 99999.0); // never fade automatically
  gl.uniform1i(tc_u_dashMode, 0);
  gl.uniform1f(tc_u_mulAlpha, 1.0);
  // Enable animation uniforms
  gl.uniform1i(tc_u_useAnim, 1);
  gl.uniform1f(tc_u_rotSpeed, 0.35);      // slower spin
  gl.uniform1f(tc_u_wobbleAmp, 0.06);    // meters
  gl.uniform1f(tc_u_wobbleSpeed, 0.5);   // Hz
  gl.bindVertexArray(trailCubeVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  // Per-instance corner offsets keyed per item: jitter on top view, zeros on bottom
  if (typeof trailCubeVBO_Corners !== 'undefined'){
    if (state.cameraKindCurrent === 'top' && typeof getTrailCornerOffsetsBuffer === 'function'){
      const keys = new Array(active.length);
      for (let i=0;i<active.length;i++){ const it=active[i]; keys[i] = `item@${it.x.toFixed(2)},${it.y.toFixed(2)},${it.z.toFixed(2)}`; }
      const packed = getTrailCornerOffsetsBuffer(keys, tNow);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
      gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
    } else {
      const zeros = new Float32Array(active.length * 8 * 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
      gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
    }
  }
  // Upload per-instance rotation axes
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
  gl.bufferData(gl.ARRAY_BUFFER, axis, gl.DYNAMIC_DRAW);
  // Thicker lines look achieved by drawing slight multi-pass scales
  gl.depthMask(false);
  gl.disable(gl.BLEND);
  // Outer yellow box
  gl.uniform3f(tc_u_lineColor, 1.0, 0.95, 0.2); // yellow-ish
  const scales = [1.00, 1.02, 1.04, 1.06]; // stays < 0.5 overall (0.46 * 1.06 = 0.488)
  for (let s of scales){
    gl.uniform1f(tc_u_scale, 0.46 * s);
    gl.drawArraysInstanced(gl.LINES, 0, 24, active.length);
  }
  // Inner smaller white box (different random axis and slightly different speed)
  gl.uniform1f(tc_u_rotSpeed, 0.55);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
  gl.bufferData(gl.ARRAY_BUFFER, axisInner, gl.DYNAMIC_DRAW);
  gl.uniform3f(tc_u_lineColor, 1.0, 1.0, 1.0);
  const innerBase = 0.28;
  const innerScales = [1.00, 1.02, 1.04];
  for (let s of innerScales){
    gl.uniform1f(tc_u_scale, innerBase * s);
    gl.drawArraysInstanced(gl.LINES, 0, 24, active.length);
  }
  // Draw purple items (reuse buffers per pass)
  if (activePurple.length){
    const tNow2 = state.nowSec || (performance.now()/1000);
    const inst2 = new Float32Array(activePurple.length * 4);
    const axis2 = new Float32Array(activePurple.length * 3);
    const axisInner2 = new Float32Array(activePurple.length * 3);
    for (let i=0;i<activePurple.length;i++){
      const it = activePurple[i];
      inst2[i*4+0] = it.x; inst2[i*4+1] = it.y; inst2[i*4+2] = it.z; inst2[i*4+3] = it.spawnT;
      axis2[i*3+0] = it.ax; axis2[i*3+1] = it.ay; axis2[i*3+2] = it.az;
      axisInner2[i*3+0] = it.ix; axisInner2[i*3+1] = it.iy; axisInner2[i*3+2] = it.iz;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, inst2, gl.DYNAMIC_DRAW);
    if (typeof trailCubeVBO_Corners !== 'undefined'){
      if (state.cameraKindCurrent === 'top' && typeof getTrailCornerOffsetsBuffer === 'function'){
        const keys = new Array(activePurple.length);
        for (let i=0;i<activePurple.length;i++){ const it=activePurple[i]; keys[i] = `pitem@${it.x.toFixed(2)},${it.y.toFixed(2)},${it.z.toFixed(2)}`; }
        const packed = getTrailCornerOffsetsBuffer(keys, tNow2);
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
        gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
      } else {
        const zeros = new Float32Array(activePurple.length * 8 * 3);
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
        gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis); gl.bufferData(gl.ARRAY_BUFFER, axis2, gl.DYNAMIC_DRAW);
    gl.uniform3f(tc_u_lineColor, 0.72, 0.35, 1.0); // purple outer
    for (let s of scales){ gl.uniform1f(tc_u_scale, 0.46 * s); gl.drawArraysInstanced(gl.LINES, 0, 24, activePurple.length); }
    gl.uniform1f(tc_u_rotSpeed, 0.55); gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis); gl.bufferData(gl.ARRAY_BUFFER, axisInner2, gl.DYNAMIC_DRAW);
    gl.uniform3f(tc_u_lineColor, 0.95, 0.85, 1.0); // pale inner
    for (let s of innerScales){ gl.uniform1f(tc_u_scale, innerBase * s); gl.drawArraysInstanced(gl.LINES, 0, 24, activePurple.length); }
  }
  gl.depthMask(true);
  gl.bindVertexArray(null);
}

// Expose in global scope
if (typeof window !== 'undefined'){
  window.initItemsFromBuilder = initItemsFromBuilder;
  window.spawnItemWorld = spawnItemWorld;
  window.spawnPurpleItemWorld = spawnPurpleItemWorld;
  window.removeItemsAtWorld = removeItemsAtWorld;
  window.listActiveItems = listActiveItems;
  window.listActivePurpleItems = listActivePurpleItems;
  window.updateItems = updateItems;
  window.updatePurpleItems = updatePurpleItems;
  window.drawItems = drawItems;
  if (Array.isArray(window._pendingItems)){
    initItemsFromBuilder(window._pendingItems);
    delete window._pendingItems;
  }
}
