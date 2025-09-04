// Controls: turns, keyboard, and jump
function turnLeft(){ state.player.angle -= Math.PI/2; showSwipeGlow('left'); }
function turnRight(){ state.player.angle += Math.PI/2; showSwipeGlow('right'); }

function handleKeyboard(dt){
  if (state.inputs.keys.has('ArrowLeft') || state.inputs.keys.has('a')) {
    turnLeft(); state.inputs.keys.delete('ArrowLeft'); state.inputs.keys.delete('a');
  }
  if (state.inputs.keys.has('ArrowRight') || state.inputs.keys.has('d')) {
    turnRight(); state.inputs.keys.delete('ArrowRight'); state.inputs.keys.delete('d');
  }
  if (state.inputs.keys.has(' ') || state.inputs.keys.has('Space') || state.inputs.keys.has('Spacebar')){
    doJump();
    state.inputs.keys.delete(' ');
    state.inputs.keys.delete('Space');
    state.inputs.keys.delete('Spacebar');
  }
}

function doJump(){
  if (state.player.grounded){
    state.player.vy = 8.5;
    state.player.grounded = false;
    state.player.jumpStartY = state.player.y;
  }
}
