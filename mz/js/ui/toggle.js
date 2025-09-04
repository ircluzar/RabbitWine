// Fill/native scaling toggle
function onToggleFill(){
  state.fillViewport = !state.fillViewport;
  FILL_TOGGLE.setAttribute('aria-pressed', state.fillViewport ? 'true' : 'false');
  FILL_TOGGLE.textContent = `Fill: ${state.fillViewport ? 'ON' : 'OFF'}`;
  resizeCanvasToViewport();
}
