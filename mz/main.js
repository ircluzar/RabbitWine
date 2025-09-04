// VRUN MZ minimal app shell (M0): WebGL2 init, DPR resize, input logger

const CANVAS = document.getElementById('app');
const HUD = document.getElementById('hud');
const SEAM = document.getElementById('seam');
const SEAM_HANDLE = document.getElementById('seam-handle');
const GLOW_L = document.getElementById('swipe-glow-left');
const GLOW_R = document.getElementById('swipe-glow-right');
const FILL_TOGGLE = document.getElementById('fill-toggle');

// Config: base internal render target 480x720 portrait (w x h)
const BASE_WIDTH = 480;
const BASE_HEIGHT = 720;

const state = {
  dpr: Math.min( window.devicePixelRatio || 1, 3 ),
  logicalWidth: BASE_WIDTH,
  logicalHeight: BASE_HEIGHT,
  timeStart: performance.now(),
  inputs: {
    pointers: new Map(), // id -> {x,y,dx,dy,startX,startY,lastT}
    keys: new Set(),
    gamepads: [],
  },
  seamRatio: 0.5, // 0..1 of canvas height where seam lies (center of handle)
  fps: 0,
  frames: 0,
  lastFpsT: performance.now(),
  letterboxCss: { x: 0, y: 0, w: 0, h: 0 },
  timePrev: performance.now(),
  fillViewport: true, // true = scale to fit viewport, false = 1x native centered
  // Player
  player: {
  x: 0, z: 0, y: 0.0,
  vy: 0.0,
  grounded: true,
  wallJumpCooldown: 0.0,
  jumpStartY: 0.0,
    angle: 0, // radians, 0 faces -Z
    speed: 0,
    radius: 0.3,
  },
  trail: {
  points: [], // array of [x,y,z,bornSec]
  maxPoints: 420,
  minDist: 0.69/2,
  ttl: 0.69, // seconds
  },
  camFollow: { x: 0, y: 0, z: 0 },
  camYaw: 0.0,
  // When true, bottom view occupies full height (seam snapped to top)
  snapBottomFull: false,
  // When true, top view occupies full height (seam snapped to bottom)
  snapTopFull: false,
};

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

// --- Grid pipeline (shader + buffers) ---
const GRID_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_mvp;
out vec3 v_world;
void main(){ v_world = a_pos; gl_Position = u_mvp * vec4(a_pos,1.0); }
`;
const GRID_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;
uniform vec3 u_camPos;
uniform float u_falloff;
in vec3 v_world;
out vec4 outColor;
void main(){
  float att = 1.0;
  if (u_falloff > 0.0) {
    float dist = distance(v_world, u_camPos);
    att = 1.0 / (1.0 + dist * u_falloff);
    att = max(att, 0.25);
  }
  outColor = vec4(u_color * att, 1.0);
}
`;
const gridProgram = createProgram(GRID_VS, GRID_FS);
const grid_u_mvp = gl.getUniformLocation(gridProgram, 'u_mvp');
const grid_u_color = gl.getUniformLocation(gridProgram, 'u_color');
const grid_u_camPos = gl.getUniformLocation(gridProgram, 'u_camPos');
const grid_u_falloff = gl.getUniformLocation(gridProgram, 'u_falloff');

function buildGridLines(size=20, step=1){
  const lines=[];
  for(let i=-size;i<=size;i+=step){
    // X-lines (varying Z)
    lines.push(-size,0,i,  size,0,i);
    // Z-lines (varying X)
    lines.push(i,0,-size,  i,0,size);
  }
  return new Float32Array(lines);
}
const gridData = buildGridLines(24, 1);
const gridVAO = gl.createVertexArray();
const gridVBO = gl.createBuffer();
gl.bindVertexArray(gridVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, gridVBO);
gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);
const gridVertexCount = gridData.length/3;

// --- Tilemap representation and instanced floor rendering ---
const TILE = { OPEN: 0, WALL: 1 };
const MAP_W = 24, MAP_H = 24;
const map = new Uint8Array(MAP_W * MAP_H);
function mapIdx(x,y){ return y*MAP_W + x; }
function buildSampleMap(){
  // Simple border walls and a few interior blocks
  for (let y=0;y<MAP_H;y++){
    for (let x=0;x<MAP_W;x++){
      const border = x===0||y===0||x===MAP_W-1||y===MAP_H-1;
      map[mapIdx(x,y)] = border ? TILE.WALL : TILE.OPEN;
    }
  }
  // Interior rooms
  for (let y=6;y<18;y++){
    map[mapIdx(6,y)] = TILE.WALL;
    map[mapIdx(17,y)] = TILE.WALL;
  }
  for (let x=6;x<18;x++){
    map[mapIdx(x,6)] = TILE.WALL;
    map[mapIdx(x,17)] = TILE.WALL;
  }
  // Some pillars
  [[10,10],[13,10],[10,13],[13,13]].forEach(([x,y])=>{ map[mapIdx(x,y)] = TILE.WALL; });
}
buildSampleMap();

// Collect instance offsets
let instOpen = new Float32Array(0), instWall = new Float32Array(0);
function rebuildInstances(){
  const opens=[], walls=[];
  for(let y=0;y<MAP_H;y++){
    for(let x=0;x<MAP_W;x++){
      const v = map[mapIdx(x,y)];
      if (v === TILE.WALL) walls.push(x,y); else opens.push(x,y);
    }
  }
  instOpen = new Float32Array(opens);
  instWall = new Float32Array(walls);
}
rebuildInstances();

// Extra tall columns (stacked blocks) defined by tile and height in tiles
const extraColumns = [
  { x: 10, y: 10, h: 6 },
  { x: 13, y: 10, h: 6 },
  { x: 10, y: 13, h: 6 },
  { x: 13, y: 13, h: 6 },
];
// Fast lookup: tile "x,y" -> height
const columnHeights = new Map();
for (const c of extraColumns){ columnHeights.set(`${c.x},${c.y}`, c.h); }

// Tile shader (instanced unit quad on XZ plane)
const TILE_VS = `#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=1) in vec2 a_off;\nuniform mat4 u_mvp;\nuniform vec2 u_originXZ;\nuniform float u_scale;\nuniform float u_y;\nvoid main(){\n  vec2 xz = (a_pos.xz + a_off + u_originXZ) * u_scale;\n  vec3 world = vec3(xz.x, u_y, xz.y);\n  gl_Position = u_mvp * vec4(world, 1.0);\n}\n`;
const TILE_FS = `#version 300 es\nprecision mediump float;\nuniform vec3 u_color;\nout vec4 outColor;\nvoid main(){ outColor = vec4(u_color,1.0); }\n`;
const tileProgram = createProgram(TILE_VS, TILE_FS);
const tile_u_mvp = gl.getUniformLocation(tileProgram, 'u_mvp');
const tile_u_origin = gl.getUniformLocation(tileProgram, 'u_originXZ');
const tile_u_scale = gl.getUniformLocation(tileProgram, 'u_scale');
const tile_u_y = gl.getUniformLocation(tileProgram, 'u_y');
const tile_u_color = gl.getUniformLocation(tileProgram, 'u_color');

