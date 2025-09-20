/**
 * Wall rendering shaders and WebGL program setup
 * Extracted from walls.js - contains GLSL sources, program creation, and uniform locations
 * 
 * @fileoverview WebGL shader program for voxel-based wall rendering with effects
 * @dependencies window.gl, window.createProgram (from gl-core.js)
 */

// ============================================================================
// Wall Rendering Shaders
// ============================================================================

/**
 * Vertex shader for voxel-based wall rendering with subdivision support
 * Transforms voxel coordinates to world space using instance offsets
 */
const WALL_VS = `#version 300 es
layout(location=0) in vec3 a_pos;      // Voxel vertex position within subdivision
layout(location=1) in vec2 a_off;      // Per-instance position offset (grid coords)
uniform mat4 u_mvp;                    // Model-View-Projection matrix
uniform vec2 u_origin;                 // Map origin offset for centering
uniform float u_scale;                 // Global scale factor
uniform float u_height;                // Wall height in world units
uniform vec3 u_voxCount;               // Voxel subdivision counts [X,Y,Z]
uniform vec3 u_voxOff;                 // Voxel offset within subdivision
uniform float u_yBase;                 // Base Y coordinate for wall bottom
out float v_worldY;                    // World Y coordinate for fragment shader
out vec2 v_worldXZ;                    // World XZ coordinates for effects
void main(){
  // Convert voxel coordinates to normalized local space (0..1)
  float lx = (a_pos.x + u_voxOff.x) / u_voxCount.x;
  float ly = (a_pos.y + u_voxOff.y) / u_voxCount.y;
  float lz = (a_pos.z + u_voxOff.z) / u_voxCount.z;
  
  // Transform to world space using instance offset and scale
  vec2 xz = (vec2(lx, lz) + a_off + u_origin) * u_scale;
  float y = ly * u_height + u_yBase;
  
  // Pass world coordinates to fragment shader for effects
  v_worldY = y;
  v_worldXZ = xz;
  
  gl_Position = u_mvp * vec4(xz.x, y, xz.y, 1.0);
}`;

/**
 * Fragment shader for wall rendering with advanced transparency and visual effects
 * Supports fade bands, screendoor patterns, glitter animation, and stippling
 */
const WALL_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;                  // Base wall color
uniform float u_alpha;                 // Base alpha value
uniform int u_useFade;                 // Enable distance-based alpha fading
uniform float u_playerY;               // Player Y position for fade calculations
uniform float u_fadeBand;              // Fade band width around player
uniform float u_minAlpha;              // Minimum alpha when faded
uniform int u_glitterMode;             // Enable glitter animation effects
uniform float u_now;                   // Current time for animations

// Screendoor transparency for top-view obstruction management
uniform int u_stippleMode;             // 0=off, 1=enable screendoor pattern
uniform float u_stippleAllow;          // Height threshold above player for stippling
uniform vec2 u_camXZ;                  // Camera world position XZ
uniform float u_camY;                  // Camera world position Y
uniform float u_stippleRadius;         // Effect radius around camera
uniform int u_stippleInvert;           // 0=apply within radius, 1=outside radius
uniform int u_stippleAbove;            // 1=check above player, 0=below

