"use strict";
/**
 * Ultra-simple multiplayer client for RabbitWine.
 * Periodically POSTs our state to the Python server and keeps a map of ghost players.
 * Ghosts are rendered as wireframe boxes using the existing trail cube pipeline.
 */

// Config
const __MP_DEFAULT = ((window.MP_SERVER && window.MP_SERVER.trim()) || (`http://${location.hostname}:42666`)).replace(/\/$/, "");
let MP_SERVER = __MP_DEFAULT; // HTTPS disabled: keep HTTP endpoint as-is
const MP_TTL_MS = 3000;
const MP_UPDATE_MS = 100; // 10 Hz

// GUID per session/boot
const MP_ID = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2)+Date.now());

// Init log so it’s clear the module is active
try { console.log('[MP] init (HTTP only)', { server: MP_SERVER, id: MP_ID }); } catch(_) {}

// Helper to get global state across script scoping variations
function __mp_getState(){
  try {
    // Prefer a direct binding if present
    if (typeof state !== 'undefined' && state) return state;
  } catch(_) {}
  // Fallback to window
  if (window && window.state) return window.state;
  return null;
}
// Bridge: if we can see a direct binding, attach to window for others
try { if (!window.state && typeof state !== 'undefined') window.state = state; } catch(_) {}

// Ghost repository with buffered samples for interpolation
/** @type {Map<string,{
 *  samples: Array<{t:number, x:number,y:number,z:number, state:'good'|'ball', rot?:number}>,
 *  renderPos:{x:number,y:number,z:number}, renderRot:number, renderState:'good'|'ball',
 *  lastSeen:number
 *}>
 */
const ghosts = new Map();

// Time sync with server for interpolation
const timeSync = { offsetMs: 0, rttMs: 0, ready: false };
const INTERP_DELAY_MS = 150;   // render slightly in the past for smooth playback
const MAX_EXTRAP_MS = 250;     // cap extrapolation when missing newer samples

// Networking
let __mp_failCount = 0;
function mpSendUpdate(selfPos, state, rotation){
  const body = { id: MP_ID, pos: { x: selfPos.x, y: selfPos.y, z: selfPos.z||0 }, state };
  if (state === 'ball') body.rotation = rotation;
  const base = MP_SERVER.replace(/\/$/, '');
  const url = base ? `${base}/update` : `${location.origin}/mz/update`;
  console.log('[MP] sending', { url, body });
  const t0 = performance.now();
  return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), mode: 'cors', keepalive: false
  }).then(async r => {
    const txt = await r.text();
    const dt = Math.round(performance.now() - t0);
    if (!r.ok){
      console.warn('[MP] server responded error', { status:r.status, dt, txt });
      throw new Error('server_error_'+r.status);
    }
    const json = JSON.parse(txt || '{}');
    const count = (json && Array.isArray(json.players)) ? json.players.length : 0;
    console.log('[MP] ok', { dt, count });
    __mp_failCount = 0;
    // Update time sync (approximate): offset = serverNow - (localNow - rtt/2)
    try {
      const localNow = Date.now();
      const rtt = Math.max(0, localNow - Math.floor(t0 + (performance.timeOrigin || 0)));
      const half = rtt * 0.5;
      const est = (typeof json.now === 'number') ? (json.now - (localNow - half)) : timeSync.offsetMs;
      const alpha = timeSync.ready ? 0.1 : 0.5;
      timeSync.offsetMs = (1 - alpha) * timeSync.offsetMs + alpha * est;
      timeSync.rttMs = (1 - alpha) * timeSync.rttMs + alpha * rtt;
      timeSync.ready = true;
    } catch(_){ }
    return json;
  }).catch(err => {
    const dt = Math.round(performance.now() - t0);
    console.error('[MP] failed', { err: String(err), dt });
    __mp_failCount++;
    if (__mp_failCount === 3){
      console.warn('[MP] still failing after 3 tries. If your page is HTTPS, the server must be HTTPS too, or set window.MP_SERVER to a same-origin proxied path.');
    }
  // HTTPS/same-origin fallback disabled by request
    throw err;
  });
}

