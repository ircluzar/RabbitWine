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
 * Handles both trail visualization and player model rendering with proper depth testing
 * and blending modes.
 * 
 * @param {Float32Array} mvp - Model-view-projection matrix for rendering
 */
function drawPlayerAndTrail(mvp){
  if (state._hidePlayer){
    // Player hidden mode - preview/visor rendering handled elsewhere
    return;
  }
  
  // === Trail Rendering ===
  // Render movement trail as instanced wireframe cubes
  const pts = state.trail.points;
  if (pts.length >= 1){
    // Prepare instance data: [x, y, z, birth_time] for each trail point
    const inst = new Float32Array(pts.length * 4);
    for (let i = 0; i < pts.length; i++){ 
      const p = pts[i]; 
      inst[i * 4 + 0] = p[0]; // x
      inst[i * 4 + 1] = p[1]; // y  
      inst[i * 4 + 2] = p[2]; // z
      inst[i * 4 + 3] = p[3]; // birth time
    }
    
    // Update trail edge jitter animation (16ms intervals)
    if (typeof ensureTrailEdgeJitterTick === 'function') {
      ensureTrailEdgeJitterTick(state.nowSec || (performance.now() / 1000));
    }
    
    // Configure trail cube shader
    gl.useProgram(trailCubeProgram);
    gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
    gl.uniform1f(tc_u_scale, 0.12);
    gl.uniform1f(tc_u_now, state.nowSec || (performance.now() / 1000));
    gl.uniform1f(tc_u_ttl, state.trail.ttl);
    gl.uniform1i(tc_u_dashMode, 0);
    gl.uniform1f(tc_u_mulAlpha, 1.0);
    gl.uniform3f(tc_u_lineColor, 1.0, 1.0, 1.0);
    
    // Disable shader-based animation (using persistent VBO mutation instead)
    if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) {
      gl.uniform1i(tc_u_useAnim, 0);
    }
    
    // Upload instance data
    gl.bindVertexArray(trailCubeVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
    
    // Handle per-instance corner offsets for different camera views
    if (typeof trailCubeVBO_Corners !== 'undefined'){
      if (state.cameraKindCurrent === 'top' && typeof getTrailCornerOffsetsBuffer === 'function'){
        // Top view: apply dynamic corner offsets for animation
        const now = state.nowSec || (performance.now() / 1000);
        const keys = new Array(pts.length);
        for (let i = 0; i < pts.length; i++){ 
          const p = pts[i]; 
          keys[i] = `trail@${p[3] || 0}`; 
        }
        const packed = getTrailCornerOffsetsBuffer(keys, now);
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
        gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
      } else {
        // Bottom view: use zero offsets (no animation)
        const zeros = new Float32Array(pts.length * 8 * 3);
        gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
        gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
      }
    }
    
    // Upload axis data for per-instance attribute (unused when u_useAnim=0)
    if (typeof trailCubeVBO_Axis !== 'undefined' && trailCubeVBO_Axis){
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts.length * 3), gl.DYNAMIC_DRAW);
    }
    
    // Render trail with alpha blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false); // Don't write to depth buffer
    gl.drawArraysInstanced(gl.LINES, 0, 24, pts.length);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
  
  // === Player Character Rendering ===
  const p = state.player;
  
  // Calculate player model transformation matrix
  let model = mat4Multiply(
    mat4Translate(p.x, p.y + 0.25, p.z), 
    mat4RotateY(p.angle)
  );
  model = mat4Multiply(model, mat4Scale(1, 1, 1));
  
  const nowSec = state.nowSec || (performance.now() / 1000);
  const inBall = !!p.isBallMode;
  const flash = inBall && nowSec <= (p._ballFlashUntilSec || 0);
  
  // Player dual-pass (visible + occluded) with uniform reuse instrumentation
  if (!window.__playerDrawStats) window.__playerDrawStats = { passes:0, uniformSets:0, reuse:0 };
  if (!inBall || flash){
    gl.useProgram(playerProgram);
    // Set once per frame for both passes
    gl.uniformMatrix4fv(pl_u_mvp, false, mvp);
    gl.uniformMatrix4fv(pl_u_model, false, model);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, playerTexArray);
    if (pl_u_tex) gl.uniform1i(pl_u_tex, 0);
    if (pl_u_forceWhite) gl.uniform1i(pl_u_forceWhite, (flash ? 2 : (state.player.isFrozen ? 1 : 0)));
    window.__playerDrawStats.uniformSets++;

    // First (visible) pass
    if (typeof pl_u_stipple !== 'undefined' && pl_u_stipple) gl.uniform1i(pl_u_stipple, 0);
    gl.bindVertexArray(playerVAO);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    window.__playerDrawStats.passes++;

    // Second (occluded) pass reuses same bound program, textures & matrices
    if (typeof pl_u_stipple !== 'undefined' && pl_u_stipple) gl.uniform1i(pl_u_stipple, 1);
    if (pl_u_forceWhite) gl.uniform1i(pl_u_forceWhite, (flash ? 2 : (state.player.isFrozen ? 1 : 0))); // minimal state churn
    window.__playerDrawStats.reuse++;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthFunc(gl.GREATER);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    window.__playerDrawStats.passes++;
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.depthFunc(gl.LESS);
    gl.bindVertexArray(null);
  }

  // === Player Wireframe Contour ===
  // White wireframe outline slightly larger than the cube
  if (typeof ensureTrailEdgeJitterTick === 'function') {
    ensureTrailEdgeJitterTick(state.nowSec || (performance.now() / 1000));
  }
  
  gl.useProgram(trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  gl.uniform1f(tc_u_scale, 0.54); // Slightly larger than player cube for outline effect
  gl.uniform1f(tc_u_now, nowSec);
  gl.uniform1f(tc_u_ttl, 1.0);
  gl.uniform1i(tc_u_dashMode, 1); // Dashed outline
  gl.uniform1f(tc_u_mulAlpha, 0.85); // Semi-transparent
  
  // Color coding: white for normal mode, red for ball mode
  if (inBall && !flash) {
    gl.uniform3f(tc_u_lineColor, 1.0, 0.2, 0.2); // Red in ball mode
  } else {
    gl.uniform3f(tc_u_lineColor, 1.0, 1.0, 1.0); // White in normal mode
  }
  
  // Disable shader-based jitter (using persistent VBO mutation instead)
  if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) {
    gl.uniform1i(tc_u_useAnim, 0);
  }
  gl.bindVertexArray(trailCubeVAO);
  // Per-instance corners for the player's outline (single instance)
  if (typeof trailCubeVBO_Corners !== 'undefined'){
    if (state.cameraKindCurrent === 'top' && typeof getTrailCornerOffsetsBuffer === 'function'){
      const packed = getTrailCornerOffsetsBuffer([`player-wire`], state.nowSec || (performance.now()/1000));
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
      gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
    } else {
      const zeros = new Float32Array(8 * 3); // one instance
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
      gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
    }
  }
  // Bind a zeroed axis stream sized for 1 instance to satisfy attrib 3 layout
  if (typeof trailCubeVBO_Axis !== 'undefined' && trailCubeVBO_Axis){
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3), gl.DYNAMIC_DRAW);
  }
  // Player wireframe: normal small white jittered shell; in ball mode, draw spinning red wireframe (same size as green)
  if (inBall && !flash){
  // Ensure full lines (no dash) so the spinning cube edges are visible
  if (typeof tc_u_dashMode !== 'undefined' && tc_u_dashMode) gl.uniform1i(tc_u_dashMode, 0);
  // Keep alpha stable during ball mode by using a long TTL
  if (typeof tc_u_ttl !== 'undefined' && tc_u_ttl) gl.uniform1f(tc_u_ttl, 9999.0);
  if (typeof tc_u_mulAlpha !== 'undefined' && tc_u_mulAlpha) gl.uniform1f(tc_u_mulAlpha, 1.0);
    // Use axis stream to spin
    if (typeof trailCubeVBO_Axis !== 'undefined' && trailCubeVBO_Axis){
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([p._ballSpinAxisX||0, p._ballSpinAxisY||1, p._ballSpinAxisZ||0]), gl.DYNAMIC_DRAW);
    }
    // Enable animation in shader: use rot speed as spin speed
    if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 1);
    if (typeof tc_u_rotSpeed !== 'undefined' && tc_u_rotSpeed) gl.uniform1f(tc_u_rotSpeed, p._ballSpinSpeed || 1.0);
    if (typeof tc_u_wobbleAmp !== 'undefined' && tc_u_wobbleAmp) gl.uniform1f(tc_u_wobbleAmp, 0.0);
    if (typeof tc_u_wobbleSpeed !== 'undefined' && tc_u_wobbleSpeed) gl.uniform1f(tc_u_wobbleSpeed, 0.0);
    // No jitter offsets for spinning cube
    if (typeof trailCubeVBO_Corners !== 'undefined'){
      const zeros = new Float32Array(8 * 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
      gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
    }
    // One instance at player center (same size as green cube shell: 0.54)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  // Draw on top of everything: disable depth test for this pass (don’t write depth)
  gl.disable(gl.DEPTH_TEST);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  // Use ball start time as seed so shader angle grows with (u_now - seed)
  const instOne = new Float32Array([p.x, p.y + 0.25, p.z, p._ballStartSec || nowSec]);
    gl.bufferData(gl.ARRAY_BUFFER, instOne, gl.DYNAMIC_DRAW);
    gl.depthMask(false);
    gl.drawArraysInstanced(gl.LINES, 0, 24, 1);
    gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  } else {
    // Normal white jittered shell behavior (INSTANCED REFACTOR)
    if (!window.__playerOutlineStats){ window.__playerOutlineStats = { jitterInstanceCount:0, uploads:0 }; }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
    // Predefined jitter offsets (7 instances)
    const OFFS = window.__playerOutlineOffsets || (
      window.__playerOutlineOffsets = [
        0,0,0,
        +0.01,0,0,  -0.01,0,0,
        0,+0.01,0,  0,-0.01,0,
        0,0,+0.01,  0,0,-0.01
      ]
    );
    // Build a single instance buffer: [x,y,z,seed] per instance
    const n = OFFS.length/3;
    const buf = (window.__playerOutlineScratch && window.__playerOutlineScratch.length === n*4)
      ? window.__playerOutlineScratch
      : (window.__playerOutlineScratch = new Float32Array(n*4));
    for (let i=0;i<n;i++){
      const bx = OFFS[i*3+0], by = OFFS[i*3+1], bz = OFFS[i*3+2];
      buf[i*4+0] = p.x + bx;
      buf[i*4+1] = p.y + 0.25 + by;
      buf[i*4+2] = p.z + bz;
      buf[i*4+3] = nowSec; // birth/seed
    }
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);
    window.__playerOutlineStats.uploads++;
    gl.depthMask(false);
    gl.drawArraysInstanced(gl.LINES, 0, 24, n);
    window.__playerOutlineStats.jitterInstanceCount = n;
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}

// Export functions to global scope for use by other modules
if (typeof window !== 'undefined') {
  window.handleSwipeTurns = handleSwipeTurns;
  window.drawPlayerAndTrail = drawPlayerAndTrail;
}
