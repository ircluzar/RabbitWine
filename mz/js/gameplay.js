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

// Trigger a jump if grounded (shared by keyboard and tap)
function doJump(){
  if (state.player.grounded){
    state.player.vy = 8.5;
    state.player.grounded = false;
    state.player.jumpStartY = state.player.y;
  }
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

// mat4Translate, mat4RotateY, mat4Scale are provided by core/math.js

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
