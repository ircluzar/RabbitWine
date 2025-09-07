/**
 * Wall and column rendering pipeline with voxel-based geometry.
 * Handles instanced rendering of walls, tall columns, and their wireframe outlines with advanced voxel subdivision.
 * Exports: WALL_VS, WALL_FS shaders, wallProgram, wallVAO, drawWalls(), drawTallColumns() functions.
 * Dependencies: createProgram() from gl-core.js, gl context, map data. Side effects: Creates VAO/VBO resources and modifies WebGL state.
 */

// Walls pipeline (extracted from scene.js) + outline helpers and tall columns
const WALL_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_off;
uniform mat4 u_mvp;
uniform vec2 u_originXZ;
uniform float u_scale;
uniform float u_height;
uniform vec3 u_voxCount; // voxel counts per axis (x,y,z)
uniform vec3 u_voxOff;   // current voxel offset (x,y,z) in [0..count-1]
uniform float u_yBase;   // additional vertical base offset (stacking)
out float v_worldY;
void main(){
  float lx = (a_pos.x + u_voxOff.x) / u_voxCount.x;
  float ly = (a_pos.y + u_voxOff.y) / u_voxCount.y;
  float lz = (a_pos.z + u_voxOff.z) / u_voxCount.z;
  vec2 xz = (vec2(lx, lz) + a_off + u_originXZ) * u_scale;
  float y = ly * u_height + u_yBase;
  v_worldY = y;
  gl_Position = u_mvp * vec4(xz.x, y, xz.y, 1.0);
}`;
const WALL_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;
uniform float u_alpha;
uniform int u_useHeightFade; // 1 = enable fade
uniform float u_playerY;     // player vertical position
uniform float u_fadeBand;    // band size (e.g., 5.0 blocks)
uniform float u_minAlpha;    // minimum alpha multiplier
uniform int u_glitterMode;   // 1 = glitter (for BAD)
uniform float u_now;         // time
in float v_worldY;
out vec4 outColor;
void main(){
  float aMul = 1.0;
  if (u_useHeightFade == 1) {
    float d = abs(v_worldY - u_playerY);
    // Linear fade: 0..fadeBand maps to 1..minAlpha, clamp below
    float t = clamp(d / max(0.0001, u_fadeBand), 0.0, 1.0);
    aMul = mix(1.0, max(0.0, u_minAlpha), t);
  }
  vec4 col = vec4(u_color, u_alpha * aMul);
  if (u_glitterMode == 1) {
    float n = fract(sin(v_worldY * 47.0 + u_now * 83.0) * 43758.5453);
    float sparkle = step(0.985, n);
    col.rgb += sparkle * 0.40;
    col.a = min(1.0, col.a + sparkle * 0.25);
  }
  outColor = col;
}`;
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
const wall_u_useFade = gl.getUniformLocation(wallProgram, 'u_useHeightFade');
const wall_u_playerY = gl.getUniformLocation(wallProgram, 'u_playerY');
const wall_u_fadeBand = gl.getUniformLocation(wallProgram, 'u_fadeBand');
const wall_u_minAlpha = gl.getUniformLocation(wallProgram, 'u_minAlpha');
const wall_u_glitterMode = gl.getUniformLocation(wallProgram, 'u_glitterMode');
const wall_u_now = gl.getUniformLocation(wallProgram, 'u_now');

const wallVAO = gl.createVertexArray();
// Separate base and jitter position buffers so bottom view can render steady geometry
const wallVBO_PosBase = gl.createBuffer();
const wallVBO_PosJitter = gl.createBuffer();
const wallVBO_Inst = gl.createBuffer();
// Base and current geometry for a unit cube (36 vertices)
const wallBasePosData = new Float32Array([
  // Unit cube 0..1
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
]);
let wallCurrPosData = new Float32Array(wallBasePosData);

