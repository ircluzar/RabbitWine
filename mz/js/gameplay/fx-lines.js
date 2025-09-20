"use strict";

/**
 * Floating edge lines visual effects system for item pickup feedback.
 * Creates dynamic 3D line particle effects that spawn from collected items and drift
 * outward while rotating, providing visual confirmation of pickup events with
 * stunning cube wireframe dissolution effects.
 * 
 * When an item is collected, spawns 12 floating lines representing each edge of a cube:
 * - Outer yellow wireframe cube with configurable scale
 * - Inner white wireframe cube for layered depth effect  
 * - Each line drifts outward from cube center with random rotation
 * - Lines fade out over 1-2 second randomized lifetime
 * 
 * @fileoverview 3D particle line effects with WebGL2 instanced rendering
 * @exports spawnPickupFloatingLines() - Standard item pickup effect
 * @exports spawnPickupFloatingLinesWithRotation() - Rotated cube pickup effect
 * @exports spawnFloatingLinesCustom() - Custom colors and rotation (multiplayer ghosts)
 * @exports updateFxLines() - Per-frame lifecycle management called by game loop
 * @exports drawFxLines() - Render all active effects with instanced drawing
 * @dependencies WebGL2 context, shader compilation utilities, game state timing
 * @sideEffects Modifies internal fxLines array, uploads GPU buffers, renders to framebuffer
 */

// ============================================================================
// Internal Effect Storage and GPU Pipeline Setup  
// ============================================================================

/** @type {Array<Object>} Active floating line effects with position, direction, and timing data */
const fxLines = [];

// ============================================================================
// WebGL2 Shader Programs for Instanced Line Rendering
// ============================================================================

/** 
 * Vertex shader for instanced floating line effects with 3D transformations
 * Features: per-instance positioning, outward drift, rotation around arbitrary axis,
 * edge alignment, temporal alpha fading, and matrix transformations
 */
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

// ============================================================================
// Mathematical Utility Functions for 3D Transformations
// ============================================================================

/**
 * Generate a random unit vector in 3D space using uniform distribution
 * Used for random rotation axes and outward drift directions
 * @returns {Object} Unit vector with {x, y, z} components, magnitude = 1.0
 */
function randUnitVec3(){
  let x = Math.random()*2-1, y = Math.random()*2-1, z = Math.random()*2-1;
  const L = Math.hypot(x,y,z) || 1; 
  return {x:x/L, y:y/L, z:z/L};
}

/**
 * Rotate a 3D vector around an arbitrary axis using Rodrigues' rotation formula
 * Essential for aligning cube edges to world orientations and applying spin effects
 * @param {Object} v - Vector to rotate with {x, y, z} components
 * @param {Object} k - Unit rotation axis with {x, y, z} components  
 * @param {number} ang - Rotation angle in radians
 * @returns {Object} Rotated vector with {x, y, z} components
 */
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

// ============================================================================
// Effect Spawning and Cube Edge Generation
// ============================================================================

/**
 * Add a single floating line effect to the active effects list
 * @param {number} x,y,z - World position coordinates for line origin
 * @param {Object} dir - Normalized drift direction vector {x, y, z}
 * @param {Object} edge - Desired world axis for line orientation {x, y, z}
 * @param {Object} color - RGB color values {r, g, b} in range [0,1]
 * @param {number} length - Line length in world units (meters)
 * @param {number} ttl - Time-to-live in seconds before line expires
 * @param {number} spawnT - Spawn timestamp for age calculation
 */
function pushLine(x, y, z, dir, edge, color, length, ttl, spawnT){
  fxLines.push({ 
    x, y, z, 
    dirX:dir.x, dirY:dir.y, dirZ:dir.z, 
    edgeX:edge.x, edgeY:edge.y, edgeZ:edge.z,
    spin: randUnitVec3(), 
    r:color.r, g:color.g, b:color.b, 
    len:length, ttl, spawnT 
  });
}

/**
 * Generate all 12 edge lines for a cube wireframe effect with optional rotation
 * Creates lines parallel to X, Y, and Z axes positioned at cube edge midpoints
 * Each line drifts outward from cube center with randomized lifetime
 * 
 * @param {Object} origin - Cube center position {x, y, z}
 * @param {number} scale - Cube size scaling factor (edge length in meters)
 * @param {Object} color - Line color {r, g, b} values in range [0,1]
 * @param {Object|null} axis - Optional rotation axis unit vector {x, y, z}, null for no rotation
 * @param {number} angle - Rotation angle in radians (ignored if axis is null)
 */
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

