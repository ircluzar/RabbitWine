/**
 * Player trail system for tracking movement path.
 * Manages trail point creation, aging, and cleanup based on distance and time thresholds.
 * Exports: updateTrail() function called by the game loop.
 * Dependencies: state.trail, state.player, state.nowSec from state.js. Side effects: Modifies state.trail.points array.
 */

// Trail logic
/**
 * Update trail points based on player movement
 * Removes old points and adds new ones based on distance traveled
 */
function updateTrail(){
  const t = state.trail;
  const p = state.player;
  const nowSec = state.nowSec || (performance.now()/1000);
  
  // Remove expired trail points
  if (t.points.length) {
    let i=0; 
    while (i < t.points.length && (nowSec - t.points[i][3]) > t.ttl) i++;
    if (i>0) t.points.splice(0, i);
  }
  
  // Add new trail point if player moved far enough
  const last = t.points.length ? t.points[t.points.length-1] : null;
  if (!last || Math.hypot(p.x - last[0], p.z - last[2]) > t.minDist) {
    t.points.push([p.x, p.y + 0.25, p.z, nowSec]);
    if (t.points.length > t.maxPoints) {
      t.points.splice(0, t.points.length - t.maxPoints);
    }
  }
}
