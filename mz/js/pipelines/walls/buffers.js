/**
 * Wall rendering buffer management
 * Extracted from walls.js - handles VAO/VBO setup and buffer operations
 * 
 * @fileoverview WebGL buffer management for wall rendering pipeline
 * @dependencies window.gl, wall geometry data, shader programs
 */

// Buffer references - module-scoped storage
let wallVAO = null;
let wallVBO_PosBase = null;
let wallVBO_PosJitter = null;
let wallVBO_Inst = null;
let wallWireVAO = null;

/**
 * Initialize wall VAO/VBO setup with geometry data
 * @param {Float32Array} wallBasePosData - Base position geometry data
 * @returns {boolean} Success status
 */
function initWallVAOs(wallBasePosData) {
  if (!wallBasePosData || !window.gl) return false;
  
  const gl = window.gl;
  
  // Main wall VAO setup
  wallVAO = gl.createVertexArray();
  gl.bindVertexArray(wallVAO);
  
  // Base position buffer (static geometry)
  wallVBO_PosBase = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_PosBase);
  gl.bufferData(gl.ARRAY_BUFFER, wallBasePosData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  
  // Jitter position buffer (dynamic for animation)
  wallVBO_PosJitter = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_PosJitter);
  gl.bufferData(gl.ARRAY_BUFFER, wallBasePosData, gl.DYNAMIC_DRAW);
  
  // Instance data buffer (positions for instanced rendering)
  wallVBO_Inst = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  
  // Clean up bindings
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // Wireframe VAO for outlines
  wallWireVAO = gl.createVertexArray();
  
  // Publish to window for legacy consumers
  try {
    window.wallVAO = wallVAO;
    window.wallWireVAO = wallWireVAO;
  } catch(_){ }
  
  return true;
}

/**
 * Update jitter position buffer with new geometry data
 * @param {Float32Array} jitterPosData - Updated position data with jitter
 */
function updateWallJitterBuffer(jitterPosData) {
  if (!wallVBO_PosJitter || !window.gl || !jitterPosData) return;
  
  const gl = window.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_PosJitter);
  gl.bufferData(gl.ARRAY_BUFFER, jitterPosData, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

/**
 * Update instance buffer with new instance data
 * @param {Float32Array} instanceData - Instance position data
 */
function updateWallInstanceBuffer(instanceData) {
  if (!wallVBO_Inst || !window.gl) return;
  
  const gl = window.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData || new Float32Array(0), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

/**
 * Bind wall VAO and configure vertex attributes for rendering
 * @param {boolean} useJitter - Whether to use jitter buffer for positions
 */
function bindWallBuffers(useJitter = false) {
  if (!wallVAO || !window.gl) return false;
  
  const gl = window.gl;
  gl.bindVertexArray(wallVAO);
  
  // Choose position buffer based on jitter setting
  const posBuffer = useJitter ? wallVBO_PosJitter : wallVBO_PosBase;
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  
  // Bind instance buffer
  gl.bindBuffer(gl.ARRAY_BUFFER, wallVBO_Inst);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  
  return true;
}

/**
 * Unbind wall buffers to clean up GL state
 */
function unbindWallBuffers() {
  if (!window.gl) return;
  
  const gl = window.gl;
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
}

/**
 * Get buffer references for external access
 * @returns {Object} Buffer object references
 */
function getWallBuffers() {
  return {
    wallVAO,
    wallVBO_PosBase,
    wallVBO_PosJitter,
    wallVBO_Inst,
    wallWireVAO
  };
}

/**
 * Clean up all wall buffers and VAOs
 */
function destroyWallBuffers() {
  if (!window.gl) return;
  
  const gl = window.gl;
  
  if (wallVAO) {
    gl.deleteVertexArray(wallVAO);
    wallVAO = null;
  }
  
  if (wallVBO_PosBase) {
    gl.deleteBuffer(wallVBO_PosBase);
    wallVBO_PosBase = null;
  }
  
  if (wallVBO_PosJitter) {
    gl.deleteBuffer(wallVBO_PosJitter);
    wallVBO_PosJitter = null;
  }
  
  if (wallVBO_Inst) {
    gl.deleteBuffer(wallVBO_Inst);
    wallVBO_Inst = null;
  }
  
  if (wallWireVAO) {
    gl.deleteVertexArray(wallWireVAO);
    wallWireVAO = null;
  }
  try { window.wallVAO = null; window.wallWireVAO = null; } catch(_){ }
}

// Export buffer management functions
if (typeof window !== 'undefined') {
  window.initWallVAOs = initWallVAOs;
  window.updateWallJitterBuffer = updateWallJitterBuffer;
  window.updateWallInstanceBuffer = updateWallInstanceBuffer;
  window.bindWallBuffers = bindWallBuffers;
  window.unbindWallBuffers = unbindWallBuffers;
  window.getWallBuffers = getWallBuffers;
  window.destroyWallBuffers = destroyWallBuffers;
  
  // Export individual buffer references for compatibility
  window.wallVAO = wallVAO;
  window.wallWireVAO = wallWireVAO;
}