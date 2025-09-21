/**
 * Full-screen blit rendering for copying offscreen render targets to the main canvas.
 * Sets up quad geometry and shader program for efficient texture blitting operations with
 * optional post-processing effects including posterization, dithering, and pixelation.
 * 
 * @fileoverview Post-processing blit pipeline for offscreen-to-screen rendering
 * @exports blitProgram - Shader program for texture blitting with effects
 * @exports blitVAO - Vertex array object for full-screen quad
 * @exports blitVBO - Vertex buffer object containing quad vertices
 * @exports offscreen - Main offscreen render target for low-res rendering
 * @dependencies createProgram() from gl-core.js, gl context, BASE_WIDTH/BASE_HEIGHT constants
 * @sideEffects Creates VAO/VBO resources, initializes offscreen render target
 */

/**
 * Vertex shader for full-screen quad rendering
 * Transforms normalized device coordinates to UV texture coordinates
 * @const {string}
 */
const BLIT_VS = `#version 300 es\nlayout(location=0) in vec2 a_pos;\nout vec2 v_uv;\nvoid main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

/**
 * Fragment shader for texture blitting with optional retro post-processing effects
 * Supports selective region effects, posterization, dithering, and pixelation for retro aesthetics
 * @const {string}
 */
const BLIT_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;       // Source texture to blit
uniform float u_topMix;        // Effect mix amount (0=off, 1=full effect)
uniform float u_topLevels;     // Posterization levels (lower = more crushed)
uniform float u_topDither;     // Dithering amount (0=off, 1=full dither)
uniform float u_topPixel;      // Pixelation size (1=off, higher=more pixelated)
in vec2 v_uv;
out vec4 outColor;

/**
 * Hash function for pseudo-random dithering pattern generation
 * @param {vec2} p - Input coordinates for hash generation
 * @returns {float} Pseudo-random value in [0,1] range
 */
float hash(vec2 p){
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

/**
 * Generates dithering noise pattern for ordered dithering
 * @param {vec2} uv - UV coordinates for dither pattern sampling
 * @returns {float} Dither value in [0,1] range
 */
float dither(vec2 uv){
  return hash(floor(uv * 256.0));
}

/**
 * Applies posterization with optional dithering to reduce color banding
 * @param {vec3} c - Input RGB color
 * @param {float} levels - Number of quantization levels per channel
 * @param {float} d - Dither noise value
 * @param {float} dAmt - Dithering amount (0=off, 1=full)
 * @returns {vec3} Posterized RGB color
 */
vec3 posterizeDither(vec3 c, float levels, float d, float dAmt){
  // Quantize without dithering first
  vec3 quantized = floor(c * levels + 0.5) / levels;
  
  // Add controlled dithering that doesn't bias toward black
  if (dAmt > 0.0) {
    float step = 1.0 / levels;
    float noise = (d - 0.5) * step * dAmt * 0.5; // Reduced intensity
    vec3 dithered = clamp(c + vec3(noise), 0.0, 1.0);
    vec3 ditheredQuantized = floor(dithered * levels + 0.5) / levels;
    return mix(quantized, ditheredQuantized, dAmt);
  }
  
  return quantized;
}

void main(){
  vec2 uv = v_uv;
  
  // Apply effect to top half (v_uv.y > 0.5 means top half)
  // BUT when mix is at full strength (1.0), apply to whole screen for consistency
  float isTop = step(0.5, v_uv.y);
  float isFullScreen = step(0.99, u_topMix); // When mix is nearly 1.0, apply to full screen
  float applyRegion = max(isTop, isFullScreen);
  
  // Pixelation effect
  if (applyRegion > 0.5 && u_topPixel > 0.5){
    vec2 texSize = vec2(textureSize(u_tex, 0));
    vec2 stepPix = vec2(u_topPixel) / texSize;
    uv = (floor(v_uv / stepPix) + 0.5) * stepPix;
  }
  
  vec4 col = texture(u_tex, uv);
  
  // Calculate mix amount
  float mixAmt = clamp(u_topMix, 0.0, 1.0) * applyRegion;
  
  // Apply posterize and dither effect
  if (mixAmt > 0.0){
    float levels = max(2.0, u_topLevels);
    float dAmt = clamp(u_topDither, 0.0, 1.0);
    float d = dither(uv);
    vec3 crushed = posterizeDither(col.rgb, levels, d, dAmt);
    col.rgb = mix(col.rgb, crushed, mixAmt);
  }
  
  outColor = col;
}`;

/**
 * Compiled shader program for full-screen texture blitting with post-processing effects
 * @const {WebGLProgram}
 */
const blitProgram = createProgram(BLIT_VS, BLIT_FS);

/**
 * Vertex Array Object for full-screen quad rendering
 * Contains vertex attribute setup for position data
 * @const {WebGLVertexArrayObject}
 */
const blitVAO = gl.createVertexArray();

/**
 * Vertex Buffer Object containing full-screen quad vertices
 * Two triangles forming a quad covering normalized device coordinates [-1,1]
 * @const {WebGLBuffer}
 */
const blitVBO = gl.createBuffer();

// Set up full-screen quad geometry
gl.bindVertexArray(blitVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, blitVBO);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([
    -1, -1,  // Bottom-left vertex
     1, -1,  // Bottom-right vertex
    -1,  1,  // Top-left vertex
     1,  1,  // Top-right vertex (triangle strip order)
  ]),
  gl.STATIC_DRAW
);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

/**
 * Main offscreen render target for low-resolution retro rendering
 * All scene geometry is rendered to this target before being blitted to screen with effects
 * @const {Object}
 */
const offscreen = createRenderTarget(BASE_WIDTH, BASE_HEIGHT);

// Cached uniform locations (avoid per-frame getUniformLocation cost)
const __blit_u_tex = gl.getUniformLocation(blitProgram, 'u_tex');
const __blit_u_topMix = gl.getUniformLocation(blitProgram, 'u_topMix');
const __blit_u_topLevels = gl.getUniformLocation(blitProgram, 'u_topLevels');
const __blit_u_topDither = gl.getUniformLocation(blitProgram, 'u_topDither');
const __blit_u_topPixel = gl.getUniformLocation(blitProgram, 'u_topPixel');

let __blitUniformSetCount = 0;
if (typeof window !== 'undefined'){
  window.__blitPerf = ()=>({ uniformSets: __blitUniformSetCount });
}
// Provide helper to apply uniforms (called each frame from bootstrap)
function blitApplyUniforms(state){
  // Called after program bound & texture unit 0 set
  if (__blit_u_tex) gl.uniform1i(__blit_u_tex, 0);
  if (__blit_u_topMix) gl.uniform1f(__blit_u_topMix, state.topPosterizeMix || 0.0);
  if (__blit_u_topLevels) gl.uniform1f(__blit_u_topLevels, state.topPosterizeLevels || 6.0);
  if (__blit_u_topDither) gl.uniform1f(__blit_u_topDither, state.topDitherAmt || 0.0);
  if (__blit_u_topPixel) gl.uniform1f(__blit_u_topPixel, state.topPixelSize || 0.0);
  __blitUniformSetCount++;
}
if (typeof window !== 'undefined') window.blitApplyUniforms = blitApplyUniforms;

// Expose accessors (optional) for debugging / hot-reload scenarios
if (typeof window !== 'undefined'){
  window.__blitUniforms = {
    u_tex: __blit_u_tex,
    u_topMix: __blit_u_topMix,
    u_topLevels: __blit_u_topLevels,
    u_topDither: __blit_u_topDither,
    u_topPixel: __blit_u_topPixel
  };
}