gl.bindVertexArray(wallVAO);
// Initialize base positions (static) and jitter positions (dynamic)
gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_PosBase);
gl.bufferData(gl.ARRAY_BUFFER, wallBasePosData, gl.STATIC_DRAW);
gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_PosJitter);
gl.bufferData(gl.ARRAY_BUFFER, wallCurrPosData, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0);
// Default pointer; will be repointed per view before drawing
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
gl.bufferData(gl.ARRAY_BUFFER, instWall, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
gl.vertexAttribDivisor(1, 1);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);

// Persistent, bounded vertex jitter around base polygon points (applies to all wall cubes)
let wallJitterLastTickSec = 0.0;
const wallJitterPeriod = 0.016;
const wallVertexProb = 0.10;   // 10% of unique corners per tick
const wallVertexStep = 0.01;   // step size
const wallVertexMax = 0.03;    // max abs offset from base per axis
// Build unique corner groups for cube (0/1 coords)
const wallCornerGroups = new Map();
for (let i=0;i<wallBasePosData.length;i+=3){
  const x=wallBasePosData[i+0], y=wallBasePosData[i+1], z=wallBasePosData[i+2];
  const key = `${x}|${y}|${z}`;
  if (!wallCornerGroups.has(key)) wallCornerGroups.set(key, []);
  wallCornerGroups.get(key).push(i);
}
const wallCornerList = Array.from(wallCornerGroups.values());
let wallCornerDisp = new Float32Array(wallCornerList.length * 3);
function ensureWallGeomJitterTick(nowSec){
  const now = nowSec || (performance.now()/1000);
  if (now - wallJitterLastTickSec < wallJitterPeriod - 1e-6) return;
  wallJitterLastTickSec = now;
  const total = wallCornerList.length;
  const count = Math.max(1, Math.round(total * wallVertexProb));
  const chosen = new Set();
  while (chosen.size < count){ chosen.add(Math.floor(Math.random()*total)); }
  chosen.forEach((ci)=>{
    const baseIx = ci*3;
    const oldX = wallCornerDisp[baseIx+0], oldY = wallCornerDisp[baseIx+1], oldZ = wallCornerDisp[baseIx+2];
    const nx = Math.max(-wallVertexMax, Math.min(wallVertexMax, oldX + (Math.random()*2-1)*wallVertexStep));
    const ny = Math.max(-wallVertexMax, Math.min(wallVertexMax, oldY + (Math.random()*2-1)*wallVertexStep));
    const nz = Math.max(-wallVertexMax, Math.min(wallVertexMax, oldZ + (Math.random()*2-1)*wallVertexStep));
    const dx = nx - oldX, dy = ny - oldY, dz = nz - oldZ;
    const idxList = wallCornerList[ci];
    for (let k=0;k<idxList.length;k++){
      const idx = idxList[k];
      wallCurrPosData[idx+0] = wallCurrPosData[idx+0] + dx;
      wallCurrPosData[idx+1] = wallCurrPosData[idx+1] + dy;
      wallCurrPosData[idx+2] = wallCurrPosData[idx+2] + dz;
    }
    wallCornerDisp[baseIx+0]=nx; wallCornerDisp[baseIx+1]=ny; wallCornerDisp[baseIx+2]=nz;
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_PosJitter);
  gl.bufferData(gl.ARRAY_BUFFER, wallCurrPosData, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

function drawWalls(mvp, viewKind /* 'bottom' | 'top' | undefined */){
  // Update persistent polygon point jitter
    if (state.cameraKindCurrent === 'top' && typeof ensureWallGeomJitterTick === 'function') {
      ensureWallGeomJitterTick(state.nowSec || (performance.now()/1000));
    }
  // Filter out ground-level wall tiles that are represented as tall columns.
  // Important: do NOT hide a ground wall if only elevated spans (base>0) exist there.
  let data = instWall;
  // Split instances into normal vs BAD, and hide ground cube if spans include base=0
  let wallsNormal = new Float32Array(0);
  let wallsBad = new Float32Array(0);
  if (data.length) {
    // Prefer spans when available regardless of feature flag
    const hasSpans = (typeof columnSpans !== 'undefined') && columnSpans && typeof columnSpans.get === 'function' && columnSpans.size > 0;
    const hasHeights = (typeof columnHeights !== 'undefined') && columnHeights && typeof columnHeights.has === 'function' && columnHeights.size > 0;
    const hasBases = (typeof columnBases !== 'undefined') && columnBases && typeof columnBases.get === 'function' && columnBases.size >= 0; // may be 0 size
    const filteredNormal = [];
    const filteredBad = [];
    for (let i=0; i<data.length; i+=2){
      const x = data[i], y = data[i+1];
      const key = `${x},${y}`;
      let hideGroundWall = false;
      const isBadTile = (typeof map !== 'undefined' && typeof mapIdx === 'function' && typeof TILE !== 'undefined') ? (map[mapIdx(x,y)] === TILE.BAD) : false;
      if (hasSpans){
        const spans = columnSpans.get(key);
        if (Array.isArray(spans)){
          if (isBadTile){
            // For BAD tiles, any span means draw only the elevated/tall version (no ground cube)
            hideGroundWall = spans.length > 0;
          } else {
            // For normal walls, hide ground only if a base-0 span exists (ground represented by tall columns)
            hideGroundWall = spans.some(s => s && ((s.b|0) === 0) && ((s.h|0) > 0));
          }
        }
      } else if (hasHeights && columnHeights.has(key)){
        if (hasBases && columnBases.has(key)){
          hideGroundWall = ((columnBases.get(key)|0) === 0);
        } else {
          // No base info -> conservatively assume ground-level column
          hideGroundWall = true;
        }
      }
      if (!hideGroundWall){
        const isBad = isBadTile;
        if (isBad) filteredBad.push(x,y); else filteredNormal.push(x,y);
      }
    }
    wallsNormal = new Float32Array(filteredNormal);
    wallsBad = new Float32Array(filteredBad);
  }
  const totalCount = wallsNormal.length + wallsBad.length;
  if (!totalCount) return;
  gl.useProgram(wallProgram);
  gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
  gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(wall_u_scale, 1.0);
  gl.uniform1f(wall_u_height, 1.0);
  gl.uniform1f(wall_u_yBase, 0.0);
  gl.uniform1f(wall_u_now, state.nowSec || (performance.now()/1000));
  // Height-based fade config (enabled only for bottom view)
  const useFade = (viewKind === 'bottom') ? 1 : 0;
  gl.uniform1i(wall_u_useFade, useFade);
  gl.uniform1f(wall_u_playerY, state.player ? (state.player.y || 0.0) : 0.0);
  gl.uniform1f(wall_u_fadeBand, 5.0);
  gl.uniform1f(wall_u_minAlpha, 0.15);
  const voxX=2, voxY=2, voxZ=2;
  gl.uniform3f(wall_u_voxCount, voxX, voxY, voxZ);
  gl.bindVertexArray(wallVAO);
  // Point attribute 0 to the appropriate buffer per view (top=jitter, bottom=base)
  gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
  // First: normal walls
  if (wallsNormal.length){
    gl.bufferData(gl.ARRAY_BUFFER, wallsNormal, gl.DYNAMIC_DRAW);
    gl.uniform3fv(wall_u_color, new Float32Array([0.06, 0.45, 0.48]));
    gl.uniform1f(wall_u_alpha, 0.65);
    gl.uniform1i(wall_u_glitterMode, 0);
  // Depth pre-pass
  gl.disable(gl.BLEND);
  gl.colorMask(false, false, false, false);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);
  for (let vz=0; vz<voxZ; vz++){
    for (let vy=0; vy<voxY; vy++){
      for (let vx=0; vx<voxX; vx++){
        gl.uniform3f(wall_u_voxOff, vx, vy, vz);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsNormal.length/2);
      }
    }
  }
  // Blended color pass (no depth writes)
  gl.colorMask(true, true, true, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.depthFunc(gl.LEQUAL);
  for (let vz=0; vz<voxZ; vz++){
    for (let vy=0; vy<voxY; vy++){
      for (let vx=0; vx<voxX; vx++){
        gl.uniform3f(wall_u_voxOff, vx, vy, vz);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsNormal.length/2);
      }
    }
  }
  }
  // Second: BAD walls
  if (wallsBad.length){
    gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
    gl.bufferData(gl.ARRAY_BUFFER, wallsBad, gl.DYNAMIC_DRAW);
    gl.uniform3fv(wall_u_color, new Float32Array([0.85, 0.10, 0.12]));
    gl.uniform1f(wall_u_alpha, 0.85);
    gl.uniform1i(wall_u_glitterMode, 1);
    gl.disable(gl.BLEND);
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsBad.length/2);
        }
      }
    }
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    for (let vz=0; vz<voxZ; vz++){
      for (let vy=0; vy<voxY; vy++){
        for (let vx=0; vx<voxX; vx++){
          gl.uniform3f(wall_u_voxOff, vx, vy, vz);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, wallsBad.length/2);
        }
      }
    }
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(null);

  // Silhouette outlines per wall tile
  if (wallsNormal.length) drawOutlinesForTileArray(mvp, wallsNormal, 0.5, 1.0, [0.0,0.0,0.0]);
  if (wallsBad.length) drawOutlinesForTileArray(mvp, wallsBad, 0.5, 1.02, [1.0,0.2,0.2]);
}