// Unit quad geometry in XZ: (0,0)-(1,1)
const tileVAO = gl.createVertexArray();
const tileVBO_Pos = gl.createBuffer();
const tileVBO_Inst = gl.createBuffer();
gl.bindVertexArray(tileVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Pos);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  // tri 1
  0,0,0,  1,0,0,  1,0,1,
  // tri 2
  0,0,0,  1,0,1,  0,0,1,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
// Instance buffer (offsets)
gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Inst);
gl.bufferData(gl.ARRAY_BUFFER, instOpen, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

function drawTiles(mvp, kind){
  const isWall = kind === 'wall';
  const data = isWall ? instWall : instOpen;
  if (!data.length) return;
  gl.useProgram(tileProgram);
  gl.uniformMatrix4fv(tile_u_mvp, false, mvp);
  // Center map around origin by shifting by (-MAP_W/2, -MAP_H/2)
  gl.uniform2f(tile_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(tile_u_scale, 1.0);
  gl.uniform1f(tile_u_y, -0.001);
  const color = [0.0, 0.0, 0.0];
  gl.uniform3fv(tile_u_color, color);

  gl.bindVertexArray(tileVAO);
  // Upload instance data for this draw
  gl.bindBuffer(gl.ARRAY_BUFFER, tileVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, data.length/2);
  gl.bindVertexArray(null);
}

// Wall voxels (instanced cube split into voxel grid via multiple passes)
const WALL_VS = `#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=1) in vec2 a_off;\nuniform mat4 u_mvp;\nuniform vec2 u_originXZ;\nuniform float u_scale;\nuniform float u_height;\nuniform vec3 u_voxCount; // voxel counts per axis (x,y,z)\nuniform vec3 u_voxOff;   // current voxel offset (x,y,z) in [0..count-1]\nuniform float u_yBase;   // additional vertical base offset (stacking)\nvoid main(){\n  // Map tile + voxelized local cube into world\n  float lx = (a_pos.x + u_voxOff.x) / u_voxCount.x;\n  float ly = (a_pos.y + u_voxOff.y) / u_voxCount.y;\n  float lz = (a_pos.z + u_voxOff.z) / u_voxCount.z;\n  vec2 xz = (vec2(lx, lz) + a_off + u_originXZ) * u_scale;\n  float y = ly * u_height + u_yBase;\n  gl_Position = u_mvp * vec4(xz.x, y, xz.y, 1.0);\n}`;
const WALL_FS = `#version 300 es\nprecision mediump float;\nuniform vec3 u_color;\nuniform float u_alpha;\nout vec4 outColor;\nvoid main(){ outColor = vec4(u_color, u_alpha); }`;
const wallProgram = createProgram(WALL_VS, WALL_FS);
const wall_u_mvp = gl.getUniformLocation(wallProgram, 'u_mvp');
const wall_u_origin = gl.getUniformLocation(wallProgram, 'u_originXZ');
const wall_u_scale = gl.getUniformLocation(wallProgram, 'u_scale');
const wall_u_height = gl.getUniformLocation(wallProgram, 'u_height');
const wall_u_color = gl.getUniformLocation(wallProgram, 'u_color');
const wall_u_alpha = gl.getUniformLocation(wallProgram, 'u_alpha');
const wall_u_voxCount = gl.getUniformLocation(wallProgram, 'u_voxCount');
const wall_u_voxOff = gl.getUniformLocation(wallProgram, 'u_voxOff');
const wall_u_yBase = gl.getUniformLocation(wallProgram, 'u_yBase');

const wallVAO = gl.createVertexArray();
const wallVBO_Pos = gl.createBuffer();
const wallVBO_Inst = gl.createBuffer();
gl.bindVertexArray(wallVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Pos);
// Unit cube from (0,0,0) to (1,1,1)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  // Front
  0,0,1,  1,0,1,  1,1,1,
  0,0,1,  1,1,1,  0,1,1,
  // Back
  1,0,0,  0,0,0,  0,1,0,
  1,0,0,  0,1,0,  1,1,0,
  // Left
  0,0,0,  0,0,1,  0,1,1,
  0,0,0,  0,1,1,  0,1,0,
  // Right
  1,0,1,  1,0,0,  1,1,0,
  1,0,1,  1,1,0,  1,1,1,
  // Top
  0,1,1,  1,1,1,  1,1,0,
  0,1,1,  1,1,0,  0,1,0,
  // Bottom
  0,0,0,  1,0,0,  1,0,1,
  0,0,0,  1,0,1,  0,0,1,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
// Instance offsets (tile x,y)
gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
gl.bufferData(gl.ARRAY_BUFFER, instWall, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

function drawWalls(mvp){
  const data = instWall;
  if (!data.length) return;
  gl.useProgram(wallProgram);
  gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
  gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(wall_u_scale, 1.0);
  gl.uniform1f(wall_u_height, 1.0); // cubic voxels (height matches tile size)
  gl.uniform1f(wall_u_yBase, 0.0);
  gl.uniform3fv(wall_u_color, new Float32Array([0.06, 0.45, 0.48]));
  gl.uniform1f(wall_u_alpha, 0.65);
  const voxX=2, voxY=2, voxZ=2; // 2x2x2 voxel grid per tile
  gl.uniform3f(wall_u_voxCount, voxX, voxY, voxZ);
  gl.bindVertexArray(wallVAO);
  // Upload instance data
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  // Depth pre-pass: write wall depth (no color) so later passes are occluded correctly
  gl.disable(gl.BLEND);
  gl.colorMask(false, false, false, false);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);
  for (let vz=0; vz<voxZ; vz++){
    for (let vy=0; vy<voxY; vy++){
      for (let vx=0; vx<voxX; vx++){
        gl.uniform3f(wall_u_voxOff, vx, vy, vz);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, data.length/2);
      }
    }
  }
  // Color blended pass: respect depth, don’t write to it
  gl.colorMask(true, true, true, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.depthFunc(gl.LEQUAL);
  for (let vz=0; vz<voxZ; vz++){
    for (let vy=0; vy<voxY; vy++){
      for (let vx=0; vx<voxX; vx++){
        gl.uniform3f(wall_u_voxOff, vx, vy, vz);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, data.length/2);
      }
    }
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(null);

  // Per-tile silhouette outlines for all wall tiles
  drawOutlinesForTileArray(mvp, data, 0.5, 1.0);
}

// Helper: draw thick black outlines for 1x1x1 blocks at given tile coordinates
function drawOutlinesForTileArray(mvp, tileArray, yCenter, baseScale){
  const count = tileArray.length/2;
  if (count <= 0) return;
  const tNow = state.nowSec || (performance.now()/1000);
  const inst = new Float32Array(count * 4);
  for (let i=0;i<count;i++){
    const tx = tileArray[i*2+0];
    const ty = tileArray[i*2+1];
    const cx = (tx - MAP_W*0.5 + 0.5);
    const cz = (ty - MAP_H*0.5 + 0.5);
    inst[i*4+0]=cx; inst[i*4+1]=yCenter; inst[i*4+2]=cz; inst[i*4+3]=tNow;
  }
  gl.useProgram(trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  gl.uniform1f(tc_u_now, tNow);
  gl.uniform1f(tc_u_ttl, 1.0);
  gl.uniform1i(tc_u_dashMode, 0);
  gl.uniform3f(tc_u_lineColor, 0.0, 0.0, 0.0);
  gl.bindVertexArray(trailCubeVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  gl.disable(gl.BLEND);
  gl.depthMask(false);
  gl.uniform1f(tc_u_mulAlpha, 1.0);
  // Pass 1: base scale
  gl.uniform1f(tc_u_scale, baseScale);
  gl.drawArraysInstanced(gl.LINES, 0, 24, count);
  // Pass 2: slightly larger for thickness
  gl.uniform1f(tc_u_scale, baseScale * 1.03);
  gl.drawArraysInstanced(gl.LINES, 0, 24, count);
  gl.depthMask(true);
  gl.bindVertexArray(null);
}

// Draw tall columns by stacking multiple unit-height cubes at specified tiles
function drawTallColumns(mvp){
  if (extraColumns.length === 0) return;
  const pillars = extraColumns.map(p=>[p.x, p.y]);
  gl.useProgram(wallProgram);
  gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
  gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(wall_u_scale, 1.0);
  gl.uniform1f(wall_u_height, 1.0);
  gl.uniform3fv(wall_u_color, new Float32Array([0.06, 0.45, 0.48]));
  gl.uniform1f(wall_u_alpha, 0.65);
  const voxX=1, voxY=1, voxZ=1;
  gl.uniform3f(wall_u_voxCount, voxX, voxY, voxZ);
  gl.bindVertexArray(wallVAO);
  // Prepare instance buffer for tile offsets
  const offs = new Float32Array(pillars.length * 2);
  for (let i=0;i<pillars.length;i++){ offs[i*2+0]=pillars[i][0]; offs[i*2+1]=pillars[i][1]; }
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, offs, gl.DYNAMIC_DRAW);
  // Depth pre-pass for each stacked level
  gl.disable(gl.BLEND);
  gl.colorMask(false,false,false,false);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);
  // Find max height among pillars to minimize passes
  let maxH = 0; for (const c of extraColumns) maxH = Math.max(maxH, c.h|0);
  for (let level=0; level<maxH; level++){
    gl.uniform1f(wall_u_yBase, level * 1.0);
    gl.uniform3f(wall_u_voxOff, 0,0,0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pillars.length);
  }
  // Blended color pass
  gl.colorMask(true,true,true,true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.depthFunc(gl.LEQUAL);
  for (let level=0; level<maxH; level++){
    gl.uniform1f(wall_u_yBase, level * 1.0);
    gl.uniform3f(wall_u_voxOff, 0,0,0);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pillars.length);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(null);

  // Draw outlines for each stacked cube level
  for (let level=0; level<maxH; level++){
    const yCenter = level + 0.5; // center of that cube
    const offs = new Float32Array(pillars.length * 2);
    for (let i=0;i<pillars.length;i++){ offs[i*2+0]=pillars[i][0]; offs[i*2+1]=pillars[i][1]; }
    drawOutlinesForTileArray(mvp, offs, yCenter, 1.0);
  }
}

function resizeCanvasToViewport() {
  const dpr = state.dpr = Math.min(window.devicePixelRatio || 1, 3);
  // canvas CSS size fills viewport; set backing store size accordingly
  const cssW = Math.max(1, Math.floor(window.innerWidth));
  const cssH = Math.max(1, Math.floor(window.innerHeight));

  // Keep internal logical resolution BASE_WIDTH x BASE_HEIGHT; adapt via cameras later.
  // For now, we render directly to canvas sized to CSS * DPR to keep crispness.
  let pixelW, pixelH;
  if (state.fillViewport) {
    pixelW = Math.floor(cssW * dpr);
    pixelH = Math.floor(cssH * dpr);
  } else {
    // 1x native resolution (BASE_WIDTH x BASE_HEIGHT) regardless of viewport
    pixelW = BASE_WIDTH;
    pixelH = BASE_HEIGHT;
  }

  if (CANVAS.width !== pixelW || CANVAS.height !== pixelH) {
    CANVAS.width = pixelW;
    CANVAS.height = pixelH;
  }
  // Compute letterbox in CSS px for overlay alignment
  const targetAR = BASE_WIDTH / BASE_HEIGHT;
  const cssAR = cssW / cssH;
  let destWcss, destHcss, offXcss, offYcss;
  if (state.fillViewport) {
    if (cssAR > targetAR) {
      destHcss = cssH;
      destWcss = Math.floor(destHcss * targetAR);
    } else {
      destWcss = cssW;
      destHcss = Math.floor(destWcss / targetAR);
    }
    offXcss = Math.floor((cssW - destWcss) / 2);
    offYcss = Math.floor((cssH - destHcss) / 2);
  } else {
    // Native size centered
    destWcss = BASE_WIDTH;
    destHcss = BASE_HEIGHT;
    offXcss = Math.floor((cssW - destWcss) / 2);
    offYcss = Math.floor((cssH - destHcss) / 2);
  }
  state.letterboxCss = { x: offXcss, y: offYcss, w: destWcss, h: destHcss };
  // Position seam handle (CSS px)
  if (state.snapBottomFull) {
    SEAM.style.top = `${offYcss}px`;
  } else if (state.snapTopFull) {
    SEAM.style.top = `${offYcss + destHcss}px`;
  } else {
    const topPx = Math.floor(offYcss + state.seamRatio * destHcss);
    SEAM.style.top = `${topPx}px`;
  }
}

// Swipe glow feedback timers and helper
let glowTimerL = 0, glowTimerR = 0;
function showSwipeGlow(dir){
  const now = performance.now();
  const dur = 180; // ms
  if (dir === 'left') { glowTimerL = now + dur; if (GLOW_L) GLOW_L.classList.add('show'); }
  else { glowTimerR = now + dur; if (GLOW_R) GLOW_R.classList.add('show'); }
}

function updateHUD(now) {
  const elapsed = (now - state.timeStart) / 1000;
  if (now - state.lastFpsT >= 500) {
    state.fps = Math.round((state.frames * 1000) / (now - state.lastFpsT));
    state.frames = 0;
    state.lastFpsT = now;
  }
  const pointerLines = [];
  state.inputs.pointers.forEach((p, id) => {
    pointerLines.push(`#${id}: x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} dx=${p.dx.toFixed(1)} dy=${p.dy.toFixed(1)}`);
  });
  HUD.textContent = [
    `FPS ${state.fps} | t ${elapsed.toFixed(1)}s | DPR ${state.dpr.toFixed(2)}`,
  `Canvas ${CANVAS.width}x${CANVAS.height} (px) | seam ${(state.seamRatio*100).toFixed(1)}%`,
  `Present ${state.letterboxCss.w}x${state.letterboxCss.h} css @ (${state.letterboxCss.x},${state.letterboxCss.y})`,
  `Player x=${state.player.x.toFixed(2)} z=${state.player.z.toFixed(2)} ang=${(state.player.angle*180/Math.PI).toFixed(0)} speed=${state.player.speed.toFixed(2)}`,
    pointerLines.length ? `Pointers:\n${pointerLines.join('\n')}` : 'Pointers: none',
    state.inputs.keys.size ? `Keys: ${Array.from(state.inputs.keys).join(',')}` : 'Keys: none',
  ].join('\n');
  // Auto-hide swipe glows shortly after activation
  if (GLOW_L && performance.now() > glowTimerL) GLOW_L.classList.remove('show');
  if (GLOW_R && performance.now() > glowTimerR) GLOW_R.classList.remove('show');
}

// Simple grid rendering in each viewport for validation
function renderGridViewport(x, y, w, h, cameraKind /* 'top'|'bottom' */) {
  gl.viewport(x, y, w, h);
  gl.enable(gl.DEPTH_TEST);
  // Clear only this region using scissor to avoid wiping the other viewport
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x, y, w, h);
  if (cameraKind === 'top') gl.clearColor(0.025, 0.05, 0.055, 1.0); else gl.clearColor(0.02, 0.045, 0.05, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.SCISSOR_TEST);
  // No grid draw here; the glow grid is drawn after scene rendering using additive blending
}

function drawGridOverlay(mvp, camEye, isThirdPerson) {
  gl.useProgram(gridProgram);
  gl.uniformMatrix4fv(grid_u_mvp, false, mvp);
  // Darker turquoise base
  gl.uniform3fv(grid_u_color, new Float32Array([0.05, 0.35, 0.33]));
  // Distance falloff for third-person only
  if (isThirdPerson) {
    gl.uniform3f(grid_u_camPos, camEye[0], camEye[1], camEye[2]);
    gl.uniform1f(grid_u_falloff, 0.09);
  } else {
    gl.uniform3f(grid_u_camPos, 0,0,0);
    gl.uniform1f(grid_u_falloff, 0.0);
  }
  // Depth-test the grid so it doesn't draw over walls or the player
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // additive glow
  gl.bindVertexArray(gridVAO);
  gl.drawArrays(gl.LINES, 0, gridVertexCount);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
}

function render(now) {
  state.frames++;
  const dt = Math.min(0.05, Math.max(0, (now - state.timePrev) / 1000));
  state.timePrev = now;
  state.nowSec = now / 1000;
  stepGame(dt);
  // 1) Render into offscreen low-res target (480x720)
  gl.bindFramebuffer(gl.FRAMEBUFFER, offscreen.fbo);
  gl.viewport(0, 0, offscreen.w, offscreen.h);
  // Clear offscreen
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0.04, 0.04, 0.06, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const W = offscreen.w, H = offscreen.h;
  const seamY = Math.floor(H * state.seamRatio);
  const topH = Math.max(1, seamY);
  const botH = Math.max(1, H - seamY);
  if (state.snapBottomFull) {
    // Full-screen bottom camera
    gl.viewport(0, 0, W, H);
    const mvAspectBot = W / H;
    renderGridViewport(0, 0, W, H, 'bottom');
    const proj = mat4Perspective(deg2rad(48), Math.max(0.1, mvAspectBot), 0.1, 150.0);
    const fx = state.camFollow.x, fz = state.camFollow.z;
    const eye = [fx, 24.0, fz];
    const center = [fx, 0.0, fz];
    const view = mat4LookAt(eye, center, [0, 0, -1]);
    const mvp = mat4Multiply(proj, view);
  drawTiles(mvp, 'open');
  drawWalls(mvp);
  drawTallColumns(mvp);
  drawPlayerAndTrail(mvp);
  drawGridOverlay(mvp, eye, false);
  } else if (state.snapTopFull) {
    // Full-screen top camera
    gl.viewport(0, 0, W, H);
    const mvAspectTop = W / H;
    renderGridViewport(0, 0, W, H, 'top');
    const proj = mat4Perspective(deg2rad(60), Math.max(0.1, mvAspectTop), 0.1, 150.0);
    const fx = state.camFollow.x, fz = state.camFollow.z;
  const dirX = Math.sin(state.camYaw);
  const dirZ = -Math.cos(state.camYaw);
  const dist = 4.0;
  const baseHeight = 2.6;
  const eye = [fx - dirX * dist, state.camFollow.y + baseHeight, fz - dirZ * dist];
  const center = [fx + dirX * 1.2, state.camFollow.y + 0.6, fz + dirZ * 1.2];
    const view = mat4LookAt(eye, center, [0, 1, 0]);
    const mvp = mat4Multiply(proj, view);
  drawTiles(mvp, 'open');
  drawWalls(mvp);
  drawTallColumns(mvp);
  drawPlayerAndTrail(mvp);
  drawGridOverlay(mvp, eye, true);
  } else {
    // Bottom viewport (lower half in pixels 0..seam)
    gl.viewport(0, 0, W, botH);
    const mvAspectBot = W / botH;
    // Clear and optional grid first so scene draws on top
    renderGridViewport(0, 0, W, botH, 'bottom');
    // Recompute bottom camera MVP (reuse function’s math inline for tiles)
    {
      const proj = mat4Perspective(deg2rad(48), Math.max(0.1, mvAspectBot), 0.1, 150.0);
      const fx = state.camFollow.x, fz = state.camFollow.z;
  const eye = [fx, 24.0, fz];
      const center = [fx, 0.0, fz];
      const view = mat4LookAt(eye, center, [0, 0, -1]);
      const mvp = mat4Multiply(proj, view);
    // Draw floor tiles then 3D walls
    drawTiles(mvp, 'open');
    drawWalls(mvp);
    drawTallColumns(mvp);
  drawPlayerAndTrail(mvp);
  drawGridOverlay(mvp, eye, false);
    }
    // Top viewport (upper half in pixels seam..H)
    gl.viewport(0, H - seamY, W, topH);
    const mvAspectTop = W / topH;
    // Clear and optional grid first so scene draws on top
    renderGridViewport(0, H - seamY, W, topH, 'top');
    {
      const proj = mat4Perspective(deg2rad(60), Math.max(0.1, mvAspectTop), 0.1, 150.0);
      const fx = state.camFollow.x, fz = state.camFollow.z;
  const dirX = Math.sin(state.camYaw);
  const dirZ = -Math.cos(state.camYaw);
    const dist = 4.0;
    const baseHeight = 2.6;
  const eye = [fx - dirX * dist, state.camFollow.y + baseHeight, fz - dirZ * dist];
    const center = [fx + dirX * 1.2, state.camFollow.y + 0.6, fz + dirZ * 1.2];
      const view = mat4LookAt(eye, center, [0, 1, 0]);
      const mvp = mat4Multiply(proj, view);
    drawTiles(mvp, 'open');
    drawWalls(mvp);
    drawTallColumns(mvp);
  drawPlayerAndTrail(mvp);
  drawGridOverlay(mvp, eye, true);
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // 2) Present offscreen texture to screen with letterboxing and NEAREST scaling
  const targetAR = BASE_WIDTH / BASE_HEIGHT;
  const Wpx = CANVAS.width, Hpx = CANVAS.height;
  const canvasAR = Wpx / Hpx;
  let destW, destH;
  if (state.fillViewport) {
    if (canvasAR > targetAR) {
      destH = Hpx;
      destW = Math.floor(destH * targetAR);
    } else {
      destW = Wpx;
      destH = Math.floor(destW / targetAR);
    }
  } else {
    destW = BASE_WIDTH;
    destH = BASE_HEIGHT;
  }
  const offX = Math.floor((Wpx - destW) / 2);
  const offY = Math.floor((Hpx - destH) / 2);

  // Clear screen background
  gl.viewport(0, 0, Wpx, Hpx);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0.012, 0.028, 0.03, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Draw textured quad into letterboxed viewport
  gl.useProgram(blitProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, offscreen.tex);
  const loc = gl.getUniformLocation(blitProgram, 'u_tex');
  gl.uniform1i(loc, 0);
  gl.bindVertexArray(blitVAO);
  gl.viewport(offX, offY, destW, destH);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  updateHUD(now);
  requestAnimationFrame(render);
}

// Input handling
function normalizeEventPosition(e) {
  const rect = CANVAS.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left),
    y: (e.clientY - rect.top),
  };
}

function onPointerDown(e) {
  CANVAS.focus();
  const pos = normalizeEventPosition(e);
  const id = e.pointerId || 0;
  state.inputs.pointers.set(id, { x: pos.x, y: pos.y, dx: 0, dy: 0, startX: pos.x, startY: pos.y, lastT: e.timeStamp, downT: e.timeStamp, turned: false });
}
function onPointerMove(e) {
  const id = e.pointerId || 0;
  const pos = normalizeEventPosition(e);
  const p = state.inputs.pointers.get(id);
  if (p) {
    p.dx = pos.x - p.x;
    p.dy = pos.y - p.y;
    p.x = pos.x;
    p.y = pos.y;
    p.lastT = e.timeStamp;
    // Swipe-to-turn while dragging: detect strong horizontal gesture
    const totalDx = p.x - p.startX;
    const totalDy = p.y - p.startY;
    if (!p.turned && Math.abs(totalDx) > 36 && Math.abs(totalDx) > Math.abs(totalDy) * 1.3) {
      if (totalDx < 0) turnLeft(); else turnRight();
      p.turned = true; // avoid repeat until finger lifted
    }
  }
}
function onPointerUpOrCancel(e) {
  const id = e.pointerId || 0;
  const p = state.inputs.pointers.get(id);
  if (p) {
    // Only consider fallback swipe on release if we didn't already turn during drag
    if (!p.turned) {
      const dx = p.x - p.startX;
      const dy = p.y - p.startY;
      const mag = Math.hypot(dx, dy);
      if (mag > 24 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) turnLeft(); else turnRight();
      } else {
        // Treat as a tap: small movement or short press duration
        const isSmallMove = mag <= 14;
        const dur = (p.downT != null) ? (e.timeStamp - p.downT) : 1e9;
        const isShortPress = dur <= 280;
        if (isSmallMove || isShortPress) {
          doJump();
        }
      }
    }
  }
  state.inputs.pointers.delete(id);
}

function onKey(e) {
  if (e.type === 'keydown') state.inputs.keys.add(e.key);
  else state.inputs.keys.delete(e.key);
}

// Trigger a jump if grounded (shared by keyboard and tap)
function doJump(){
  if (state.player.grounded){
    state.player.vy = 8.5;
    state.player.grounded = false;
    state.player.jumpStartY = state.player.y;
  }
}

// Prevent context menu on long-press/right-click
window.addEventListener('contextmenu', (e) => e.preventDefault(), { passive: false });

CANVAS.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUpOrCancel);
window.addEventListener('pointercancel', onPointerUpOrCancel);

