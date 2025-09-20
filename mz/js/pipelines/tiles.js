// ============================================================================
// Tile Rendering Pipeline System
// ============================================================================
/**
 * @fileoverview Advanced tile rendering pipeline for ground/floor surfaces
 * 
 * Features:
 * - Instanced rendering for efficient floor tile rendering across large maps
 * - Dynamic vertex jitter animation for organic visual effects in top-down view
 * - Dual buffer system for stable/animated geometry based on camera type
 * - Configurable tile colors derived from level theme settings
 * - Separate rendering modes for open floor and wall tiles
 * 
 * Architecture:
 * - Base geometry: Unit quad (0,0,0 to 1,0,1) rendered as instanced tiles
 * - Instance data: 2D offset per tile position for world-space placement
 * - Vertex animation: Per-corner displacement with bounded random walks
 * - Shader pipeline: Vertex transform with MVP matrix and Y-level positioning
 * 
 * Dependencies: gl-core.js (createProgram), global gl context, game state
 * Exports: TILE_VS/TILE_FS shaders, tileProgram, tileVAO, drawTiles()
 * Side effects: Creates VAO/VBO resources, modifies WebGL state during rendering
 */

// ============================================================================
// Tile Rendering Shaders
// ============================================================================

/** 
 * Vertex shader for tile rendering with instanced positioning and animation
 * Transforms unit tile geometry to world space using instance offsets
 */
const TILE_VS = `#version 300 es
layout(location=0) in vec3 a_pos;      // Base tile vertex position (0..1 space)
layout(location=1) in vec2 a_off;      // Per-instance tile offset (grid coordinates)
uniform mat4 u_mvp;                    // Model-View-Projection matrix
uniform vec2 u_originXZ;               // Map origin offset for centering
uniform float u_scale;                 // Global scale factor
uniform float u_y;                     // Y-level for tile placement
void main(){
  vec2 xz = (a_pos.xz + a_off + u_originXZ) * u_scale;
  vec3 world = vec3(xz.x, u_y, xz.y);
  gl_Position = u_mvp * vec4(world, 1.0);
}
`;

/** 
 * Fragment shader for solid color tile rendering with configurable colors
 * Provides uniform color output for floor/wall tile surfaces
 */
