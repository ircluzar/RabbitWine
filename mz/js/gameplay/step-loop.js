/**
 * Main game loop step orchestration and frame management.
 * Coordinates all gameplay systems in the correct order each frame, handling both
 * normal gameplay mode and editor mode with appropriate system routing.
 * Also manages dynamic audio and visual effects during gameplay transitions.
 * 
 * @fileoverview Central game loop coordination and frame-by-frame system updates
 * @exports stepGame() - Primary game loop function called by render system
 * @dependencies handleKeyboard(), applyVerticalPhysics(), moveAndCollide(), camera functions, updateItems(), updateFxLines()
 * @sideEffects Updates all game state, modifies audio playback parameters, triggers visual effect changes
 */

// ============================================================================
// Main Game Loop Orchestration
// ============================================================================

/**
 * Execute one complete frame of game logic with proper system ordering
 * Handles both normal gameplay and editor mode with different execution paths
 * @param {number} dt - Delta time in seconds since last frame
 */
function stepGame(dt){
  // Frame counter (used for lock state prev-frame snapshot logic)
  if (typeof state.frameCounter !== 'number') state.frameCounter = 0; else state.frameCounter++;
  // ============================================================================
  // Input Processing Phase
  // ============================================================================
  
  if (state.editor && state.editor.mode === 'fps'){
    // Editor mode: use specialized input handling for level editing
    editorHandleInput && editorHandleInput(dt);
  } else {
    // Normal gameplay: process player input controls
    handleKeyboard(dt);
  }
  
  // ============================================================================
  // Physics Integration Phase
  // ============================================================================
  
  // Early lock containment update (Theory 1): ensures vertical physics & ceiling collision
  // operate with up-to-date knowledge of being inside a lock span to prevent one-frame
  // camera unlock flicker and BAD ceiling misclassification.
  try { if (typeof updateLockCameraState === 'function') updateLockCameraState('early'); } catch(_){ }

  // Apply gravity and vertical movement physics (affects both modes)
  applyVerticalPhysics(dt);
  
  if (state.editor && state.editor.mode === 'fps'){
    // ============================================================================
    // Editor Mode: Override normal physics with noclip movement
    // ============================================================================
    
    const e = state.editor.fps;
    // Replace normal motion with editor camera position for consistent preview
    state.player.x = e.x; 
    state.player.y = e.y; 
    state.player.z = e.z;
    state.player.speed = 0; 
    state.player.vy = 0; 
    state.player.grounded = false;
    
    // Camera follows editor pose directly (no smoothing needed)
    state.camFollow.x = e.x; 
    state.camFollow.y = e.y; 
    state.camFollow.z = e.z;
    state.camYaw = e.yaw;
    
    // Update visor target for top-screen level preview during editing
    editorRaycastVisor && editorRaycastVisor();
  } else {
    // ============================================================================
    // Normal Gameplay Mode: Full physics and camera systems
    // ============================================================================
    
    moveAndCollide(dt);     // Handle player movement and world collision
    updateCameraFollow(dt); // Smooth camera position tracking
    updateCameraYaw(dt);    // Smooth camera rotation tracking
  }
  
  // ============================================================================
  // Entity Update Phase (Common to Both Modes)
  // ============================================================================
  
  // Update item animations, collision detection, and pickup processing
  if (typeof updateItems === 'function') updateItems(dt);
  
  // Update particle effect lines and trail animations  
  if (typeof updateFxLines === 'function') updateFxLines(dt);
  
  // ============================================================================
  // Dynamic Audio-Visual Effects System
  // ============================================================================
  
  // Handle first acceleration sequence with synchronized audio/visual effects
  try {
    if (state.firstAccelFired && (state.nowSec || performance.now()/1000) <= (state.firstAccelSlowUntil || 0)){
      // Active acceleration ramp: create smooth transition effects
      const now = (state.nowSec || performance.now()/1000);
      const t0 = state.firstAccelStartSec || now;
      const dur = state.firstAccelDuration || 1.75;
      const u = Math.max(0, Math.min(1, (now - t0) / Math.max(0.001, dur))); // Normalized progress [0,1]
      
      // Music effect: ramp playback rate from 0.5x to 1.0x with pitch following
      const rate = 0.5 + 0.5 * u;
      if (window.music) {
        if (typeof music.setPreservesPitch === 'function') music.setPreservesPitch(false); // Allow pitch to follow rate
        if (typeof music.setPlaybackRate === 'function') music.setPlaybackRate(rate);
        if (typeof music.setFilterProgress === 'function') music.setFilterProgress(u);
      }
      
      // Visual effects: animate top-half posterization from full to minimal
      state.topPosterizeMix = 1.0 - u;                    // Fade out bitcrush effect
      state.topDitherAmt = 0.6 * (1.0 - u);              // Reduce dithering noise
      state.topPosterizeLevels = 4.0 + (6.0 - 4.0) * u;  // Increase color levels (4->6)
      state.topPixelSize = 3.0 * (1.0 - u);              // Fade out pixelation
    } else if (state.firstAccelFired && (state.nowSec || performance.now()/1000) > (state.firstAccelSlowUntil || 0)){
      // Post-acceleration: ensure effects end at normal values
      if (window.music) {
        if (typeof music.setPlaybackRate === 'function') music.setPlaybackRate(1.0);
        if (typeof music.setFilterProgress === 'function') music.setFilterProgress(1.0);
        if (typeof music.setPreservesPitch === 'function') music.setPreservesPitch(false);
      }
      
      // Visual effects: reset to normal rendering values  
      state.topPosterizeMix = 0.0;    // No bitcrush effect
      state.topDitherAmt = 0.0;       // No dithering noise
      state.topPosterizeLevels = 6.0;  // Full color levels
      state.topPixelSize = 0.0;       // No pixelation
    }
  } catch (err) {
    // Graceful handling of audio-visual effect errors (music system might not be loaded)
    console.warn('Audio-visual effect update failed:', err.message);
  }
  
  // ============================================================================
  // Player State Management and Safety Checks
  // ============================================================================
  
  // Update movement cooldowns to prevent spamming special abilities
  if (state.player.wallJumpCooldown > 0) {
    state.player.wallJumpCooldown = Math.max(0, state.player.wallJumpCooldown - dt);
  }
  
  // Safety: prevent inconsistent physics states that could break gameplay
  if (state.player.grounded && state.player.isFrozen) { 
    state.player.isFrozen = false; // Freeze only valid while airborne
  }
  if (state.player.grounded && state.player.isDashing) { 
    state.player.isDashing = false; // Cancel edge-case ground dash
  }
  
  // ============================================================================
  // Visual Trail Updates (Common to All Movement Modes)
  // ============================================================================
  
  // Trail particles update in all modes including ball form (creates tumbling effect)
  updateTrail();
}

// ============================================================================
// Global Export for Render System Integration
// ============================================================================

/**
 * Export game loop function to global scope for access by rendering system
 * Required for integration with main render loop calling pattern
 */
window.stepGame = stepGame;
