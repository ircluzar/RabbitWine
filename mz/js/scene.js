// --- Grid pipeline (shader + buffers) ---
const GRID_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_mvp;
out vec3 v_world;
void main(){ v_world = a_pos; gl_Position = u_mvp * vec4(a_pos,1.0); }
`;
const GRID_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;
uniform vec3 u_camPos;
uniform float u_falloff;
in vec3 v_world;
out vec4 outColor;
void main(){
  float att = 1.0;
  if (u_falloff > 0.0) {
    float dist = distance(v_world, u_camPos);
    att = 1.0 / (1.0 + dist * u_falloff);
    att = max(att, 0.25);
  }
  outColor = vec4(u_color * att, 1.0);
}
`;
const gridProgram = createProgram(GRID_VS, GRID_FS);
const grid_u_mvp = gl.getUniformLocation(gridProgram, 'u_mvp');
const grid_u_color = gl.getUniformLocation(gridProgram, 'u_color');
const grid_u_camPos = gl.getUniformLocation(gridProgram, 'u_camPos');
const grid_u_falloff = gl.getUniformLocation(gridProgram, 'u_falloff');

function buildGridLines(size=20, step=1){
  const lines=[];
  for(let i=-size;i<=size;i+=step){
    // X-lines (varying Z)
    lines.push(-size,0,i,  size,0,i);
    // Z-lines (varying X)
    lines.push(i,0,-size,  i,0,size);
  }
  return new Float32Array(lines);
}
const gridData = buildGridLines(24, 1);
const gridVAO = gl.createVertexArray();
const gridVBO = gl.createBuffer();
gl.bindVertexArray(gridVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, gridVBO);
gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);
const gridVertexCount = gridData.length/3;

// --- Tilemap representation and instanced floor rendering ---
// Definitions now live in map/map-data.js, map-instances.js, map/columns.js

// Tile shader (instanced unit quad on XZ plane)
const TILE_VS = `#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=1) in vec2 a_off;\nuniform mat4 u_mvp;\nuniform vec2 u_originXZ;\nuniform float u_scale;\nuniform float u_y;\nvoid main(){\n  vec2 xz = (a_pos.xz + a_off + u_originXZ) * u_scale;\n  vec3 world = vec3(xz.x, u_y, xz.y);\n  gl_Position = u_mvp * vec4(world, 1.0);\n}\n`;
const TILE_FS = `#version 300 es\nprecision mediump float;\nuniform vec3 u_color;\nout vec4 outColor;\nvoid main(){ outColor = vec4(u_color,1.0); }\n`;
const tileProgram = createProgram(TILE_VS, TILE_FS);
const tile_u_mvp = gl.getUniformLocation(tileProgram, 'u_mvp');
const tile_u_origin = gl.getUniformLocation(tileProgram, 'u_originXZ');
const tile_u_scale = gl.getUniformLocation(tileProgram, 'u_scale');
const tile_u_y = gl.getUniformLocation(tileProgram, 'u_y');
const tile_u_color = gl.getUniformLocation(tileProgram, 'u_color');

// Unit quad geometry in XZ: (0,0)-(1,1)
const tileVAO = gl.createVertexArray();
const tileVBO_Pos = gl.createBuffer();
const tileVBO_Inst = gl.createBuffer();
gl.bindVertexArray(tileVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Pos);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  // tri 1
  0,0,0,  1,0,0,  1,0,1,
  // tri 2
  0,0,0,  1,0,1,  0,0,1,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
// Instance buffer (offsets)
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
  // Center map around origin by shifting by (-MAP_W/2, -MAP_H/2)
  gl.uniform2f(tile_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(tile_u_scale, 1.0);
  gl.uniform1f(tile_u_y, -0.001);
  const color = [0.0, 0.0, 0.0];
  gl.uniform3fv(tile_u_color, color);

  gl.bindVertexArray(tileVAO);
  // Upload instance data for this draw
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, data.length/2);
  gl.bindVertexArray(null);
}

