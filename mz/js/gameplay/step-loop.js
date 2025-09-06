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
  if (typeof updateItems === 'function') updateItems(dt);
  if (typeof updateFxLines === 'function') updateFxLines(dt);
  // During first acceleration, ramp music playback rate 0.5 -> 1.0, with pitch/filter opening and un-bitcrush top
  try {
    if (state.firstAccelFired && (state.nowSec || performance.now()/1000) <= (state.firstAccelSlowUntil || 0)){
      const now = (state.nowSec || performance.now()/1000);
      const t0 = state.firstAccelStartSec || now;
      const dur = state.firstAccelDuration || 1.75;
      const u = Math.max(0, Math.min(1, (now - t0) / Math.max(0.001, dur)));
      const rate = 0.5 + 0.5 * u; // 0.5 -> 1.0
      if (window.music) {
        if (typeof music.setPreservesPitch === 'function') music.setPreservesPitch(false); // allow pitch to follow rate
        if (typeof music.setPlaybackRate === 'function') music.setPlaybackRate(rate);
        if (typeof music.setFilterProgress === 'function') music.setFilterProgress(u);
      }
  // Animate top-half bitcrush from 1 -> 0, fade dithering out, increase levels
  state.topPosterizeMix = 1.0 - u;
  state.topDitherAmt = 0.6 * (1.0 - u);
  state.topPosterizeLevels = 4.0 + (6.0 - 4.0) * u; // 4 -> 6 levels
  state.topPixelSize = 3.0 * (1.0 - u); // pixelation fades out
    } else if (state.firstAccelFired && (state.nowSec || performance.now()/1000) > (state.firstAccelSlowUntil || 0)){
      // Ensure we end at 1.0
      if (window.music) {
        if (typeof music.setPlaybackRate === 'function') music.setPlaybackRate(1.0);
        if (typeof music.setFilterProgress === 'function') music.setFilterProgress(1.0);
        if (typeof music.setPreservesPitch === 'function') music.setPreservesPitch(false);
      }
  state.topPosterizeMix = 0.0;
  state.topDitherAmt = 0.0;
  state.topPosterizeLevels = 6.0;
  state.topPixelSize = 0.0;
    }
  } catch(_){}
  
  // Update cooldowns
  if (state.player.wallJumpCooldown > 0) {
    state.player.wallJumpCooldown = Math.max(0, state.player.wallJumpCooldown - dt);
  }
  // Safety: if frozen while grounded, unfreeze (freeze only valid midair)
  if (state.player.grounded && state.player.isFrozen){ state.player.isFrozen = false; }
  // Safety: if started dash while grounded by edge-case, cancel
  if (state.player.grounded && state.player.isDashing){ state.player.isDashing = false; }
  
  updateTrail();
}
