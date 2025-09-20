/**
 * Instance data management system for efficient map tile rendering using WebGL instancing.
 * Generates and maintains optimized instance buffer arrays by categorizing tiles into
 * rendering groups (open, wall, hazard) for maximum GPU performance. Automatically
 * rebuilds instance data when map layout changes occur during gameplay or editing.
 * 
 * Key Features:
 * - Instanced rendering optimization for thousands of tiles
 * - Tile type categorization for specialized rendering pipelines
 * - Dynamic instance buffer rebuilding for map changes
 * - Memory-efficient Float32Array storage for GPU upload
 * - Integration with tile-based collision and visual systems
 * 
 * @fileoverview Optimized instance data generation for tile-based rendering
 * @exports instOpen, instWall, instBad - Categorized instance position arrays
 * @exports rebuildInstances() - Instance buffer regeneration function
 * @dependencies MAP_W, MAP_H, TILE, map, mapIdx - Core map data structures from map-data.js
 * @sideEffects Allocates GPU-optimized Float32Array buffers, rebuilds on map changes
 */

// ============================================================================
// Instance Buffer Storage for Categorized Tile Rendering
// ============================================================================

/** 
 * Open tile instance positions for floor/ground rendering pipeline
 * @type {Float32Array} Interleaved [x,y] coordinate pairs for walkable tiles
 */
let instOpen = new Float32Array(0);

/** 
 * Wall tile instance positions for solid geometry rendering pipeline  
 * @type {Float32Array} Interleaved [x,y] coordinate pairs for solid/blocking tiles
 */
let instWall = new Float32Array(0);

/** 
 * Hazard tile instance positions for danger/damage rendering pipeline
 * @type {Float32Array} Interleaved [x,y] coordinate pairs for damaging tiles
 */
let instBad = new Float32Array(0);

// ============================================================================
// Instance Buffer Generation and Optimization System
// ============================================================================

/**
 * Rebuild instance data arrays from current map state for optimal GPU rendering
 * Categorizes all map tiles into appropriate rendering pipelines based on tile type,
 * generates efficient instance position buffers, and updates GPU-ready data structures.
 * Called automatically on map initialization and manually on map changes.
 * 
 * Performance Optimizations:
 * - Single-pass tile scanning minimizes map traversal overhead
 * - Categorized instance arrays enable specialized shader pipelines  
 * - Float32Array buffers optimize GPU memory transfer
 * - Coordinate interleaving matches vertex attribute expectations
 */
function rebuildInstances(){
  // Temporary storage arrays for tile position collection
  const openPositions = [];   // Walkable/open tile coordinates
  const wallPositions = [];   // Solid/blocking tile coordinates  
  const hazardPositions = []; // Dangerous/damaging tile coordinates
  
  // Single-pass map scan with tile categorization
  for(let y = 0; y < MAP_H; y++){
    for(let x = 0; x < MAP_W; x++){
      const tileType = map[mapIdx(x,y)];
      
      // Determine tile category based on type and collision properties
      const isSolidTile = (tileType === TILE.WALL) || 
                         (tileType === TILE.FILL) || 
                         (tileType === TILE.BAD) || 
                         (tileType === TILE.HALF) || 
                         (tileType === TILE.FENCE) || 
                         (tileType === TILE.BADFENCE) || 
                         (tileType === TILE.LEVELCHANGE) || 
                         (tileType === TILE.NOCLIMB);
      
      // Special hazard category for damage-dealing tiles
      if (tileType === TILE.BAD) {
        hazardPositions.push(x, y);
      }
      
      // Primary categorization: solid vs open tiles
      if (isSolidTile) {
        wallPositions.push(x, y); 
      } else {
        openPositions.push(x, y);
      }
    }
  }
  
  // Convert position arrays to GPU-optimized Float32Array buffers
  instOpen = new Float32Array(openPositions);   // Open tile instances
  instWall = new Float32Array(wallPositions);   // Wall tile instances  
  instBad = new Float32Array(hazardPositions);  // Hazard tile instances
}

// ============================================================================
// System Initialization and Global Integration
// ============================================================================

/**
 * Initialize instance data on module load for immediate rendering readiness
 * Ensures instance buffers are populated before first render call
 */
rebuildInstances();

/**
 * Export instance system to global scope for cross-module access
 * Enables rendering, editing, and save systems to access optimized instance data
 */
if (typeof window !== 'undefined'){
  window.rebuildInstances = rebuildInstances;  // Instance regeneration function
  window.instBad = instBad;                    // Hazard tile instance data
}
