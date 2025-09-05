/**
 * Full-screen blit rendering for copying offscreen render targets to the main canvas.
 * Sets up quad geometry and shader program for efficient texture blitting operations.
 * Exports: blitProgram, blitVAO, blitVBO for use by main render loop.
 * Dependencies: createProgram() from gl-core.js, gl context. Side effects: Creates VAO/VBO resources.
 */

// Blit pipeline and offscreen target (moved from gl.js)
const BLIT_VS = `#version 300 es\nlayout(location=0) in vec2 a_pos;\nout vec2 v_uv;\nvoid main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const BLIT_FS = `#version 300 es\nprecision mediump float;\nuniform sampler2D u_tex;\nin vec2 v_uv;\nout vec4 outColor;\nvoid main(){ outColor = texture(u_tex, v_uv); }`;

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
