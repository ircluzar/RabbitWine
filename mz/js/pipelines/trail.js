// ============================================================================
// Trail Wireframe Rendering Pipeline System  
// ============================================================================
/**
 * @fileoverview Advanced trail wireframe rendering for player movement history
 * 
 * Features:
 * - Instanced wireframe cube rendering with time-based alpha decay
 * - Per-instance vertex jitter animation for organic visual effects
 * - Rodrigues rotation and wobble animation support
 * - Dash mode for dotted line effects on cube edges
 * - Per-corner displacement tracking for unique trail segments
 * - Configurable animation parameters (rotation speed, wobble amplitude/frequency)
 * 
 * Architecture:
 * - Base geometry: Cube wireframe (12 edges, 24 vertices) as line segments
 * - Instance data: Position, timestamp, rotation axis, 8 corner offsets
 * - Animation system: Per-instance bounded random walks for corner positions
 * - Shader features: Time-based fading, rotation, vertical wobble, dash effects
 * 
 * Dependencies: gl-core.js (createProgram), global gl context, performance.now()
 * Exports: Trail shaders, program, VAO, uniform locations, animation functions
 * Side effects: Creates VAO/VBO resources, maintains per-instance jitter state
 */

// ============================================================================
// Trail Wireframe Shaders
// ============================================================================

/**
 * Vertex shader for animated trail wireframe cubes
 * Supports per-instance rotation, wobble animation, and corner displacement
 */
const TRAIL_CUBE_VS = `#version 300 es
layout(location=0) in vec3 a_pos;      // Base cube edge vertex position
layout(location=1) in vec4 a_inst;     // Instance: [x, y, z, timestamp]
layout(location=2) in float a_t;       // Edge parameter (0..1) for dash effects
layout(location=3) in vec3 a_axis;     // Per-instance rotation axis (can be zero)

// Per-instance 8 corner offsets for vertex displacement animation
layout(location=4) in vec3 a_c0;       // Corner offsets at cube vertices
layout(location=5) in vec3 a_c1;       // ±0.5 base positions with jitter
layout(location=6) in vec3 a_c2;
layout(location=7) in vec3 a_c3;
layout(location=8) in vec3 a_c4;
layout(location=9) in vec3 a_c5;
layout(location=10) in vec3 a_c6;
layout(location=11) in vec3 a_c7;

uniform mat4 u_mvp;                     // Model-View-Projection matrix
uniform float u_scale;                  // Trail cube scale factor
uniform float u_now;                    // Current time for animations
uniform float u_ttl;                    // Trail time-to-live for alpha decay

// Animation controls (default 0 for legacy behavior)
uniform int u_useAnim;                  // 0=off, 1=apply rotate+wobble
uniform float u_rotSpeed;               // Rotation speed (radians/sec)
uniform float u_wobbleAmp;              // Vertical wobble amplitude  
uniform float u_wobbleSpeed;            // Wobble frequency (Hz)

out float v_alpha;                      // Time-based alpha for fading
out float v_t;                          // Edge parameter for fragment shader

// Rodrigues' rotation formula for vector v around unit axis k by angle ang
vec3 rotateAroundAxis(vec3 v, vec3 k, float ang){
  float s = sin(ang);
  float c = cos(ang);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

// Map vertex position to corner index (0-7) for offset lookup
int cornerIndex(vec3 p){
  int ix = (p.x > 0.0) ? 1 : 0;
  int iy = (p.y > 0.0) ? 1 : 0;
  int iz = (p.z > 0.0) ? 1 : 0;
  return ix + (iy<<1) + (iz<<2);
}

// Lookup corner offset by index using attribute array
vec3 cornerOffset(int idx){
  if (idx==0) return a_c0; if (idx==1) return a_c1; 
  if (idx==2) return a_c2; if (idx==3) return a_c3;
  if (idx==4) return a_c4; if (idx==5) return a_c5; 
  if (idx==6) return a_c6; return a_c7;
}

void main(){
  vec3 pos = a_pos;
  
  // Apply optional rotation and wobble animation
  if (u_useAnim == 1){
    float t = u_now;
    float seed = a_inst.w;  // Use timestamp as animation seed
    float ang = u_rotSpeed * (t - seed);
    
    // Use provided axis or fallback to Y-axis for rotation
    vec3 axis = a_axis;
    float len = max(1e-5, length(axis));
    axis = (len < 1e-3) ? vec3(0.0,1.0,0.0) : (axis/len);
    pos = rotateAroundAxis(pos, axis, ang);
    
    // Add vertical wobble with instance-specific phase
    float wob = sin(6.2831853 * u_wobbleSpeed * (t - seed)) * u_wobbleAmp;
    pos.y += wob;
  }
  
  // Apply per-instance corner offset in local space before scaling
  int ci = cornerIndex(pos);
  pos += cornerOffset(ci);
  
  // Transform to world space and project
  vec3 world = a_inst.xyz + pos * u_scale;
  gl_Position = u_mvp * vec4(world, 1.0);
  
  // Calculate time-based alpha decay
  float age = clamp((u_now - a_inst.w) / u_ttl, 0.0, 1.0);
  v_alpha = 1.0 - age;
  v_t = a_t;
}`;

