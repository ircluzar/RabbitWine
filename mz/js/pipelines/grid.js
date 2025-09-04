// Grid pipeline (extracted from scene.js)
const GRID_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_mvp;
out vec3 v_world;
void main(){ v_world = a_pos; gl_Position = u_mvp * vec4(a_pos,1.0); }
`;
const GRID_FS = `#version 300 es
precision mediump float;
uniform vec3 u_color;
uniform vec3 u_camPos;
uniform float u_falloff;
in vec3 v_world;
out vec4 outColor;
void main(){
  float att = 1.0;
  if (u_falloff > 0.0) {
    float dist = distance(v_world, u_camPos);
    att = 1.0 / (1.0 + dist * u_falloff);
    att = max(att, 0.25);
  }
  outColor = vec4(u_color * att, 1.0);
}
`;
const gridProgram = createProgram(GRID_VS, GRID_FS);
const grid_u_mvp = gl.getUniformLocation(gridProgram, 'u_mvp');
const grid_u_color = gl.getUniformLocation(gridProgram, 'u_color');
const grid_u_camPos = gl.getUniformLocation(gridProgram, 'u_camPos');
const grid_u_falloff = gl.getUniformLocation(gridProgram, 'u_falloff');

function buildGridLines(size=20, step=1){
  const lines=[];
  for(let i=-size;i<=size;i+=step){
    lines.push(-size,0,i,  size,0,i);
    lines.push(i,0,-size,  i,0,size);
  }
  return new Float32Array(lines);
}
const gridData = buildGridLines(24, 1);
const gridVAO = gl.createVertexArray();
const gridVBO = gl.createBuffer();
gl.bindVertexArray(gridVAO);
gl.bindBuffer(gl.ARRAY_BUFFER, gridVBO);
gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);
gl.bindBuffer(gl.ARRAY_BUFFER, null);
const gridVertexCount = gridData.length/3;

function renderGridViewport(x, y, w, h, cameraKind /* 'top'|'bottom' */) {
  gl.viewport(x, y, w, h);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x, y, w, h);
  if (cameraKind === 'top') gl.clearColor(0.025, 0.05, 0.055, 1.0); else gl.clearColor(0.02, 0.045, 0.05, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.SCISSOR_TEST);
}

function drawGridOverlay(mvp, camEye, isThirdPerson) {
  gl.useProgram(gridProgram);
  gl.uniformMatrix4fv(grid_u_mvp, false, mvp);
  gl.uniform3fv(grid_u_color, new Float32Array([0.05, 0.35, 0.33]));
  if (isThirdPerson) {
    gl.uniform3f(grid_u_camPos, camEye[0], camEye[1], camEye[2]);
    gl.uniform1f(grid_u_falloff, 0.09);
  } else {
    gl.uniform3f(grid_u_camPos, 0,0,0);
    gl.uniform1f(grid_u_falloff, 0.0);
  }
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.bindVertexArray(gridVAO);
  gl.drawArrays(gl.LINES, 0, gridVertexCount);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
}