// ============================================================================
// Public API for Effect Spawning and Management
// ============================================================================

/**
 * Spawn standard item pickup floating line effect with dual-layer cube wireframes
 * Creates the classic pickup effect: outer yellow cube + inner white cube
 * with all 24 lines (12 per cube) drifting outward and rotating independently
 * 
 * @param {number} x,y,z - World coordinates where pickup occurred
 * @param {number} outerScale - Size of outer yellow cube wireframe (default: 0.46m)
 * @param {number} innerScale - Size of inner white cube wireframe (default: 0.28m)
 */
function spawnPickupFloatingLines(x, y, z, outerScale=0.46, innerScale=0.28){
  const origin = {x, y, z};
  addCubeEdgeLines(origin, outerScale, {r:1.0, g:0.95, b:0.2}, null, 0.0); // Yellow outer
  addCubeEdgeLines(origin, innerScale, {r:1.0, g:1.0, b:1.0}, null, 0.0);  // White inner
}

/**
 * Spawn pickup effect with custom rotation applied to both cube layers
 * Useful for items that have specific orientation or spinning motion when collected
 * 
 * @param {number} x,y,z - World coordinates where pickup occurred
 * @param {number} outerScale - Size of outer cube wireframe
 * @param {number} innerScale - Size of inner cube wireframe  
 * @param {Object} outerAxis - Rotation axis for outer cube {x, y, z} unit vector
 * @param {number} outerAngle - Rotation angle for outer cube in radians
 * @param {Object} innerAxis - Rotation axis for inner cube {x, y, z} unit vector
 * @param {number} innerAngle - Rotation angle for inner cube in radians
 */
function spawnPickupFloatingLinesWithRotation(x, y, z, outerScale, innerScale, outerAxis, outerAngle, innerAxis, innerAngle){
  const origin = {x, y, z};
  addCubeEdgeLines(origin, outerScale, {r:1.0, g:0.95, b:0.2}, outerAxis, outerAngle);
  addCubeEdgeLines(origin, innerScale, {r:1.0, g:1.0, b:1.0}, innerAxis, innerAngle);
}

/**
 * Spawn floating line effect with custom colors and optional rotation
 * Designed for external systems like multiplayer ghost despawn effects or special items
 * Provides full control over colors, sizes, and rotation for maximum flexibility
 * 
 * @param {number} x,y,z - World coordinates for effect origin
 * @param {Object} colorOuter - Outer cube color {r, g, b} values in range [0,1]
 * @param {Object} colorInner - Inner cube color {r, g, b} values in range [0,1]
 * @param {number} outerScale - Size of outer cube wireframe (default: 0.46m)
 * @param {number} innerScale - Size of inner cube wireframe (default: 0.28m)
 * @param {Object|null} rotOuter - Outer rotation {axis: {x,y,z}, angle: radians} or null
 * @param {Object|null} rotInner - Inner rotation {axis: {x,y,z}, angle: radians} or null
 */
function spawnFloatingLinesCustom(x, y, z, colorOuter, colorInner, outerScale=0.46, innerScale=0.28, rotOuter=null, rotInner=null){
  const origin = {x, y, z};
  const oa = rotOuter && rotOuter.axis ? rotOuter.axis : null;
  const oaAng = rotOuter && typeof rotOuter.angle === 'number' ? rotOuter.angle : 0.0;
  const ia = rotInner && rotInner.axis ? rotInner.axis : null;
  const iaAng = rotInner && typeof rotInner.angle === 'number' ? rotInner.angle : 0.0;
  addCubeEdgeLines(origin, outerScale, colorOuter, oa, oaAng);
  addCubeEdgeLines(origin, innerScale, colorInner, ia, iaAng);
}

// ============================================================================
// Effect Lifecycle Management and Rendering
// ============================================================================

/**
 * Update all active floating line effects and remove expired ones
 * Called every frame by the main game loop to maintain effect lifecycle
 * Efficiently removes expired effects in-place without array reallocation
 * 
 * @param {number} dt - Delta time since last frame (unused, uses absolute timing)
 */
