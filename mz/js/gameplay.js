/**
 * Player and trail rendering functions using established rendering pipelines.
 * Provides high-level rendering calls for player character and movement trail visualization.
 * Exports: handleSwipeTurns(), drawPlayerAndTrail() functions.
 * Dependencies: trail pipeline from pipelines/trail.js, state.trail from state.js. Side effects: Modifies WebGL state during rendering.
 */

// Rendering for player and trail (uses pipeline globals)

/**
 * Handle swipe-based turning (placeholder for future multi-touch support)
 * Main logic is in pointer event handlers
 */
function handleSwipeTurns(){
  // kept for potential multi-touch future; main logic lives in pointer handlers
}

/**
 * Render player character and movement trail
 * @param {Float32Array} mvp - Model-view-projection matrix
 */
function drawPlayerAndTrail(mvp){
  if (state._hidePlayer){
    // Still draw preview/visor if hooked from bootstrap
  } else {
  // Trail as instanced wireframe cubes
  const pts = state.trail.points;
  if (pts.length >= 1){
    const inst = new Float32Array(pts.length * 4);
    for (let i=0;i<pts.length;i++){ 
      const p=pts[i]; 
      inst[i*4+0]=p[0]; inst[i*4+1]=p[1]; inst[i*4+2]=p[2]; inst[i*4+3]=p[3]; 
    }
    gl.useProgram(trailCubeProgram);
    gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
    gl.uniform1f(tc_u_scale, 0.12);
    gl.uniform1f(tc_u_now, state.nowSec || (performance.now()/1000));
    gl.uniform1f(tc_u_ttl, state.trail.ttl);
    gl.uniform1i(tc_u_dashMode, 0);
    gl.uniform1f(tc_u_mulAlpha, 1.0);
    gl.uniform3f(tc_u_lineColor, 1.0, 1.0, 1.0);
  if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 0);
    gl.bindVertexArray(trailCubeVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
    // Satisfy a_axis per-instance attrib (layout=3) with zeros; u_useAnim=0 makes it unused
    if (typeof trailCubeVBO_Axis !== 'undefined' && trailCubeVBO_Axis){
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts.length * 3), gl.DYNAMIC_DRAW);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArraysInstanced(gl.LINES, 0, 24, pts.length);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
  // Player arrow
  const p = state.player;
  let model = mat4Multiply(mat4Translate(p.x, p.y+0.25, p.z), mat4RotateY(p.angle));
  model = mat4Multiply(model, mat4Scale(1,1,1));
  // First pass: draw only the visible (not occluded) parts, write depth
  gl.useProgram(playerProgram);
  gl.uniformMatrix4fv(pl_u_mvp, false, mvp);
  gl.uniformMatrix4fv(pl_u_model, false, model);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, playerTexArray);
  if (pl_u_tex) gl.uniform1i(pl_u_tex, 0);
  if (pl_u_forceWhite) gl.uniform1i(pl_u_forceWhite, state.player.isFrozen ? 1 : 0);
  if (typeof pl_u_stipple !== 'undefined' && pl_u_stipple) gl.uniform1i(pl_u_stipple, 0);
  gl.bindVertexArray(playerVAO);
  gl.depthFunc(gl.LEQUAL);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.drawArrays(gl.TRIANGLES, 0, 36);
  gl.bindVertexArray(null);

  // Second pass: draw only occluded fragments with checkerboard stipple
  gl.useProgram(playerProgram);
  gl.uniformMatrix4fv(pl_u_mvp, false, mvp);
  gl.uniformMatrix4fv(pl_u_model, false, model);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, playerTexArray);
  if (pl_u_tex) gl.uniform1i(pl_u_tex, 0);
  if (pl_u_forceWhite) gl.uniform1i(pl_u_forceWhite, state.player.isFrozen ? 1 : 0);
  if (typeof pl_u_stipple !== 'undefined' && pl_u_stipple) gl.uniform1i(pl_u_stipple, 1);
  gl.bindVertexArray(playerVAO);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthFunc(gl.GREATER); // Only draw where player is behind existing depth (occluded)
  gl.depthMask(false);      // Don't disturb depth buffer
  gl.drawArrays(gl.TRIANGLES, 0, 36);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(null);

  // White wireframe contour slightly larger than the cube, floating around it
  gl.useProgram(trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  gl.uniform1f(tc_u_scale, 0.54);
  gl.uniform1f(tc_u_now, state.nowSec || (performance.now()/1000));
  gl.uniform1f(tc_u_ttl, 1.0);
  gl.uniform1i(tc_u_dashMode, 1);
  gl.uniform1f(tc_u_mulAlpha, 0.85);
  gl.uniform3f(tc_u_lineColor, 1.0, 1.0, 1.0);
  if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 0);
  gl.bindVertexArray(trailCubeVAO);
  // Bind a zeroed axis stream sized for 1 instance to satisfy attrib 3 layout
  if (typeof trailCubeVBO_Axis !== 'undefined' && trailCubeVBO_Axis){
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3), gl.DYNAMIC_DRAW);
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  const tNow = state.nowSec || (performance.now()/1000);
  const offsets = [
    [0,0,0],
    [0.01,0.00,0.00], [-0.01,0.00,0.00],
    [0.00,0.01,0.00], [0.00,-0.01,0.00],
    [0.00,0.00,0.01], [0.00,0.00,-0.01],
  ];
  for (let i=0;i<offsets.length;i++){
    const o = offsets[i];
    const instOne = new Float32Array([p.x + o[0], p.y + 0.25 + o[1], p.z + o[2], tNow]);
    gl.bufferData(gl.ARRAY_BUFFER, instOne, gl.DYNAMIC_DRAW);
    gl.depthMask(false);
    gl.drawArraysInstanced(gl.LINES, 0, 24, 1);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
  }
}
