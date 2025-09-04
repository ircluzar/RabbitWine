// HUD updates and swipe glow feedback
let glowTimerL = 0, glowTimerR = 0;
function showSwipeGlow(dir){
  const now = performance.now();
  const dur = 180;
  if (dir === 'left') { glowTimerL = now + dur; if (GLOW_L) GLOW_L.classList.add('show'); }
  else { glowTimerR = now + dur; if (GLOW_R) GLOW_R.classList.add('show'); }
}

function updateHUD(now) {
  const elapsed = (now - state.timeStart) / 1000;
  if (now - state.lastFpsT >= 500) {
    state.fps = Math.round((state.frames * 1000) / (now - state.lastFpsT));
    state.frames = 0;
    state.lastFpsT = now;
  }
  const pointerLines = [];
  state.inputs.pointers.forEach((p, id) => {
    pointerLines.push(`#${id}: x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} dx=${p.dx.toFixed(1)} dy=${p.dy.toFixed(1)}`);
  });
  HUD.textContent = [
    `FPS ${state.fps} | t ${elapsed.toFixed(1)}s | DPR ${state.dpr.toFixed(2)}`,
    `Canvas ${CANVAS.width}x${CANVAS.height} (px) | seam ${(state.seamRatio*100).toFixed(1)}%`,
    `Present ${state.letterboxCss.w}x${state.letterboxCss.h} css @ (${state.letterboxCss.x},${state.letterboxCss.y})`,
    `Player x=${state.player.x.toFixed(2)} z=${state.player.z.toFixed(2)} ang=${(state.player.angle*180/Math.PI).toFixed(0)} speed=${state.player.speed.toFixed(2)}`,
    pointerLines.length ? `Pointers:\n${pointerLines.join('\n')}` : 'Pointers: none',
    state.inputs.keys.size ? `Keys: ${Array.from(state.inputs.keys).join(',')}` : 'Keys: none',
  ].join('\n');
  if (GLOW_L && performance.now() > glowTimerL) GLOW_L.classList.remove('show');
  if (GLOW_R && performance.now() > glowTimerR) GLOW_R.classList.remove('show');
}