function updateFxLines(dt){
  if (!fxLines.length) return;
  
  const now = state.nowSec || (performance.now()/1000);
  
  // Compact array by moving non-expired effects to front
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < fxLines.length; readIndex++){
    const line = fxLines[readIndex];
    if ((now - line.spawnT) < line.ttl) { 
      fxLines[writeIndex++] = line; 
    }
    // Expired lines are automatically discarded by not copying
  }
  fxLines.length = writeIndex; // Truncate array to new valid length
}

/**
 * Render all active floating line effects using WebGL2 instanced drawing
 * Builds per-instance attribute buffers and renders with alpha blending overlay
 * Uses line primitives with custom vertex shader for 3D transformation effects
 * 
 * @param {Float32Array} mvp - Model-View-Projection matrix (4x4 in column-major order)
 */
function drawFxLines(mvp){
  if (fxLines.length === 0) return;
  
  // ============================================================================
  // Per-Instance Attribute Buffer Construction
  // ============================================================================
  
  const N = fxLines.length;
  const inst = new Float32Array(N*4);    // [x, y, z, spawnTime] per instance
  const dir = new Float32Array(N*3);     // [dirX, dirY, dirZ] outward drift
  const edge = new Float32Array(N*3);    // [edgeX, edgeY, edgeZ] line orientation  
  const spin = new Float32Array(N*3);    // [spinX, spinY, spinZ] rotation axis
  const lenTtl = new Float32Array(N*2);  // [length, timeToLive] per instance
  const color = new Float32Array(N*3);   // [r, g, b] color per instance
  
  // Pack all line data into instanced attribute arrays
  for (let i=0; i<N; i++){
    const L = fxLines[i];
    inst[i*4+0] = L.x; inst[i*4+1] = L.y; inst[i*4+2] = L.z; inst[i*4+3] = L.spawnT;
    dir[i*3+0] = L.dirX; dir[i*3+1] = L.dirY; dir[i*3+2] = L.dirZ;
    edge[i*3+0] = L.edgeX; edge[i*3+1] = L.edgeY; edge[i*3+2] = L.edgeZ;
    spin[i*3+0] = L.spin.x; spin[i*3+1] = L.spin.y; spin[i*3+2] = L.spin.z;
    lenTtl[i*2+0] = L.len; lenTtl[i*2+1] = L.ttl;
    color[i*3+0] = L.r; color[i*3+1] = L.g; color[i*3+2] = L.b;
  }

  // ============================================================================
  // WebGL2 Rendering Setup and Execution
  // ============================================================================
  
  gl.useProgram(fxLinesProgram);
  gl.uniformMatrix4fv(fxl_u_mvp, false, mvp);
  gl.uniform1f(fxl_u_now, state.nowSec || (performance.now()/1000));
  gl.uniform1f(fxl_u_speed, 0.12);     // Slow outward drift speed (m/s)
  gl.uniform1f(fxl_u_rotSpeed, 0.6);   // Slow rotation speed (rad/s)
  gl.uniform1f(fxl_u_mulAlpha, 1.0);   // Global alpha multiplier

  gl.bindVertexArray(fxLinesVAO);
  
  // Upload per-instance attribute streams to GPU
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Dir); gl.bufferData(gl.ARRAY_BUFFER, dir, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Edge); gl.bufferData(gl.ARRAY_BUFFER, edge, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Spin); gl.bufferData(gl.ARRAY_BUFFER, spin, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_LenTtl); gl.bufferData(gl.ARRAY_BUFFER, lenTtl, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, fxlVBO_Color); gl.bufferData(gl.ARRAY_BUFFER, color, gl.DYNAMIC_DRAW);

  // Configure alpha blending for overlay rendering (always visible)
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  
  // Disable depth testing for overlay effect (lines appear on top)
  const wasDepthTest = gl.isEnabled(gl.DEPTH_TEST);
  if (wasDepthTest) gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false); // Don't write to depth buffer
  
  // Execute instanced draw call: 2 vertices per line × N instances
  gl.drawArraysInstanced(gl.LINES, 0, 2, N);
  
  // Restore previous WebGL state
  gl.depthMask(true);
  if (wasDepthTest) gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

// ============================================================================
// Global Exports for Cross-Module Integration
// ============================================================================
if (typeof window !== 'undefined'){
  window.spawnPickupFloatingLines = spawnPickupFloatingLines;
  window.spawnPickupFloatingLinesWithRotation = spawnPickupFloatingLinesWithRotation;
  window.spawnFloatingLinesCustom = spawnFloatingLinesCustom;
  window.updateFxLines = updateFxLines;
  window.drawFxLines = drawFxLines;
}