// Wall voxels (instanced cube split into voxel grid via multiple passes)
const WALL_VS = `#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=1) in vec2 a_off;\nuniform mat4 u_mvp;\nuniform vec2 u_originXZ;\nuniform float u_scale;\nuniform float u_height;\nuniform vec3 u_voxCount; // voxel counts per axis (x,y,z)\nuniform vec3 u_voxOff;   // current voxel offset (x,y,z) in [0..count-1]\nuniform float u_yBase;   // additional vertical base offset (stacking)\nvoid main(){\n  // Map tile + voxelized local cube into world\n  float lx = (a_pos.x + u_voxOff.x) / u_voxCount.x;\n  float ly = (a_pos.y + u_voxOff.y) / u_voxCount.y;\n  float lz = (a_pos.z + u_voxOff.z) / u_voxCount.z;\n  vec2 xz = (vec2(lx, lz) + a_off + u_originXZ) * u_scale;\n  float y = ly * u_height + u_yBase;\n  gl_Position = u_mvp * vec4(xz.x, y, xz.y, 1.0);\n}`;
const WALL_FS = `#version 300 es\nprecision mediump float;\nuniform vec3 u_color;\nuniform float u_alpha;\nout vec4 outColor;\nvoid main(){ outColor = vec4(u_color, u_alpha); }`;
const wallProgram = createProgram(WALL_VS, WALL_FS);
const wall_u_mvp = gl.getUniformLocation(wallProgram, 'u_mvp');
const wall_u_origin = gl.getUniformLocation(wallProgram, 'u_originXZ');
const wall_u_scale = gl.getUniformLocation(wallProgram, 'u_scale');
const wall_u_height = gl.getUniformLocation(wallProgram, 'u_height');
const wall_u_color = gl.getUniformLocation(wallProgram, 'u_color');
const wall_u_alpha = gl.getUniformLocation(wallProgram, 'u_alpha');
const wall_u_voxCount = gl.getUniformLocation(wallProgram, 'u_voxCount');
const wall_u_voxOff = gl.getUniformLocation(wallProgram, 'u_voxOff');
const wall_u_yBase = gl.getUniformLocation(wallProgram, 'u_yBase');

const wallVAO = gl.createVertexArray();
const wallVBO_Pos = gl.createBuffer();
const wallVBO_Inst = gl.createBuffer();
gl.bindVertexArray(wallVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Pos);
// Unit cube from (0,0,0) to (1,1,1)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  // Front
  0,0,1,  1,0,1,  1,1,1,
  0,0,1,  1,1,1,  0,1,1,
  // Back
  1,0,0,  0,0,0,  0,1,0,
  1,0,0,  0,1,0,  1,1,0,
  // Left
  0,0,0,  0,0,1,  0,1,1,
  0,0,0,  0,1,1,  0,1,0,
  // Right
  1,0,1,  1,0,0,  1,1,0,
  1,0,1,  1,1,0,  1,1,1,
  // Top
  0,1,1,  1,1,1,  1,1,0,
  0,1,1,  1,1,0,  0,1,0,
  // Bottom
  0,0,0,  1,0,0,  1,0,1,
  0,0,0,  1,0,1,  0,0,1,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
// Instance offsets (tile x,y)
gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
gl.bufferData(gl.ARRAY_BUFFER, instWall, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

function drawWalls(mvp){
  const data = instWall;
  if (!data.length) return;
  gl.useProgram(wallProgram);
  gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
  gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(wall_u_scale, 1.0);
  gl.uniform1f(wall_u_height, 1.0); // cubic voxels (height matches tile size)
  gl.uniform1f(wall_u_yBase, 0.0);
  gl.uniform3fv(wall_u_color, new Float32Array([0.06, 0.45, 0.48]));
  gl.uniform1f(wall_u_alpha, 0.65);
  const voxX=2, voxY=2, voxZ=2; // 2x2x2 voxel grid per tile
  gl.uniform3f(wall_u_voxCount, voxX, voxY, voxZ);
  gl.bindVertexArray(wallVAO);
  // Upload instance data
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  // Depth pre-pass: write wall depth (no color) so later passes are occluded correctly
  gl.disable(gl.BLEND);
  gl.colorMask(false, false, false, false);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);
  for (let vz=0; vz<voxZ; vz++){
    for (let vy=0; vy<voxY; vy++){
      for (let vx=0; vx<voxX; vx++){
        gl.uniform3f(wall_u_voxOff, vx, vy, vz);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, data.length/2);
      }
    }
  }
  // Color blended pass: respect depth, don’t write to it
  gl.colorMask(true, true, true, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.depthFunc(gl.LEQUAL);
  for (let vz=0; vz<voxZ; vz++){
    for (let vy=0; vy<voxY; vy++){
      for (let vx=0; vx<voxX; vx++){
        gl.uniform3f(wall_u_voxOff, vx, vy, vz);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, data.length/2);
      }
    }
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(null);

  // Per-tile silhouette outlines for all wall tiles
  drawOutlinesForTileArray(mvp, data, 0.5, 1.0);
}

