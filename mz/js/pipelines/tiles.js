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
// Separate base and jitter position buffers so bottom view can be steady
const tileVBO_PosBase = gl.createBuffer();
const tileVBO_PosJitter = gl.createBuffer();
const tileVBO_Inst = gl.createBuffer();
// Base and current geometry for a unit tile (2 triangles)
const tileBasePosData = new Float32Array([
  0,0,0,  1,0,0,  1,0,1,
  0,0,0,  1,0,1,  0,0,1,
]);
let tileCurrPosData = new Float32Array(tileBasePosData);

gl.bindVertexArray(tileVAO);
// Initialize base buffer with immutable base positions
gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_PosBase);
gl.bufferData(gl.ARRAY_BUFFER, tileBasePosData, gl.STATIC_DRAW);
// Initialize jitter buffer with current positions (starts equal to base)
gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_PosJitter);
gl.bufferData(gl.ARRAY_BUFFER, tileCurrPosData, gl.DYNAMIC_DRAW);
// Attribute 0 will be repointed per draw depending on camera kind
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Inst);
gl.bufferData(gl.ARRAY_BUFFER, instOpen, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

// Persistent, bounded vertex jitter around base tile points
let tileJitterLastTickSec = 0.0;
const tileJitterPeriod = 0.016;
const tileVertexProb = 0.10; // 10% of unique tile corners
const tileVertexStep = 0.01;
const tileVertexMax = 0.03;
// Unique corners: (0,0,0), (1,0,0), (1,0,1), (0,0,1)
const tileCornerMap = new Map();
for (let i=0;i<tileBasePosData.length;i+=3){
  const key = `${tileBasePosData[i+0]}|${tileBasePosData[i+1]}|${tileBasePosData[i+2]}`;
  if (!tileCornerMap.has(key)) tileCornerMap.set(key, []);
  tileCornerMap.get(key).push(i);
}
const tileCornerList = Array.from(tileCornerMap.values());
let tileCornerDisp = new Float32Array(tileCornerList.length * 3);
function ensureTileGeomJitterTick(nowSec){
  const now = nowSec || (performance.now()/1000);
  if (now - tileJitterLastTickSec < tileJitterPeriod - 1e-6) return;
  tileJitterLastTickSec = now;
  const total = tileCornerList.length;
  const count = Math.max(1, Math.round(total * tileVertexProb));
  const chosen = new Set();
  while (chosen.size < count){ chosen.add(Math.floor(Math.random()*total)); }
  chosen.forEach((ci)=>{
    const b = ci*3;
    const ox = tileCornerDisp[b+0], oy = tileCornerDisp[b+1], oz = tileCornerDisp[b+2];
    const nx = Math.max(-tileVertexMax, Math.min(tileVertexMax, ox + (Math.random()*2-1)*tileVertexStep));
    const ny = Math.max(-tileVertexMax, Math.min(tileVertexMax, oy + (Math.random()*2-1)*tileVertexStep));
    const nz = Math.max(-tileVertexMax, Math.min(tileVertexMax, oz + (Math.random()*2-1)*tileVertexStep));
    const dx = nx - ox, dy = ny - oy, dz = nz - oz;
    const idxs = tileCornerList[ci];
    for (let k=0;k<idxs.length;k++){
      const i = idxs[k];
      tileCurrPosData[i+0]+=dx; tileCurrPosData[i+1]+=dy; tileCurrPosData[i+2]+=dz;
    }
    tileCornerDisp[b+0]=nx; tileCornerDisp[b+1]=ny; tileCornerDisp[b+2]=nz;
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_PosJitter);
  gl.bufferData(gl.ARRAY_BUFFER, tileCurrPosData, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

function drawTiles(mvp, kind){
  // Update persistent tile vertex jitter for top view only
  if (state.cameraKindCurrent === 'top' && typeof ensureTileGeomJitterTick === 'function') {
    ensureTileGeomJitterTick(state.nowSec || (performance.now()/1000));
  }
  const isWall = kind === 'wall';
  const data = isWall ? instWall : instOpen;
  if (!data.length) return;
  gl.useProgram(tileProgram);
  gl.uniformMatrix4fv(tile_u_mvp, false, mvp);
  gl.uniform2f(tile_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(tile_u_scale, 1.0);
  gl.uniform1f(tile_u_y, -0.001);
  // Derive floor color as a darkened wall color for subtle tint
  let floorCol = [0,0,0];
  try {
    const wall = (typeof getLevelWallColorRGB === 'function') ? getLevelWallColorRGB() : [0.06,0.45,0.48];
    floorCol = wall.map(c=>c*0.15);
  } catch(_){ }
  gl.uniform3fv(tile_u_color, new Float32Array(floorCol));
  gl.bindVertexArray(tileVAO);
  // Point attribute 0 to the appropriate position buffer per view
  gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? tileVBO_PosJitter : tileVBO_PosBase);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, data.length/2);
  gl.bindVertexArray(null);
}