window.addEventListener('keydown', onKey);
window.addEventListener('keyup', onKey);

window.addEventListener('resize', resizeCanvasToViewport);
window.addEventListener('orientationchange', resizeCanvasToViewport);

// Toggle fill/native scaling
if (FILL_TOGGLE){
  FILL_TOGGLE.addEventListener('click', () => {
    state.fillViewport = !state.fillViewport;
    FILL_TOGGLE.setAttribute('aria-pressed', state.fillViewport ? 'true' : 'false');
    FILL_TOGGLE.textContent = `Fill: ${state.fillViewport ? 'ON' : 'OFF'}`;
    resizeCanvasToViewport();
  });
}

// Seam drag logic
let draggingSeam = false;
SEAM_HANDLE.addEventListener('pointerdown', (e) => {
  draggingSeam = true;
  SEAM_HANDLE.setPointerCapture(e.pointerId);
});
SEAM_HANDLE.addEventListener('pointermove', (e) => {
  if (!draggingSeam) return;
  const lb = state.letterboxCss;
  const cssH = Math.max(1, Math.floor(window.innerHeight));
  const y = Math.max(0, Math.min(cssH, e.clientY));
  const insideY = Math.min(Math.max(y - lb.y, 0), Math.max(1, lb.h));
  const ratio = insideY / Math.max(1, lb.h); // top height ratio
  const bottomRatio = 1 - ratio;

  // Normalize mutual exclusivity
  if (state.snapBottomFull) state.snapTopFull = false;
  if (state.snapTopFull) state.snapBottomFull = false;

  if (state.snapBottomFull) {
    // Stay snapped until user pulls past threshold (top >= 31%)
    if (ratio >= 0.31) {
      state.snapBottomFull = false;
      state.seamRatio = 0.31;
      const topPx = Math.floor(lb.y + state.seamRatio * lb.h);
      SEAM.style.top = `${topPx}px`;
    } else {
      state.seamRatio = 0.0;
      SEAM.style.top = `${lb.y}px`;
    }
  } else if (state.snapTopFull) {
    // Stay snapped until user pulls past threshold from bottom (bottom >= 31% => ratio <= 0.80)
    if (bottomRatio >= 0.31) {
      state.snapTopFull = false;
      state.seamRatio = 0.80; // top 80%
      const topPx = Math.floor(lb.y + state.seamRatio * lb.h);
      SEAM.style.top = `${topPx}px`;
    } else {
      state.seamRatio = 1.0;
      SEAM.style.top = `${lb.y + lb.h}px`;
    }
  } else {
    // Not snapped: if bottom grows beyond 80%, snap to full bottom
    if (bottomRatio > 0.80) {
      state.snapBottomFull = true;
      state.seamRatio = 0.0;
      SEAM.style.top = `${lb.y}px`;
    } else if (ratio > 0.80) {
      // If top grows beyond 80%, snap to full top
      state.snapTopFull = true;
      state.seamRatio = 1.0;
      SEAM.style.top = `${lb.y + lb.h}px`;
    } else {
      state.seamRatio = Math.min(0.95, Math.max(0.05, ratio));
      const topPx = Math.floor(lb.y + state.seamRatio * lb.h);
      SEAM.style.top = `${topPx}px`;
    }
  }
});
const endDrag = (e) => { draggingSeam = false; };
SEAM_HANDLE.addEventListener('pointerup', endDrag);
SEAM_HANDLE.addEventListener('pointercancel', endDrag);

