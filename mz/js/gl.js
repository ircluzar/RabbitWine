/**
 * @fileoverview WebGL2 context initialization and render target utilities
 * @description Provides WebGL2 context setup and framebuffer creation utilities.
 * Contains WebGL context initialization with optimal settings and helper functions
 * for creating render targets.
 * 
 * @author MZ Team
 * @version 1.0.0
 * 
 * @requires config.js - CANVAS element reference
 * @exports {WebGL2RenderingContext} gl - WebGL2 rendering context
 * @exports {Function} createRenderTarget - Render target creation utility
 */

/**
 * WebGL2 rendering context with optimized settings
 * Configured for high-performance rendering with antialiasing enabled
 * and no alpha channel for better performance.
 * @type {WebGL2RenderingContext}
 */
const gl = CANVAS.getContext('webgl2', {
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
});

// Validate WebGL2 support
if (!gl) {
  alert('WebGL2 not supported on this device/browser.');
  throw new Error('WebGL2 not supported');
}

/**
 * Creates a framebuffer render target with color texture and depth buffer
 * Configured with nearest-neighbor filtering and edge clamping for pixel-perfect rendering.
 * 
 * @param {number} w - Width in pixels
 * @param {number} h - Height in pixels
 * @returns {Object} Render target object with properties:
 *   - {WebGLFramebuffer} fbo - The framebuffer object
 *   - {WebGLTexture} tex - The color texture attachment
 *   - {number} w - Width in pixels
 *   - {number} h - Height in pixels
 * @throws {Error} If framebuffer creation fails
 */
function createRenderTarget(w, h) {
  // Create and configure color texture
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  
  // Configure texture parameters for pixel-perfect rendering
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Create framebuffer and depth renderbuffer
  const fbo = gl.createFramebuffer();
  const rbo = gl.createRenderbuffer();
  
  // Attach color texture to framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  
  // Create and attach depth buffer for depth testing
  gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rbo);
  
  // Validate framebuffer completeness
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Offscreen framebuffer incomplete');
  }
  
  // Clean up bindings
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  
  return { fbo, tex, w, h, rbo };
}

/**
 * Creates and links a WebGL shader program from vertex and fragment shader source code
 * 
 * @param {string} vsSrc - Vertex shader source code
 * @param {string} fsSrc - Fragment shader source code
 * @returns {WebGLProgram} Compiled and linked shader program
 * @throws {Error} If shader compilation or program linking fails
 */
function createProgram(vsSrc, fsSrc) {
  /**
   * Compiles a shader from source code
   * @param {number} type - Shader type (gl.VERTEX_SHADER or gl.FRAGMENT_SHADER)
   * @param {string} src - Shader source code
   * @returns {WebGLShader} Compiled shader
   * @throws {Error} If compilation fails
   */
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('Shader compile failed: ' + log);
    }
    return s;
  }
  
  // Compile vertex and fragment shaders
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  
  // Create and link program
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  
  // Check for linking errors
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    throw new Error('Program link failed: ' + log);
  }
  
  // Clean up shader objects (program retains compiled code)
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  
  return prog;
}

// Shader Source Code
/** @const {string} Vertex shader for fullscreen blit operations */
const BLIT_VS = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main(){ 
  v_uv = a_pos * 0.5 + 0.5; 
  gl_Position = vec4(a_pos, 0.0, 1.0); 
}`;

/** @const {string} Fragment shader for texture sampling */
const BLIT_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 outColor;
void main(){ 
  outColor = texture(u_tex, v_uv); 
}`;

// Initialize blit pipeline for fullscreen texture rendering
/** @const {WebGLProgram} Shader program for blitting textures to screen */
const blitProgram = createProgram(BLIT_VS, BLIT_FS);

/** @const {WebGLVertexArrayObject} VAO for fullscreen quad rendering */
const blitVAO = gl.createVertexArray();

/** @const {WebGLBuffer} VBO containing fullscreen quad vertices */
const blitVBO = gl.createBuffer();

// Set up fullscreen quad geometry
gl.bindVertexArray(blitVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, blitVBO);

