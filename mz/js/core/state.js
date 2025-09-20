/**
 * Global application state for the MZ game engine.
 * Centralized state object containing player data, camera settings, input state, rendering config,
 * and level progression. This module provides the single source of truth for all game state
 * and includes level management, color palette system, and utility functions.
 * 
 * @fileoverview Central game state management and level configuration
 * @exports state - Global game state object
 * @exports setLevel() - Level switching with palette updates
 * @exports parseLevelGroupId() - Level name parsing utilities
 * @exports getLevelBaseColor() - Color system getters
 * @dependencies BASE_WIDTH, BASE_HEIGHT from constants.js
 * @sideEffects Accesses window.devicePixelRatio and performance.now(), initializes default level
 */

/**
 * Level-specific visual configuration including base colors and style flags
 * Each level has a unique palette that affects UI, background, and outline rendering
 * @const {Object<number, Object>}
 */
const LEVEL_BASE_COLORS = {
  1: { color: '#0fd5db', coloredOutlines: false, coloredBg: false }, // Teal - clean minimal style
  2: { color: '#ed92ff', coloredOutlines: true,  coloredBg: true },  // Purple - vibrant style
  3: { color: '#db8b0f', coloredOutlines: true,  coloredBg: false }, // Orange - warm style
  4: { color: '#82ff5d', coloredOutlines: false, coloredBg: true },  // Green - natural style
  5: { color: '#ff4be7', coloredOutlines: true, coloredBg: true },   // Pink - energetic style
  6: { color: '#c2bc9d', coloredOutlines: false, coloredBg: false }, // Beige - neutral style
  7: { color: '#ff6a6a', coloredOutlines: true, coloredBg: true },   // Red - intense style
};

/**
 * Converts hex color string to normalized RGB array for WebGL usage
 * Handles both 3-digit (#rgb) and 6-digit (#rrggbb) hex formats
 * @param {string} hex - Hex color string (with or without #)
 * @returns {Array<number>} RGB values in [0,1] range, defaults to white on error
 */
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

/**
 * Central game state object containing all mutable application data
 * This object serves as the single source of truth for game state across all modules
 * @const {Object}
 */
