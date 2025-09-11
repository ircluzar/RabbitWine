/**
 * Grid overlay rendering pipeline with distance-based fading.
 * Provides wireframe grid lines that fade based on camera distance for visual reference.
 * Exports: GRID_VS, GRID_FS shaders, gridProgram, gridVAO, drawGridOverlay(), renderGridViewport() functions.
 * Dependencies: createProgram() from gl-core.js, gl context. Side effects: Creates VAO/VBO resources and modifies WebGL state.
 */

// Grid pipeline (extracted from scene.js)
const GRID_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_mvp;
uniform vec3 u_offset; // world-space offset to fake thickness
out vec3 v_world;
void main(){
  vec3 p = a_pos + u_offset;
  v_world = p;
  gl_Position = u_mvp * vec4(p,1.0);
}
`;

const GRID_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;
uniform vec3 u_camPos;
uniform float u_falloff;
uniform vec3 u_sphereCenter;
uniform float u_sphereRadius;
uniform int u_useSphereMask; // 1 = draw only inside the sphere
in vec3 v_world;
out vec4 outColor;
void main(){
  if (u_useSphereMask == 1) {
    float d = distance(v_world, u_sphereCenter);
    if (d > u_sphereRadius) discard;
  }
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
const grid_u_sphereCenter = gl.getUniformLocation(gridProgram, 'u_sphereCenter');
const grid_u_sphereRadius = gl.getUniformLocation(gridProgram, 'u_sphereRadius');
const grid_u_useSphereMask = gl.getUniformLocation(gridProgram, 'u_useSphereMask');
const grid_u_offset = gl.getUniformLocation(gridProgram, 'u_offset');

function buildGridLines(size=20, step=1){
  const lines=[];
  for(let i=-size;i<=size;i+=step){
    lines.push(-size,0,i,  size,0,i);
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

// --- Red vertical boundary grid (invisible wall cue) ---
// Lazily built so it can adapt to MAP_W/MAP_H if they change.
let boundaryVAO = null;
let boundaryVBO = null;
let boundaryVertexCount = 0;
let boundaryBuiltFor = { w: 0, h: 0, height: 0 };

// Determine the current level height (in whole blocks), based on spans/columns
function computeLevelHeight(){
  let maxTop = 1; // at least ground wall height
  try {
    if (typeof columnSpans !== 'undefined' && columnSpans && typeof columnSpans.entries === 'function' && columnSpans.size > 0){
      for (const [, spans] of columnSpans.entries()){
        if (!Array.isArray(spans)) continue;
        for (const s of spans){ if (!s) continue; const b=(s.b|0)||0, h=(s.h|0)||0; if (h>0) maxTop = Math.max(maxTop, b + h); }
      }
    } else if (typeof extraColumns !== 'undefined' && Array.isArray(extraColumns) && extraColumns.length){
      for (const c of extraColumns){ if (!c) continue; const b=(c.b|0)||0, h=(c.h|0)||0; if (h>0) maxTop = Math.max(maxTop, b + h); }
    } else if (typeof columnHeights !== 'undefined' && columnHeights && typeof columnHeights.entries === 'function' && columnHeights.size > 0){
      for (const [key, hVal] of columnHeights.entries()){
        const h=(hVal|0)||0; if (h<=0) continue;
        let b = 0; try { if (typeof columnBases !== 'undefined' && columnBases && columnBases.has(key)) b = (columnBases.get(key)|0)||0; } catch(_){}
        maxTop = Math.max(maxTop, b + h);
      }
    }
  } catch(_){}
  return Math.max(1, (maxTop|0));
}

function buildBoundaryLines(heightUnits){
  const W = (typeof MAP_W !== 'undefined' && MAP_W)|0 || 24;
  const H = (typeof MAP_H !== 'undefined' && MAP_H)|0 || 24;
  const halfW = W * 0.5;
  const halfH = H * 0.5;
  const step = 1; // one line per tile along the edges
  const lines = [];
  // Two X edges at x = -halfW and x = +halfW, vary Z
  for (let zi = -halfH; zi <= halfH; zi += step){
    lines.push(-halfW, 0, zi,   -halfW, heightUnits, zi);
    lines.push( halfW, 0, zi,    halfW, heightUnits, zi);
  }
  // Two Z edges at z = -halfH and z = +halfH, vary X
  for (let xi = -halfW; xi <= halfW; xi += step){
    lines.push(xi, 0, -halfH,   xi, heightUnits, -halfH);
    lines.push(xi, 0,  halfH,   xi, heightUnits,  halfH);
  }
  // Horizontal rings at each integer block height (exclude y=0 to reduce clutter)
  for (let y=1; y<=heightUnits; y+=1){
    // Perimeter rectangle (4 edges)
    lines.push(-halfW, y, -halfH,   halfW, y, -halfH);
    lines.push( halfW, y, -halfH,   halfW, y,  halfH);
    lines.push( halfW, y,  halfH,  -halfW, y,  halfH);
    lines.push(-halfW, y,  halfH,  -halfW, y, -halfH);
  }
  return new Float32Array(lines);
}

function ensureBoundaryBuffers(heightUnits){
  const W = (typeof MAP_W !== 'undefined' && MAP_W)|0 || 24;
  const H = (typeof MAP_H !== 'undefined' && MAP_H)|0 || 24;
  const h = Math.max(1, Math.floor(heightUnits||4));
  if (boundaryVAO && boundaryBuiltFor.w === W && boundaryBuiltFor.h === H && boundaryBuiltFor.height === h) return;
  const data = buildBoundaryLines(h);
  if (!boundaryVAO){
    boundaryVAO = gl.createVertexArray();
    boundaryVBO = gl.createBuffer();
  }
  gl.bindVertexArray(boundaryVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, boundaryVBO);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  boundaryVertexCount = data.length / 3;
  boundaryBuiltFor = { w: W, h: H, height: h };
}

function renderGridViewport(x, y, w, h, cameraKind /* 'top'|'bottom' */) {
  gl.viewport(x, y, w, h);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x, y, w, h);
  // Derive subtle background tints from base level color (darkened strongly)
  const useCol = (typeof getLevelBackgroundColored === 'function') ? getLevelBackgroundColored() : true;
  if (useCol){
    const base = (typeof getLevelBaseColorRGB === 'function') ? getLevelBaseColorRGB() : [0.06,0.45,0.48];
    const dark = base.map(c=>c*0.15);
    const dark2 = base.map(c=>c*0.11);
    if (cameraKind === 'top') gl.clearColor(dark[0], dark[1], dark[2], 1.0); else gl.clearColor(dark2[0], dark2[1], dark2[2], 1.0);
  } else {
    gl.clearColor(0,0,0,1);
  }
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.SCISSOR_TEST);
}

function drawGridOverlay(mvp, camEye, isThirdPerson) {
  gl.useProgram(gridProgram);
  gl.uniformMatrix4fv(grid_u_mvp, false, mvp);
  const gridCol = (typeof getLevelGridColorRGB === 'function') ? getLevelGridColorRGB() : [0.05,0.35,0.33];
  gl.uniform3fv(grid_u_color, new Float32Array(gridCol));
  // No sphere mask for the general overlay
  if (grid_u_useSphereMask) gl.uniform1i(grid_u_useSphereMask, 0);
  if (grid_u_offset) gl.uniform3f(grid_u_offset, 0,0,0);
  if (isThirdPerson) {
    gl.uniform3f(grid_u_camPos, camEye[0], camEye[1], camEye[2]);
    gl.uniform1f(grid_u_falloff, 0.09);
  } else {
    gl.uniform3f(grid_u_camPos, 0,0,0);
    gl.uniform1f(grid_u_falloff, 0.0);
  }
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.bindVertexArray(gridVAO);
  gl.drawArrays(gl.LINES, 0, gridVertexCount);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
}

// Draw vertical red boundary grid along the play area's outer edges
function drawBoundaryGrid(mvp, camEye, isThirdPerson){
  // Fixed height in world units (tiles): always 64 blocks high regardless of level contents
  const HEIGHT = 64;
  ensureBoundaryBuffers(HEIGHT);
  if (!boundaryVAO || boundaryVertexCount <= 0) return;
  gl.useProgram(gridProgram);
  gl.uniformMatrix4fv(grid_u_mvp, false, mvp);
  // Dim red so additive blending doesn't overpower scene
  gl.uniform3fv(grid_u_color, new Float32Array([0.95, 0.12, 0.12]));
  // Enable sphere mask around the player (about 2 blocks radius)
  if (grid_u_useSphereMask) gl.uniform1i(grid_u_useSphereMask, 1);
  const px = (state && state.player) ? (state.player.x || 0) : 0;
  const py = (state && state.player) ? (state.player.y || 0) : 0;
  const pz = (state && state.player) ? (state.player.z || 0) : 0;
  if (grid_u_sphereCenter) gl.uniform3f(grid_u_sphereCenter, px, py, pz);
  if (grid_u_sphereRadius) gl.uniform1f(grid_u_sphereRadius, 2.0);
  if (isThirdPerson) {
    gl.uniform3f(grid_u_camPos, camEye[0], camEye[1], camEye[2]);
    gl.uniform1f(grid_u_falloff, 0.06);
  } else {
    gl.uniform3f(grid_u_camPos, 0,0,0);
    gl.uniform1f(grid_u_falloff, 0.0);
  }
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.bindVertexArray(boundaryVAO);
  // Multi-pass slight offsets to fake thicker lines
  const t = 0.03; // thickness in world units
  if (grid_u_offset) {
    const offs = [
      [0,0,0],
      [ t,0, 0], [-t,0, 0],
      [ 0,0, t], [ 0,0,-t],
      [ t,0, t], [ t,0,-t], [-t,0, t], [-t,0,-t],
    ];
    for (let i=0;i<offs.length;i++){
      gl.uniform3f(grid_u_offset, offs[i][0], offs[i][1], offs[i][2]);
      gl.drawArrays(gl.LINES, 0, boundaryVertexCount);
    }
    // Reset
    gl.uniform3f(grid_u_offset, 0,0,0);
  } else {
    gl.drawArrays(gl.LINES, 0, boundaryVertexCount);
  }
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
}
