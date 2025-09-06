"use strict";
/**
 * Action Distributor: simple string->fn registry for item payloads and other triggers.
 * Public API:
 *  - dispatchAction(key: string, ...args): looks up anonymous fn by key and invokes it
 *  - registerAction(key: string, fn: Function): register/override an action
 *
 * Default registrations unlock player abilities from item payloads defined in the sample map.
 */

// Internal registry (array used as string-keyed map per requirement)
const _actionRegistry = [];

function registerAction(key, fn){
  if (!key || typeof fn !== 'function') return;
  _actionRegistry[String(key)] = fn;
}

function dispatchAction(key, ...args){
  const fn = _actionRegistry && _actionRegistry[String(key)];
  if (typeof fn === 'function') {
    try { fn(...args); } catch (e) { console && console.error && console.error('Action error', key, e); }
  }
}

// Default ability unlockers (anonymous functions)
registerAction('ABILITY_MOVE', function(){
  if (!state || !state.player) return;
  state.player.canTurn = true;
  if (typeof showTopNotification === 'function') showTopNotification('Wandering around', { body: 'You can now change direction.' });
});

registerAction('ABILITY_BACK', function(){
  if (!state || !state.player) return;
  state.player.canBack = true;
  if (typeof showTopNotification === 'function') showTopNotification('You can go back', { body: 'Go down to stop or flip.' });
});

registerAction('ABILITY_JUMP', function(){
  if (!state || !state.player) return;
  state.player.canJump = true;
  if (typeof showTopNotification === 'function') showTopNotification('Verticality', { body: 'You can press the action button to jump.' });
});

registerAction('ABILITY_WALLJUMP', function(){
  if (!state || !state.player) return;
  state.player.canWallJump = true;
  if (typeof showTopNotification === 'function') showTopNotification('Jumping Off Walls', { body: 'You will now automatically jump when hitting a wall during ascent.' });
});

registerAction('ABILITY_DASH', function(){
  if (!state || !state.player) return;
  state.player.hasDash = true;
  state.player.canDash = true;
  if (typeof showTopNotification === 'function') showTopNotification('Horizontality', { body: 'Freeze midair, then dash in a direction.' });
});

// Expose
if (typeof window !== 'undefined'){
  window.dispatchAction = dispatchAction;
  window.registerAction = registerAction;
}