in float v_worldY;                     // World Y coordinate from vertex shader
in vec2 v_worldXZ;                     // World XZ coordinates from vertex shader
out vec4 outColor;
void main(){
  float aMul = 1.0;
  if (u_useFade == 1) {
    float d = abs(v_worldY - u_playerY);
    float t = clamp(d / max(0.0001, u_fadeBand), 0.0, 1.0);
    aMul = mix(1.0, max(0.0, u_minAlpha), t);
  }
  vec4 col = vec4(u_color, u_alpha * aMul);
  // Top-view screendoor: if fragment is above the player's head by more than a small allowance,
  // apply a 50% ordered-dither point pattern within a local radius around the player (not a checkerboard or lines).
  if (u_stippleMode == 1) {
    bool heightCond = (u_stippleAbove == 1) ? (v_worldY > (u_playerY + u_stippleAllow))
                                           : (v_worldY < (u_playerY - u_stippleAllow));
  float dist3 = distance(vec3(v_worldXZ.x, v_worldY, v_worldXZ.y), vec3(u_camXZ.x, u_camY, u_camXZ.y));
    bool radialWithin = (dist3 <= u_stippleRadius);
    bool radialHit = (u_stippleInvert == 1) ? (!radialWithin) : radialWithin;
    if (heightCond && radialHit) {
      // Dot lattice: remove every other column and every other row (25% coverage kept)
      int xi2 = int(mod(floor(gl_FragCoord.x), 2.0));
      int yi2 = int(mod(floor(gl_FragCoord.y), 2.0));
      // Keep only when both are odd (1); discard if either is even (0)
      if (xi2 == 0 || yi2 == 0) { discard; }
    }
  }
  if (u_glitterMode == 1) {
    float n = fract(sin(v_worldY * 47.0 + u_now * 83.0) * 43758.5453);
    col.rgb += vec3(n) * 0.15;
    col.a = min(1.0, col.a + n * 0.10);
  }
  outColor = col;
}`;

// ============================================================================
// WebGL Resources and Initialization
// ============================================================================

/**
 * Create shader program and get uniform locations
 * Call this after WebGL context is available
 */
function initWallShaders() {
  if (typeof window === 'undefined' || !window.gl || !window.createProgram) {
    console.warn('Wall shaders: WebGL context or createProgram not available');
    return null;
  }

  const program = window.createProgram(WALL_VS, WALL_FS);
  if (!program) {
    console.error('Failed to create wall shader program');
    return null;
  }

  const gl = window.gl;
  return {
    program,
    uniforms: {
      // Core uniform locations for transform and geometry parameters
      mvp: gl.getUniformLocation(program, 'u_mvp'),
      origin: gl.getUniformLocation(program, 'u_origin'),
      scale: gl.getUniformLocation(program, 'u_scale'),
      height: gl.getUniformLocation(program, 'u_height'),
      voxCount: gl.getUniformLocation(program, 'u_voxCount'),
      voxOff: gl.getUniformLocation(program, 'u_voxOff'),
      yBase: gl.getUniformLocation(program, 'u_yBase'),
      
      // Visual effect uniform locations for transparency and animation
      useFade: gl.getUniformLocation(program, 'u_useFade'),
      playerY: gl.getUniformLocation(program, 'u_playerY'),
      fadeBand: gl.getUniformLocation(program, 'u_fadeBand'),
      minAlpha: gl.getUniformLocation(program, 'u_minAlpha'),
      color: gl.getUniformLocation(program, 'u_color'),
      alpha: gl.getUniformLocation(program, 'u_alpha'),
      glitterMode: gl.getUniformLocation(program, 'u_glitterMode'),
      now: gl.getUniformLocation(program, 'u_now'),
      
      // Screendoor transparency uniform locations for top-view visibility
      stippleMode: gl.getUniformLocation(program, 'u_stippleMode'),
      stippleAllow: gl.getUniformLocation(program, 'u_stippleAllow'),
      camXZ: gl.getUniformLocation(program, 'u_camXZ'),
      camY: gl.getUniformLocation(program, 'u_camY'),
      stippleRadius: gl.getUniformLocation(program, 'u_stippleRadius'),
      stippleInvert: gl.getUniformLocation(program, 'u_stippleInvert'),
      stippleAbove: gl.getUniformLocation(program, 'u_stippleAbove')
    }
  };
}

/**
 * Create base wall geometry (unit cube triangulation)
 */
function createWallGeometry() {
  return new Float32Array([
    0,0,1,  1,0,1,  1,1,1,
    0,0,1,  1,1,1,  0,1,1,
    1,0,0,  0,0,0,  0,1,0,
    1,0,0,  0,1,0,  1,1,0,
    0,0,0,  0,0,1,  0,1,1,
    0,0,0,  0,1,1,  0,1,0,
    1,0,1,  1,0,0,  1,1,0,
    1,0,1,  1,1,0,  1,1,1,
    0,1,1,  1,1,1,  1,1,0,
    0,1,1,  1,1,0,  0,1,0,
    0,0,0,  1,0,0,  1,0,1,
    0,0,0,  1,0,1,  0,0,1,
  ]);
}

// Export shader utilities
if (typeof window !== 'undefined') {
  window.WALL_VS = WALL_VS;
  window.WALL_FS = WALL_FS;
  window.initWallShaders = initWallShaders;
  window.createWallGeometry = createWallGeometry;
}