/**
 * Fragment shader for trail wireframe with dash effects and alpha blending
 * Supports dash mode for dotted line appearance on cube edges
 */
const TRAIL_CUBE_FS = `#version 300 es
precision mediump float;
in float v_alpha;                       // Time-based alpha from vertex shader
in float v_t;                          // Edge parameter (0..1) for dash effects
uniform int u_dashMode;                 // 0=solid, 1=dashed line effect
uniform float u_mulAlpha;               // Additional alpha multiplier
uniform vec3 u_lineColor;               // Trail wireframe color
out vec4 outColor;
void main(){
  // Dash effect: discard middle portion of edges (0.1 to 0.9)
  // Dash effect: discard middle portion of edges (0.1 to 0.9)
  if (u_dashMode == 1) { 
    if (v_t > 0.10 && v_t < 0.90) discard; 
  }
  outColor = vec4(u_lineColor, v_alpha * u_mulAlpha);
}`;

// ============================================================================
// WebGL Resources and Initialization
// ============================================================================

/** Shader program for trail wireframe rendering */
const trailCubeProgram = createProgram(TRAIL_CUBE_VS, TRAIL_CUBE_FS);

/** Uniform locations for efficient parameter updates during rendering */
const tc_u_mvp = gl.getUniformLocation(trailCubeProgram, 'u_mvp');
const tc_u_scale = gl.getUniformLocation(trailCubeProgram, 'u_scale');
const tc_u_now = gl.getUniformLocation(trailCubeProgram, 'u_now');
const tc_u_ttl = gl.getUniformLocation(trailCubeProgram, 'u_ttl');
const tc_u_dashMode = gl.getUniformLocation(trailCubeProgram, 'u_dashMode');
const tc_u_mulAlpha = gl.getUniformLocation(trailCubeProgram, 'u_mulAlpha');
const tc_u_lineColor = gl.getUniformLocation(trailCubeProgram, 'u_lineColor');
const tc_u_useAnim = gl.getUniformLocation(trailCubeProgram, 'u_useAnim');
const tc_u_rotSpeed = gl.getUniformLocation(trailCubeProgram, 'u_rotSpeed');
const tc_u_wobbleAmp = gl.getUniformLocation(trailCubeProgram, 'u_wobbleAmp');
const tc_u_wobbleSpeed = gl.getUniformLocation(trailCubeProgram, 'u_wobbleSpeed');

/** Vertex Array Object and buffer resources for trail geometry */
const trailCubeVAO = gl.createVertexArray();
const trailCubeVBO_Pos = gl.createBuffer();       // Base cube edge vertices (layout 0)
const trailCubeVBO_T = gl.createBuffer();         // Edge parameters for dash effects (layout 2)
const trailCubeVBO_Inst = gl.createBuffer();      // Instance position+timestamp (layout 1)
const trailCubeVBO_Axis = gl.createBuffer();      // Rotation axis per instance (layout 3)
const trailCubeVBO_Corners = gl.createBuffer();   // 8 corner offsets per instance (layouts 4-11)