// --- Player control & game step ---
function turnLeft(){ state.player.angle -= Math.PI/2; showSwipeGlow('left'); }
function turnRight(){ state.player.angle += Math.PI/2; showSwipeGlow('right'); }

function handleKeyboard(dt){
  if (state.inputs.keys.has('ArrowLeft') || state.inputs.keys.has('a')) {
    turnLeft(); state.inputs.keys.delete('ArrowLeft'); state.inputs.keys.delete('a');
  }
  if (state.inputs.keys.has('ArrowRight') || state.inputs.keys.has('d')) {
    turnRight(); state.inputs.keys.delete('ArrowRight'); state.inputs.keys.delete('d');
  }
  // Jump (Space)
  if (state.inputs.keys.has(' ') || state.inputs.keys.has('Space') || state.inputs.keys.has('Spacebar')){
  doJump();
    state.inputs.keys.delete(' ');
    state.inputs.keys.delete('Space');
    state.inputs.keys.delete('Spacebar');
  }
}

function handleSwipeTurns(){
  // On pointer up, detect horizontal swipe on canvas
  // This is integrated in onPointerUpOrCancel but we keep logic here if needed for future multi-touch
}

function seamSpeedFactor(){
  // More bottom map area (low seamRatio) => slower; more top (high seamRatio) => faster
  return 0.6 + 0.9 * state.seamRatio; // 0.6..1.5x
}