function drawOutlinesForTileArray(mvp, tileArray, yCenter, baseScale, color){
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
  if (Array.isArray(color) && color.length>=3) gl.uniform3f(tc_u_lineColor, color[0], color[1], color[2]); else gl.uniform3f(tc_u_lineColor, 0.0, 0.0, 0.0);
  // Persisted edge jitter update (~16ms bucket)
  if (typeof ensureTrailEdgeJitterTick === 'function') ensureTrailEdgeJitterTick(tNow);
  if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 0);
  gl.bindVertexArray(trailCubeVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  // Per-instance corner offsets: top view uses jitter, bottom view uses zeros
  if (typeof trailCubeVBO_Corners !== 'undefined'){
    if (state.cameraKindCurrent === 'top' && typeof getTrailCornerOffsetsBuffer === 'function'){
      const keys = new Array(count);
      for (let i=0;i<count;i++){
        const tx = tileArray[i*2+0];
        const ty = tileArray[i*2+1];
        keys[i] = `tile@${tx},${ty},${yCenter.toFixed(2)}`;
      }
      const packed = getTrailCornerOffsetsBuffer(keys, tNow);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
      gl.bufferData(gl.ARRAY_BUFFER, packed, gl.DYNAMIC_DRAW);
    } else {
      const zeros = new Float32Array(count * 8 * 3);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners);
      gl.bufferData(gl.ARRAY_BUFFER, zeros, gl.DYNAMIC_DRAW);
    }
  }
  // Ensure a_axis buffer has enough entries (even though u_useAnim==0)
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(count * 3), gl.DYNAMIC_DRAW);
  gl.disable(gl.BLEND);
  gl.depthMask(false);
  gl.uniform1f(tc_u_mulAlpha, 1.0);
  gl.uniform1f(tc_u_scale, baseScale);
  gl.drawArraysInstanced(gl.LINES, 0, 24, count);
  gl.uniform1f(tc_u_scale, baseScale * 1.03);
  gl.drawArraysInstanced(gl.LINES, 0, 24, count);
  gl.depthMask(true);
  gl.bindVertexArray(null);
}

