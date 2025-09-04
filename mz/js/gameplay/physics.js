// Physics and collision
function groundHeightAt(x, z){
  const gx = Math.floor(x + MAP_W*0.5);
  const gz = Math.floor(z + MAP_H*0.5);
  if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return 0.0;
  const key = `${gx},${gz}`;
  if (columnHeights.has(key)) return columnHeights.get(key);
  return map[mapIdx(gx,gz)] === TILE.WALL ? 1.0 : 0.0;
}

function moveAndCollide(dt){
  const p = state.player;
  const baseSpeed = 3.0;
  p.speed = baseSpeed * seamSpeedFactor();
  const dirX = Math.sin(p.angle);
  const dirZ = -Math.cos(p.angle);
  const stepX = dirX * p.speed * dt;
  const stepZ = dirZ * p.speed * dt;
  let newX = p.x + stepX;
  let newZ = p.z + stepZ;
  function isWallAt(wx, wz){
    const gx = Math.floor(wx + MAP_W*0.5);
    const gz = Math.floor(wz + MAP_H*0.5);
    if (gx<0||gz<0||gx>=MAP_W||gz>=MAP_H) return true;
    const key = `${gx},${gz}`;
    let blockH = 0.0;
    if (columnHeights.has(key)) blockH = columnHeights.get(key);
    else if (map[mapIdx(gx,gz)] === TILE.WALL) blockH = 1.0;
    if (blockH <= 0.0) return false;
    if (state.player.y >= blockH - 0.02) return false;
    return true;
  }
  let hitWall = false;
  if (!isWallAt(p.x, newZ)) { p.z = newZ; } else { newZ = p.z; hitWall = true; }
  if (!isWallAt(newX, p.z)) { p.x = newX; } else { newX = p.x; hitWall = true; }

  if (hitWall && !p.grounded && p.vy > 0.0 && (p.wallJumpCooldown || 0) <= 0.0 && (p.y - (p.jumpStartY || 0)) >= 1.5) {
    p.angle += Math.PI;
    p.vy = 8.5;
    p.grounded = false;
    p.jumpStartY = p.y;
    p.wallJumpCooldown = 0.22;
  }
}

function applyVerticalPhysics(dt){
  const p = state.player;
  const GRAV = -12.5;
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
