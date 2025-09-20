/**
 * Multiplayer configuration constants and time synchronization
 * Extracted from multiplayer.js - handles server config and time offset logic
 * 
 * @fileoverview Configuration and time sync for multiplayer client
 */

// ============================================================================
// Configuration Constants
// ============================================================================

window.__MP_SCHEME = window.__MP_SCHEME || (location.protocol === 'https:' ? 'wss' : 'ws');
window.__MP_DEFAULT = window.__MP_DEFAULT || ((window.MP_SERVER && window.MP_SERVER.trim()) || (`${window.__MP_SCHEME}://${location.hostname}:42666`)).replace(/\/$/, "");
window.MP_SERVER = window.MP_SERVER || window.__MP_DEFAULT; // WebSocket endpoint (ws:// or wss://)
window.MP_TTL_MS = window.MP_TTL_MS || 3000;
window.MP_UPDATE_MS = window.MP_UPDATE_MS || 100; // 10 Hz
window.GHOST_Y_OFFSET = window.GHOST_Y_OFFSET || 0.32; // raise wireframe so the bottom doesn't clip into the ground

// Channel / Level segmentation defaults (channel can be changed at runtime via settings modal)
window.MP_CHANNEL = window.MP_CHANNEL || 'DEFAULT';
window.MP_LEVEL = window.MP_LEVEL || 'ROOT';

// Attempt to restore previously chosen channel from localStorage
try {
  if (typeof localStorage !== 'undefined') {
    const savedCh = localStorage.getItem('mp_channel');
    if (savedCh && /^[A-Za-z0-9_\-]{1,32}$/.test(savedCh)) {
      window.MP_CHANNEL = savedCh;
    }
  }
} catch(_) {}

// GUID per session/boot
window.MP_ID = window.MP_ID || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2)+Date.now()));

// ============================================================================
// Time Synchronization
// ============================================================================

// Time sync with server for interpolation
window.timeSync = window.timeSync || { offsetMs: 0, rttMs: 0, ready: false };
window.INTERP_DELAY_MS = window.INTERP_DELAY_MS || 150;   // render slightly in the past for smooth playback
window.MAX_EXTRAP_MS = window.MAX_EXTRAP_MS || 250;     // cap extrapolation when missing newer samples
window.GHOST_DESPAWN_MS = window.GHOST_DESPAWN_MS || 2000; // if no updates > 2s, despawn
window.MP_FAIL_COOLDOWN_MS = window.MP_FAIL_COOLDOWN_MS || 10000; // cap: wait up to 10s between retries
window.MP_FAIL_BASE_MS = window.MP_FAIL_BASE_MS || 2000;      // initial backoff 2s
window.MP_FAIL_JITTER_MS = window.MP_FAIL_JITTER_MS || 400;     // +/- jitter to avoid thundering herd

/**
 * Update time offset between client and server for smooth interpolation
 * @param {number} serverNow - Server timestamp in milliseconds
 */
function mpComputeOffset(serverNow){
  try {
    const localNow = Date.now();
    const est = (typeof serverNow === 'number') ? (serverNow - localNow) : window.timeSync.offsetMs;
    const alpha = window.timeSync.ready ? 0.1 : 0.5;
    window.timeSync.offsetMs = (1 - alpha) * window.timeSync.offsetMs + alpha * est;
    window.timeSync.ready = true;
  } catch(_){}
}

// Export configuration and time sync
if (typeof window !== 'undefined') {
  window.mpComputeOffset = mpComputeOffset;
}