function moveAndCollide(dt){
  const p = state.player;
  const baseSpeed = 3.0; // tiles per second baseline
  p.speed = baseSpeed * seamSpeedFactor();
  const dirX = Math.sin(p.angle);
  const dirZ = -Math.cos(p.angle);
  const stepX = dirX * p.speed * dt;
  const stepZ = dirZ * p.speed * dt;
  let newX = p.x + stepX;
  let newZ = p.z + stepZ;
  // Collision radius and map sampling
  function isWallAt(wx, wz){
    const gx = Math.floor(wx + MAP_W*0.5);
    const gz = Math.floor(wz + MAP_H*0.5);
    if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return true;
    // Determine blocking height for this tile
    const key = `${gx},${gz}`;
    let blockH = 0.0;
    if (columnHeights.has(key)) blockH = columnHeights.get(key);
    else if (map[mapIdx(gx,gz)] === TILE.WALL) blockH = 1.0;
    // If no block here
    if (blockH <= 0.0) return false;
    // Allow passage if player's base is at or above block top
    if (state.player.y >= blockH - 0.02) return false;
    return true;
  }
  let hitWall = false;
  // Try Z first
  if (!isWallAt(p.x, newZ)) {
    p.z = newZ;
  } else {
    // stop on wall; allow slight slide along X if open
    newZ = p.z;
    hitWall = true;
  }
  // Then X
  if (!isWallAt(newX, p.z)) {
    p.x = newX;
  } else {
    newX = p.x;
    hitWall = true;
  }

  // Auto wall-jump: only if ascending and have risen at least 1.5 block heights since jump start
  if (hitWall && !p.grounded && p.vy > 0.0 && (p.wallJumpCooldown || 0) <= 0.0 && (p.y - (p.jumpStartY || 0)) >= 1.5) {
    p.angle += Math.PI; // 180 turn
    // Start a new floaty jump immediately
    p.vy = 8.5;
    p.grounded = false;
    p.jumpStartY = p.y;
    p.wallJumpCooldown = 0.22; // small cooldown to avoid ping-pong
  }
}

