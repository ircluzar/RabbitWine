/**
 * Multiplayer configuration constants and time synchronization
 * Extracted from multiplayer.js - handles server config and time offset logic
 * 
 * @fileoverview Configuration and time sync for multiplayer client
 */

// ============================================================================
// Configuration Constants
// ============================================================================

const __MP_SCHEME = (location.protocol === 'https:' ? 'wss' : 'ws');
const __MP_DEFAULT = ((window.MP_SERVER && window.MP_SERVER.trim()) || (`${__MP_SCHEME}://${location.hostname}:42666`)).replace(/\/$/, "");
let MP_SERVER = __MP_DEFAULT; // WebSocket endpoint (ws:// or wss://)
const MP_TTL_MS = 3000;
const MP_UPDATE_MS = 100; // 10 Hz
const GHOST_Y_OFFSET = 0.32; // raise wireframe so the bottom doesn't clip into the ground

// Channel / Level segmentation defaults (channel can be changed at runtime via settings modal)
let MP_CHANNEL = 'DEFAULT';
let MP_LEVEL = 'ROOT';

// Attempt to restore previously chosen channel from localStorage
try {
  if (typeof localStorage !== 'undefined') {
    const savedCh = localStorage.getItem('mp_channel');
    if (savedCh && /^[A-Za-z0-9_\-]{1,32}$/.test(savedCh)) {
      MP_CHANNEL = savedCh;
    }
  }
} catch(_) {}

// GUID per session/boot
const MP_ID = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2)+Date.now());

// ============================================================================
// Time Synchronization
// ============================================================================

// Time sync with server for interpolation
const timeSync = { offsetMs: 0, rttMs: 0, ready: false };
const INTERP_DELAY_MS = 150;   // render slightly in the past for smooth playback
const MAX_EXTRAP_MS = 250;     // cap extrapolation when missing newer samples
const GHOST_DESPAWN_MS = 2000; // if no updates > 2s, despawn
const MP_FAIL_COOLDOWN_MS = 10000; // cap: wait up to 10s between retries
const MP_FAIL_BASE_MS = 2000;      // initial backoff 2s
const MP_FAIL_JITTER_MS = 400;     // +/- jitter to avoid thundering herd

/**
 * Update time offset between client and server for smooth interpolation
 * @param {number} serverNow - Server timestamp in milliseconds
 */
function mpComputeOffset(serverNow){
  try {
    const localNow = Date.now();
    const est = (typeof serverNow === 'number') ? (serverNow - localNow) : timeSync.offsetMs;
    const alpha = timeSync.ready ? 0.1 : 0.5;
    timeSync.offsetMs = (1 - alpha) * timeSync.offsetMs + alpha * est;
    timeSync.ready = true;
  } catch(_){}
}

// Export configuration and time sync
if (typeof window !== 'undefined') {
  // Config exports
  window.MP_SERVER = MP_SERVER;
  window.MP_CHANNEL = MP_CHANNEL;
  window.MP_LEVEL = MP_LEVEL;
  window.MP_ID = MP_ID;
  window.MP_TTL_MS = MP_TTL_MS;
  window.MP_UPDATE_MS = MP_UPDATE_MS;
  window.GHOST_Y_OFFSET = GHOST_Y_OFFSET;
  window.INTERP_DELAY_MS = INTERP_DELAY_MS;
  window.MAX_EXTRAP_MS = MAX_EXTRAP_MS;
  window.GHOST_DESPAWN_MS = GHOST_DESPAWN_MS;
  window.MP_FAIL_COOLDOWN_MS = MP_FAIL_COOLDOWN_MS;
  window.MP_FAIL_BASE_MS = MP_FAIL_BASE_MS;
  window.MP_FAIL_JITTER_MS = MP_FAIL_JITTER_MS;
  
  // Time sync exports
  window.timeSync = timeSync;
  window.mpComputeOffset = mpComputeOffset;
}