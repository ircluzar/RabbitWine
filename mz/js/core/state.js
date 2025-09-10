/**
 * Global application state for the MZ game engine.
 * Centralized state object containing player data, camera settings, input state, and rendering config.
 * Exports: state object for read/write access by all modules.
 * Dependencies: BASE_WIDTH, BASE_HEIGHT from constants.js. Side effects: Accesses window.devicePixelRatio and performance.now().
 */

// Level base colors & style flags (extend / tweak as more levels are added)
// coloredOutlines = true -> use derived wall color for cube outlines; false -> force black outlines
// coloredBg = true -> tint scene & viewport clears with darkened base color; false -> use black background
const LEVEL_BASE_COLORS = {
  1: { color: '#0fd5db', coloredOutlines: true, coloredBg: false  },
  2: { color: '#db8b0f', coloredOutlines: true,  coloredBg: true  },
  3: { color: '#db0f7a', coloredOutlines: false, coloredBg: false },
};

function hexToRgb01(hex){
  if (!hex) return [1,1,1];
  const h = hex.replace('#','');
  if (h.length === 3){
    const r = parseInt(h[0]+h[0],16), g=parseInt(h[1]+h[1],16), b=parseInt(h[2]+h[2],16);
    return [r/255,g/255,b/255];
  }
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return [r/255,g/255,b/255];
}

// Global state (moved from config.js)
const state = {
  dpr: Math.min(window.devicePixelRatio || 1, 3),
  logicalWidth: BASE_WIDTH,
  logicalHeight: BASE_HEIGHT,
  timeStart: performance.now(),
  // Active level & palette (baseColor propagates to UI / rendering elements formerly hard-coded to teal)
  level: {
    id: 1,
    baseColor: (typeof LEVEL_BASE_COLORS[1] === 'string') ? LEVEL_BASE_COLORS[1] : LEVEL_BASE_COLORS[1].color,
    baseColorRGB: hexToRgb01((typeof LEVEL_BASE_COLORS[1] === 'string') ? LEVEL_BASE_COLORS[1] : LEVEL_BASE_COLORS[1].color),
  outlineColored: (typeof LEVEL_BASE_COLORS[1] === 'object' && !!LEVEL_BASE_COLORS[1].coloredOutlines) || false,
  backgroundColored: (typeof LEVEL_BASE_COLORS[1] === 'object' && !!LEVEL_BASE_COLORS[1].coloredBg) || false,
    palette: { wallRGB: [0,0,0], gridRGB: [0,0,0] }, // temp, filled below
  },
  inputs: {
    pointers: new Map(), // id -> {x,y,dx,dy,startX,startY,lastT}
    keys: new Set(),
    gamepads: [],
  },
  seamRatio: 0.5, // 0..1 of canvas height where seam lies (center of handle)
  fps: 0,
  frames: 0,
  lastFpsT: performance.now(),
  letterboxCss: { x: 0, y: 0, w: 0, h: 0 },
  timePrev: performance.now(),
  fillViewport: true, // true = scale to fit viewport, false = 1x native centered
  debugVisible: false, // HUD visibility controlled by Debug button
  player: {
    x: 0, z: 0, y: 0.0,
    vy: 0.0,
    grounded: true,
    wallJumpCooldown: 0.0,
    jumpStartY: 0.0,
    angle: 0, // radians, 0 faces -Z
  speed: 0,
  // Movement mode: 'stationary' (decelerate/hold 0) or 'accelerate' (accelerate toward seam max)
  movementMode: 'stationary',
    radius: 0.3,
  // Damage/ball mode
  isBallMode: false,
  _ballVX: 0.0,
  _ballVZ: 0.0,
  _ballBouncesLeft: 0,
  _ballStartSec: 0,
  _ballFlashUntilSec: 0,
  _ballSpinAxisX: 0,
  _ballSpinAxisY: 1,
  _ballSpinAxisZ: 0,
  _ballSpinSpeed: 0.0,
  // Ability flags (unlockable during gameplay)
  canBack: false,      // press down to stop/go backwards (ABILITY_BACK)
  canTurn: false,      // turning locked until unlocked by an ability
  canJump: false,      // press jump (ABILITY_JUMP)
  canWallJump: false,  // wall jump (ABILITY_WALLJUMP)
  canDash: false,      // freeze and dash system (ABILITY_DASH)
  // Dash powerup ownership
  hasDash: false,
  dashUsed: false,
  isFrozen: false,
  isDashing: false,
  dashTime: 0.0,
  // Saved values when frozen/dashing
  _savedSpeed: 0.0,
  _savedVy: 0.0,
  _savedMode: 'stationary',
  _resumeVy: 0.0,
  },
  trail: {
    points: [], // array of [x,y,z,bornSec]
    maxPoints: 420,
    minDist: 0.69/2,
    ttl: 0.69, // seconds
  },
  camFollow: { x: 0, y: 0, z: 0 },
  camYaw: 0.0,
  snapBottomFull: false,
  snapTopFull: false,
  // Alt control lock: when true, use bottom-fullscreen controls without fullscreen
  altBottomControlLocked: false,
  // Camera yaw lock (freeze top camera yaw when true)
  lockCameraYaw: false,
  // First acceleration marker/event state
  firstAccelFired: false,
  firstAccelSlowUntil: 0,
  firstAccelStartSec: 0,
  firstAccelDuration: 0,
  // Top-half posterize mix (0 = off, 1 = fully posterized)
  topPosterizeMix: 1.0, // Start with effect ON
  topPosterizeLevels: 4.0, // Start crushed but not too extreme
  topDitherAmt: 0.6, // Moderate dithering
  topPixelSize: 3.0, // Moderate pixelation
  // Editor/debug tools
  editor: {
    mode: 'none', // 'none' | 'fps'
    pointerLocked: false,
    modalOpen: false,
    // First-person free-fly camera (noclip)
    fps: { x: 0, y: 2.6, z: 0, yaw: 0, pitch: 0, moveSpeed: 6.0 },
  // Distance from the FPS camera along the view ray to sample the visor target (scroll to adjust)
  visorDist: 6.0,
    // Ray/hover target for visor
    visor: { gx: -1, gy: -1, yCenter: 0.5, base: 0, height: 1 },
    // Live preview cells [{gx,gy,b,h}]
    preview: [],
  // Current modal origin and camera prefs for top preview when editing
  modalOrigin: { gx: -1, gy: -1, base: 0 },
  topCamDist: 4.0,
  topCamHeight: 2.6,
  draggingTopCam: false,
  // Selected block type slot (1..9). Slot 1 = BASE (normal), slot 2 = BAD (hazard), others default to BASE for now.
  blockSlot: 1,
  },
};

