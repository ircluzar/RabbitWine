/**
 * Main game loop step orchestration.
 * Coordinates all gameplay systems in the correct order each frame.
 * Exports: stepGame() function called by the render loop.
 * Dependencies: handleKeyboard(), applyVerticalPhysics(), moveAndCollide(), updateCameraFollow(), updateCameraYaw(), updateTrail() from various modules. Side effects: Updates all game state per frame.
 */

// Game step orchestration
/**
 * Execute one frame of game logic
 * @param {number} dt - Delta time in seconds
 */
function stepGame(dt){
  handleKeyboard(dt);
  applyVerticalPhysics(dt);
  moveAndCollide(dt);
  updateCameraFollow(dt);
  updateCameraYaw(dt);
  
  // Update cooldowns
  if (state.player.wallJumpCooldown > 0) {
    state.player.wallJumpCooldown = Math.max(0, state.player.wallJumpCooldown - dt);
  }
  
  updateTrail();
}
