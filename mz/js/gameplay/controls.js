/**
 * Player control functions for movement and input handling.
 * Provides turn controls, keyboard input processing, and jump mechanics.
 * Exports: turnLeft(), turnRight(), handleKeyboard(), doJump() functions.
 * Dependencies: state.player and state.inputs from state.js, showSwipeGlow() from UI. Side effects: Modifies player angle, velocity, and input state.
 */

// Controls: turns, keyboard, and jump
/**
 * Turn player 90 degrees to the left
 */
function turnLeft(){ 
  state.player.angle -= Math.PI/2; 
  showSwipeGlow('left'); 
}

/**
 * Turn player 90 degrees to the right
 */
function turnRight(){ 
  state.player.angle += Math.PI/2; 
  showSwipeGlow('right'); 
}

/**
 * Process keyboard input for player controls
 * @param {number} dt - Delta time (unused)
 */
function handleKeyboard(dt){
  if (state.inputs.keys.has('ArrowLeft') || state.inputs.keys.has('a')) {
    turnLeft(); 
    state.inputs.keys.delete('ArrowLeft'); 
    state.inputs.keys.delete('a');
  }
  if (state.inputs.keys.has('ArrowRight') || state.inputs.keys.has('d')) {
    turnRight(); 
    state.inputs.keys.delete('ArrowRight'); 
    state.inputs.keys.delete('d');
  }
  if (state.inputs.keys.has(' ') || state.inputs.keys.has('Space') || state.inputs.keys.has('Spacebar')){
    doJump();
    state.inputs.keys.delete(' ');
    state.inputs.keys.delete('Space');
    state.inputs.keys.delete('Spacebar');
  }
}

/**
 * Make player jump if grounded
 */
function doJump(){
  if (state.player.grounded){
    state.player.vy = 8.5;
    state.player.grounded = false;
    state.player.jumpStartY = state.player.y;
  }
}
