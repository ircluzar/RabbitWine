/**
 * Debug visualization pipeline for TILE.REMOVE volumes and carved map geometry.
 * Renders translucent red boxes to visualize areas that have been carved out by the map builder,
 * providing essential visual feedback for level design and debugging without affecting gameplay collision.
 * Supports both batch rendering of multiple volumes and single-volume editor utilities.
 * 
 * Key Features:
 * - Translucent red cube rendering for carved volume visualization
 * - Instanced rendering for efficient batch display of multiple volumes
 * - Variable height support for complex multi-level carved areas
 * - Alpha blending with depth-aware rendering for proper visual layering
 * - Editor integration for single-cube debugging and validation
 * - Debug state awareness to show/hide visualization on demand
 * 
 * @fileoverview Debug rendering system for visualizing carved map volumes
 * @exports drawRemoveDebug() - Main batch rendering function for all remove volumes
 * @exports _drawSolidCubeOnceForEditor() - Single cube utility for editor debugging
 * @dependencies createProgram() from gl-core.js, removeVolumes from column system, MAP dimensions
 * @sideEffects Creates VAO/VBO resources, modifies WebGL blending and depth state during rendering
 */

// ============================================================================
// WebGL2 Shader Programs for Remove Volume Visualization
// ============================================================================

/**
 * Vertex shader for remove volume cube rendering with instanced positioning
 * Features: per-instance position and height scaling, world-space coordinate transformation
 */
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

// ============================================================================
// Remove Debug Rendering System Initialization
// ============================================================================

/** WebGL program for remove volume rendering */
let remProg, rem_u_mvp, rem_u_origin, rem_u_scale, rem_u_color, rem_u_alpha;
/** Vertex array and buffer objects for cube geometry and instance data */
let remVAO, remVBO_Pos, remVBO_Inst;

/**
 * Initialize remove debug rendering system with shaders and geometry buffers
 * Sets up cube geometry and instance buffer for efficient batch rendering
 * Called immediately on module load to ensure rendering readiness
 */
(function initRemoveDebug(){
  if (typeof gl === 'undefined') return; // Skip if WebGL context not available
  
  // Compile shader program and get uniform locations
  remProg = createProgram(REM_VS, REM_FS);
  rem_u_mvp = gl.getUniformLocation(remProg, 'u_mvp');
  rem_u_origin = gl.getUniformLocation(remProg, 'u_originXZ');
  rem_u_scale = gl.getUniformLocation(remProg, 'u_scale');
  rem_u_color = gl.getUniformLocation(remProg, 'u_color');
  rem_u_alpha = gl.getUniformLocation(remProg, 'u_alpha');
  
  // Create vertex array and buffers for cube rendering
  remVAO = gl.createVertexArray();
  remVBO_Pos = gl.createBuffer();   // Static cube geometry
  remVBO_Inst = gl.createBuffer();  // Dynamic instance data
  
  gl.bindVertexArray(remVAO);
  
  // Upload unit cube geometry (0..1 coordinate space, scaled per instance)
  gl.bindBuffer(gl.ARRAY_BUFFER, remVBO_Pos);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    // Front face triangles (Z=1)
    0,0,1,  1,0,1,  1,1,1,
    0,0,1,  1,1,1,  0,1,1,
    // Back face triangles (Z=0)
    1,0,0,  0,0,0,  0,1,0,
    1,0,0,  0,1,0,  1,1,0,
    // Left face triangles (X=0)
    0,0,0,  0,0,1,  0,1,1,
    0,0,0,  0,1,1,  0,1,0,
    // Right face triangles (X=1)
    1,0,1,  1,0,0,  1,1,0,
    1,0,1,  1,1,0,  1,1,1,
    // Top face triangles (Y=1)
    0,1,1,  1,1,1,  1,1,0,
    0,1,1,  1,1,0,  0,1,0,
    // Bottom face triangles (Y=0)
    0,0,0,  1,0,0,  1,0,1,
    0,0,0,  1,0,1,  0,0,1,
  ]), gl.STATIC_DRAW);
  
  // Configure position attribute (location 0) for cube vertices
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  
  // Setup instance buffer for per-volume position and size data
  gl.bindBuffer(gl.ARRAY_BUFFER, remVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
  
  // Instance position attribute (location 1): [x, y, z, height] per volume
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1); // One instance per remove volume
  
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
})();

// ============================================================================
// Remove Debug Volume Rendering Functions
// ============================================================================