function updateTrail(){
  const t = state.trail;
  const p = state.player;
  const nowSec = state.nowSec || (performance.now()/1000);
  // Cull expired
  if (t.points.length) {
    let i=0; while (i < t.points.length && (nowSec - t.points[i][3]) > t.ttl) i++;
    if (i>0) t.points.splice(0, i);
  }
  const last = t.points.length ? t.points[t.points.length-1] : null;
  if (!last || Math.hypot(p.x - last[0], p.z - last[2]) > t.minDist) {
    // Spawn trail at the vertical center of the cube (cube center at p.y + 0.25)
    t.points.push([p.x, p.y + 0.25, p.z, nowSec]);
    if (t.points.length > t.maxPoints) t.points.splice(0, t.points.length - t.maxPoints);
  }
}

// Ground height under player: 0 for floor, 1 for wall tops where standing.
function groundHeightAt(x, z){
  // Only the tile under the player's center counts as support
  const gx = Math.floor(x + MAP_W*0.5);
  const gz = Math.floor(z + MAP_H*0.5);
  if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return 0.0;
  // Tall column support takes precedence
  const key = `${gx},${gz}`;
  if (columnHeights.has(key)) return columnHeights.get(key);
  return map[mapIdx(gx,gz)] === TILE.WALL ? 1.0 : 0.0;
}

