const gl = CANVAS.getContext('webgl2', {
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
});

if (!gl) {
  alert('WebGL2 not supported on this device/browser.');
  throw new Error('WebGL2 not supported');
}

// --- Offscreen low-res render target (480x720) ---
function createRenderTarget(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Offscreen framebuffer incomplete');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return { fbo, tex, w, h };
}

// --- Blit pipeline (textured quad) ---
function createProgram(vsSrc, fsSrc) {
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
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

const BLIT_VS = `#version 300 es\nlayout(location=0) in vec2 a_pos;\nout vec2 v_uv;\nvoid main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const BLIT_FS = `#version 300 es\nprecision mediump float;\nuniform sampler2D u_tex;\nin vec2 v_uv;\nout vec4 outColor;\nvoid main(){ outColor = texture(u_tex, v_uv); }`;

const blitProgram = createProgram(BLIT_VS, BLIT_FS);
const blitVAO = gl.createVertexArray();
const blitVBO = gl.createBuffer();
gl.bindVertexArray(blitVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, blitVBO);
// Two-triangle strip covering NDC
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([
    -1, -1,
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

// --- Minimal mat4 utilities ---
function mat4Identity(){
  return new Float32Array([1,0,0,0,
                           0,1,0,0,
                           0,0,1,0,
                           0,0,0,1]);
}
function mat4Multiply(a,b){
  const out = new Float32Array(16);
  for(let r=0;r<4;r++){
    for(let c=0;c<4;c++){
      out[c*4+r] = a[0*4+r]*b[c*4+0] + a[1*4+r]*b[c*4+1] + a[2*4+r]*b[c*4+2] + a[3*4+r]*b[c*4+3];
    }
  }
  return out;
}
function mat4Perspective(fovYRad, aspect, near, far){
  const f = 1.0/Math.tan(fovYRad/2);
  const nf = 1/(near - far);
  const out = new Float32Array(16);
  out[0]=f/aspect; out[1]=0; out[2]=0; out[3]=0;
  out[4]=0; out[5]=f; out[6]=0; out[7]=0;
  out[8]=0; out[9]=0; out[10]=(far+near)*nf; out[11]=-1;
  out[12]=0; out[13]=0; out[14]=(2*far*near)*nf; out[15]=0;
  return out;
}
function mat4LookAt(eye, center, up){
  const [ex,ey,ez]=eye, [cx,cy,cz]=center, [ux,uy,uz]=up;
  let zx=ex-cx, zy=ey-cy, zz=ez-cz; // z = normalize(eye-center)
  const zlen=Math.hypot(zx,zy,zz)||1; zx/=zlen; zy/=zlen; zz/=zlen;
  // x = normalize(cross(up,z))
  let xx=uy*zz-uz*zy, xy=uz*zx-ux*zz, xz=ux*zy-uy*zx;
  const xlen=Math.hypot(xx,xy,xz)||1; xx/=xlen; xy/=xlen; xz/=xlen;
  // y = cross(z,x)
  const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
  const out=new Float32Array(16);
  out[0]=xx; out[1]=yx; out[2]=zx; out[3]=0;
  out[4]=xy; out[5]=yy; out[6]=zy; out[7]=0;
  out[8]=xz; out[9]=yz; out[10]=zz; out[11]=0;
  out[12]=-(xx*ex+xy*ey+xz*ez);
  out[13]=-(yx*ex+yy*ey+yz*ez);
  out[14]=-(zx*ex+zy*ey+zz*ez);
  out[15]=1;
  return out;
}
function deg2rad(d){ return d*Math.PI/180; }
function smoothstep(a,b,x){ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); }
function normalizeAngle(a){
  const TAU = Math.PI * 2;
  while (a <= -Math.PI) a += TAU;
  while (a > Math.PI) a -= TAU;
  return a;
}
