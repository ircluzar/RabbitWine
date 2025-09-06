/**
 * Trail wireframe rendering pipeline for player movement history.
 * Manages instanced rendering of trail cubes with time-based alpha fading and dash effects.
 * Exports: TRAIL_CUBE_VS, TRAIL_CUBE_FS shaders, trailCubeProgram, trailCubeVAO, and related functions.
 * Dependencies: createProgram() from gl-core.js, gl context, trail data from state. Side effects: Creates VAO/VBO resources and modifies WebGL state.
 */

// Trail wireframe pipeline (extracted from gameplay.js)
const TRAIL_CUBE_VS = `#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=1) in vec4 a_inst;\nlayout(location=2) in float a_t;\nlayout(location=3) in vec3 a_axis; // per-instance rotation axis (can be zero)\nuniform mat4 u_mvp;\nuniform float u_scale;\nuniform float u_now;\nuniform float u_ttl;\n// Optional animation controls (default 0 for legacy behavior)\nuniform int u_useAnim;        // 0=off, 1=apply rotate+wobble\nuniform float u_rotSpeed;     // radians/sec around a_axis (fallback Y when axis~0)\nuniform float u_wobbleAmp;    // vertical wobble amplitude\nuniform float u_wobbleSpeed;  // wobble frequency in Hz (cycles/sec)\nout float v_alpha;\nout float v_t;\n\n// Rodrigues' rotation for vector v around unit axis k by angle ang\nvec3 rotateAroundAxis(vec3 v, vec3 k, float ang){\n  float s = sin(ang);\n  float c = cos(ang);\n  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);\n}\n\nvoid main(){\n  vec3 pos = a_pos;\n  if (u_useAnim == 1){\n    float t = u_now;\n    float seed = a_inst.w; // use instance w as spawnTime/phase seed\n    float ang = u_rotSpeed * (t - seed);\n    // Normalize axis; fallback to Y if nearly zero\n    vec3 axis = a_axis;\n    float len = max(1e-5, length(axis));\n    axis = (len < 1e-3) ? vec3(0.0, 1.0, 0.0) : (axis / len);\n    pos = rotateAroundAxis(pos, axis, ang);\n    // Gentle vertical wobble independent of axis\n    float wob = sin(6.2831853 * u_wobbleSpeed * (t - seed)) * u_wobbleAmp;\n    pos.y += wob;\n  }\n  vec3 world = a_inst.xyz + pos * u_scale;\n  gl_Position = u_mvp * vec4(world,1.0);\n  float age = clamp((u_now - a_inst.w)/u_ttl, 0.0, 1.0);\n  v_alpha = 1.0 - age;\n  v_t = a_t;\n}`;

const TRAIL_CUBE_FS = `#version 300 es\nprecision mediump float;\nin float v_alpha;\nin float v_t;\nuniform int u_dashMode;\nuniform float u_mulAlpha;\nuniform vec3 u_lineColor;\nout vec4 outColor;\nvoid main(){\n  if (u_dashMode == 1) { if (v_t > 0.10 && v_t < 0.90) discard; }\n  outColor = vec4(u_lineColor, v_alpha * u_mulAlpha);\n}`;

const trailCubeProgram = createProgram(TRAIL_CUBE_VS, TRAIL_CUBE_FS);
const tc_u_mvp = gl.getUniformLocation(trailCubeProgram, 'u_mvp');
const tc_u_scale = gl.getUniformLocation(trailCubeProgram, 'u_scale');
const tc_u_now = gl.getUniformLocation(trailCubeProgram, 'u_now');
const tc_u_ttl = gl.getUniformLocation(trailCubeProgram, 'u_ttl');
const tc_u_dashMode = gl.getUniformLocation(trailCubeProgram, 'u_dashMode');
const tc_u_mulAlpha = gl.getUniformLocation(trailCubeProgram, 'u_mulAlpha');
const tc_u_lineColor = gl.getUniformLocation(trailCubeProgram, 'u_lineColor');
// New optional animation uniforms (existence check not needed in WebGL2)
const tc_u_useAnim = gl.getUniformLocation(trailCubeProgram, 'u_useAnim');
const tc_u_rotSpeed = gl.getUniformLocation(trailCubeProgram, 'u_rotSpeed');
const tc_u_wobbleAmp = gl.getUniformLocation(trailCubeProgram, 'u_wobbleAmp');
const tc_u_wobbleSpeed = gl.getUniformLocation(trailCubeProgram, 'u_wobbleSpeed');

const trailCubeVAO = gl.createVertexArray();
const trailCubeVBO_Pos = gl.createBuffer();
const trailCubeVBO_Inst = gl.createBuffer();
const trailCubeVBO_T = gl.createBuffer();
const trailCubeVBO_Axis = gl.createBuffer();
gl.bindVertexArray(trailCubeVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Pos);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,
  -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,
  -0.5, 0.5,-0.5,  0.5, 0.5,-0.5,
  -0.5, 0.5, 0.5,  0.5, 0.5, 0.5,
  -0.5,-0.5,-0.5, -0.5, 0.5,-0.5,
   0.5,-0.5,-0.5,  0.5, 0.5,-0.5,
  -0.5,-0.5, 0.5, -0.5, 0.5, 0.5,
   0.5,-0.5, 0.5,  0.5, 0.5, 0.5,
  -0.5,-0.5,-0.5, -0.5,-0.5, 0.5,
   0.5,-0.5,-0.5,  0.5,-0.5, 0.5,
  -0.5, 0.5,-0.5, -0.5, 0.5, 0.5,
   0.5, 0.5,-0.5,  0.5, 0.5, 0.5,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_T);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  0,1,  0,1,  0,1,  0,1,
  0,1,  0,1,  0,1,  0,1,
  0,1,  0,1,  0,1,  0,1,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(2);
gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
gl.bufferData(gl.ARRAY_BUFFER, 4, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);
// Per-instance rotation axis (vec3)
gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
gl.bufferData(gl.ARRAY_BUFFER, 12, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(3);
gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(3, 1);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);
const trailCubeBaseCount = 24 * 2;