function drawTallColumns(mvp, viewKind /* 'bottom' | 'top' | undefined */){
  // Update persistent polygon point jitter
    if (state.cameraKindCurrent === 'top' && typeof ensureWallGeomJitterTick === 'function') {
      ensureWallGeomJitterTick(state.nowSec || (performance.now()/1000));
    }
  // Prefer spans when available regardless of feature flag
  const hasSpans = (typeof columnSpans !== 'undefined') && columnSpans && typeof columnSpans.entries === 'function' && columnSpans.size > 0;
  if (!hasSpans && (!extraColumns || extraColumns.length === 0)) return;

  // Group pillars/columns by their integer height AND base so we can render stacked from bottom
  /** @type {Map<string, {h:number,b:number,pts:Array<[number,number]>}>>} */
  const groups = new Map();
  if (hasSpans){
    for (const [key, spans] of columnSpans.entries()){
      if (!Array.isArray(spans)) continue;
      const [gx,gy] = key.split(',').map(n=>parseInt(n,10));
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
      for (const s of spans){
        if (!s) continue; const h=(s.h|0); const b=(s.b|0); if (h<=0) continue;
        const gkey = `${h}@${b}`;
        let g = groups.get(gkey); if (!g){ g = { h, b, pts: [] }; groups.set(gkey, g); }
        g.pts.push([gx, gy]);
      }
    }
  } else {
    for (const c of extraColumns){
      const h = (c && typeof c.h === 'number') ? (c.h|0) : 0; // visible height
      const b = (c && typeof c.b === 'number') ? (c.b|0) : 0; // base offset from ground
      if (h <= 0) continue;
      const key = `${h}@${b}`;
      let g = groups.get(key);
      if (!g){ g = { h, b, pts: [] }; groups.set(key, g); }
      g.pts.push([c.x, c.y]);
    }
  }
  if (groups.size === 0) return;

  gl.useProgram(wallProgram);
  gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
  gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(wall_u_scale, 1.0);
  gl.uniform1f(wall_u_height, 1.0);
  gl.uniform1f(wall_u_now, state.nowSec || (performance.now()/1000));
  // Height-based fade config (enabled only for bottom view)
  const useFade = (viewKind === 'bottom') ? 1 : 0;
  gl.uniform1i(wall_u_useFade, useFade);
  gl.uniform1f(wall_u_playerY, state.player ? (state.player.y || 0.0) : 0.0);
  gl.uniform1f(wall_u_fadeBand, 5.0);
  gl.uniform1f(wall_u_minAlpha, 0.15);
  const voxX=1, voxY=1, voxZ=1;
  gl.uniform3f(wall_u_voxCount, voxX, voxY, voxZ);
  gl.bindVertexArray(wallVAO);
  // Point attribute 0 to the appropriate position buffer per view for tall columns
  gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  // Small epsilon to avoid coplanar depth ties between stacked levels
  const EPS = 1e-4;

  // For determinism, draw groups sorted by (base, height)
  const keys = Array.from(groups.keys()).sort((ka,kb)=>{
    const [ha,ba] = ka.split('@').map(n=>parseInt(n,10));
    const [hb,bb] = kb.split('@').map(n=>parseInt(n,10));
    if (ba!==bb) return ba-bb;
    return ha-hb;
  });
  for (const key of keys){
    const g = groups.get(key);
    if (!g || !g.pts || g.pts.length === 0) continue;
    // Split pillars by BAD vs normal
    const pillars = g.pts;
    const normPts = [];
    const badPts = [];
    for (let i=0;i<pillars.length;i++){
      const gx = pillars[i][0], gy = pillars[i][1];
      const isBad = (typeof map !== 'undefined' && typeof mapIdx === 'function' && typeof TILE !== 'undefined') ? (map[mapIdx(gx,gy)] === TILE.BAD) : false;
      (isBad ? badPts : normPts).push([gx,gy]);
    }
  function drawGroupPts(pts, color, alpha, glitter){
      if (!pts || !pts.length) return;
      const offs = new Float32Array(pts.length * 2);
      for (let i=0;i<pts.length;i++){ offs[i*2+0]=pts[i][0]; offs[i*2+1]=pts[i][1]; }
      gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
      gl.bufferData(gl.ARRAY_BUFFER, offs, gl.DYNAMIC_DRAW);
      gl.uniform3fv(wall_u_color, new Float32Array(color));
      gl.uniform1f(wall_u_alpha, alpha);
      gl.uniform1i(wall_u_glitterMode, glitter ? 1 : 0);
      // Depth pre-pass
      gl.disable(gl.BLEND);
      gl.colorMask(false,false,false,false);
      gl.depthMask(true);
      gl.depthFunc(gl.LEQUAL);
      for (let level=0; level<g.h; level++){
        gl.uniform1f(wall_u_yBase, (g.b + level) * 1.0 + (level>0 ? EPS*level : 0.0));
        gl.uniform3f(wall_u_voxOff, 0,0,0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pts.length);
      }
      // Blended color pass
      gl.colorMask(true,true,true,true);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.depthFunc(gl.LEQUAL);
      for (let level=0; level<g.h; level++){
        gl.uniform1f(wall_u_yBase, (g.b + level) * 1.0 + (level>0 ? EPS*level : 0.0));
        gl.uniform3f(wall_u_voxOff, 0,0,0);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, pts.length);
      }
    }
    // Draw normal then BAD
    drawGroupPts(normPts, [0.06, 0.45, 0.48], 0.65, false);
    drawGroupPts(badPts, [0.85, 0.10, 0.12], 0.85, true);

  // Note: color passes for normal and BAD pillars are already drawn above via drawGroupPts().
  // Avoid re-drawing the combined set here to prevent instance-buffer mismatches that cause ghost tiles.

    // Silhouette outlines per level for this group
    for (let level=0; level<g.h; level++){
      const yCenter = (g.b + level) + 0.5 + (level>0 ? EPS*level : 0.0);
      if (normPts.length){
        const offs2 = new Float32Array(normPts.length * 2);
        for (let i=0;i<normPts.length;i++){ offs2[i*2+0]=normPts[i][0]; offs2[i*2+1]=normPts[i][1]; }
        drawOutlinesForTileArray(mvp, offs2, yCenter, 1.0, [0,0,0]);
      }
      if (badPts.length){
        const offs3 = new Float32Array(badPts.length * 2);
        for (let i=0;i<badPts.length;i++){ offs3[i*2+0]=badPts[i][0]; offs3[i*2+1]=badPts[i][1]; }
        drawOutlinesForTileArray(mvp, offs3, yCenter, 1.02, [1,0.2,0.2]);
      }
    }

  // Rebind wall VAO and wall program after outlines (they switch program/VAO),
  // and restore uniforms so next group renders color correctly.
  gl.bindVertexArray(wallVAO);
  gl.useProgram(wallProgram);
  // Re-point attribute 0 after outlines switched VAO/program
  gl.bindBuffer(gl.ARRAY_BUFFER, state.cameraKindCurrent === 'top' ? wallVBO_PosJitter : wallVBO_PosBase);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(wall_u_mvp, false, mvp);
  gl.uniform2f(wall_u_origin, -MAP_W*0.5, -MAP_H*0.5);
  gl.uniform1f(wall_u_scale, 1.0);
  gl.uniform1f(wall_u_height, 1.0);
  gl.uniform3fv(wall_u_color, new Float32Array([0.06, 0.45, 0.48]));
  gl.uniform1f(wall_u_alpha, 0.65);
  gl.uniform1i(wall_u_glitterMode, 0);
  gl.uniform3f(wall_u_voxCount, 1,1,1);
  }

  // Restore defaults
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.depthFunc(gl.LESS);
  gl.bindVertexArray(null);
}
