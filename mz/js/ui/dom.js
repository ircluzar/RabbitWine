/**
 * DOM element references for the MZ game UI.
 * Provides cached DOM element lookups for game canvas, HUD, and UI controls.
 * Exports: CANVAS, HUD, SEAM, SEAM_HANDLE, GLOW_L, GLOW_R, DEBUG_TOGGLE constants.
 * Dependencies: None. Side effects: Queries DOM elements by ID at module load time.
 */

// DOM element lookups (moved from config.js)
const CANVAS = document.getElementById('app');
const HUD = document.getElementById('hud');
const SEAM = document.getElementById('seam');
const SEAM_HANDLE = document.getElementById('seam-handle');
const GLOW_L = document.getElementById('swipe-glow-left');
const GLOW_R = document.getElementById('swipe-glow-right');
const DEBUG_TOGGLE = document.getElementById('debug-toggle');
const ALT_LOCK_BTN = document.getElementById('alt-control-lock');
const CAMERA_STATUS = document.getElementById('camera-status');
const SETTINGS_BTN = document.getElementById('settings-button');

// Expose references globally (for simpler interop and debugging)
if (typeof window !== 'undefined'){
	window.CANVAS = CANVAS;
	window.HUD = HUD;
	window.SEAM = SEAM;
	window.SEAM_HANDLE = SEAM_HANDLE;
	window.GLOW_L = GLOW_L;
	window.GLOW_R = GLOW_R;
	window.DEBUG_TOGGLE = DEBUG_TOGGLE;
		window.ALT_LOCK_BTN = ALT_LOCK_BTN;
		window.CAMERA_STATUS = CAMERA_STATUS;
		window.SETTINGS_BTN = SETTINGS_BTN;
}
