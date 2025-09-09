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

// Remove items at (world x,z) cell (within small epsilon). Returns number removed.
function removeItemsAtWorld(x, z){
  let removed = 0;
  for (let i=items.length-1;i>=0;i--){
    const it = items[i]; if (!it || it.gone) continue;
    if (Math.abs(it.x - x) < 0.4 && Math.abs(it.z - z) < 0.4){ items.splice(i,1); removed++; }
  }
  return removed;
}

// Query active items (for export or debug)
function listActiveItems(){ return items.filter(it=>!it.gone).map(it=>({ x: it.x, y: it.y, z: it.z, payload: it.payload })); }

function updateItems(dt){
  if (!items.length) return;
  // Player collision (simple sphere vs sphere)
  const p = state.player;
  const pr = Math.max(0.25, p.radius || 0.3);
  for (const it of items){
    if (it.gone) continue;
    const dx = it.x - p.x;
    const dz = it.z - p.z;
    // Use the item's vertical extent so the hit reaches the bottom of the block area
  const itemHalf = 0.24; // half-height of the drawn cube (~0.46 scale)
  const pTop = p.y + 0.25; // player's top
  const itemBottom = it.y - itemHalf;
  const itemTop = it.y + itemHalf;
  let dy = 0.0;
  if (pTop < itemBottom) dy = itemBottom - pTop;
  else if (pTop > itemTop) dy = pTop - itemTop;
    const dist2 = dx*dx + dz*dz + dy*dy;
    const r = pr + 0.26; // slightly larger pickup radius so it feels forgiving
    if (dist2 <= r*r){
  it.gone = true;
  // Mark as collected in save
  try { if (window.gameSave) gameSave.markItemCollected(it); } catch(_){ }
      // Dispatch payload action immediately (unlock abilities etc.)
      if (typeof dispatchAction === 'function' && it.payload){
        dispatchAction(it.payload, it);
      }
  // Play pickup SFX
  try { if (window.sfx) sfx.play('./sfx/VRUN_HealthGet.mp3'); } catch(_){ }
  // Stop player movement immediately (stationary)
  p.speed = 0.0;
  p.movementMode = 'stationary';
  p.isDashing = false;
      // Spawn floating edge lines FX at the item's location with proper rotation
      const nowSec = state.nowSec || (performance.now()/1000);
      const age = Math.max(0, nowSec - (it.spawnT || nowSec));
      const outerAxis = { x: it.ax || 0, y: it.ay || 1, z: it.az || 0 };
      const innerAxis = { x: it.ix || 0, y: it.iy || 1, z: it.iz || 0 };
      const outerAngle = 0.35 * age;
      const innerAngle = 0.55 * age;
      if (typeof spawnPickupFloatingLinesWithRotation === 'function'){
        spawnPickupFloatingLinesWithRotation(it.x, it.y, it.z, 0.46, 0.28, outerAxis, outerAngle, innerAxis, innerAngle);
      } else if (typeof spawnPickupFloatingLines === 'function'){
        // Fallback: no rotation alignment available
        spawnPickupFloatingLines(it.x, it.y, it.z, 0.46, 0.28);
      }
    }
  }
}

function drawItems(mvp){
  const active = items.filter(it => !it.gone);
  if (active.length === 0) return;
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
  gl.depthMask(true);
  gl.bindVertexArray(null);
}

// Expose in global scope
if (typeof window !== 'undefined'){
  window.initItemsFromBuilder = initItemsFromBuilder;
  window.spawnItemWorld = spawnItemWorld;
  window.removeItemsAtWorld = removeItemsAtWorld;
  window.listActiveItems = listActiveItems;
  window.updateItems = updateItems;
  window.drawItems = drawItems;
  if (Array.isArray(window._pendingItems)){
    initItemsFromBuilder(window._pendingItems);
    delete window._pendingItems;
  }
}
