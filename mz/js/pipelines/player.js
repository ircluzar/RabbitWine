/**
 * Player rendering pipeline with advanced cube geometry and procedural texture system.
 * Provides comprehensive player visualization including dynamic cube faces, texture array support,
 * and specialized rendering modes for different game states (normal, highlighted, damaged).
 * Features procedural green noise textures with clustered detail patterns for visual interest.
 * 
 * Key Features:
 * - Multi-face cube geometry with per-face texture layer assignment
 * - Procedural texture array generation with noise clustering algorithms
 * - Multiple rendering modes: normal, force white, force red, stipple pattern
 * - Screen-space checkerboard stippling for transparency effects
 * - Optimized vertex buffer layout with position, UV, and layer attributes
 * 
 * @fileoverview Advanced player cube rendering with procedural textures and multi-mode support
 * @exports PLAYER_VS, PLAYER_FS - WebGL2 shader programs for player rendering
 * @exports playerProgram, playerVAO, playerTexArray - Core rendering resources
 * @exports createGreenNoiseTextureArray() - Procedural texture generation utility
 * @dependencies createProgram() from gl-core.js, WebGL2 context with texture array support
 * @sideEffects Creates and uploads vertex buffers, generates texture arrays, modifies WebGL state
 */

// ============================================================================
// WebGL2 Shader Programs for Advanced Player Rendering
// ============================================================================

/**
 * Vertex shader for player cube rendering with texture layer support
 * Features: MVP and model matrix transformations, per-face texture layer assignment,
 * interleaved vertex attributes for position, UV coordinates, and layer selection
 */
const PLAYER_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in float a_layer;
uniform mat4 u_mvp;
uniform mat4 u_model;
out vec2 v_uv;
flat out float v_layer;
void main(){ v_uv = a_uv; v_layer = a_layer; gl_Position = u_mvp * u_model * vec4(a_pos,1.0); }`;

const PLAYER_FS = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;
uniform sampler2DArray u_tex;
uniform int u_forceWhite; // 0=normal, 1=white, 2=red
uniform int u_stipple; // 1 = checkerboard stipple using gl_FragCoord, 0 = normal
in vec2 v_uv;
flat in float v_layer;
out vec4 outColor;
void main(){
  if (u_forceWhite == 1) {
    outColor = vec4(1.0,1.0,1.0,1.0);
  } else if (u_forceWhite == 2) {
    outColor = vec4(1.0,0.15,0.15,1.0);
  } else {
    outColor = texture(u_tex, vec3(v_uv, floor(v_layer + 0.5)));
  }
  if (u_stipple == 1) {
    // Screen-space checkerboard: keep 1 of every 2 pixels
    float cx = floor(gl_FragCoord.x);
    float cy = floor(gl_FragCoord.y);
    if (mod(cx + cy, 2.0) < 1.0) discard;
  }
}`;
const playerProgram = createProgram(PLAYER_VS, PLAYER_FS);
const pl_u_mvp = gl.getUniformLocation(playerProgram, 'u_mvp');
const pl_u_model = gl.getUniformLocation(playerProgram, 'u_model');
const pl_u_tex = gl.getUniformLocation(playerProgram, 'u_tex');
const pl_u_forceWhite = gl.getUniformLocation(playerProgram, 'u_forceWhite');
const pl_u_stipple = gl.getUniformLocation(playerProgram, 'u_stipple');

// ============================================================================
// Player Cube Geometry and Vertex Buffer Setup
// ============================================================================

/** 
 * WebGL Vertex Array Object for player cube rendering 
 * Contains all vertex attributes: position (vec3), UV (vec2), layer (float)
 */
const playerVAO = gl.createVertexArray();
const playerVBO = gl.createBuffer();

// Configure cube geometry with per-face texture layer assignment
gl.bindVertexArray(playerVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, playerVBO);

