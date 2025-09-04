// Trail wireframe pipeline (extracted from gameplay.js)
const TRAIL_CUBE_VS = `#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=1) in vec4 a_inst;\nlayout(location=2) in float a_t;\nuniform mat4 u_mvp;\nuniform float u_scale;\nuniform float u_now;\nuniform float u_ttl;\nout float v_alpha;\nout float v_t;\nvoid main(){\n  vec3 world = a_inst.xyz + a_pos * u_scale;\n  gl_Position = u_mvp * vec4(world,1.0);\n  float age = clamp((u_now - a_inst.w)/u_ttl, 0.0, 1.0);\n  v_alpha = 1.0 - age;\n  v_t = a_t;\n}`;
const TRAIL_CUBE_FS = `#version 300 es\nprecision mediump float;\nin float v_alpha;\nin float v_t;\nuniform int u_dashMode;\nuniform float u_mulAlpha;\nuniform vec3 u_lineColor;\nout vec4 outColor;\nvoid main(){\n  if (u_dashMode == 1) { if (v_t > 0.10 && v_t < 0.90) discard; }\n  outColor = vec4(u_lineColor, v_alpha * u_mulAlpha);\n}`;
const trailCubeProgram = createProgram(TRAIL_CUBE_VS, TRAIL_CUBE_FS);
const tc_u_mvp = gl.getUniformLocation(trailCubeProgram, 'u_mvp');
const tc_u_scale = gl.getUniformLocation(trailCubeProgram, 'u_scale');
const tc_u_now = gl.getUniformLocation(trailCubeProgram, 'u_now');
const tc_u_ttl = gl.getUniformLocation(trailCubeProgram, 'u_ttl');
const tc_u_dashMode = gl.getUniformLocation(trailCubeProgram, 'u_dashMode');
const tc_u_mulAlpha = gl.getUniformLocation(trailCubeProgram, 'u_mulAlpha');
const tc_u_lineColor = gl.getUniformLocation(trailCubeProgram, 'u_lineColor');
const trailCubeVAO = gl.createVertexArray();
const trailCubeVBO_Pos = gl.createBuffer();
const trailCubeVBO_Inst = gl.createBuffer();
const trailCubeVBO_T = gl.createBuffer();
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
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);
const trailCubeBaseCount = 24 * 2;
