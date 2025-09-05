/**
 * DOM element references for the MZ game UI.
 * Provides cached DOM element lookups for game canvas, HUD, and UI controls.
 * Exports: CANVAS, HUD, SEAM, SEAM_HANDLE, GLOW_L, GLOW_R, FILL_TOGGLE constants.
 * Dependencies: None. Side effects: Queries DOM elements by ID at module load time.
 */

// DOM element lookups (moved from config.js)
const CANVAS = document.getElementById('app');
const HUD = document.getElementById('hud');
const SEAM = document.getElementById('seam');
const SEAM_HANDLE = document.getElementById('seam-handle');
const GLOW_L = document.getElementById('swipe-glow-left');
const GLOW_R = document.getElementById('swipe-glow-right');
const FILL_TOGGLE = document.getElementById('fill-toggle');
