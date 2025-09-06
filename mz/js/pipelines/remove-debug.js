/**
 * Debug renderer for TILE.REMOVE volumes.
 * Draws translucent red boxes where map builder carved volumes, without affecting collisions.
 */

// Simple cube pipeline reused from walls but with solid color and alpha
const REM_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec4 a_inst; // x,z,yBase,height
uniform mat4 u_mvp;
uniform vec2 u_originXZ;
uniform float u_scale;
void main(){
  // a_pos is unit cube 0..1 in local space; scale Y by u_height
  vec3 p = a_pos;
  p.y = p.y * a_inst.w + a_inst.z; // a_inst.z carries base (world Y)
  // a_inst.x = grid x, a_inst.y = grid y (we use as z)
  vec2 xz = (vec2(p.x, p.z) + a_inst.xy + u_originXZ) * u_scale;
  gl_Position = u_mvp * vec4(xz.x, p.y, xz.y, 1.0);
}`;
const REM_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;
uniform float u_alpha;
out vec4 outColor;
void main(){ outColor = vec4(u_color, u_alpha); }`;

let remProg, rem_u_mvp, rem_u_origin, rem_u_scale, rem_u_color, rem_u_alpha;
let remVAO, remVBO_Pos, remVBO_Inst;

(function initRemoveDebug(){
  if (typeof gl === 'undefined') return;
  remProg = createProgram(REM_VS, REM_FS);
  rem_u_mvp = gl.getUniformLocation(remProg, 'u_mvp');
  rem_u_origin = gl.getUniformLocation(remProg, 'u_originXZ');
  rem_u_scale = gl.getUniformLocation(remProg, 'u_scale');
  rem_u_color = gl.getUniformLocation(remProg, 'u_color');
  rem_u_alpha = gl.getUniformLocation(remProg, 'u_alpha');
  remVAO = gl.createVertexArray();
  remVBO_Pos = gl.createBuffer();
  remVBO_Inst = gl.createBuffer();
  gl.bindVertexArray(remVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, remVBO_Pos);
  // Unit cube triangles (same as walls.js)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0,0,1,  1,0,1,  1,1,1,
    0,0,1,  1,1,1,  0,1,1,
    1,0,0,  0,0,0,  0,1,0,
    1,0,0,  0,1,0,  1,1,0,
    0,0,0,  0,0,1,  0,1,1,
    0,0,0,  0,1,1,  0,1,0,
    1,0,1,  1,0,0,  1,1,0,
    1,0,1,  1,1,0,  1,1,1,
    0,1,1,  1,1,1,  1,1,0,
    0,1,1,  1,1,0,  0,1,0,
    0,0,0,  1,0,0,  1,0,1,
    0,0,0,  1,0,1,  0,0,1,
  ]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, remVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
})();

function drawRemoveDebug(mvp){
  if (!remProg || !window.removeVolumes || !state || !state.debugVisible) return;
  const vols = window.removeVolumes;
  if (!Array.isArray(vols) || vols.length === 0) return;
  // Build instance buffer entries per voxel vertical slice to show actual thickness
  const inst = [];
  for (const r of vols){
    if (!r) continue; const x=r.x|0, y=r.y|0, b=(r.b|0)||0, h=(r.h|0)||0;
    if (h<=0) continue;
    // Push one instance with base b and height h
    inst.push(x, y, b, h);
  }
  if (!inst.length) return;
  const instArr = new Float32Array(inst);
  gl.useProgram(remProg);
  gl.uniformMatrix4fv(rem_u_mvp, false, mvp);
  gl.uniform2f(rem_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(rem_u_scale, 1.0);
  gl.uniform3f(rem_u_color, 0.95, 0.15, 0.2);
  gl.uniform1f(rem_u_alpha, 0.35);
  gl.bindVertexArray(remVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, remVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, instArr, gl.DYNAMIC_DRAW);

  // Render all instances in one pass
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, instArr.length / 4);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

// Expose globally
if (typeof window !== 'undefined') window.drawRemoveDebug = drawRemoveDebug;
else if (typeof globalThis !== 'undefined') globalThis.drawRemoveDebug = drawRemoveDebug;
