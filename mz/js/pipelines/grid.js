/**
 * Advanced grid overlay rendering pipeline with adaptive distance-based fading and boundary visualization.
 * Provides comprehensive wireframe grid systems for spatial reference, level boundaries, and debug visualization
 * with sophisticated camera-aware rendering optimizations and dynamic color management based on game state.
 * 
 * Key Features:
 * - Dynamic ground grid with distance-based transparency fading
 * - Adaptive vertical boundary grid with camera lock state indication
 * - Sphere masking for localized grid visibility around player
 * - Multi-pass rendering for enhanced line thickness appearance
 * - Level-aware height calculation from column geometry data
 * - Runtime color customization and debug visualization support
 * 
 * @fileoverview Comprehensive grid rendering system with advanced visual feedback
 * @exports drawGridOverlay() - Main ground grid rendering function
 * @exports drawBoundaryGrid() - Vertical boundary visualization with state-aware coloring
 * @exports renderGridViewport() - Viewport setup with level-themed background colors
 * @exports GRID_VS, GRID_FS - WebGL2 shader programs for grid rendering
 * @dependencies createProgram() from gl-core.js, WebGL2 context, game state integration
 * @sideEffects Creates and manages VAO/VBO resources, modifies WebGL rendering state
 */

// ============================================================================
// WebGL2 Shader Programs for Advanced Grid Rendering
// ============================================================================

/**
 * Vertex shader for grid line rendering with world-space positioning and offset support
 * Features: MVP transformation, world-space coordinate output, thickness simulation via offset
 */
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

// ============================================================================
// Grid Geometry Generation and GPU Buffer Management
// ============================================================================

/**
 * Generate horizontal grid line geometry with configurable density and extent
 * Creates intersecting X and Z axis lines for spatial reference visualization
 * @param {number} size - Grid extent in both directions (creates -size to +size range)
 * @param {number} step - Distance between grid lines (typically 1 for per-tile resolution)
 * @returns {Float32Array} Interleaved line vertex data for WebGL buffer upload
 */
function buildGridLines(size=20, step=1){
  const lines=[];
  
  // Generate horizontal lines (vary Z, constant X range)
  for(let i=-size; i<=size; i+=step){
    lines.push(-size,0,i,  size,0,i);
  }
  
  // Generate vertical lines (vary X, constant Z range)  
  for(let i=-size; i<=size; i+=step){
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

// ============================================================================
// Dynamic Boundary Grid System with Adaptive Height Detection
// ============================================================================

/** Lazily-built boundary grid VAO for vertical level containment visualization */
let boundaryVAO = null;
let boundaryVBO = null;
let boundaryVertexCount = 0;
let boundaryBuiltFor = { w: 0, h: 0, height: 0 }; // Cache key for rebuild detection

/**
 * Compute maximum level height by analyzing all column geometry data sources
 * Scans multi-span columns, legacy extraColumns, and height maps to determine
 * the tallest structure in the current level for boundary grid sizing
 * @returns {number} Maximum height in world units (minimum 1)
 */
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
  // Determine if camera lock mode is active to swap boundary grid color.
  // We mirror the detection logic used for lock block alpha capping so visuals stay consistent.
  let lockModeActive = false;
  try {
    // New stricter definition: only treat visuals as in "Lock" mode when the game has actually
    // engaged a lock block transition (forced camera) – not merely when the player manually
    // fixed the camera (lockCameraYaw) or has pointer/look lock. This prevents unintended
    // boundary recoloring + world fade when user toggles a normal fixed camera.
    // Sources of truth:
    //   state.lockedCameraForced -> set on entering a lock span, cleared on exit
    //   state._inLockNow         -> per-frame flag from physics identifying presence in lock span
    // Debug / manual overrides remain available via window.__FORCE_LOCK_VISUALS or legacy __CAMERA_LOCKED.
    if (state) {
      if (state.lockedCameraForced || state._inLockNow) lockModeActive = true;
    }
    if (!lockModeActive && typeof window !== 'undefined') {
      if (window.__FORCE_LOCK_VISUALS || window.__CAMERA_LOCKED) lockModeActive = true; // explicit override only
    }
  } catch(_){ }

  // Base colors: default red (rest) and pastel blue (lock outline color)
  let restCol = [0.95, 0.12, 0.12];
  let lockCol = [0.65, 0.80, 1.0];
  // Optional runtime overrides: window.__LOCK_BOUNDARY_COLOR_REST / _LOCK as array [r,g,b] or hex string '#RRGGBB'
  function parseColorOverride(val, fallback){
    if (!val) return fallback;
    if (Array.isArray(val) && val.length >= 3){
      const r = +val[0], g = +val[1], b = +val[2];
      if ([r,g,b].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return [r,g,b];
      return fallback;
    }
    if (typeof val === 'string'){
      const s = val.trim();
      if (/^#?[0-9a-fA-F]{6}$/.test(s)){
        const hex = s.replace('#','');
        const r = parseInt(hex.slice(0,2),16)/255;
        const g = parseInt(hex.slice(2,4),16)/255;
        const b = parseInt(hex.slice(4,6),16)/255;
        return [r,g,b];
      }
    }
    return fallback;
  }
  try {
    if (typeof window !== 'undefined'){
      if (window.__LOCK_BOUNDARY_COLOR_REST) restCol = parseColorOverride(window.__LOCK_BOUNDARY_COLOR_REST, restCol);
      if (window.__LOCK_BOUNDARY_COLOR_LOCK) lockCol = parseColorOverride(window.__LOCK_BOUNDARY_COLOR_LOCK, lockCol);
    }
  } catch(_){ }

  const useCol = lockModeActive ? lockCol : restCol;
  gl.uniform3fv(grid_u_color, new Float32Array(useCol));
  // One-shot debug logging on transition
  try {
    if (typeof window !== 'undefined' && window.__DEBUG_LOCK_BOUNDARY){
      if (state && state._boundaryWasLockColor !== lockModeActive){
        console.log('[boundary-grid] mode=', lockModeActive ? 'LOCK' : 'REST', 'color=', useCol);
      }
    }
    if (state) state._boundaryWasLockColor = lockModeActive;
  } catch(_){ }
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

// ============================================================================
// Global Exports for Cross-Module Integration
// ============================================================================

/**
 * Export grid rendering system components to global scope for rendering pipeline access
 * Enables main rendering loop and debug systems to access grid visualization functions
 */
if (typeof window !== 'undefined') {
  // Primary rendering functions
  window.drawGridOverlay = drawGridOverlay;           // Ground grid with distance fading
  window.drawBoundaryGrid = drawBoundaryGrid;         // Vertical boundary visualization  
  window.renderGridViewport = renderGridViewport;     // Viewport setup with themed backgrounds
  
  // Utility functions for advanced usage
  window.buildGridLines = buildGridLines;             // Grid geometry generation
  window.computeLevelHeight = computeLevelHeight;     // Dynamic level height calculation
  
  // WebGL resources for direct access if needed
  window.gridProgram = gridProgram;                   // Compiled shader program
  window.gridVAO = gridVAO;                          // Ground grid vertex array object
}
