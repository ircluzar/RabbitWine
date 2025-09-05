/**
 * Tile rendering pipeline for ground/floor tiles.
 * Manages instanced rendering of floor tiles with position offsets and configurable colors.
 * Exports: TILE_VS, TILE_FS shaders, tileProgram, tileVAO, and drawTiles() function.
 * Dependencies: createProgram() from gl-core.js, gl context. Side effects: Creates VAO/VBO resources and modifies WebGL state.
 */

// Tile pipeline (extracted from scene.js)
const TILE_VS = `#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=1) in vec2 a_off;\nuniform mat4 u_mvp;\nuniform vec2 u_originXZ;\nuniform float u_scale;\nuniform float u_y;\nvoid main(){\n  vec2 xz = (a_pos.xz + a_off + u_originXZ) * u_scale;\n  vec3 world = vec3(xz.x, u_y, xz.y);\n  gl_Position = u_mvp * vec4(world, 1.0);\n}\n`;
const TILE_FS = `#version 300 es\nprecision mediump float;\nuniform vec3 u_color;\nout vec4 outColor;\nvoid main(){ outColor = vec4(u_color,1.0); }\n`;

const tileProgram = createProgram(TILE_VS, TILE_FS);
const tile_u_mvp = gl.getUniformLocation(tileProgram, 'u_mvp');
const tile_u_origin = gl.getUniformLocation(tileProgram, 'u_originXZ');
const tile_u_scale = gl.getUniformLocation(tileProgram, 'u_scale');
const tile_u_y = gl.getUniformLocation(tileProgram, 'u_y');
const tile_u_color = gl.getUniformLocation(tileProgram, 'u_color');

const tileVAO = gl.createVertexArray();
const tileVBO_Pos = gl.createBuffer();
const tileVBO_Inst = gl.createBuffer();
gl.bindVertexArray(tileVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Pos);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  0,0,0,  1,0,0,  1,0,1,
  0,0,0,  1,0,1,  0,0,1,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Inst);
gl.bufferData(gl.ARRAY_BUFFER, instOpen, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

function drawTiles(mvp, kind){
  const isWall = kind === 'wall';
  const data = isWall ? instWall : instOpen;
  if (!data.length) return;
  gl.useProgram(tileProgram);
  gl.uniformMatrix4fv(tile_u_mvp, false, mvp);
  gl.uniform2f(tile_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(tile_u_scale, 1.0);
  gl.uniform1f(tile_u_y, -0.001);
  gl.uniform3fv(tile_u_color, new Float32Array([0.0, 0.0, 0.0]));
  gl.bindVertexArray(tileVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, data.length/2);
  gl.bindVertexArray(null);
}
