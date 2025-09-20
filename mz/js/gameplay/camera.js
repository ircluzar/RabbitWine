/**
 * Camera control and following logic for smooth player tracking in 3D space.
 * Provides camera smoothing algorithms, seam-based speed adjustment, and angle interpolation
 * to create fluid camera movement that follows the player without jarring transitions.
 * 
 * The camera system handles both position following (with spring-based smoothing) and 
 * orientation following (with angular interpolation) while respecting game state constraints
 * like ball mode and camera lock settings.
 * 
 * @fileoverview Camera tracking and smoothing system for player following
 * @exports seamSpeedFactor() - Speed scaling based on viewport seam position  
 * @exports updateCameraFollow() - Smooth camera position tracking
 * @exports updateCameraYaw() - Smooth camera rotation tracking
 * @exports normalizeAngle() - Utility for angle normalization (if not globally available)
 * @dependencies state.player, state.camFollow, state.seamRatio, state.lockCameraYaw from state.js
 * @sideEffects Modifies camera state properties in global state object
 */

// ============================================================================
// Speed and Movement Scaling
// ============================================================================

/**
 * Calculate speed multiplier based on viewport seam position
 * Currently disabled for consistent gameplay - always returns 1.0 so speed equals base speed.
 * Previously this would scale movement speed based on the split seam ratio for different
 * gameplay feels in top vs bottom viewport sections.
 * 
 * @returns {number} Speed factor (currently fixed at 1.0 for consistent movement)
 */
function seamSpeedFactor(){
  return 1.0;
}

// ============================================================================
// Camera Following and Smoothing
// ============================================================================

/**
 * Smoothly update camera position to follow player using spring-based interpolation
 * Uses exponential smoothing to create natural camera movement that feels responsive
 * but not jarring, maintaining smooth tracking during player movement and stops.
 * 
 * @param {number} dt - Delta time in seconds since last frame
 */
function updateCameraFollow(dt){
  const k = 12.0; // Spring constant (higher = snappier, lower = more lag)
  const a = 1 - Math.exp(-k * dt); // Exponential smoothing factor
  
  // Apply spring interpolation to each axis independently
  state.camFollow.x += (state.player.x - state.camFollow.x) * a;
  state.camFollow.y += (state.player.y - state.camFollow.y) * a;
  state.camFollow.z += (state.player.z - state.camFollow.z) * a;
}

/**
 * Smoothly update camera yaw (rotation) to match player facing direction
 * Handles angular interpolation with proper angle wrapping and respects game state
 * constraints like ball mode and camera lock settings.
 * 
 * @param {number} dt - Delta time in seconds since last frame
 */
function updateCameraYaw(dt){
  // Skip yaw updates in special states
  if (state.player && state.player.isBallMode) return; // Freeze camera yaw in ball mode
  if (state.lockCameraYaw) return; // Lock yaw when alt control lock is enabled
  
  const target = state.player.angle;
  let dyaw = normalizeAngle(target - state.camYaw); // Calculate shortest angular path
  
  const yawK = 10.0; // Yaw smoothing constant
  const yawA = 1 - Math.exp(-yawK * dt); // Exponential smoothing for rotation
  
  state.camYaw = normalizeAngle(state.camYaw + dyaw * yawA);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Ensure normalizeAngle function is available globally for cross-module use
 * This utility is used by controls and physics modules for consistent angle handling
 */
if (typeof window !== 'undefined' && typeof window.normalizeAngle !== 'function'){
  /**
   * Normalizes an angle to the range (-π, π] for consistent angular calculations
   * @param {number} a - Input angle in radians
   * @returns {number} Normalized angle in (-π, π] range
   */
  window.normalizeAngle = function(a){
    a = a % (Math.PI*2);
    if (a > Math.PI) a -= Math.PI*2;
    if (a < -Math.PI) a += Math.PI*2;
    return a;
  };
}
