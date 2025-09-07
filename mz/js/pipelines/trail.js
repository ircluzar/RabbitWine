/**
 * Trail wireframe rendering pipeline for player movement history.
 * Manages instanced rendering of trail cubes with time-based alpha fading and dash effects.
 * Exports: TRAIL_CUBE_VS, TRAIL_CUBE_FS shaders, trailCubeProgram, trailCubeVAO, and related functions.
 * Dependencies: createProgram() from gl-core.js, gl context, trail data from state. Side effects: Creates VAO/VBO resources and modifies WebGL state.
 */

// Vertex shader: takes per-vertex position and t, per-instance transform, axis, and 8 corner offsets
const TRAIL_CUBE_VS = `#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=1) in vec4 a_inst;\nlayout(location=2) in float a_t;\nlayout(location=3) in vec3 a_axis; // per-instance rotation axis (can be zero)\n// Per-instance 8 corner offsets (cube corners at +-0.5)\nlayout(location=4) in vec3 a_c0;\nlayout(location=5) in vec3 a_c1;\nlayout(location=6) in vec3 a_c2;\nlayout(location=7) in vec3 a_c3;\nlayout(location=8) in vec3 a_c4;\nlayout(location=9) in vec3 a_c5;\nlayout(location=10) in vec3 a_c6;\nlayout(location=11) in vec3 a_c7;\nuniform mat4 u_mvp;\nuniform float u_scale;\nuniform float u_now;\nuniform float u_ttl;\n// Optional animation controls (default 0 for legacy behavior)\nuniform int u_useAnim;        // 0=off, 1=apply rotate+wobble\nuniform float u_rotSpeed;     // radians/sec around a_axis (fallback Y when axis~0)\nuniform float u_wobbleAmp;    // vertical wobble amplitude\nuniform float u_wobbleSpeed;  // wobble frequency in Hz (cycles/sec)\nout float v_alpha;\nout float v_t;\n\n// Rodrigues' rotation for vector v around unit axis k by angle ang\nvec3 rotateAroundAxis(vec3 v, vec3 k, float ang){\n  float s = sin(ang);\n  float c = cos(ang);\n  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);\n}\n\nint cornerIndex(vec3 p){\n  int ix = (p.x > 0.0) ? 1 : 0;\n  int iy = (p.y > 0.0) ? 1 : 0;\n  int iz = (p.z > 0.0) ? 1 : 0;\n  return ix + (iy<<1) + (iz<<2);\n}\nvec3 cornerOffset(int idx){\n  if (idx==0) return a_c0; if (idx==1) return a_c1; if (idx==2) return a_c2; if (idx==3) return a_c3;\n  if (idx==4) return a_c4; if (idx==5) return a_c5; if (idx==6) return a_c6; return a_c7;\n}\n\nvoid main(){\n  vec3 pos = a_pos;\n  if (u_useAnim == 1){\n    float t = u_now;\n    float seed = a_inst.w;\n    float ang = u_rotSpeed * (t - seed);\n    vec3 axis = a_axis;\n    float len = max(1e-5, length(axis));\n    axis = (len < 1e-3) ? vec3(0.0,1.0,0.0) : (axis/len);\n    pos = rotateAroundAxis(pos, axis, ang);\n    float wob = sin(6.2831853 * u_wobbleSpeed * (t - seed)) * u_wobbleAmp;\n    pos.y += wob;\n  }\n  // Apply per-instance corner offset in local space before scaling\n  int ci = cornerIndex(pos);\n  pos += cornerOffset(ci);\n  vec3 world = a_inst.xyz + pos * u_scale;\n  gl_Position = u_mvp * vec4(world,1.0);\n  float age = clamp((u_now - a_inst.w)/u_ttl, 0.0, 1.0);\n  v_alpha = 1.0 - age;\n  v_t = a_t;\n}`;

// Fragment shader: handles dash and color/alpha
const TRAIL_CUBE_FS = `#version 300 es\nprecision mediump float;\nin float v_alpha;\nin float v_t;\nuniform int u_dashMode;\nuniform float u_mulAlpha;\nuniform vec3 u_lineColor;\nout vec4 outColor;\nvoid main(){\n  if (u_dashMode == 1) { if (v_t > 0.10 && v_t < 0.90) discard; }\n  outColor = vec4(u_lineColor, v_alpha * u_mulAlpha);\n}`;

const trailCubeProgram = createProgram(TRAIL_CUBE_VS, TRAIL_CUBE_FS);
// Uniform locations used elsewhere
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

// VAO/VBO objects
const trailCubeVAO = gl.createVertexArray();
const trailCubeVBO_Pos = gl.createBuffer();       // layout=0 (vec3)
const trailCubeVBO_T = gl.createBuffer();         // layout=2 (float)
const trailCubeVBO_Inst = gl.createBuffer();      // layout=1 (vec4 per-instance)
const trailCubeVBO_Axis = gl.createBuffer();      // layout=3 (vec3 per-instance)
const trailCubeVBO_Corners = gl.createBuffer();   // layouts 4..11 (8x vec3 per-instance)