const state = {
  /** Device pixel ratio clamped to reasonable maximum for performance */
  dpr: Math.min(window.devicePixelRatio || 1, 3),
  /** Logical rendering dimensions (internal resolution) */
  logicalWidth: BASE_WIDTH,
  logicalHeight: BASE_HEIGHT,
  /** Application start timestamp for timing calculations */
  timeStart: performance.now(),
  
  /** Current level configuration and visual palette */
  level: {
    /** Current level identifier */
    id: 1,
    /** Base hex color for this level's palette */
    baseColor: (typeof LEVEL_BASE_COLORS[1] === 'string') ? LEVEL_BASE_COLORS[1] : LEVEL_BASE_COLORS[1].color,
    /** Base color as normalized RGB array for WebGL */
    baseColorRGB: hexToRgb01((typeof LEVEL_BASE_COLORS[1] === 'string') ? LEVEL_BASE_COLORS[1] : LEVEL_BASE_COLORS[1].color),
    /** Whether to use colored outlines (vs black) */
    outlineColored: (typeof LEVEL_BASE_COLORS[1] === 'object' && !!LEVEL_BASE_COLORS[1].coloredOutlines) || false,
    /** Whether to tint background with level color */
    backgroundColored: (typeof LEVEL_BASE_COLORS[1] === 'object' && !!LEVEL_BASE_COLORS[1].coloredBg) || false,
    /** Derived colors for rendering (computed from base color) */
    palette: { wallRGB: [0,0,0], gridRGB: [0,0,0] }, // Filled by setLevel()
  },
  
  /** Input state tracking for all input devices */
  inputs: {
    /** Map of active pointer/touch inputs by ID */
    pointers: new Map(), // id -> {x,y,dx,dy,startX,startY,lastT}
    /** Set of currently pressed keyboard keys */
    keys: new Set(),
    /** Array of connected gamepad states */
    gamepads: [],
  },
  
  /** Viewport split seam position (0=bottom full, 1=top full) */
  seamRatio: 0.5,
  
  /** Performance monitoring */
  fps: 0,
  frames: 0,
  lastFpsT: performance.now(),
  
  /** Current letterboxing dimensions for viewport scaling */
  letterboxCss: { x: 0, y: 0, w: 0, h: 0 },
  
  /** Previous frame timestamp for delta time calculations */
  timePrev: performance.now(),
  
  /** Display mode: true=scale to fit viewport, false=1x native centered */
  fillViewport: true,
  
  /** Debug HUD visibility (controlled by Debug button) */
  debugVisible: false,
  /** Player character state and physics */
  player: {
    /** World position coordinates */
    x: 0, z: 0, y: 0.0,
    /** Vertical velocity for jumping/falling physics */
    vy: 0.0,
    /** Whether player is standing on solid ground */
    grounded: true,
    /** Wall jump ability cooldown timer */
    wallJumpCooldown: 0.0,
    /** Y position when jump started (for jump height calculation) */
    jumpStartY: 0.0,
    /** Player facing direction in radians (0 faces -Z) */
    angle: 0,
    /** Current movement speed */
    speed: 0,
    /** Movement behavior: 'stationary' (decelerate) or 'accelerate' (toward seam max) */
    movementMode: 'stationary',
    /** Player collision radius */
    radius: 0.3,
    
    /** Ball mode transformation state (damage/special ability) */
    isBallMode: false,
    _ballVX: 0.0,              // Ball velocity X component
    _ballVZ: 0.0,              // Ball velocity Z component  
    _ballBouncesLeft: 0,       // Remaining bounces in ball mode
    _ballStartSec: 0,          // Ball mode start timestamp
    _ballFlashUntilSec: 0,     // Flash effect end timestamp
    _ballSpinAxisX: 0,         // Ball rotation axis X
    _ballSpinAxisY: 1,         // Ball rotation axis Y
    _ballSpinAxisZ: 0,         // Ball rotation axis Z
    _ballSpinSpeed: 0.0,       // Ball rotation speed
    
    /** Progressive ability unlocks (gained through gameplay) */
    canBack: false,            // ABILITY_BACK: press down to stop/reverse
    canTurn: false,            // Turning locked until unlocked by ability
    canJump: false,            // ABILITY_JUMP: jump button enabled
    canWallJump: false,        // ABILITY_WALLJUMP: wall jump enabled
    canDash: false,            // ABILITY_DASH: freeze and dash system
    
    /** Dash powerup state management */
    hasDash: false,            // Player owns dash powerup
    dashUsed: false,           // Dash has been consumed this segment
    isFrozen: false,           // Player frozen during dash targeting
    isDashing: false,          // Player currently executing dash
    dashTime: 0.0,             // Dash execution timer
    
    /** Saved state during freeze/dash (for restoration) */
    _savedSpeed: 0.0,          // Speed before freeze
    _savedVy: 0.0,             // Vertical velocity before freeze
    _savedMode: 'stationary',  // Movement mode before freeze
    _resumeVy: 0.0,            // Vertical velocity to restore after dash
  },
  trail: {
    points: [], // array of [x,y,z,bornSec]
    maxPoints: 420,
    minDist: 0.69/2,
    ttl: 0.69, // seconds
  },
  camFollow: { x: 0, y: 0, z: 0 },
  // Bottom camera vertical follow (smoothed)
  bottomCamY: 0.0,              // current eased camera Y target
  bottomCamOffset: 14.4,        // height above player for eye
  bottomCamLagK: 8.0,           // smoothing constant (higher = snappier)
  camYaw: 0.0,
  snapBottomFull: false,
  snapTopFull: false,
  // Alt control lock: when true, use bottom-fullscreen controls without fullscreen
  altBottomControlLocked: false,
  // Camera yaw lock (freeze top camera yaw when true)
  lockCameraYaw: false,
  // Future: forced camera lock mode (shows Camera [Locked])
  lockedCameraForced: false,
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
  // Active editor set for slots (A,B, later C). Press '0' to cycle. Default 'A'.
  blockSet: 'A',
  },
};