// Public helpers to update level & propagate derived color
window.setLevel = function(levelId){
  if (!LEVEL_BASE_COLORS[levelId]) {
    console.warn('[MZ] setLevel: unknown level', levelId, 'falling back to 1');
    levelId = 1;
  }
  const def = LEVEL_BASE_COLORS[levelId];
  const baseHex = (typeof def === 'string') ? def : def.color;
  state.level.id = levelId;
  state.level.baseColor = baseHex;
  state.level.baseColorRGB = hexToRgb01(baseHex);
  state.level.outlineColored = (typeof def === 'object' && !!def.coloredOutlines) || false;
  state.level.backgroundColored = (typeof def === 'object' && !!def.coloredBg) || false;
  // Derive palette variants from base
  try {
    const [r,g,b] = state.level.baseColorRGB;
    function clamp01(x){ return Math.min(1, Math.max(0, x)); }
    const wall = [clamp01(r*1.02), clamp01(g*0.54), clamp01(b*0.56)];
    const grid = [clamp01(r*0.85), clamp01(g*0.419), clamp01(b*0.385)];
    state.level.palette.wallRGB = wall;
    state.level.palette.gridRGB = grid;
  } catch(e){ console.warn('Palette derivation failed', e); }
};

window.getLevelBaseColor = function(){ return state.level.baseColor; };
window.getLevelBaseColorRGB = function(){ return state.level.baseColorRGB; };
window.getLevelWallColorRGB = function(){ return (state.level && state.level.palette && state.level.palette.wallRGB) || [0.06,0.45,0.48]; };
window.getLevelGridColorRGB = function(){ return (state.level && state.level.palette && state.level.palette.gridRGB) || [0.05,0.35,0.33]; };
window.getLevelOutlineColored = function(){ return !!(state.level && state.level.outlineColored); };
window.getLevelOutlineColorRGB = function(){ return window.getLevelOutlineColored() ? window.getLevelWallColorRGB() : [0,0,0]; };
window.getLevelBackgroundColored = function(){ return !!(state.level && state.level.backgroundColored); };

// Initialize palette immediately for initial level without requiring explicit setLevel call
try { window.setLevel(state.level.id); } catch(_){ }

