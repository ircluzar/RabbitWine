/**
 * LEGACY CONFIGURATION FILE - Content has been moved to other modules
 * Originally contained DOM element lookups, constants, and state - now distributed across:
 * - DOM elements moved to ui/dom.js
 * - Constants moved to core/constants.js  
 * - State moved to core/state.js
 * TODO: Remove this file and update any remaining imports.
 * Dependencies: None. Side effects: May create duplicate global variables.
 */

// VRUN MZ minimal app shell (M0): WebGL2 init, DPR resize, input logger
// NOTE: Content below has been refactored into separate modules

const CANVAS = document.getElementById('app');
const HUD = document.getElementById('hud');
const SEAM = document.getElementById('seam');
const SEAM_HANDLE = document.getElementById('seam-handle');
const GLOW_L = document.getElementById('swipe-glow-left');
const GLOW_R = document.getElementById('swipe-glow-right');
const FILL_TOGGLE = document.getElementById('fill-toggle');

// Config: base internal render target 480x720 portrait (w x h)
const BASE_WIDTH = 480;
const BASE_HEIGHT = 720;

const state = {
  dpr: Math.min( window.devicePixelRatio || 1, 3 ),
  logicalWidth: BASE_WIDTH,
  logicalHeight: BASE_HEIGHT,
  timeStart: performance.now(),
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
  // Player
  player: {
  x: 0, z: 0, y: 0.0,
  vy: 0.0,
  grounded: true,
  wallJumpCooldown: 0.0,
  jumpStartY: 0.0,
    angle: 0, // radians, 0 faces -Z
    speed: 0,
    radius: 0.3,
  },
  trail: {
  points: [], // array of [x,y,z,bornSec]
  maxPoints: 420,
  minDist: 0.69/2,
  ttl: 0.69, // seconds
  },
  camFollow: { x: 0, y: 0, z: 0 },
  camYaw: 0.0,
  // When true, bottom view occupies full height (seam snapped to top)
  snapBottomFull: false,
  // When true, top view occupies full height (seam snapped to bottom)
  snapTopFull: false,
};
