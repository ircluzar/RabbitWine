// Keyboard input
function onKey(e) {
  if (e.type === 'keydown') state.inputs.keys.add(e.key);
  else state.inputs.keys.delete(e.key);
}
