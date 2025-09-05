/**
 * Player rendering pipeline with vertex buffer and shader management.
 * Handles player geometry, trail rendering, and WebGL draw calls with texture array support.
 * Exports: PLAYER_VS, PLAYER_FS shaders, playerProgram, playerVAO, and drawPlayerAndTrail() function.
 * Dependencies: gl context, createProgram() from gl-core.js, state.player and state.trail from state.js. Side effects: Creates VAO/VBO resources and modifies WebGL state.
 */

// Player pipeline (extracted from gameplay.js)
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
uniform int u_forceWhite;
uniform int u_stipple; // 1 = checkerboard stipple using gl_FragCoord, 0 = normal
in vec2 v_uv;
flat in float v_layer;
out vec4 outColor;
void main(){
  if (u_forceWhite == 1) {
    outColor = vec4(1.0,1.0,1.0,1.0);
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
const playerVAO = gl.createVertexArray();
const playerVBO = gl.createBuffer();
gl.bindVertexArray(playerVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, playerVBO);
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

const playerTexArray = createGreenNoiseTextureArray(16, 6);
