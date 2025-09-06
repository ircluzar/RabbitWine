"use strict";
/**
 * Floating edge lines FX for item pickups.
 * On pickup, we spawn 12 lines for each cube (outer yellow and inner white):
 * each line corresponds to a cube edge and drifts outward from the cube center
 * while slowly rotating, then despawns after a random 1–2s lifetime.
 *
 * Public API:
 *  - spawnPickupFloatingLines(x, y, z, outerScale=0.46, innerScale=0.28)
 *  - updateFxLines(dt)
 *  - drawFxLines(mvp)
 */

// Internal store of active FX lines
const fxLines = [];

// ---------- GPU pipeline ----------
const FX_LINES_VS = `#version 300 es
layout(location=0) in vec3 a_pos;        // base line: [-0.5,0,0]..[+0.5,0,0]
layout(location=1) in vec4 a_inst;       // xyz = origin, w = spawnT
layout(location=2) in vec3 a_dir;        // outward unit direction from center
layout(location=3) in vec3 a_edge;       // desired world axis for the line orientation (unit)
layout(location=4) in vec3 a_spin;       // random unit axis for slow spin
layout(location=5) in vec2 a_lenTtl;     // x = length in meters, y = ttl seconds
layout(location=6) in vec3 a_color;      // RGB color per line

uniform mat4 u_mvp;
uniform float u_now;
uniform float u_speed;      // outward drift speed (m/s)
uniform float u_rotSpeed;   // radians/sec for spin

out vec3 v_color;
out float v_alpha;

// Rodrigues' rotation for vector v around unit axis k by angle ang
vec3 rotateAxis(vec3 v, vec3 k, float ang){
  float s = sin(ang);
  float c = cos(ang);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

void main(){
  // Age and alpha
  float spawnT = a_inst.w;
  float ttl = max(0.0001, a_lenTtl.y);
  float age = clamp(u_now - spawnT, 0.0, ttl);
  float tNorm = age / ttl;
  v_alpha = 1.0 - tNorm;
  v_color = a_color;

  // Base local line oriented along +X, scaled by instance length
  vec3 pos = a_pos * vec3(a_lenTtl.x, a_lenTtl.x, a_lenTtl.x);

  // Align local +X to desired edge axis
  vec3 xaxis = vec3(1.0, 0.0, 0.0);
  vec3 edge = normalize(a_edge);
  float dotXE = clamp(dot(xaxis, edge), -1.0, 1.0);
  float angAlign = acos(dotXE);
  vec3 axisAlign = normalize(cross(xaxis, edge));
  if (length(axisAlign) < 1e-4) axisAlign = vec3(0.0, 1.0, 0.0);
  pos = rotateAxis(pos, axisAlign, angAlign);

  // Apply slow spin around a_spin
  vec3 spinAxis = a_spin; float L = length(spinAxis);
  if (L > 1e-4) {
    spinAxis /= L;
    float ang = u_rotSpeed * (u_now - spawnT);
    pos = rotateAxis(pos, spinAxis, ang);
  }

  // Outward drift along a_dir
  vec3 world = a_inst.xyz + pos + a_dir * (u_speed * age);
  gl_Position = u_mvp * vec4(world, 1.0);
}`;

const FX_LINES_FS = `#version 300 es
precision mediump float;
in vec3 v_color;
in float v_alpha;
uniform float u_mulAlpha;
out vec4 outColor;
void main(){
  outColor = vec4(v_color, v_alpha * u_mulAlpha);
}`;

const fxLinesProgram = createProgram(FX_LINES_VS, FX_LINES_FS);
const fxl_u_mvp = gl.getUniformLocation(fxLinesProgram, 'u_mvp');
const fxl_u_now = gl.getUniformLocation(fxLinesProgram, 'u_now');
const fxl_u_speed = gl.getUniformLocation(fxLinesProgram, 'u_speed');
const fxl_u_rotSpeed = gl.getUniformLocation(fxLinesProgram, 'u_rotSpeed');
const fxl_u_mulAlpha = gl.getUniformLocation(fxLinesProgram, 'u_mulAlpha');

// Geometry: a single line along X from -0.5 to +0.5
const fxLinesVAO = gl.createVertexArray();
const fxlVBO_Pos = gl.createBuffer();
const fxlVBO_Inst = gl.createBuffer();
const fxlVBO_Dir = gl.createBuffer();
const fxlVBO_Edge = gl.createBuffer();
const fxlVBO_Spin = gl.createBuffer();
const fxlVBO_LenTtl = gl.createBuffer();
const fxlVBO_Color = gl.createBuffer();

