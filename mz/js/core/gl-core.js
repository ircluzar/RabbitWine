/**
 * WebGL2 context initialization and core rendering utilities.
 * Sets up WebGL2 context with optimal settings and provides render target creation and shader compilation.
 * This module handles the foundational WebGL setup required by all rendering pipelines.
 * 
 * @fileoverview Core WebGL2 context and utilities
 * @exports gl - WebGL2 rendering context
 * @exports createRenderTarget() - Creates framebuffer + texture pairs
 * @exports createProgram() - Compiles and links shader programs
 * @dependencies CANVAS from dom.js
 * @sideEffects Gets WebGL2 context, throws error if unsupported, enables debug in development
 */

/**
 * WebGL2 rendering context with optimized settings for high-performance rendering
 * @const {WebGL2RenderingContext}
 */
const gl = CANVAS.getContext('webgl2', {
  antialias: true,              // Hardware antialiasing for smoother edges
  alpha: false,                 // Opaque canvas - no alpha compositing needed
  preserveDrawingBuffer: false, // Allow buffer swapping for better performance  
  powerPreference: 'high-performance', // Request discrete GPU when available
});

if (!gl) {
  alert('WebGL2 not supported on this device/browser.');
  throw new Error('WebGL2 not supported');
}

/**
 * Creates a render target (framebuffer + texture + optional depth buffer)
 * Used for offscreen rendering operations in the graphics pipeline.
 * 
 * @param {number} w - Width in pixels
 * @param {number} h - Height in pixels
 * @returns {Object} Render target object with fbo, tex, w, h, rbo properties
 */
function createRenderTarget(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  const rbo = gl.createRenderbuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  
  // Attach depth renderbuffer for proper depth testing in 3D rendering
  gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rbo);
  
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Offscreen framebuffer incomplete');
  }
  
  // Clean up bindings to avoid state leaks
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  
  return { fbo, tex, w, h, rbo };
}

/**
 * Compiles vertex and fragment shaders and links them into a shader program
 * Provides error handling and cleanup for shader compilation failures.
 * 
 * @param {string} vsSrc - Vertex shader source code (GLSL ES 3.0)
 * @param {string} fsSrc - Fragment shader source code (GLSL ES 3.0)
 * @returns {WebGLProgram} Compiled and linked shader program
 * @throws {Error} If shader compilation or program linking fails
 */
function createProgram(vsSrc, fsSrc) {
  /**
   * Compiles a single shader of the specified type
   * @param {number} type - gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
   * @param {string} src - GLSL shader source code
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
  
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    throw new Error('Program link failed: ' + log);
  }
  
  // Clean up individual shaders after linking
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  
  return prog;
}
