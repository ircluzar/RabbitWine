"use strict";
/**
 * Action Distributor: Event-driven ability unlocking and item payload processing system.
 * Provides a simple string-to-function registry for triggering gameplay events, primarily
 * used by the item collection system to unlock progressive player abilities throughout the game.
 * 
 * The action system enables data-driven ability progression where map designers can place
 * items with specific payload strings that unlock corresponding player capabilities.
 * 
 * @fileoverview Action dispatch system for ability unlocking and event handling
 * @exports dispatchAction() - Executes registered action by key
 * @exports registerAction() - Registers new action handlers
 * @dependencies state.player for ability flags, showTopNotification() for user feedback
 * @sideEffects Modifies global state.player ability flags, displays notifications
 */

/**
 * Internal registry storing action key to function mappings
 * Uses array as object for string-keyed storage per original design requirements
 * @type {Array<Function>}
 */
const _actionRegistry = [];

/**
 * Registers an action handler function with a specific key
 * Allows overriding existing actions for customization or debugging
 * 
 * @param {string} key - Unique identifier for the action (e.g., 'ABILITY_JUMP')
 * @param {Function} fn - Handler function to execute when action is dispatched
 */
function registerAction(key, fn){
  if (!key || typeof fn !== 'function') return;
  _actionRegistry[String(key)] = fn;
}

/**
 * Dispatches an action by key with optional arguments
 * Safely handles missing actions and function execution errors
 * 
 * @param {string} key - Action identifier to look up and execute
 * @param {...any} args - Arguments to pass to the action handler
 */
function dispatchAction(key, ...args){
  const fn = _actionRegistry && _actionRegistry[String(key)];
  if (typeof fn === 'function') {
    try { fn(...args); } catch (e) { console && console.error && console.error('Action error', key, e); }
  }
}

// ============================================================================
// Default Ability Unlock Actions
// ============================================================================
// These actions are triggered by item collection to progressively unlock
// player abilities throughout the game progression.

/**
 * ABILITY_MOVE: Unlocks directional movement controls
 * Enables the player to change direction during movement
 */
registerAction('ABILITY_MOVE', function(){
  if (!state || !state.player) return;
  state.player.canTurn = true;
  if (typeof showTopNotification === 'function') showTopNotification('Wandering around', { body: 'You can now change direction.' });
});

/**
 * ABILITY_BACK: Unlocks reverse movement capability
 * Allows player to stop or reverse direction using down input
 */
registerAction('ABILITY_BACK', function(){
  if (!state || !state.player) return;
  state.player.canBack = true;
  if (typeof showTopNotification === 'function') showTopNotification('You can go back', { body: 'Go down to stop or flip.' });
});

/**
 * ABILITY_JUMP: Unlocks basic jump mechanics
 * Enables vertical movement via action button press
 */
registerAction('ABILITY_JUMP', function(){
  if (!state || !state.player) return;
  state.player.canJump = true;
  if (typeof showTopNotification === 'function') showTopNotification('Verticality', { body: 'You can press the action button to jump.' });
});

/**
 * ABILITY_WALLJUMP: Unlocks wall-assisted jumping
 * Enables automatic jumping when hitting walls during upward movement
 */
registerAction('ABILITY_WALLJUMP', function(){
  if (!state || !state.player) return;
  state.player.canWallJump = true;
  if (typeof showTopNotification === 'function') showTopNotification('Jumping Off Walls', { body: 'You will now automatically jump when hitting a wall during ascent.' });
});

/**
 * ABILITY_DASH: Unlocks freeze-and-dash mechanics
 * Enables midair freezing and directional dashing for advanced movement
 */
registerAction('ABILITY_DASH', function(){
  if (!state || !state.player) return;
  state.player.hasDash = true;
  state.player.canDash = true;
  if (typeof showTopNotification === 'function') showTopNotification('Horizontality', { body: 'Freeze midair, then dash in a direction.' });
});

// ============================================================================
// Global Exports
// ============================================================================

/**
 * Export action system functions to global scope for cross-module access
 * Enables item system and other modules to dispatch and register actions
 */
if (typeof window !== 'undefined'){
  window.dispatchAction = dispatchAction;
  window.registerAction = registerAction;
}