function applyVerticalPhysics(dt){
  const p = state.player;
  const GRAV = -12.5; // floatier gravity
  // Integrate velocity
  p.vy += GRAV * dt;
  let newY = p.y + p.vy * dt;
  const gH = groundHeightAt(p.x, p.z);
  if (p.vy <= 0.0 && newY <= gH){
    newY = gH;
    p.vy = 0.0;
    p.grounded = true;
  } else {
  if (p.grounded) { p.jumpStartY = p.y; }
    p.grounded = false;
  }
  p.y = newY;
}

function stepGame(dt){
  handleKeyboard(dt);
  // Vertical first, then horizontal
  applyVerticalPhysics(dt);
  moveAndCollide(dt);
  // Smooth camera follow towards player position
  const k = 12.0; // responsiveness (higher = snappier)
  const a = 1 - Math.exp(-k * dt);
  state.camFollow.x += (state.player.x - state.camFollow.x) * a;
  state.camFollow.y += (state.player.y - state.camFollow.y) * a;
  state.camFollow.z += (state.player.z - state.camFollow.z) * a;
  // Smooth yaw towards player angle
  {
    const target = state.player.angle;
    let dyaw = normalizeAngle(target - state.camYaw);
    // critically damped style step
    const yawK = 10.0;
    const yawA = 1 - Math.exp(-yawK * dt);
    state.camYaw = normalizeAngle(state.camYaw + dyaw * yawA);
  }
  // Cooldowns
  if (state.player.wallJumpCooldown > 0) state.player.wallJumpCooldown = Math.max(0, state.player.wallJumpCooldown - dt);
  updateTrail();
}

// Player mesh and trail renderer
const PLAYER_VS = `#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=1) in vec2 a_uv;\nlayout(location=2) in float a_layer;\nuniform mat4 u_mvp;\nuniform mat4 u_model;\nout vec2 v_uv;\nflat out float v_layer;\nvoid main(){ v_uv = a_uv; v_layer = a_layer; gl_Position = u_mvp * u_model * vec4(a_pos,1.0); }`;
const PLAYER_FS = `#version 300 es\nprecision mediump float;\nprecision mediump sampler2DArray;\nuniform sampler2DArray u_tex;\nuniform int u_forceWhite;\nin vec2 v_uv;\nflat in float v_layer;\nout vec4 outColor;\nvoid main(){\n  if (u_forceWhite == 1) { outColor = vec4(1.0,1.0,1.0,1.0); }\n  else { outColor = texture(u_tex, vec3(v_uv, floor(v_layer + 0.5))); }\n}`;
const playerProgram = createProgram(PLAYER_VS, PLAYER_FS);
const pl_u_mvp = gl.getUniformLocation(playerProgram, 'u_mvp');
const pl_u_model = gl.getUniformLocation(playerProgram, 'u_model');
const pl_u_tex = gl.getUniformLocation(playerProgram, 'u_tex');
const pl_u_forceWhite = gl.getUniformLocation(playerProgram, 'u_forceWhite');
const playerVAO = gl.createVertexArray();
const playerVBO = gl.createBuffer();
gl.bindVertexArray(playerVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, playerVBO);
// Textured cube (size ~0.5), interleaved [pos(3), uv(2), layer(1)] per-vertex
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  // Front (+Z), layer 0
  -0.25,-0.25, 0.25,  0,0, 0,   0.25,-0.25, 0.25,  1,0, 0,   0.25, 0.25, 0.25,  1,1, 0,
  -0.25,-0.25, 0.25,  0,0, 0,   0.25, 0.25, 0.25,  1,1, 0,  -0.25, 0.25, 0.25,  0,1, 0,
  // Back (-Z), layer 1
   0.25,-0.25,-0.25,  0,0, 1,  -0.25,-0.25,-0.25,  1,0, 1,  -0.25, 0.25,-0.25,  1,1, 1,
   0.25,-0.25,-0.25,  0,0, 1,  -0.25, 0.25,-0.25,  1,1, 1,   0.25, 0.25,-0.25,  0,1, 1,
  // Left (-X), layer 2
  -0.25,-0.25,-0.25,  0,0, 2,  -0.25,-0.25, 0.25,  1,0, 2,  -0.25, 0.25, 0.25,  1,1, 2,
  -0.25,-0.25,-0.25,  0,0, 2,  -0.25, 0.25, 0.25,  1,1, 2,  -0.25, 0.25,-0.25,  0,1, 2,
  // Right (+X), layer 3
   0.25,-0.25, 0.25,  0,0, 3,   0.25,-0.25,-0.25,  1,0, 3,   0.25, 0.25,-0.25,  1,1, 3,
   0.25,-0.25, 0.25,  0,0, 3,   0.25, 0.25,-0.25,  1,1, 3,   0.25, 0.25, 0.25,  0,1, 3,
  // Top (+Y), layer 4
  -0.25, 0.25, 0.25,  0,0, 4,   0.25, 0.25, 0.25,  1,0, 4,   0.25, 0.25,-0.25,  1,1, 4,
  -0.25, 0.25, 0.25,  0,0, 4,   0.25, 0.25,-0.25,  1,1, 4,  -0.25, 0.25,-0.25,  0,1, 4,
  // Bottom (-Y), layer 5
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