const TILE_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;                  // Tile surface color (RGB)
out vec4 outColor;
void main(){ 
  outColor = vec4(u_color, 1.0); 
}
`;

// ============================================================================
// WebGL Resources and Initialization
// ============================================================================

/** Shader program for tile rendering */
const tileProgram = createProgram(TILE_VS, TILE_FS);

/** Uniform locations for efficient shader parameter updates */
const tile_u_mvp = gl.getUniformLocation(tileProgram, 'u_mvp');
const tile_u_origin = gl.getUniformLocation(tileProgram, 'u_originXZ');
const tile_u_scale = gl.getUniformLocation(tileProgram, 'u_scale');
const tile_u_y = gl.getUniformLocation(tileProgram, 'u_y');
const tile_u_color = gl.getUniformLocation(tileProgram, 'u_color');

/** Vertex Array Object and buffer resources for tile geometry */
const tileVAO = gl.createVertexArray();
const tileVBO_PosBase = gl.createBuffer();    // Static base tile geometry
const tileVBO_PosJitter = gl.createBuffer();  // Animated jittered geometry  
const tileVBO_Inst = gl.createBuffer();       // Instance offset data

/**
 * Base tile geometry: Unit quad as two triangles (0,0,0) to (1,0,1)
 * Forms foundation for all tile instances before positioning transforms
 */
const tileBasePosData = new Float32Array([
  // Triangle 1: bottom-left, bottom-right, top-right
  0,0,0,  1,0,0,  1,0,1,
  // Triangle 2: bottom-left, top-right, top-left  
  0,0,0,  1,0,1,  0,0,1,
]);

/** Current geometry with applied vertex animations (starts as copy of base) */
let tileCurrPosData = new Float32Array(tileBasePosData);

/**
 * Initialize tile rendering VAO with base and animated geometry buffers
 * Sets up dual buffer system for stable/jittered vertex positions
 */
(function initTileBuffers() {
  gl.bindVertexArray(tileVAO);
  
  // Initialize base buffer with immutable tile geometry
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_PosBase);
  gl.bufferData(gl.ARRAY_BUFFER, tileBasePosData, gl.STATIC_DRAW);
  
  // Initialize jitter buffer with current positions (starts equal to base)
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_PosJitter);
  gl.bufferData(gl.ARRAY_BUFFER, tileCurrPosData, gl.DYNAMIC_DRAW);
  
  // Configure position attribute (location 0) - will be rebound per draw
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  
  // Setup instance buffer for tile grid positions
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Inst);
  // Initialize with empty buffer - will be populated when instOpen is available
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
  
  // Configure instance offset attribute (location 1)
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1); // One offset per tile instance
  
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
})();

// ============================================================================
// Vertex Animation System
// ============================================================================

/** Timing control for vertex animation updates */
let tileJitterLastTickSec = 0.0;
const tileJitterPeriod = 0.016; // ~60 FPS update rate

/** Animation parameters for vertex displacement */
const tileVertexProb = 0.10;    // 10% of unique tile corners animate per frame
const tileVertexStep = 0.01;    // Maximum displacement per frame
const tileVertexMax = 0.03;     // Maximum total displacement from base position

/**
 * Map unique tile corners to their vertex indices for efficient animation
 * Groups vertices by position to animate shared corners together
 */
// Identify unique corners: (0,0,0), (1,0,0), (1,0,1), (0,0,1)
const tileCornerMap = new Map();
for (let i = 0; i < tileBasePosData.length; i += 3) {
  const key = `${tileBasePosData[i+0]}|${tileBasePosData[i+1]}|${tileBasePosData[i+2]}`;
  if (!tileCornerMap.has(key)) tileCornerMap.set(key, []);
  tileCornerMap.get(key).push(i);
}
const tileCornerList = Array.from(tileCornerMap.values());

/** Current displacement for each unique corner (bounded random walk) */
let tileCornerDisp = new Float32Array(tileCornerList.length * 3);

/**
 * Update tile vertex positions with bounded random animation
 * Creates organic movement by displacing tile corners with random walks
 * Only affects top-down camera view to maintain stable geometry for other views
 * 
 * @param {number} nowSec - Current time in seconds for throttling updates
 */
function ensureTileGeomJitterTick(nowSec) {
  const now = nowSec || (performance.now() / 1000);
  if (now - tileJitterLastTickSec < tileJitterPeriod - 1e-6) return;
  tileJitterLastTickSec = now;
  
  // Select random subset of corners to animate this frame
  const total = tileCornerList.length;
  const count = Math.max(1, Math.round(total * tileVertexProb));
  const chosen = new Set();
  while (chosen.size < count) { 
    chosen.add(Math.floor(Math.random() * total)); 
  }
  
  // Apply bounded random displacement to selected corners
  chosen.forEach((ci) => {
    const b = ci * 3;
    const ox = tileCornerDisp[b+0], oy = tileCornerDisp[b+1], oz = tileCornerDisp[b+2];
    
    // Random step with clamping to maximum displacement bounds
    const nx = Math.max(-tileVertexMax, Math.min(tileVertexMax, 
      ox + (Math.random() * 2 - 1) * tileVertexStep));
    const ny = Math.max(-tileVertexMax, Math.min(tileVertexMax, 
      oy + (Math.random() * 2 - 1) * tileVertexStep));
    const nz = Math.max(-tileVertexMax, Math.min(tileVertexMax, 
      oz + (Math.random() * 2 - 1) * tileVertexStep));
    
    // Calculate displacement delta for this frame
    const dx = nx - ox, dy = ny - oy, dz = nz - oz;
    
    // Apply displacement to all vertices sharing this corner position
    const idxs = tileCornerList[ci];
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      tileCurrPosData[i+0] += dx; 
      tileCurrPosData[i+1] += dy; 
      tileCurrPosData[i+2] += dz;
    }
    
    // Store new displacement for next frame
    tileCornerDisp[b+0] = nx; 
    tileCornerDisp[b+1] = ny; 
    tileCornerDisp[b+2] = nz;
  });
  
  // Upload updated geometry to GPU
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_PosJitter);
  gl.bufferData(gl.ARRAY_BUFFER, tileCurrPosData, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

// ============================================================================
// Tile Rendering Functions
// ============================================================================

/**
 * Render floor tiles with optional vertex animation and dynamic coloring
 * Supports different camera views with stable/animated geometry as appropriate
 * 
 * @param {Float32Array} mvp - Model-View-Projection matrix for camera transform
 * @param {string} kind - Tile type: 'wall' for wall tiles, other for open floor
 */
function drawTiles(mvp, kind) {
  // Update persistent tile vertex jitter for top view only
  if (state.cameraKindCurrent === 'top' && typeof ensureTileGeomJitterTick === 'function') {
    ensureTileGeomJitterTick(state.nowSec || (performance.now() / 1000));
  }
  
  // Select instance data based on tile type
  const isWall = kind === 'wall';
  const data = isWall ? (window.instWall || new Float32Array(0)) : (window.instOpen || new Float32Array(0));
  if (!data.length) return; // Skip if no tiles to render
  
  // Configure tile rendering shader and uniforms
  gl.useProgram(tileProgram);
  gl.uniformMatrix4fv(tile_u_mvp, false, mvp);
  gl.uniform2f(tile_u_origin, -MAP_W * 0.5, -MAP_H * 0.5); // Center map origin
  gl.uniform1f(tile_u_scale, 1.0); // No additional scaling
  gl.uniform1f(tile_u_y, -0.001); // Slight Y offset to prevent Z-fighting
  
  // Derive floor color as darkened wall color for subtle theme consistency
  let floorCol = [0, 0, 0];
  try {
    const wall = (typeof getLevelWallColorRGB === 'function') 
      ? getLevelWallColorRGB() 
      : [0.06, 0.45, 0.48]; // Fallback teal color
    floorCol = wall.map(c => c * 0.15); // Dark floor relative to walls
  } catch (_) { 
    // Use fallback if color function unavailable
  }
  gl.uniform3fv(tile_u_color, new Float32Array(floorCol));
  
  gl.bindVertexArray(tileVAO);
  
  // Select appropriate position buffer based on camera type
  // Top view uses animated jitter, other views use stable base geometry
  const posBuffer = state.cameraKindCurrent === 'top' ? tileVBO_PosJitter : tileVBO_PosBase;
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  
  // Upload instance data and render all tiles
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, data.length / 2); // 6 vertices, 2 floats per instance
  
  gl.bindVertexArray(null);
}

// ============================================================================
// Global Export Registration  
// ============================================================================

/** Export tile rendering system for cross-module access */
if (typeof window !== 'undefined') {
  window.TILE_VS = TILE_VS;
  window.TILE_FS = TILE_FS;
  window.tileProgram = tileProgram;
  window.tileVAO = tileVAO;
  window.drawTiles = drawTiles;
} else if (typeof globalThis !== 'undefined') {
  globalThis.TILE_VS = TILE_VS;
  globalThis.TILE_FS = TILE_FS;
  globalThis.tileProgram = tileProgram;
  globalThis.tileVAO = tileVAO;
  globalThis.drawTiles = drawTiles;
}