gl.bindVertexArray(fxLinesVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Pos);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -0.5, 0.0, 0.0,
   0.5, 0.0, 0.0,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

// Per-instance: origin + spawnT
gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Inst);
gl.bufferData(gl.ARRAY_BUFFER, 16, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);

// Per-instance: outward direction
gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Dir);
gl.bufferData(gl.ARRAY_BUFFER, 12, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(2);
gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(2, 1);

// Per-instance: edge orientation
gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Edge);
gl.bufferData(gl.ARRAY_BUFFER, 12, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(3);
gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(3, 1);

// Per-instance: spin axis
gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Spin);
gl.bufferData(gl.ARRAY_BUFFER, 12, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(4);
gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(4, 1);

// Per-instance: length and ttl
gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_LenTtl);
gl.bufferData(gl.ARRAY_BUFFER, 8, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(5);
gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(5, 1);

// Per-instance: color
gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Color);
gl.bufferData(gl.ARRAY_BUFFER, 12, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(6);
gl.vertexAttribPointer(6, 3, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(6, 1);

gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

// ---------- Spawning helpers ----------
function randUnitVec3(){
  let x = Math.random()*2-1, y = Math.random()*2-1, z = Math.random()*2-1;
  const L = Math.hypot(x,y,z) || 1; return {x:x/L, y:y/L, z:z/L};
}

function rotateVecAxisAngle(v, k, ang){
  const s = Math.sin(ang), c = Math.cos(ang);
  const kx=k.x, ky=k.y, kz=k.z;
  const dot = v.x*kx + v.y*ky + v.z*kz;
  return {
    x: v.x*c + (ky*v.z - kz*v.y)*s + kx*dot*(1-c),
    y: v.y*c + (kz*v.x - kx*v.z)*s + ky*dot*(1-c),
    z: v.z*c + (kx*v.y - ky*v.x)*s + kz*dot*(1-c),
  };
}

function pushLine(x, y, z, dir, edge, color, length, ttl, spawnT){
  fxLines.push({ x, y, z, dirX:dir.x, dirY:dir.y, dirZ:dir.z, edgeX:edge.x, edgeY:edge.y, edgeZ:edge.z,
    spin: randUnitVec3(), r:color.r, g:color.g, b:color.b, len:length, ttl, spawnT });
}

function addCubeEdgeLines(origin, scale, color, axis /*unit vec3 or null*/, angle /*rad*/){
  const spawnT = state.nowSec || (performance.now()/1000);
  const length = scale; // cube edge length in meters
  const ttlBase = 1.0, ttlJit = 1.0; // 1..2 seconds
  const hasRot = !!axis && (Math.hypot(axis.x||0,axis.y||0,axis.z||0) > 1e-5) && isFinite(angle||0);
  const rot = (v)=> hasRot ? rotateVecAxisAngle(v, axis, angle) : v;
  const rotDir = (v)=> { const r = rot(v); const L = Math.hypot(r.x,r.y,r.z)||1; return {x:r.x/L, y:r.y/L, z:r.z/L}; };
  // Edges parallel to X: (y=±0.5, z=±0.5), midpoint (0, y, z)
  for (let sy of [-1, 1]){
    for (let sz of [-1, 1]){
      const midLocal = {x:0, y:sy*0.5, z:sz*0.5};
      const mid = rot(midLocal);
      const dir = rotDir(midLocal);
      const axisEdge = rot({x:1, y:0, z:0});
      const ox = origin.x + mid.x * scale;
      const oy = origin.y + mid.y * scale;
      const oz = origin.z + mid.z * scale;
      pushLine(ox, oy, oz, dir, axisEdge, color, length, ttlBase + Math.random()*ttlJit, spawnT);
    }
  }
  // Edges parallel to Y: (x=±0.5, z=±0.5), midpoint (x, 0, z)
  for (let sx of [-1, 1]){
    for (let sz of [-1, 1]){
      const midLocal = {x:sx*0.5, y:0, z:sz*0.5};
      const mid = rot(midLocal);
      const dir = rotDir(midLocal);
      const axisEdge = rot({x:0, y:1, z:0});
      const ox = origin.x + mid.x * scale;
      const oy = origin.y + mid.y * scale;
      const oz = origin.z + mid.z * scale;
      pushLine(ox, oy, oz, dir, axisEdge, color, length, ttlBase + Math.random()*ttlJit, spawnT);
    }
  }
  // Edges parallel to Z: (x=±0.5, y=±0.5), midpoint (x, y, 0)
  for (let sx of [-1, 1]){
    for (let sy of [-1, 1]){
      const midLocal = {x:sx*0.5, y:sy*0.5, z:0};
      const mid = rot(midLocal);
      const dir = rotDir(midLocal);
      const axisEdge = rot({x:0, y:0, z:1});
      const ox = origin.x + mid.x * scale;
      const oy = origin.y + mid.y * scale;
      const oz = origin.z + mid.z * scale;
      pushLine(ox, oy, oz, dir, axisEdge, color, length, ttlBase + Math.random()*ttlJit, spawnT);
    }
  }
}

// ---------- Public API ----------
function spawnPickupFloatingLines(x, y, z, outerScale=0.46, innerScale=0.28){
  const origin = {x, y, z};
  addCubeEdgeLines(origin, outerScale, {r:1.0, g:0.95, b:0.2}, null, 0.0);
  addCubeEdgeLines(origin, innerScale, {r:1.0, g:1.0, b:1.0}, null, 0.0);
}

function spawnPickupFloatingLinesWithRotation(x, y, z, outerScale, innerScale, outerAxis, outerAngle, innerAxis, innerAngle){
  const origin = {x, y, z};
  addCubeEdgeLines(origin, outerScale, {r:1.0, g:0.95, b:0.2}, outerAxis, outerAngle);
  addCubeEdgeLines(origin, innerScale, {r:1.0, g:1.0, b:1.0}, innerAxis, innerAngle);
}

function updateFxLines(dt){
  if (!fxLines.length) return;
  const now = state.nowSec || (performance.now()/1000);
  // Remove expired
  let w = 0;
  for (let i=0;i<fxLines.length;i++){
    const L = fxLines[i];
    if ((now - L.spawnT) < L.ttl){ fxLines[w++] = L; }
  }
  fxLines.length = w;
}

function drawFxLines(mvp){
  if (fxLines.length === 0) return;
  // Build per-instance buffers
  const N = fxLines.length;
  const inst = new Float32Array(N*4);
  const dir = new Float32Array(N*3);
  const edge = new Float32Array(N*3);
  const spin = new Float32Array(N*3);
  const lenTtl = new Float32Array(N*2);
  const color = new Float32Array(N*3);
  for (let i=0;i<N;i++){
    const L = fxLines[i];
    inst[i*4+0] = L.x; inst[i*4+1] = L.y; inst[i*4+2] = L.z; inst[i*4+3] = L.spawnT;
    dir[i*3+0] = L.dirX; dir[i*3+1] = L.dirY; dir[i*3+2] = L.dirZ;
    edge[i*3+0] = L.edgeX; edge[i*3+1] = L.edgeY; edge[i*3+2] = L.edgeZ;
    spin[i*3+0] = L.spin.x; spin[i*3+1] = L.spin.y; spin[i*3+2] = L.spin.z;
    lenTtl[i*2+0] = L.len; lenTtl[i*2+1] = L.ttl;
    color[i*3+0] = L.r; color[i*3+1] = L.g; color[i*3+2] = L.b;
  }

  gl.useProgram(fxLinesProgram);
  gl.uniformMatrix4fv(fxl_u_mvp, false, mvp);
  gl.uniform1f(fxl_u_now, state.nowSec || (performance.now()/1000));
  gl.uniform1f(fxl_u_speed, 0.12);     // slow drift
  gl.uniform1f(fxl_u_rotSpeed, 0.6);   // slow spin
  gl.uniform1f(fxl_u_mulAlpha, 1.0);

  gl.bindVertexArray(fxLinesVAO);
  // Upload per-instance streams
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Dir); gl.bufferData(gl.ARRAY_BUFFER, dir, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Edge); gl.bufferData(gl.ARRAY_BUFFER, edge, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Spin); gl.bufferData(gl.ARRAY_BUFFER, spin, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_LenTtl); gl.bufferData(gl.ARRAY_BUFFER, lenTtl, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Color); gl.bufferData(gl.ARRAY_BUFFER, color, gl.DYNAMIC_DRAW);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  // Draw as an overlay so they are always visible
  const wasDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  if (wasDepthTest) gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.drawArraysInstanced(gl.LINES, 0, 2, N);
  gl.depthMask(true);
  if (wasDepthTest) gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

// Expose globally
if (typeof window !== 'undefined'){
  window.spawnPickupFloatingLines = spawnPickupFloatingLines;
  window.spawnPickupFloatingLinesWithRotation = spawnPickupFloatingLinesWithRotation;
  window.updateFxLines = updateFxLines;
  window.drawFxLines = drawFxLines;
}
