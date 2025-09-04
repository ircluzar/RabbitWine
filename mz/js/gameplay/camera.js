// Camera helpers and seam speed factor
function seamSpeedFactor(){
  return 0.6 + 0.9 * state.seamRatio;
}

function updateCameraFollow(dt){
  const k = 12.0;
  const a = 1 - Math.exp(-k * dt);
  state.camFollow.x += (state.player.x - state.camFollow.x) * a;
  state.camFollow.y += (state.player.y - state.camFollow.y) * a;
  state.camFollow.z += (state.player.z - state.camFollow.z) * a;
}

function updateCameraYaw(dt){
  const target = state.player.angle;
  let dyaw = normalizeAngle(target - state.camYaw);
  const yawK = 10.0;
  const yawA = 1 - Math.exp(-yawK * dt);
  state.camYaw = normalizeAngle(state.camYaw + dyaw * yawA);
}