// Build cube line list and configure VAO
(function buildTrailCubeVAO(){
  /** @type {number[]} */
  const pos = [];
  /** @type {number[]} */
  const tVals = [];
  const s = 0.5;
  // 4 edges along X at y={-s,+s}, z={-s,+s}
  for (const y of [-s, s]){
    for (const z of [-s, s]){
      pos.push(-s, y, z,  +s, y, z);
      tVals.push(0, 1);
    }
  }
  // 4 edges along Y at x={-s,+s}, z={-s,+s}
  for (const x of [-s, s]){
    for (const z of [-s, s]){
      pos.push(x, -s, z,  x, +s, z);
      tVals.push(0, 1);
    }
  }
  // 4 edges along Z at x={-s,+s}, y={-s,+s}
  for (const x of [-s, s]){
    for (const y of [-s, s]){
      pos.push(x, y, -s,  x, y, +s);
      tVals.push(0, 1);
    }
  }
  const posArr = new Float32Array(pos);
  const tArr = new Float32Array(tVals);

  gl.bindVertexArray(trailCubeVAO);

  // layout=0 -> a_pos
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Pos);
  gl.bufferData(gl.ARRAY_BUFFER, posArr, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  // layout=2 -> a_t
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_T);
  gl.bufferData(gl.ARRAY_BUFFER, tArr, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

  // layout=1 -> a_inst (vec4 per-instance)
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);

  // layout=3 -> a_axis (vec3 per-instance)
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(3, 1);

  // layouts 4..11 -> a_c0..a_c7 (8x vec3 per instance), packed in one buffer
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
  const stride = 8 * 3 * 4; // 8 vec3 per instance
  for (let i=0;i<8;i++){
    const loc = 4 + i;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, stride, i * 3 * 4);
    gl.vertexAttribDivisor(loc, 1);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindVertexArray(null);
})();

// -------- Per-instance corner jitter manager (object-unique) --------
const jitterPeriod = 0.016;        // ~16ms bucket
const vertexJitterProb = 0.15;     // 15% of corners per tick
const vertexJitterStep = 0.015;    // step size per axis
const vertexJitterMax = 0.075;     // clamp per axis (~15% of half-size 0.5)
/** @type {Map<string,{offs:Float32Array,last:number}>} */
const trailCornerJitter = new Map();
function getTrailCornerOffsetsBuffer(instanceKeys, nowSec){
  const now = nowSec || (typeof performance !== 'undefined' ? performance.now()/1000 : 0);
  const N = instanceKeys.length;
  const packed = new Float32Array(N * 8 * 3);
  for (let i=0;i<N;i++){
    const key = String(instanceKeys[i] ?? i);
    let rec = trailCornerJitter.get(key);
    if (!rec){ rec = { offs: new Float32Array(8*3), last: 0 }; trailCornerJitter.set(key, rec); }
    if (now - rec.last >= jitterPeriod - 1e-6){
      rec.last = now;
      const count = Math.max(1, Math.round(8 * vertexJitterProb));
      const chosen = new Set();
      while (chosen.size < count){ chosen.add((Math.random()*8)|0); }
      chosen.forEach((ci)=>{
        const base = ci*3;
        const ox = rec.offs[base+0], oy = rec.offs[base+1], oz = rec.offs[base+2];
        const nx = Math.max(-vertexJitterMax, Math.min(vertexJitterMax, ox + (Math.random()*2-1)*vertexJitterStep));
        const ny = Math.max(-vertexJitterMax, Math.min(vertexJitterMax, oy + (Math.random()*2-1)*vertexJitterStep));
        const nz = Math.max(-vertexJitterMax, Math.min(vertexJitterMax, oz + (Math.random()*2-1)*vertexJitterStep));
        rec.offs[base+0]=nx; rec.offs[base+1]=ny; rec.offs[base+2]=nz;
      });
    }
    packed.set(rec.offs, i*8*3);
  }
  return packed;
}

// Back-compat no-op to satisfy old callers if still present
function ensureTrailEdgeJitterTick(nowSec){ /* moved to per-instance stream; kept for compatibility */ }

// Export frequently accessed symbols to window (non-module environment)
if (typeof window !== 'undefined'){
  window.TRAIL_CUBE_VS = TRAIL_CUBE_VS;
  window.TRAIL_CUBE_FS = TRAIL_CUBE_FS;
  window.trailCubeProgram = trailCubeProgram;
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
  window.trailCubeVAO = trailCubeVAO;
  window.trailCubeVBO_Pos = trailCubeVBO_Pos;
  window.trailCubeVBO_T = trailCubeVBO_T;
  window.trailCubeVBO_Inst = trailCubeVBO_Inst;
  window.trailCubeVBO_Axis = trailCubeVBO_Axis;
  window.trailCubeVBO_Corners = trailCubeVBO_Corners;
  window.getTrailCornerOffsetsBuffer = getTrailCornerOffsetsBuffer;
  window.ensureTrailEdgeJitterTick = ensureTrailEdgeJitterTick;
}
