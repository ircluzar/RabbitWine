/**
 * Core constants for the MZ game engine.
 * Defines base rendering dimensions and other fundamental values used throughout the application.
 * These constants determine the internal rendering resolution and are used by the viewport system
 * to maintain consistent aspect ratios across different screen sizes.
 * 
 * @fileoverview Base rendering constants
 * @exports BASE_WIDTH, BASE_HEIGHT - Core rendering dimensions
 * @dependencies None
 * @sideEffects None
 */

/**
 * Base rendering width in pixels for internal offscreen buffer
 * This is the logical rendering width before scaling to actual display size
 * @const {number}
 */
const BASE_WIDTH = 480;

/**
 * Base rendering height in pixels for internal offscreen buffer  
 * This is the logical rendering height before scaling to actual display size
 * @const {number}
 */
const BASE_HEIGHT = 720;