let mpLastNetT = 0;
function mpTickNet(nowMs){
  const s = __mp_getState();
  if (!s || !s.player){
    if (!mpTickNet._warned){ console.log('[MP] waiting for state...'); mpTickNet._warned = true; }
    return;
  }
  if ((nowMs - mpLastNetT) < MP_UPDATE_MS - 1) return; // rate
  mpLastNetT = nowMs;
  const p = s.player;
  const myState = p.isBallMode ? 'ball' : 'good';
  // Derive a simple rotation for ball mode using spin start + speed (rad/sec)
  let rotDeg = 0;
  if (p.isBallMode) {
    const nowSec = (state.nowSec || (performance.now()/1000));
    const seed = p._ballStartSec || nowSec;
    const speed = (p._ballSpinSpeed || 1.0); // radians/sec
    const angRad = speed * Math.max(0, nowSec - seed);
    rotDeg = ((angRad * 180/Math.PI) % 360 + 360) % 360;
  }
  const selfPos = { x: p.x, y: p.y, z: p.z };
  if (mpTickNet._warned && !mpTickNet._readyLogged){ console.log('[MP] state ready, starting updates'); mpTickNet._readyLogged = true; }
  mpSendUpdate(selfPos, myState, rotDeg).then(snap => {
    const serverNow = snap.now || 0;
    const seen = new Set();
    if (Array.isArray(snap.players)){
      for (const o of snap.players){
        if (!o || typeof o.id !== 'string') continue;
        seen.add(o.id);
        let g = ghosts.get(o.id);
        if (!g){
          g = { samples: [], renderPos: {x:o.pos.x, y:o.pos.y, z:o.pos.z}, renderRot: (o.rotation||0), renderState: (o.state==='ball'?'ball':'good'), lastSeen: 0 };
          ghosts.set(o.id, g);
        }
        const st = Math.max(0, serverNow - (o.ageMs || 0)); // sample server time
        g.samples.push({ t: st, x:o.pos.x, y:o.pos.y, z:o.pos.z, state:(o.state==='ball'?'ball':'good'), rot: (typeof o.rotation==='number'? o.rotation : undefined) });
        // Keep last ~2s of samples
        const cutoff = st - 2000;
        let k = 0;
        for (let i=0;i<g.samples.length;i++){ if (g.samples[i].t >= cutoff){ g.samples[k++] = g.samples[i]; } }
        g.samples.length = k;
        g.lastSeen = Date.now();
      }
    }
    // Prune expired
    const nowLocal = Date.now();
    for (const [id, g] of ghosts){
      if (!seen.has(id) && (nowLocal - g.lastSeen > MP_TTL_MS)) ghosts.delete(id);
    }
  }).catch(()=>{});
}

// Local interpolation (called every frame)
function mpUpdateGhosts(dt){
  const localNow = Date.now();
  const serverRenderTime = timeSync.ready ? (localNow + timeSync.offsetMs - INTERP_DELAY_MS) : localNow - INTERP_DELAY_MS;
  for (const g of ghosts.values()){
    const arr = g.samples;
    if (!arr || arr.length === 0) continue;
    // Find bracketing samples
    let a = null, b = null;
    for (let i=arr.length-1;i>=0;i--){
      if (arr[i].t <= serverRenderTime){ a = arr[i]; b = arr[i+1] || null; break; }
    }
    if (!a){ a = arr[0]; b = arr[1] || null; }
    if (!b){
      // Extrapolate using last two samples if possible
      const n = arr.length;
      if (n >= 2){
        const p0 = arr[n-2], p1 = arr[n-1];
        const dtMs = Math.max(1, p1.t - p0.t);
        const vx = (p1.x - p0.x) / dtMs;
        const vy = (p1.y - p0.y) / dtMs;
        const vz = (p1.z - p0.z) / dtMs;
        const lookahead = Math.min(MAX_EXTRAP_MS, serverRenderTime - p1.t);
        g.renderPos = { x: p1.x + vx * lookahead, y: p1.y + vy * lookahead, z: p1.z + vz * lookahead };
        g.renderState = p1.state;
        if (p1.state === 'ball' && typeof p1.rot === 'number') g.renderRot = p1.rot;
      } else {
        g.renderPos = { x: arr[0].x, y: arr[0].y, z: arr[0].z };
        g.renderState = arr[0].state;
        if (arr[0].state === 'ball' && typeof arr[0].rot === 'number') g.renderRot = arr[0].rot;
      }
      continue;
    }
    const span = Math.max(1, b.t - a.t);
    const u = Math.max(0, Math.min(1, (serverRenderTime - a.t) / span));
    g.renderPos = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
    // Choose state from newer sample to reduce flicker
    g.renderState = (u < 0.5 ? a.state : b.state);
    // Rotation smoothing (shortest arc) if ball and both have rotation
    const ra = (typeof a.rot === 'number') ? ((a.rot%360)+360)%360 : null;
    const rb = (typeof b.rot === 'number') ? ((b.rot%360)+360)%360 : null;
    if (g.renderState === 'ball' && ra !== null && rb !== null){
      let diff = rb - ra; if (diff > 180) diff -= 360; if (diff < -180) diff += 360;
      g.renderRot = ra + diff * u;
    } else if (ra !== null) { g.renderRot = ra; }
  }
}

