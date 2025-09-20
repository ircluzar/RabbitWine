/**
 * Player movement trail system for visual path tracking and particle effects.
 * Creates a breadcrumb trail that follows the player's movement through 3D space,
 * managing point lifecycle with distance-based sampling and time-based expiration.
 * Used for rendering particle trails, ghost effects, and movement history visualization.
 * 
 * @fileoverview Trail point management with distance sampling and temporal aging
 * @exports updateTrail() - Trail update function called by main game loop  
 * @dependencies state.trail, state.player, state.nowSec - Game state trail configuration and player position
 * @sideEffects Modifies state.trail.points array, adding new points and removing expired ones
 */

// ============================================================================
// Trail Point Management System
// ============================================================================

/**
 * Update trail points based on player movement and manage point lifecycle
 * Maintains a moving window of trail points by:
 * 1. Removing expired points based on time-to-live (TTL)
 * 2. Adding new points when player moves sufficient distance
 * 3. Limiting total points to prevent memory growth
 * 
 * Trail points are stored as [x, y, z, timestamp] arrays for efficient processing
 * Y coordinate is offset slightly above player center for visual separation
 */
function updateTrail(){
  const t = state.trail;      // Trail configuration and point storage
  const p = state.player;     // Current player position and state
  const nowSec = state.nowSec || (performance.now()/1000); // Current time in seconds
  
  // ============================================================================
  // Expired Point Cleanup Phase
  // ============================================================================
  
  // Remove trail points older than configured time-to-live threshold
  if (t.points.length > 0) {
    let expiredCount = 0; 
    
    // Count consecutive expired points from start of array (oldest first)
    while (expiredCount < t.points.length && (nowSec - t.points[expiredCount][3]) > t.ttl) {
      expiredCount++;
    }
    
    // Batch remove all expired points for efficiency
    if (expiredCount > 0) {
      t.points.splice(0, expiredCount);
    }
  }
  
  // ============================================================================
  // New Point Addition Phase  
  // ============================================================================
  
  // Add new trail point only if player has moved sufficient distance
  const lastPoint = t.points.length > 0 ? t.points[t.points.length - 1] : null;
  
  if (!lastPoint || Math.hypot(p.x - lastPoint[0], p.z - lastPoint[2]) > t.minDist) {
    // Create new point: [x, y + offset, z, timestamp]
    // Y offset (0.25) positions trail slightly above player center for visibility
    const newPoint = [p.x, p.y + 0.25, p.z, nowSec];
    t.points.push(newPoint);
    
    // ============================================================================
    // Point Count Limiting Phase
    // ============================================================================
    
    // Enforce maximum point limit to prevent unbounded memory growth
    if (t.points.length > t.maxPoints) {
      const excess = t.points.length - t.maxPoints;
      t.points.splice(0, excess); // Remove oldest points to maintain limit
    }
  }
}

// ============================================================================
// Global Export for Game Loop Integration
// ============================================================================

/**
 * Export trail update function to global scope for access by game loop
 * Required for integration with step-loop.js calling pattern
 */
window.updateTrail = updateTrail;
