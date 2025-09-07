/**
 * Camera control and following logic for smooth player tracking.
 * Provides camera smoothing, seam-based speed adjustment, and angle interpolation.
 * Exports: seamSpeedFactor(), updateCameraFollow(), updateCameraYaw(), normalizeAngle() functions.
 * Dependencies: state.player, state.camFollow, state.seamRatio from state.js. Side effects: Modifies camera state.
 */

// Camera helpers and seam speed factor
/**
 * Calculate speed multiplier based on seam position
 * @returns {number} Speed factor (0.6 to 1.5)
 */
function seamSpeedFactor(){
  return 0.6 + 0.9 * state.seamRatio;
}

/**
 * Smoothly update camera to follow player position
 * @param {number} dt - Delta time in seconds
 */
function updateCameraFollow(dt){
  const k = 12.0; // Spring constant
  const a = 1 - Math.exp(-k * dt);
  state.camFollow.x += (state.player.x - state.camFollow.x) * a;
  state.camFollow.y += (state.player.y - state.camFollow.y) * a;
  state.camFollow.z += (state.player.z - state.camFollow.z) * a;
}

/**
 * Smoothly update camera yaw to match player angle
 * @param {number} dt - Delta time in seconds
 */
function updateCameraYaw(dt){
  const target = state.player.angle;
  let dyaw = normalizeAngle(target - state.camYaw);
  const yawK = 10.0;
  const yawA = 1 - Math.exp(-yawK * dt);
  state.camYaw = normalizeAngle(state.camYaw + dyaw * yawA);
}

// Utility: ensure normalizeAngle exists globally (used by controls/physics)
if (typeof window !== 'undefined' && typeof window.normalizeAngle !== 'function'){
  window.normalizeAngle = function(a){
    a = a % (Math.PI*2);
    if (a > Math.PI) a -= Math.PI*2;
    if (a < -Math.PI) a += Math.PI*2;
    return a;
  };
}