// Helper: draw thick black outlines for 1x1x1 blocks at given tile coordinates
function drawOutlinesForTileArray(mvp, tileArray, yCenter, baseScale){
  const count = tileArray.length/2;
  if (count <= 0) return;
  const tNow = state.nowSec || (performance.now()/1000);
  const inst = new Float32Array(count * 4);
  for (let i=0;i<count;i++){
    const tx = tileArray[i*2+0];
    const ty = tileArray[i*2+1];
    const cx = (tx - MAP_W*0.5 + 0.5);
    const cz = (ty - MAP_H*0.5 + 0.5);
    inst[i*4+0]=cx; inst[i*4+1]=yCenter; inst[i*4+2]=cz; inst[i*4+3]=tNow;
  }
  gl.useProgram(trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  gl.uniform1f(tc_u_now, tNow);
  gl.uniform1f(tc_u_ttl, 1.0);
  gl.uniform1i(tc_u_dashMode, 0);
  gl.uniform3f(tc_u_lineColor, 0.0, 0.0, 0.0);
  gl.bindVertexArray(trailCubeVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  gl.disable(gl.BLEND);
  gl.depthMask(false);
  gl.uniform1f(tc_u_mulAlpha, 1.0);
  // Pass 1: base scale
  gl.uniform1f(tc_u_scale, baseScale);
  gl.drawArraysInstanced(gl.LINES, 0, 24, count);
  // Pass 2: slightly larger for thickness
  gl.uniform1f(tc_u_scale, baseScale * 1.03);
  gl.drawArraysInstanced(gl.LINES, 0, 24, count);
  gl.depthMask(true);
  gl.bindVertexArray(null);
}

// Draw tall columns by stacking multiple unit-height cubes at specified tiles
function drawTallColumns(mvp){
  if (extraColumns.length === 0) return;
  const pillars = extraColumns.map(p=>[p.x, p.y]);
  gl.useProgram(wallProgram);
  gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
  gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(wall_u_scale, 1.0);
  gl.uniform1f(wall_u_height, 1.0);
  gl.uniform3fv(wall_u_color, new Float32Array([0.06, 0.45, 0.48]));
  gl.uniform1f(wall_u_alpha, 0.65);
  const voxX=1, voxY=1, voxZ=1;
  gl.uniform3f(wall_u_voxCount, voxX, voxY, voxZ);
  gl.bindVertexArray(wallVAO);
  // Prepare instance buffer for tile offsets
  const offs = new Float32Array(pillars.length * 2);
  for (let i=0;i<pillars.length;i++){ offs[i*2+0]=pillars[i][0]; offs[i*2+1]=pillars[i][1]; }
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, offs, gl.DYNAMIC_DRAW);
  // Depth pre-pass for each stacked level
  gl.disable(gl.BLEND);
  gl.colorMask(false,false,false,false);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);
  // Find max height among pillars to minimize passes
  let maxH = 0; for (const c of extraColumns) maxH = Math.max(maxH, c.h|0);
  for (let level=0; level<maxH; level++){
    gl.uniform1f(wall_u_yBase, level * 1.0);
    gl.uniform3f(wall_u_voxOff, 0,0,0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pillars.length);
  }
  // Blended color pass
  gl.colorMask(true,true,true,true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.depthFunc(gl.LEQUAL);
  for (let level=0; level<maxH; level++){
    gl.uniform1f(wall_u_yBase, level * 1.0);
    gl.uniform3f(wall_u_voxOff, 0,0,0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pillars.length);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(null);

  // Draw outlines for each stacked cube level
  for (let level=0; level<maxH; level++){
    const yCenter = level + 0.5; // center of that cube
    const offs = new Float32Array(pillars.length * 2);
    for (let i=0;i<pillars.length;i++){ offs[i*2+0]=pillars[i][0]; offs[i*2+1]=pillars[i][1]; }
    drawOutlinesForTileArray(mvp, offs, yCenter, 1.0);
  }
}

function renderGridViewport(x, y, w, h, cameraKind /* 'top'|'bottom' */) {
  gl.viewport(x, y, w, h);
  gl.enable(gl.DEPTH_TEST);
  // Clear only this region using scissor to avoid wiping the other viewport
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x, y, w, h);
  if (cameraKind === 'top') gl.clearColor(0.025, 0.05, 0.055, 1.0); else gl.clearColor(0.02, 0.045, 0.05, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.SCISSOR_TEST);
  // No grid draw here; the glow grid is drawn after scene rendering using additive blending
}

function drawGridOverlay(mvp, camEye, isThirdPerson) {
  gl.useProgram(gridProgram);
  gl.uniformMatrix4fv(grid_u_mvp, false, mvp);
  // Darker turquoise base
  gl.uniform3fv(grid_u_color, new Float32Array([0.05, 0.35, 0.33]));
  // Distance falloff for third-person only
  if (isThirdPerson) {
    gl.uniform3f(grid_u_camPos, camEye[0], camEye[1], camEye[2]);
    gl.uniform1f(grid_u_falloff, 0.09);
  } else {
    gl.uniform3f(grid_u_camPos, 0,0,0);
    gl.uniform1f(grid_u_falloff, 0.0);
  }
  // Depth-test the grid so it doesn't draw over walls or the player
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // additive glow
  gl.bindVertexArray(gridVAO);
  gl.drawArrays(gl.LINES, 0, gridVertexCount);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
}