/**
 * Draw a single solid cube at specified grid position with translucent effect
 * Used by editor to visualize individual remove volumes being placed/edited
 * 
 * @param {Float32Array} mvp - Model-View-Projection matrix for rendering
 * @param {number} gx - Grid X coordinate (map tile position)
 * @param {number} gy - Grid Y coordinate (map tile position)  
 * @param {number} baseY - Bottom Y coordinate of the remove volume
 * @param {number} height - Height of the remove volume in world units
 * @param {Array<number>} color - RGB color array [r,g,b] in 0-1 range
 * @param {number} alpha - Transparency level (0=invisible, 1=opaque)
 */
function _drawSolidCubeOnceForEditor(mvp, gx, gy, baseY, height, color /*[r,g,b]*/, alpha /*0..1*/){
  if (!remProg) return; // Skip if rendering system not initialized
  
  // Pack instance data: [gridX, gridY, baseY, height]
  const instArr = new Float32Array([ (gx|0), (gy|0), (baseY|0), Math.max(1, height|0) ]);
  
  // Configure shader program and uniforms
  gl.useProgram(remProg);
  gl.uniformMatrix4fv(rem_u_mvp, false, mvp);
  gl.uniform2f(rem_u_origin, -MAP_W*0.5, -MAP_H*0.5); // Center map origin
  gl.uniform1f(rem_u_scale, 1.0); // No additional scaling
  
  // Set volume color with fallback to white
  const r = (color && color[0] != null) ? color[0] : 1.0;
  const g = (color && color[1] != null) ? color[1] : 1.0;
  const b = (color && color[2] != null) ? color[2] : 1.0;
  gl.uniform3f(rem_u_color, r, g, b);
  gl.uniform1f(rem_u_alpha, Math.max(0.0, Math.min(1.0, alpha==null?0.3:alpha)));
  
  // Render single instanced cube
  gl.bindVertexArray(remVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, remVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, instArr, gl.DYNAMIC_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, 1); // 36 vertices = 12 triangles = cube
  gl.bindVertexArray(null);
}

/**
 * Render all remove debug volumes in the current map for visualization
 * Displays translucent cubes showing areas where map geometry will be carved
 * Typically called during debug/editor rendering passes
 * 
 * @param {Float32Array} mvp - Model-View-Projection matrix for camera transform
 */
function drawRemoveDebug(mvp){
  // Skip rendering if system not ready or debug mode disabled
  if (!remProg || !window.removeVolumes || !state || !state.debugVisible) return;
  
  const vols = window.removeVolumes;
  if (!Array.isArray(vols) || vols.length === 0) return;
  
  // Build instance buffer entries per remove volume for batch rendering
  const inst = [];
  for (const r of vols){
    if (!r) continue;
    
    // Extract volume parameters with fallbacks
    const x = r.x|0, y = r.y|0, b = (r.b|0)||0, h = (r.h|0)||0;
    if (h <= 0) continue; // Skip volumes with no height
    
    // Add instance data: [gridX, gridY, baseY, height]
    inst.push(x, y, b, h);
  }
  
  if (!inst.length) return; // No valid volumes to render
  
  // Configure shader program for batch volume rendering
  const instArr = new Float32Array(inst);
  gl.useProgram(remProg);
  gl.uniformMatrix4fv(rem_u_mvp, false, mvp);
  gl.uniform2f(rem_u_origin, -MAP_W*0.5, -MAP_H*0.5); // Center map coordinates
  gl.uniform1f(rem_u_scale, 1.0);
  gl.uniform3f(rem_u_color, 0.95, 0.15, 0.2); // Red-orange volume color
  gl.uniform1f(rem_u_alpha, 0.35); // Semi-transparent for debug visibility
  
  // Upload instance data and render all volumes in single draw call
  gl.bindVertexArray(remVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, remVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, instArr, gl.DYNAMIC_DRAW);

  // Enable transparency for debug volume visualization
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false); // Don't write depth to allow overlapping volumes
  
  // Render all instances: 36 vertices per cube, instArr.length/4 volumes
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, instArr.length / 4);
  
  // Restore rendering state
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

// ============================================================================
// Global Export Registration
// ============================================================================

/** Export remove debug rendering function for cross-module access */
if (typeof window !== 'undefined') window.drawRemoveDebug = drawRemoveDebug;
else if (typeof globalThis !== 'undefined') globalThis.drawRemoveDebug = drawRemoveDebug;