/**
 * Initialize trail cube VAO with wireframe geometry and instance attributes
 * Creates 12-edge cube wireframe optimized for instanced rendering
 */
(function buildTrailCubeVAO(){
  /** Cube edge vertex positions */
  const pos = [];
  /** Edge parameters (0..1) for dash effect calculations */
  const tVals = [];
  const s = 0.5; // Half-size for cube centered at origin
  
  // Generate 12 cube edges as line segments (24 vertices total)
  
  // 4 edges along X-axis at y={-s,+s}, z={-s,+s}
  for (const y of [-s, s]){
    for (const z of [-s, s]){
      pos.push(-s, y, z,  +s, y, z);
      tVals.push(0, 1); // Start and end of edge for dash effects
    }
  }
  
  // 4 edges along Y-axis at x={-s,+s}, z={-s,+s}
  for (const x of [-s, s]){
    for (const z of [-s, s]){
      pos.push(x, -s, z,  x, +s, z);
      tVals.push(0, 1);
    }
  }
  
  // 4 edges along Z-axis at x={-s,+s}, y={-s,+s}
  for (const x of [-s, s]){
    for (const y of [-s, s]){
      pos.push(x, y, -s,  x, y, +s);
      tVals.push(0, 1);
    }
  }
  
  const posArr = new Float32Array(pos);
  const tArr = new Float32Array(tVals);

  gl.bindVertexArray(trailCubeVAO);

  // Configure base cube edge geometry (layout 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Pos);
  gl.bufferData(gl.ARRAY_BUFFER, posArr, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  // Configure edge parameters for dash effects (layout 2)
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_T);
  gl.bufferData(gl.ARRAY_BUFFER, tArr, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

  // Configure instance position+timestamp buffer (layout 1)
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1); // One vec4 per trail instance

  // Configure instance rotation axis buffer (layout 3)
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1); // One vec3 per trail instance

  // Configure 8 corner offset attributes (layouts 4-11), packed in single buffer
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
  const stride = 8 * 3 * 4; // 8 vec3 (24 floats) per instance
  for (let i = 0; i < 8; i++){
    const loc = 4 + i; // Attribute locations 4 through 11
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, stride, i * 3 * 4);
    gl.vertexAttribDivisor(loc, 1); // One vec3 per trail instance
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindVertexArray(null);
})();

// ============================================================================
// Per-Instance Corner Animation System
// ============================================================================

/** Animation timing and parameters for vertex jitter effects */
const jitterPeriod = 0.016;        // ~16ms update interval (~60 FPS)
const vertexJitterProb = 0.15;     // 15% of corners animate per frame
const vertexJitterStep = 0.015;    // Maximum displacement step per frame
const vertexJitterMax = 0.075;     // Maximum total displacement (~15% of cube half-size)

/** 
 * Per-instance corner jitter state tracking
 * Maps instance keys to displacement arrays and timing data
 * @type {Map<string,{offs:Float32Array,last:number}>} 
 */
const trailCornerJitter = new Map();

/**
 * Generate corner offset buffer for trail instances with bounded random animation
 * Maintains per-instance jitter state for organic visual movement
 * 
 * @param {Array} instanceKeys - Unique identifiers for trail instances
 * @param {number} nowSec - Current time in seconds for animation timing
 * @returns {Float32Array} Packed corner offsets (8 vec3 per instance)
 */
