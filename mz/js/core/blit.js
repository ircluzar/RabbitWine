/**
 * Full-screen blit rendering for copying offscreen render targets to the main canvas.
 * Sets up quad geometry and shader program for efficient texture blitting operations.
 * Exports: blitProgram, blitVAO, blitVBO for use by main render loop.
 * Dependencies: createProgram() from gl-core.js, gl context. Side effects: Creates VAO/VBO resources.
 */

// Blit pipeline and offscreen target (moved from gl.js)
const BLIT_VS = `#version 300 es\nlayout(location=0) in vec2 a_pos;\nout vec2 v_uv;\nvoid main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const BLIT_FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform float u_topMix;
uniform float u_topLevels;
uniform float u_topDither;
uniform float u_topPixel;
in vec2 v_uv;
out vec4 outColor;

float hash(vec2 p){
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

float dither(vec2 uv){
  return hash(floor(uv * 256.0));
}

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

const blitProgram = createProgram(BLIT_VS, BLIT_FS);
const blitVAO = gl.createVertexArray();
const blitVBO = gl.createBuffer();
gl.bindVertexArray(blitVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, blitVBO);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([
    -1, -1,  // Full-screen quad vertices
     1, -1,
    -1,  1,
     1,  1,
  ]),
  gl.STATIC_DRAW
);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

const offscreen = createRenderTarget(BASE_WIDTH, BASE_HEIGHT);