/**
 * Upload cube face geometry with interleaved vertex attributes
 * Each face uses a different texture layer (0-5) for visual variety
 * Vertex format: [position(3), UV(2), layer(1)] = 6 floats per vertex
 * 
 * Face assignments:
 * - Layer 0: Front face (+Z)    - Layer 1: Back face (-Z)
 * - Layer 2: Left face (-X)     - Layer 3: Right face (+X)  
 * - Layer 4: Top face (+Y)      - Layer 5: Bottom face (-Y)
 */
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  // cube faces with layer per face
  -0.25,-0.25, 0.25,  0,0, 0,   0.25,-0.25, 0.25,  1,0, 0,   0.25, 0.25, 0.25,  1,1, 0,
  -0.25,-0.25, 0.25,  0,0, 0,   0.25, 0.25, 0.25,  1,1, 0,  -0.25, 0.25, 0.25,  0,1, 0,
   0.25,-0.25,-0.25,  0,0, 1,  -0.25,-0.25,-0.25,  1,0, 1,  -0.25, 0.25,-0.25,  1,1, 1,
   0.25,-0.25,-0.25,  0,0, 1,  -0.25, 0.25,-0.25,  1,1, 1,   0.25, 0.25,-0.25,  0,1, 1,
  -0.25,-0.25,-0.25,  0,0, 2,  -0.25,-0.25, 0.25,  1,0, 2,  -0.25, 0.25, 0.25,  1,1, 2,
  -0.25,-0.25,-0.25,  0,0, 2,  -0.25, 0.25, 0.25,  1,1, 2,  -0.25, 0.25,-0.25,  0,1, 2,
   0.25,-0.25, 0.25,  0,0, 3,   0.25,-0.25,-0.25,  1,0, 3,   0.25, 0.25,-0.25,  1,1, 3,
   0.25,-0.25, 0.25,  0,0, 3,   0.25, 0.25,-0.25,  1,1, 3,   0.25, 0.25, 0.25,  0,1, 3,
  -0.25, 0.25, 0.25,  0,0, 4,   0.25, 0.25, 0.25,  1,0, 4,   0.25, 0.25,-0.25,  1,1, 4,
  -0.25, 0.25, 0.25,  0,0, 4,   0.25, 0.25,-0.25,  1,1, 4,  -0.25, 0.25,-0.25,  0,1, 4,
  -0.25,-0.25,-0.25,  0,0, 5,   0.25,-0.25,-0.25,  1,0, 5,   0.25,-0.25, 0.25,  1,1, 5,
  -0.25,-0.25,-0.25,  0,0, 5,   0.25,-0.25, 0.25,  1,1, 5,  -0.25,-0.25, 0.25,  0,1, 5,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0,3,gl.FLOAT,false,6*4,0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1,2,gl.FLOAT,false,6*4,3*4);
gl.enableVertexAttribArray(2);
gl.vertexAttribPointer(2,1,gl.FLOAT,false,6*4,5*4);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

// ============================================================================
// Procedural Texture Array Generation System
// ============================================================================

/**
 * Generate procedural green noise texture array with clustered detail patterns
 * Creates multiple texture layers with varying green tones and black cluster accents
 * for visually interesting player cube faces that avoid repetitive appearance
 * 
 * Algorithm Features:
 * - Base green color variation per layer (175-195 range with noise)
 * - Clustered black spot generation (4% probability, 2x2 clusters)
 * - Single pixel black accents (3% probability) for additional detail
 * - Per-layer randomization ensures visual variety across cube faces
 * 
 * @param {number} size - Texture resolution per layer (default: 16x16 pixels)
 * @param {number} layers - Number of texture layers to generate (default: 6 for cube faces)
 * @returns {WebGLTexture} Configured texture array ready for shader sampling
 */
function createGreenNoiseTextureArray(size=16, layers=6){
  const tex = gl.createTexture();
  const data = new Uint8Array(size*size*4*layers);
  let off = 0;
  for (let l=0;l<layers;l++){
    const gBase = 175 + Math.floor(Math.random()*20);
    const clusterMask = new Uint8Array(size*size);
    for (let y=0;y<size;y++){
      for (let x=0;x<size;x++){
        if (Math.random() < 0.04){
          const x0 = Math.min(x, size-2);
          const y0 = Math.min(y, size-2);
          const i00 = y0*size + x0;
          clusterMask[i00] = 1;
          clusterMask[i00+1] = 1;
          clusterMask[i00+size] = 1;
          clusterMask[i00+size+1] = 1;
        }
      }
    }
    for (let y=0;y<size;y++){
      for (let x=0;x<size;x++){
        const idx = off + (y*size + x)*4;
        const masked = clusterMask[y*size + x] === 1;
        const singleBlack = Math.random() < 0.03;
        if (masked || singleBlack){
          data[idx+0]=0; data[idx+1]=0; data[idx+2]=0; data[idx+3]=255;
        } else {
          const noise = -3 + Math.floor(Math.random()*7);
          const g = Math.max(0, Math.min(255, gBase + noise));
          data[idx+0]=16; data[idx+1]=g; data[idx+2]=16; data[idx+3]=255;
        }
      }
    }
    off += size*size*4;
  }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, size, size, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return tex;
}

// ============================================================================
// Texture Array Initialization for Player Rendering
// ============================================================================

/** 
 * Pre-generated player texture array with 6 layers of procedural green noise
 * Each layer provides unique texture variation for the 6 cube faces
 */
const playerTexArray = createGreenNoiseTextureArray(16, 6);

// ============================================================================
// Global Exports for Rendering Pipeline Integration
// ============================================================================

/**
 * Export player rendering system components to global scope for gameplay integration
 * Enables main rendering loop and game systems to access player visualization resources
 */
if (typeof window !== 'undefined') {
  // Core rendering resources
  window.playerProgram = playerProgram;               // Compiled shader program
  window.playerVAO = playerVAO;                      // Cube geometry vertex array
  window.playerTexArray = playerTexArray;            // Procedural texture array
  
  // Shader uniform locations for direct access
  window.pl_u_mvp = pl_u_mvp;                       // MVP matrix uniform
  window.pl_u_model = pl_u_model;                   // Model matrix uniform  
  window.pl_u_tex = pl_u_tex;                       // Texture array uniform
  window.pl_u_forceWhite = pl_u_forceWhite;         // Force white mode uniform
  window.pl_u_stipple = pl_u_stipple;               // Stipple pattern uniform
  
  // Utility functions
  window.createGreenNoiseTextureArray = createGreenNoiseTextureArray; // Texture generation
}
