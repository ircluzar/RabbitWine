/**
 * @fileoverview Configuration module for MZ project
 * @description Provides centralized configuration for DOM elements, constants, and application state.
 * This module contains DOM element references, base dimensions, and the main application state object.
 * 
 * @author MZ Team
 * @version 1.0.0
 * 
 * @requires None
 * @exports {HTMLElement} CANVAS - Main application canvas element
 * @exports {HTMLElement} HUD - Heads-up display container
 * @exports {HTMLElement} SEAM - Seam UI element
 * @exports {Object} state - Main application state object
 */

// DOM Element References
/** @type {HTMLCanvasElement} Main application canvas element */
const CANVAS = document.getElementById('app');

/** @type {HTMLElement} Heads-up display container element */
const HUD = document.getElementById('hud');

/** @type {HTMLElement} Seam UI element for split-screen functionality */
const SEAM = document.getElementById('seam');

/** @type {HTMLElement} Seam handle for user interaction */
const SEAM_HANDLE = document.getElementById('seam-handle');

/** @type {HTMLElement} Left swipe glow effect element */
const GLOW_L = document.getElementById('swipe-glow-left');

/** @type {HTMLElement} Right swipe glow effect element */
const GLOW_R = document.getElementById('swipe-glow-right');

/** @type {HTMLElement} Fill toggle button element */
const FILL_TOGGLE = document.getElementById('fill-toggle');

// Application Constants
/** @const {number} Base internal render target width in pixels */
const BASE_WIDTH = 480;

/** @const {number} Base internal render target height in pixels (portrait orientation) */
const BASE_HEIGHT = 720;

/**
 * @typedef {Object} ApplicationState
 * @property {number} dpr - Device pixel ratio (clamped to max 3)
 * @property {number} logicalWidth - Logical render width
 * @property {number} logicalHeight - Logical render height
 * @property {number} timeStart - Application start timestamp
 * @property {Object} inputs - Input state tracking
 * @property {number} seamRatio - Seam position ratio (0-1)
 * @property {number} fps - Current frames per second
 * @property {Object} player - Player state and properties
 * @property {Object} trail - Movement trail configuration
 * @property {Object} camFollow - Camera follow target position
 * @property {number} camYaw - Camera yaw rotation
 * @property {boolean} snapBottomFull - Bottom view full height mode
 * @property {boolean} snapTopFull - Top view full height mode
 */

/**
 * Main application state object
 * Contains all runtime state for the MZ application including player data,
 * camera settings, input tracking, and render configuration.
 * @type {ApplicationState}
 */

const state = {
  /** Device pixel ratio, clamped to maximum of 3 for performance */
  dpr: Math.min( window.devicePixelRatio || 1, 3 ),
  
  /** Logical rendering width in pixels */
  logicalWidth: BASE_WIDTH,
  
  /** Logical rendering height in pixels */
  logicalHeight: BASE_HEIGHT,
  
  /** Application start time in milliseconds */
  timeStart: performance.now(),
  
  /** Input state tracking for pointers, keys, and gamepads */
  inputs: {
    /** Map of active pointer inputs: id -> {x,y,dx,dy,startX,startY,lastT} */
    pointers: new Map(),
    /** Set of currently pressed keys */
    keys: new Set(),
    /** Array of connected gamepad states */
    gamepads: [],
  },
  
  /** Seam position ratio (0..1) representing vertical position of split-screen divider */
  seamRatio: 0.5,
  
  /** Current frames per second */
  fps: 0,
  
  /** Frame counter for FPS calculation */
  frames: 0,
  
  /** Last FPS calculation timestamp */
  lastFpsT: performance.now(),
  
  /** Letterbox CSS positioning for responsive scaling */
  letterboxCss: { x: 0, y: 0, w: 0, h: 0 },
  
  /** Previous frame timestamp for delta time calculation */
  timePrev: performance.now(),
  
  /** Viewport fill mode: true = scale to fit, false = 1x native centered */
  fillViewport: true,
  
  /** Player character state and properties */
  player: {
    /** Player X coordinate in world space */
    x: 0,
    /** Player Z coordinate in world space */
    z: 0,
    /** Player Y coordinate (height) in world space */
    y: 0.0,
    /** Vertical velocity for jump/fall physics */
    vy: 0.0,
    /** Whether player is currently touching ground */
    grounded: true,
    /** Wall jump cooldown timer in seconds */
    wallJumpCooldown: 0.0,
    /** Y coordinate when jump was initiated */
    jumpStartY: 0.0,
    /** Player facing angle in radians (0 faces -Z direction) */
    angle: 0,
    /** Current movement speed */
    speed: 0,
    /** Player collision radius */
    radius: 0.3,
  },
  
  /** Movement trail visualization configuration */
  trail: {
    /** Array of trail points: [x,y,z,bornSec] */
    points: [],
    /** Maximum number of trail points to maintain */
    maxPoints: 420,
    /** Minimum distance between trail points */
    minDist: 0.69/2,
    /** Trail point time-to-live in seconds */
    ttl: 0.69,
  },
  
  /** Camera follow target position */
  camFollow: { x: 0, y: 0, z: 0 },
  
  /** Camera yaw rotation in radians */
  camYaw: 0.0,
  
  /** Bottom view occupies full height when true (seam at top) */
  snapBottomFull: false,
  
  /** Top view occupies full height when true (seam at bottom) */
  snapTopFull: false,
};
