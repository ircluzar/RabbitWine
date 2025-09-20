/**
 * Centralized DOM element reference cache for UI components.
 *
 * Purpose:
 *  - Avoid repeated document.getElementById lookups across disparate scripts.
 *  - Provide a single place to augment / rename element IDs.
 *  - Expose references on window for the legacy non-module environment and debugging.
 *
 * Exported Globals (window):
 *  - CANVAS, HUD, SEAM, SEAM_HANDLE
 *  - GLOW_L, GLOW_R (swipe feedback assets)
 *  - DEBUG_TOGGLE, ALT_LOCK_BTN, CAMERA_STATUS
 *  - SETTINGS_BTN (settings modal launcher)
 *  - STATS_* (stats HUD elements: materials, purple, rooms)
 *
 * Accessibility Notes:
 *  - Interactive elements referenced here should own appropriate aria-* attributes in their markup / runtime scripts.
 *  - Scripts manipulating visibility should prefer aria-hidden + data-hidden for styling hooks.
 *
 * Side Effects:
 *  - Performs DOM queries at load time; acceptable because page structure is static post-initialization.
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
const STATS_BOX = document.getElementById('stats-box');
const STATS_MATERIALS = document.getElementById('stats-materials');
const STATS_PURPLE = document.getElementById('stats-purple');
const STATS_ROOMS = document.getElementById('stats-rooms');

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
		window.STATS_BOX = STATS_BOX;
		window.STATS_MATERIALS = STATS_MATERIALS;
		window.STATS_PURPLE = STATS_PURPLE;
		window.STATS_ROOMS = STATS_ROOMS;
}
