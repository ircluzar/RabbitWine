// Game step orchestration
function stepGame(dt){
  handleKeyboard(dt);
  applyVerticalPhysics(dt);
  moveAndCollide(dt);
  updateCameraFollow(dt);
  updateCameraYaw(dt);
  if (state.player.wallJumpCooldown > 0) state.player.wallJumpCooldown = Math.max(0, state.player.wallJumpCooldown - dt);
  updateTrail();
}