// Rendering helpers using existing trail cube pipeline
function drawGhosts(mvp){
  if (!ghosts.size) return;
  const now = state.nowSec || performance.now()/1000;
  const N = ghosts.size;
  // Build buffers for N instances
  const inst = new Float32Array(N*4);
  const zeros3 = new Float32Array(N*3); // axis=0
  const corners = new Float32Array(N*8*3); // no jitter
  let i = 0;
  for (const g of ghosts.values()){
    const rp = g.renderPos || {x:0,y:0,z:0};
    inst[i*4+0] = rp.x; inst[i*4+1] = rp.y + 0.25; inst[i*4+2] = rp.z; inst[i*4+3] = now;
    i++;
  }
  gl.useProgram(trailCubeProgram);
  gl.uniformMatrix4fv(tc_u_mvp, false, mvp);
  gl.uniform1f(tc_u_scale, 0.54);
  gl.uniform1f(tc_u_now, now);
  gl.uniform1f(tc_u_ttl, 9999.0);
  gl.uniform1i(tc_u_dashMode, 0);
  gl.uniform1f(tc_u_mulAlpha, 0.9);
  // We’ll push color per-state by two passes for simplicity

  gl.bindVertexArray(trailCubeVAO);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, inst, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis); gl.bufferData(gl.ARRAY_BUFFER, zeros3, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Corners); gl.bufferData(gl.ARRAY_BUFFER, corners, gl.DYNAMIC_DRAW);

  // First pass: GOOD (green)
  gl.uniform3f(tc_u_lineColor, 0.1, 1.0, 0.1);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  // Draw only those with state good by issuing individual draws; cheap for small N
  let idx = 0;
  for (const g of ghosts.values()){
    if ((g.renderState || 'good') !== 'ball'){
      const rp = g.renderPos || {x:0,y:0,z:0};
      const localInst = new Float32Array([rp.x, rp.y + 0.25, rp.z, now]);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, localInst, gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.LINES, 0, 24, 1);
    }
    idx++;
  }

  // Second pass: BALL (red) with spin about Z using u_useAnim + rotation proxy
  if (typeof tc_u_useAnim !== 'undefined' && tc_u_useAnim) gl.uniform1i(tc_u_useAnim, 1);
  if (typeof tc_u_rotSpeed !== 'undefined' && tc_u_rotSpeed) gl.uniform1f(tc_u_rotSpeed, 1.0); // angle = 1*(now - seed)
  if (typeof tc_u_wobbleAmp !== 'undefined' && tc_u_wobbleAmp) gl.uniform1f(tc_u_wobbleAmp, 0.0);
  if (typeof tc_u_wobbleSpeed !== 'undefined' && tc_u_wobbleSpeed) gl.uniform1f(tc_u_wobbleSpeed, 0.0);
  gl.uniform3f(tc_u_lineColor, 1.0, 0.2, 0.2);
  for (const g of ghosts.values()){
    if ((g.renderState || 'good') === 'ball'){
      // Encode the desired angle in the seed by back-solving: angle = rotSpeed*(now-seed). Using rotSpeed=1 rad/s -> seed = now - angleRad
      const rp = g.renderPos || {x:0,y:0,z:0};
      const angleRad = ((g.renderRot||0) * Math.PI/180);
      const instOne = new Float32Array([rp.x, rp.y + 0.25, rp.z, now - angleRad]);
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Inst); gl.bufferData(gl.ARRAY_BUFFER, instOne, gl.DYNAMIC_DRAW);
      // Axis = +Z spin
      gl.bindBuffer(gl.ARRAY_BUFFER, trailCubeVBO_Axis); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0,1]), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.LINES, 0, 24, 1);
    }
  }

  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);
}

// Hooks into main loop
function __mp_onFrame(dt, nowMs){
  __mp_onFrame._count = ( __mp_onFrame._count || 0 ) + 1;
  mpTickNet(nowMs);
  mpUpdateGhosts(dt);
}

// Export globals
window.drawGhosts = drawGhosts;
window.__mp_onFrame = __mp_onFrame;
window.MP_ID = MP_ID;
window.MP_SERVER = MP_SERVER;

// Fallback: if the frame hook doesn't run within 1500ms, start a timer-based tick
setTimeout(() => {
  const ran = __mp_onFrame._count || 0;
  if (ran === 0){
    console.warn('[MP] frame hook not detected; starting fallback interval ticking');
    setInterval(() => { mpTickNet(Date.now()); }, MP_UPDATE_MS);
  } else {
    console.log('[MP] frame hook active');
  }
}, 1500);

// Try to resolve and bridge state for modules that load out of order
let __mp_state_probe_count = 0;
const __mp_state_probe = setInterval(() => {
  const s = __mp_getState();
  __mp_state_probe_count++;
  if (s && s.player){
    try { if (!window.state) window.state = s; } catch(_){ }
    console.log('[MP] bridged global state');
    clearInterval(__mp_state_probe);
  }
  if (__mp_state_probe_count > 50){ clearInterval(__mp_state_probe); }
}, 100);