// Create 6-layer 16x16 green-noise texture array
function createGreenNoiseTextureArray(size=16, layers=6){
  const tex = gl.createTexture();
  const data = new Uint8Array(size*size*4*layers);
  let off = 0;
  for (let l=0;l<layers;l++){
    // Smoother, less pronounced green base per layer
    const gBase = 175 + Math.floor(Math.random()*20); // 175..194
    const clusterMask = new Uint8Array(size*size); // 1 = black cluster here
    // Pre-place some 2x2 black blotches
    for (let y=0;y<size;y++){
      for (let x=0;x<size;x++){
        if (Math.random() < 0.04){ // 4% chance to start a 2x2 cluster
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
        // Some single-pixel black specks (lower rate), on top of clusters
        const singleBlack = Math.random() < 0.03;
        if (masked || singleBlack){
          data[idx+0]=0; data[idx+1]=0; data[idx+2]=0; data[idx+3]=255;
        } else {
          // Very gentle per-pixel noise for smoother look
          const noise = -3 + Math.floor(Math.random()*7); // -3..+3
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

// Trail wireframe cube (instanced lines)
const TRAIL_CUBE_VS = `#version 300 es\nlayout(location=0) in vec3 a_pos;\nlayout(location=1) in vec4 a_inst; // xyz: position, w: bornSec\nlayout(location=2) in float a_t; // 0 at start of edge, 1 at end\nuniform mat4 u_mvp;\nuniform float u_scale;\nuniform float u_now;\nuniform float u_ttl;\nout float v_alpha;\nout float v_t;\nvoid main(){\n  vec3 world = a_inst.xyz + a_pos * u_scale;\n  gl_Position = u_mvp * vec4(world,1.0);\n  float age = clamp((u_now - a_inst.w)/u_ttl, 0.0, 1.0);\n  v_alpha = 1.0 - age;\n  v_t = a_t;\n}`;
const TRAIL_CUBE_FS = `#version 300 es\nprecision mediump float;\nin float v_alpha;\nin float v_t;\nuniform int u_dashMode; // 0 = solid, 1 = hide middle 80%\nuniform float u_mulAlpha; // multiply output alpha\nuniform vec3 u_lineColor;\nout vec4 outColor;\nvoid main(){\n  if (u_dashMode == 1) { if (v_t > 0.10 && v_t < 0.90) discard; }\n  outColor = vec4(u_lineColor, v_alpha * u_mulAlpha);\n}`;
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
// Base wireframe cube edges centered at origin, unit size (we'll scale in shader)
gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Pos);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  // 12 edges, each as 2 vertices
  // X edges at y=-0.5,z=-0.5 and y=-0.5,z=0.5 and y=0.5,z=-0.5 and y=0.5,z=0.5
  -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,
  -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,
  -0.5, 0.5,-0.5,  0.5, 0.5,-0.5,
  -0.5, 0.5, 0.5,  0.5, 0.5, 0.5,
  // Y edges at x=-0.5,z=-0.5 and x=0.5,z=-0.5 and x=-0.5,z=0.5 and x=0.5,z=0.5
  -0.5,-0.5,-0.5, -0.5, 0.5,-0.5,
   0.5,-0.5,-0.5,  0.5, 0.5,-0.5,
  -0.5,-0.5, 0.5, -0.5, 0.5, 0.5,
   0.5,-0.5, 0.5,  0.5, 0.5, 0.5,
  // Z edges at x=-0.5,y=-0.5 and x=0.5,y=-0.5 and x=-0.5,y=0.5 and x=0.5,y=0.5
  -0.5,-0.5,-0.5, -0.5,-0.5, 0.5,
   0.5,-0.5,-0.5,  0.5,-0.5, 0.5,
  -0.5, 0.5,-0.5, -0.5, 0.5, 0.5,
   0.5, 0.5,-0.5,  0.5, 0.5, 0.5,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
// Per-vertex t (0 at start, 1 at end) for each edge
gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_T);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  // 12 edges * (0,1)
  0,1,  0,1,  0,1,  0,1,
  0,1,  0,1,  0,1,  0,1,
  0,1,  0,1,  0,1,  0,1,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(2);
gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
// Instance buffer: xyz position + bornSec
gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
gl.bufferData(gl.ARRAY_BUFFER, 4, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);
const trailCubeBaseCount = 24 * 2; // 12 edges * 2 verts = 24 vertices; we listed duplicates correctly above (24 verts)

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

function drawPlayerAndTrail(mvp){
  // Trail as instanced wireframe cubes
  const pts = state.trail.points;
  if (pts.length >= 1){
    const inst = new Float32Array(pts.length * 4);
    for (let i=0;i<pts.length;i++){ const p=pts[i]; inst[i*4+0]=p[0]; inst[i*4+1]=p[1]; inst[i*4+2]=p[2]; inst[i*4+3]=p[3]; }
    gl.useProgram(trailCubeProgram);
    gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
    gl.uniform1f(tc_u_scale, 0.12);
    gl.uniform1f(tc_u_now, state.nowSec || (performance.now()/1000));
    gl.uniform1f(tc_u_ttl, state.trail.ttl);
  gl.uniform1i(tc_u_dashMode, 0);
  gl.uniform1f(tc_u_mulAlpha, 1.0);
  gl.uniform3f(tc_u_lineColor, 1.0, 1.0, 1.0);
    gl.bindVertexArray(trailCubeVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
    gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
    gl.drawArraysInstanced(gl.LINES, 0, 24, pts.length);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
  // Player arrow
  const p = state.player;
  let model = mat4Multiply(mat4Translate(p.x, p.y+0.25, p.z), mat4RotateY(p.angle));
  model = mat4Multiply(model, mat4Scale(1,1,1));
  gl.useProgram(playerProgram);
  gl.uniformMatrix4fv(pl_u_mvp, false, mvp);
  gl.uniformMatrix4fv(pl_u_model, false, model);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, playerTexArray);
  if (pl_u_tex) gl.uniform1i(pl_u_tex, 0);
  if (pl_u_forceWhite) gl.uniform1i(pl_u_forceWhite, 0);
  gl.bindVertexArray(playerVAO);
  gl.depthMask(true);
  gl.drawArrays(gl.TRIANGLES, 0, 36);
  gl.bindVertexArray(null);

  // White wireframe contour slightly larger than the cube, floating around it
  // Reuse the trail wireframe cube geometry (unit cube lines), draw as non-instanced at player's position
  gl.useProgram(trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  gl.uniform1f(tc_u_scale, 0.54); // larger than 0.25 half-extent cube
  gl.uniform1f(tc_u_now, state.nowSec || (performance.now()/1000));
  gl.uniform1f(tc_u_ttl, 1.0);
  gl.uniform1i(tc_u_dashMode, 1); // hide middle 80%
  gl.uniform1f(tc_u_mulAlpha, 0.85);
  gl.uniform3f(tc_u_lineColor, 1.0, 1.0, 1.0);
  gl.bindVertexArray(trailCubeVAO);
  // Build a temporary instance buffer for one cube positioned at player center
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  // Draw multiple slight offsets to simulate thicker lines
  const tNow = state.nowSec || (performance.now()/1000);
  const offsets = [
    [0,0,0],
    [0.01,0.00,0.00], [-0.01,0.00,0.00],
    [0.00,0.01,0.00], [0.00,-0.01,0.00],
    [0.00,0.00,0.01], [0.00,0.00,-0.01],
  ];
  for (let i=0;i<offsets.length;i++){
    const o = offsets[i];
    const instOne = new Float32Array([p.x + o[0], p.y + 0.25 + o[1], p.z + o[2], tNow]);
    gl.bufferData(gl.ARRAY_BUFFER, instOne, gl.DYNAMIC_DRAW);
    gl.depthMask(false);
    gl.drawArraysInstanced(gl.LINES, 0, 24, 1);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

// Kick
resizeCanvasToViewport();
// Initialize camera yaw to player angle to avoid initial snap
state.camYaw = state.player.angle;
requestAnimationFrame(render);
