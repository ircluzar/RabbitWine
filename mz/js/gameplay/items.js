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
    items.push({ x: w.x, z: w.z, y: 0.65, payload: String(it.payload || ''), spawnT: t0, gone: false });
  }
}

function spawnItemWorld(x, y, z, payload){
  items.push({ x, y, z, payload: String(payload || ''), spawnT: state.nowSec || performance.now()/1000, gone: false });
}

function updateItems(dt){
  if (!items.length) return;
  // Player collision (simple sphere vs sphere)
  const p = state.player;
  const pr = Math.max(0.25, p.radius || 0.3);
  for (const it of items){
    if (it.gone) continue;
    const dx = it.x - p.x;
    const dz = it.z - p.z;
    const dy = (it.y) - (p.y + 0.25);
    const dist2 = dx*dx + dz*dz + dy*dy;
    const r = pr + 0.22; // item ~0.22 radius (a bit smaller than player cube 0.25)
    if (dist2 <= r*r){
      it.gone = true;
      // Hook for future gameplay: we keep payload string available
      // Optionally dispatch an event later using it.payload
    }
  }
}

function drawItems(mvp){
  const active = items.filter(it => !it.gone);
  if (active.length === 0) return;
  // Build instance buffer [x,y,z,spawnT] per item; animate in shader via spawnT
  const tNow = state.nowSec || (performance.now()/1000);
  const inst = new Float32Array(active.length * 4);
  for (let i=0;i<active.length;i++){
    const it = active[i];
    inst[i*4+0] = it.x;
    inst[i*4+1] = it.y; // already floating a bit above ground
    inst[i*4+2] = it.z;
    inst[i*4+3] = it.spawnT;
  }
  gl.useProgram(trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  // Base scale: 0.50 would match the green player cube; use slightly smaller
  gl.uniform1f(tc_u_scale, 0.46);
  gl.uniform1f(tc_u_now, tNow);
  gl.uniform1f(tc_u_ttl, 99999.0); // never fade automatically
  gl.uniform1i(tc_u_dashMode, 0);
  gl.uniform1f(tc_u_mulAlpha, 1.0);
  gl.uniform3f(tc_u_lineColor, 1.0, 0.95, 0.2); // yellow-ish
  // Enable animation uniforms
  gl.uniform1i(tc_u_useAnim, 1);
  gl.uniform1f(tc_u_rotSpeed, 1.2);      // rad/sec
  gl.uniform1f(tc_u_wobbleAmp, 0.06);    // meters
  gl.uniform1f(tc_u_wobbleSpeed, 0.5);   // Hz
  gl.bindVertexArray(trailCubeVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  // Thicker lines look achieved by drawing slight multi-pass scales
  gl.depthMask(false);
  gl.disable(gl.BLEND);
  const scales = [1.00, 1.02, 1.04, 1.06]; // stays < 0.5 overall (0.46 * 1.06 = 0.488)
  for (let s of scales){
    gl.uniform1f(tc_u_scale, 0.46 * s);
    gl.drawArraysInstanced(gl.LINES, 0, 24, active.length);
  }
  gl.depthMask(true);
  gl.bindVertexArray(null);
}

// Expose in global scope
if (typeof window !== 'undefined'){
  window.initItemsFromBuilder = initItemsFromBuilder;
  window.spawnItemWorld = spawnItemWorld;
  window.updateItems = updateItems;
  window.drawItems = drawItems;
  if (Array.isArray(window._pendingItems)){
    initItemsFromBuilder(window._pendingItems);
    delete window._pendingItems;
  }
}