function getTrailCornerOffsetsBuffer(instanceKeys, nowSec) {
  const now = nowSec || (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
  const N = instanceKeys.length;
  const packed = new Float32Array(N * 8 * 3); // 8 corners × 3 components per instance
  
  for (let i = 0; i < N; i++) {
    const key = String(instanceKeys[i] ?? i);
    let rec = trailCornerJitter.get(key);
    
    // Initialize jitter record for new instances
    if (!rec) { 
      rec = { 
        offs: new Float32Array(8 * 3), // 8 corners × xyz components
        last: 0 
      }; 
      trailCornerJitter.set(key, rec); 
    }
    
    // Update corner positions if enough time has passed
    if (now - rec.last >= jitterPeriod - 1e-6) {
      rec.last = now;
      
      // Select random subset of corners to animate this frame
      const count = Math.max(1, Math.round(8 * vertexJitterProb));
      const chosen = new Set();
      while (chosen.size < count) { 
        chosen.add((Math.random() * 8) | 0); 
      }
      
      // Apply bounded random displacement to selected corners
      chosen.forEach((ci) => {
        const base = ci * 3;
        const ox = rec.offs[base+0], oy = rec.offs[base+1], oz = rec.offs[base+2];
        
        // Random step with clamping to maximum displacement bounds
        const nx = Math.max(-vertexJitterMax, Math.min(vertexJitterMax, 
          ox + (Math.random() * 2 - 1) * vertexJitterStep));
        const ny = Math.max(-vertexJitterMax, Math.min(vertexJitterMax, 
          oy + (Math.random() * 2 - 1) * vertexJitterStep));
        const nz = Math.max(-vertexJitterMax, Math.min(vertexJitterMax, 
          oz + (Math.random() * 2 - 1) * vertexJitterStep));
        
        // Store updated displacement for this corner
        rec.offs[base+0] = nx; 
        rec.offs[base+1] = ny; 
        rec.offs[base+2] = nz;
      });
    }
    
    // Copy instance corner data to packed buffer
    packed.set(rec.offs, i * 8 * 3);
  }
  
  return packed;
}

/**
 * Legacy compatibility function for old edge jitter system
 * Kept for backward compatibility but functionality moved to per-instance system
 * @param {number} nowSec - Current time (unused in new system)
 */
function ensureTrailEdgeJitterTick(nowSec) { 
  /* moved to per-instance stream; kept for compatibility */ 
}

// ============================================================================
// Global Export Registration
// ============================================================================

/** Export trail rendering system components for cross-module access */
if (typeof window !== 'undefined'){
  // Shader source code
  window.TRAIL_CUBE_VS = TRAIL_CUBE_VS;
  window.TRAIL_CUBE_FS = TRAIL_CUBE_FS;
  
  // WebGL program and resources
  window.trailCubeProgram = trailCubeProgram;
  window.trailCubeVAO = trailCubeVAO;
  
  // Uniform locations for external rendering code
  window.tc_u_mvp = tc_u_mvp;
  window.tc_u_scale = tc_u_scale;
  window.tc_u_now = tc_u_now;
  window.tc_u_ttl = tc_u_ttl;
  window.tc_u_dashMode = tc_u_dashMode;
  window.tc_u_mulAlpha = tc_u_mulAlpha;
  window.tc_u_lineColor = tc_u_lineColor;
  window.tc_u_useAnim = tc_u_useAnim;
  window.tc_u_rotSpeed = tc_u_rotSpeed;
  window.tc_u_wobbleAmp = tc_u_wobbleAmp;
  window.tc_u_wobbleSpeed = tc_u_wobbleSpeed;
  
  // Buffer objects for external management
  window.trailCubeVBO_Pos = trailCubeVBO_Pos;
  window.trailCubeVBO_T = trailCubeVBO_T;
  window.trailCubeVBO_Inst = trailCubeVBO_Inst;
  window.trailCubeVBO_Axis = trailCubeVBO_Axis;
  window.trailCubeVBO_Corners = trailCubeVBO_Corners;
  
  // Animation and utility functions
  window.getTrailCornerOffsetsBuffer = getTrailCornerOffsetsBuffer;
  window.ensureTrailEdgeJitterTick = ensureTrailEdgeJitterTick;
} else if (typeof globalThis !== 'undefined') {
  // Alternative global object for other environments
  globalThis.TRAIL_CUBE_VS = TRAIL_CUBE_VS;
  globalThis.TRAIL_CUBE_FS = TRAIL_CUBE_FS;
  globalThis.trailCubeProgram = trailCubeProgram;
  globalThis.trailCubeVAO = trailCubeVAO;
  globalThis.getTrailCornerOffsetsBuffer = getTrailCornerOffsetsBuffer;
  globalThis.ensureTrailEdgeJitterTick = ensureTrailEdgeJitterTick;
}