// Two-triangle strip covering normalized device coordinates (-1 to 1)
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([
    -1, -1,  // Bottom-left
     1, -1,  // Bottom-right
    -1,  1,  // Top-left
     1,  1,  // Top-right
  ]),
  gl.STATIC_DRAW
);

// Configure vertex attribute for position
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

// Clean up bindings
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

/** @const {Object} Offscreen render target for low-resolution rendering */
const offscreen = createRenderTarget(BASE_WIDTH, BASE_HEIGHT);

// Matrix Mathematics Utilities

/**
 * Creates a 4x4 identity matrix
 * @returns {Float32Array} 4x4 identity matrix in column-major order
 */
function mat4Identity(){
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]);
}

/**
 * Multiplies two 4x4 matrices
 * @param {Float32Array} a - First matrix (left operand)
 * @param {Float32Array} b - Second matrix (right operand)  
 * @returns {Float32Array} Result matrix (a * b)
 */
function mat4Multiply(a, b){
  const out = new Float32Array(16);
  for(let r = 0; r < 4; r++){
    for(let c = 0; c < 4; c++){
      out[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + 
                       a[1 * 4 + r] * b[c * 4 + 1] + 
                       a[2 * 4 + r] * b[c * 4 + 2] + 
                       a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

/**
 * Creates a perspective projection matrix
 * @param {number} fovYRad - Field of view angle in radians (Y axis)
 * @param {number} aspect - Aspect ratio (width/height)
 * @param {number} near - Near clipping plane distance
 * @param {number} far - Far clipping plane distance
 * @returns {Float32Array} 4x4 perspective projection matrix
 */
function mat4Perspective(fovYRad, aspect, near, far){
  const f = 1.0 / Math.tan(fovYRad / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  
  // Column 0
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  // Column 1  
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  // Column 2
  out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
  // Column 3
  out[12] = 0; out[13] = 0; out[14] = (2 * far * near) * nf; out[15] = 0;
  
  return out;
}

/**
 * Creates a view matrix using the "look at" method
 * @param {Array<number>} eye - Camera position [x, y, z]
 * @param {Array<number>} center - Look target position [x, y, z]
 * @param {Array<number>} up - Up vector [x, y, z]
 * @returns {Float32Array} 4x4 view matrix
 */
function mat4LookAt(eye, center, up){
  const [ex, ey, ez] = eye;
  const [cx, cy, cz] = center;
  const [ux, uy, uz] = up;
  
  // Calculate z-axis (normalized vector from center to eye)
  let zx = ex - cx, zy = ey - cy, zz = ez - cz;
  const zlen = Math.hypot(zx, zy, zz) || 1;
  zx /= zlen; zy /= zlen; zz /= zlen;
  
  // Calculate x-axis (normalized cross product of up and z)
  let xx = uy * zz - uz * zy;
  let xy = uz * zx - ux * zz;
  let xz = ux * zy - uy * zx;
  const xlen = Math.hypot(xx, xy, xz) || 1;
  xx /= xlen; xy /= xlen; xz /= xlen;
  
  // Calculate y-axis (cross product of z and x)
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  
  // Build view matrix
  const out = new Float32Array(16);
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
  
  return out;
}

// Utility Functions

/**
 * Converts degrees to radians
 * @param {number} d - Angle in degrees
 * @returns {number} Angle in radians
 */
function deg2rad(d){ 
  return d * Math.PI / 180; 
}

/**
 * Performs smooth interpolation between two values using Hermite polynomial
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} x - Interpolation factor (0-1)
 * @returns {number} Smoothly interpolated value
 */
function smoothstep(a, b, x){ 
  const t = Math.min(1, Math.max(0, (x - a) / (b - a))); 
  return t * t * (3 - 2 * t); 
}

/**
 * Normalizes an angle to the range (-π, π]
 * @param {number} a - Angle in radians
 * @returns {number} Normalized angle
 */
function normalizeAngle(a){
  const TAU = Math.PI * 2;
  while (a <= -Math.PI) a += TAU;
  while (a > Math.PI) a -= TAU;
  return a;
}
