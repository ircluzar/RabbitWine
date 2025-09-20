/**
 * Essential 3D math utilities for matrix operations and transformations.
 * Provides matrix creation, multiplication, perspective projection, and utility functions for WebGL rendering.
 * Exports: mat4Identity(), mat4Multiply(), mat4Perspective(), mat4LookAt(), deg2rad() and other math functions.
 * Dependencies: None. Side effects: None.
 */

// Minimal math utilities (moved from gl.js and gameplay.js)
/**
 * Create a 4x4 identity matrix
 * @returns {Float32Array} 4x4 identity matrix in column-major order
 */
function mat4Identity(){
  return new Float32Array([1,0,0,0,
                           0,1,0,0,
                           0,0,1,0,
                           0,0,0,1]);
}

/**
 * Multiply two 4x4 matrices
 * @param {Float32Array} a - First matrix (left operand)
 * @param {Float32Array} b - Second matrix (right operand)
 * @returns {Float32Array} Result matrix a * b
 */
function mat4Multiply(a,b){
  const out = new Float32Array(16);
  for(let r=0;r<4;r++){
    for(let c=0;c<4;c++){
      out[c*4+r] = a[0*4+r]*b[c*4+0] + a[1*4+r]*b[c*4+1] + a[2*4+r]*b[c*4+2] + a[3*4+r]*b[c*4+3];
    }
  }
  return out;
}

/**
 * Create a perspective projection matrix
 * @param {number} fovYRad - Field of view in Y direction (radians)
 * @param {number} aspect - Aspect ratio (width/height)
 * @param {number} near - Near clipping plane distance
 * @param {number} far - Far clipping plane distance
 * @returns {Float32Array} 4x4 perspective projection matrix
 */
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
  let zx=ex-cx, zy=ey-cy, zz=ez-cz;
  const zlen=Math.hypot(zx,zy,zz)||1; zx/=zlen; zy/=zlen; zz/=zlen;
  let xx=uy*zz-uz*zy, xy=uz*zx-ux*zz, xz=ux*zy-uy*zx;
  const xlen=Math.hypot(xx,xy,xz)||1; xx/=xlen; xy/=xlen; xz/=xlen;
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
function mat4Translate(tx,ty,tz){
  const m = mat4Identity(); m[12]=tx; m[13]=ty; m[14]=tz; return m;
}
function mat4RotateY(rad){
  const c=Math.cos(rad), s=Math.sin(rad);
  return new Float32Array([
    c,0,-s,0,
    0,1, 0,0,
    s,0, c,0,
    0,0, 0,1,
  ]);
}
function mat4Scale(sx,sy,sz){
  const m = mat4Identity(); m[0]=sx; m[5]=sy; m[10]=sz; return m;
}

// Export all matrix functions to global scope for cross-module access
window.mat4Identity = mat4Identity;
window.mat4Multiply = mat4Multiply;
window.mat4Perspective = mat4Perspective;
window.mat4LookAt = mat4LookAt;
window.deg2rad = deg2rad;
window.smoothstep = smoothstep;
window.normalizeAngle = normalizeAngle;
window.mat4Translate = mat4Translate;
window.mat4RotateY = mat4RotateY;
window.mat4Scale = mat4Scale;