/**
 * Updates the current level and recalculates all derived colors and palette values
 * This function ensures visual consistency across the entire game when switching levels
 * @param {number} levelId - Level identifier (1-7, falls back to 1 if invalid)
 */
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
  
  // Derive palette variants from base color for consistent theming
  try {
    const [r,g,b] = state.level.baseColorRGB;
    function clamp01(x){ return Math.min(1, Math.max(0, x)); }
    const wall = [clamp01(r*1.02), clamp01(g*0.54), clamp01(b*0.56)];
    const grid = [clamp01(r*0.85), clamp01(g*0.419), clamp01(b*0.385)];
    state.level.palette.wallRGB = wall;
    state.level.palette.gridRGB = grid;
  } catch(e){ console.warn('Palette derivation failed', e); }
};

/**
 * Parses level name/string into a numeric palette group identifier
 * Handles various naming conventions: 'ROOT'->1, '1A'->1, '2B'->2, '10Shell'->10, etc.
 * @param {string} name - Level name to parse
 * @returns {number} Palette group ID (1-7, defaults to 1)
 */
window.parseLevelGroupId = function(name){
  try {
    if (typeof name !== 'string' || !name.trim()) return 1;
    const s = name.trim();
    if (/^root$/i.test(s)) return 1;
    const m = s.match(/^(\d+)/);
    if (m && m[1]){
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return Math.min(7, n); // clamp to defined palettes
    }
  } catch(_){ }
  return 1;
};

// Color system getter functions for consistent access across modules

/** @returns {string} Current level's base hex color */
window.getLevelBaseColor = function(){ return state.level.baseColor; };

/** @returns {Array<number>} Current level's base RGB color in [0,1] range */
window.getLevelBaseColorRGB = function(){ return state.level.baseColorRGB; };

/** @returns {Array<number>} Current level's wall RGB color in [0,1] range */
window.getLevelWallColorRGB = function(){ return (state.level && state.level.palette && state.level.palette.wallRGB) || [0.06,0.45,0.48]; };

/** @returns {Array<number>} Current level's grid RGB color in [0,1] range */
window.getLevelGridColorRGB = function(){ return (state.level && state.level.palette && state.level.palette.gridRGB) || [0.05,0.35,0.33]; };

/** @returns {boolean} Whether outlines should use level color (vs black) */
window.getLevelOutlineColored = function(){ return !!(state.level && state.level.outlineColored); };

/** @returns {Array<number>} Outline RGB color - either level color or black */
window.getLevelOutlineColorRGB = function(){ return window.getLevelOutlineColored() ? window.getLevelWallColorRGB() : [0,0,0]; };

/** @returns {boolean} Whether background should be tinted with level color */
window.getLevelBackgroundColored = function(){ return !!(state.level && state.level.backgroundColored); };

/**
 * NOCLIMB terrain color system (for special non-climbable surfaces)
 * Provides consistent neutral gray coloring for NOCLIMB blocks that stands out from level palettes
 * @returns {Array<number>} RGB color in [0,1] range for NOCLIMB terrain
 */
window.getLevelNoClimbColorRGB = function(){
  try {
    // Allow level palette override via state.level.palette.noClimbRGB if present
    const c = state?.level?.palette?.noClimbRGB;
    if (Array.isArray(c) && c.length >= 3) return [c[0], c[1], c[2]];
  } catch(_){}
  // Default neutral gray that contrasts with all level palettes
  return [0.3, 0.3, 0.3];
};

/**
 * NOCLIMB terrain outline color (slightly brighter than base for definition)
 * @returns {Array<number>} RGB color in [0,1] range for NOCLIMB terrain outlines
 */
window.getLevelNoClimbOutlineColorRGB = function(){
  try {
    const base = window.getLevelNoClimbColorRGB();
    // Slightly brighten for outlines to provide edge definition
    const r = Math.min(1, base[0] * 1.1);
    const g = Math.min(1, base[1] * 1.1);
    const b = Math.min(1, base[2] * 1.1);
    return [r, g, b];
  } catch(_) {
    return [0.4, 0.4, 0.4];
  }
};

// Initialize level palette immediately for initial level without requiring explicit setLevel call
try { window.setLevel(state.level.id); } catch(_){ }

