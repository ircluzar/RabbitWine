/**
 * Core tile-based map data structure and sample level generation system.
 * Defines the primary game world grid with comprehensive tile types for walls, hazards,
 * interactive elements, and special mechanics. Provides map indexing utilities and 
 * a complete sample map builder that demonstrates all major gameplay features.
 * 
 * Key Features:
 * - Comprehensive tile type system supporting walls, hazards, fences, triggers
 * - 24x24 grid-based world structure with efficient array storage
 * - Sample map demonstrating vertical platforming, ability gates, and item placement
 * - Integration with 3D column system for multi-level geometry
 * - Player spawn point and item initialization system
 * - Level switching support for multiplayer environments
 * 
 * @fileoverview Core map data structures and sample level generation
 * @exports TILE enum - All tile type constants for map construction
 * @exports MAP_W, MAP_H - World grid dimensions (24x24)
 * @exports map array - Primary tile storage (Uint8Array)
 * @exports mapIdx() - 2D to 1D coordinate conversion utility
 * @exports buildSampleMap() - Complete sample level generator function
 * @dependencies MapBuilder class, column system integration, item system integration
 * @sideEffects Initializes global map array, applies height data, sets player spawn, places items
 */

// ============================================================================
// Core Tile Type System and World Dimensions
// ============================================================================

/**
 * Comprehensive tile type enumeration for all map elements and gameplay mechanics
 * Each tile type represents different collision, visual, and interactive behaviors
 */
const TILE = { 
  OPEN: 0,        // Walkable open space (default ground terrain)
  WALL: 1,        // Solid wall blocks (standard collision geometry)
  FILL: 2,        // Solid fill blocks (platforms and elevated terrain)
  REMOVE: 3,      // Carved space markers (holes and gaps in structures)
  BAD: 4,         // Hazardous tiles (damage player on contact, render red)
  HALF: 5,        // Half-height blocks (0.5 unit tall, step-up platforms)
  FENCE: 6,       // Connectable fence posts with rails (climbable, brightened)
  BADFENCE: 7,    // Hazardous fences (damage on rail contact, render red)
  LEVELCHANGE: 8, // Non-solid level transition triggers (teleport zones)
  NOCLIMB: 9      // Solid walls that prevent climbing mechanics
};

/** World grid width in tiles (creates 24x24 game area) */
const MAP_W = 24;
/** World grid height in tiles (creates 24x24 game area) */
const MAP_H = 24;

/** Primary tile storage array - each byte represents one tile type */
const map = new Uint8Array(MAP_W * MAP_H);

/**
 * Convert 2D grid coordinates to linear array index for efficient map access
 * Essential utility for all map operations and collision detection systems
 * @param {number} x - Grid X coordinate (0 to MAP_W-1, left to right)
 * @param {number} y - Grid Y coordinate (0 to MAP_H-1, top to bottom)
 * @returns {number} Linear array index for direct map array access
 */
function mapIdx(x,y){ 
  return y*MAP_W + x; 
}

// ============================================================================
// Global Export Integration for Cross-System Access
// ============================================================================

/**
 * Export core map data structures to global scope for universal access
 * Enables physics, rendering, collision, and gameplay systems to share map state
 */
try {
  if (typeof window !== 'undefined'){
    window.TILE = TILE;        // Tile type constants
    window.MAP_W = MAP_W;      // World width
    window.MAP_H = MAP_H;      // World height  
    window.map = map;          // Primary tile data
    window.mapIdx = mapIdx;    // Coordinate conversion utility
  }
} catch(_){}

// ============================================================================
// Sample Map Generation and Level Design Showcase
// ============================================================================

/**
 * Generate comprehensive sample map demonstrating all major gameplay systems
 * Creates a structured test level featuring:
 * - Perimeter containment walls and interior room layouts
 * - Multi-level vertical platforming with variable column heights  
 * - Strategic pillar placement for wall-jumping and navigation
 * - Ability-gated progression requiring specific movement skills
 * - Item placement system with spawn point configuration
 * - Integration with 3D column geometry and physics systems
 * 
 * Map Structure:
 * - Total dimensions: 24x24 tiles
 * - Central room: 12x12 area (coordinates 6,6 to 17,17)  
 * - Height variation: Ground to 23 units elevation
 * - Spawn point: Southwest area (3,12) facing south
 * - Sky platform: High-altitude rest area at elevation 21
 */
function buildSampleMap(){
  // ========================================================================
  // MapBuilder Initialization and Base Terrain
  // ========================================================================
  
  const builder = new MapBuilder(MAP_W, MAP_H, map, TILE);
  
  // Establish foundation: fill entire grid with walkable open terrain
  builder.clear(TILE.OPEN);

  // ========================================================================
  // Core Level Architecture and Room Structure  
  // ========================================================================
  
  // Create impermeable outer boundary for player containment
  builder.border(TILE.WALL, 1.0); 
  
  // Central fortress: large rectangular room with tall walls (5 units high)
  builder.rect(6, 6, 17, 17, TILE.WALL, 5.0); 
  
  // Auxiliary structures: entrance areas and corner fill
  builder.rect(6, 1, 6, 5, TILE.WALL, 1.0);      // Northern entrance bump
  builder.rect(17, 17, 24, 24, TILE.FILL, 1.0);  // Southeast corner fill
  
  // Strategic entrance: doorway gap in central wall for access
  builder.rect(11, 6, 12, 6, TILE.REMOVE, 2.0);  // 2-wide entrance opening

  // ========================================================================
  // Vertical Platforming Elements with Progressive Difficulty
  // ========================================================================
  
  // Training pillars: height progression for wall-jumping skill development
  builder.pillars([10, 10], TILE.WALL, 1.0); // Northwest: ground level reference
  builder.pillars([13, 10], TILE.WALL, 2.0); // Northeast: basic elevation  
  builder.pillars([10, 13], TILE.WALL, 3.0); // Southwest: medium challenge
  builder.pillars([13, 13], TILE.WALL, 4.0); // Southeast: advanced height
  
  // ========================================================================
  // Advanced Vertical Architecture - Sky Platform System
  // ========================================================================
  // builder.rect(5, 12, 5, 12, TILE.FILL, 1.0, { y: 2 });
  // builder.rect(6, 12, 6, 12, TILE.FILL, 1.0, { y: 3 });
  // builder.rect(6, 11, 6, 11, TILE.FILL, 1.0, { y: 4 });
  // builder.rect(7, 11, 7, 11, TILE.FILL, 1.0, { y: 5 });
  // builder.rect(8, 11, 8, 11, TILE.FILL, 1.0, { y: 6 });
  // // Overhead walkway
  //builder.rect(8, 10, 10, 10, TILE.FILL, 1.0, { y: 7 });
  // // Supports for wall-jumping
  //builder.pillars([[4,11],[5,11]], TILE.WALL, 3.0);
  //builder.pillars([[6,10]], TILE.WALL, 4.0);

  // Extremely tall climb with rest platforms (Minecraft-style inspiration)
  // Segment A: vertical ascent north from spawn column (x≈5, yGrid decreasing)
  //  for (let lvl=3; lvl<=10; lvl++){
  //    const gy = 12 - lvl; // 11..2
  //    builder.rect(5, gy, 5, gy, TILE.FILL, 1.0, { y: lvl });
  //    if (lvl === 6){
  //      // Rest area (3x3) at this height centered near (5,6)
  //      builder.rect(4, 5, 6, 7, TILE.FILL, 1.0, { y: lvl });
  //    }
  //  }
  // Segment B: traverse east along row yGrid=2
  //  for (let lvl=11; lvl<=20; lvl++){
  //    const gx = 5 + (lvl - 10); // 6..15
  //    const gy = 2;
  //    builder.rect(gx, gy, gx, gy, TILE.FILL, 1.0, { y: lvl });
  //    if (lvl === 12) builder.rect(7, 1, 9, 3, TILE.FILL, 1.0, { y: lvl }); // rest pad
  //    if (lvl === 16) builder.rect(11, 1, 13, 3, TILE.FILL, 1.0, { y: lvl }); // rest pad
  //  }
  // Segment C: sky platform as a large rest area at high altitude
  
  // High-altitude sky platform: ultimate challenge reward area at elevation 21
  builder.rect(12, 2, 16, 6, TILE.FILL, 1.0, { y: 21 });
  
  // Architectural supports: corner pillars for visual interest and stability
  builder.pillars([[12,2],[16,2],[12,6],[16,6]], TILE.WALL, 3.0, { y: 21 });

  // ========================================================================
  // Gameplay Progression System - Spawn and Ability Items
  // ========================================================================
  
  // Player spawn: safe starting area in southwest with southern facing
  builder.spawn(3, 12, 'S');
  
  // Strategic ability placement for gated progression design:
  builder.item(3, 19, 'ABILITY_BACK');      // Basic backward movement
  builder.item(3, 3, 'ABILITY_MOVE');       // Forward movement unlock  
  builder.item(14, 20, 'ABILITY_JUMP');     // Vertical movement capability
  builder.item(12, 10, 'ABILITY_WALLJUMP'); // Advanced wall interaction
  builder.item(14, 4, 'ABILITY_DASH', { y: 23 }); // High-skill dash at extreme elevation

  // ========================================================================
  // World Integration and System Activation
  // ========================================================================
  
  // Export 3D geometry data to column registry system
  const heightData = builder.getHeightData();
  if (typeof applyHeightData === 'function') {
    applyHeightData(heightData, true);
  } else if (typeof window !== 'undefined') {
    window._pendingMapHeights = heightData;
  }
  
  // Refresh rendering instances to reflect geometry changes
  if (typeof rebuildInstances === 'function') rebuildInstances();

  // Apply spawn point to player state for game initialization
  const spawnData = builder.getSpawn && builder.getSpawn();
  if (spawnData && typeof state !== 'undefined' && state.player){
    // Convert grid coordinates to world space (centered at map origin)
    state.player.x = (spawnData.x + 0.5) - MAP_W * 0.5;
    state.player.z = (spawnData.y + 0.5) - MAP_H * 0.5;
    state.player.angle = spawnData.angle || 0.0; // 0 radians faces -Z direction
    // Y coordinate handled by physics system on first frame
  }

  // Initialize item collection system with placed items
  const itemList = builder.getItems && builder.getItems();
  if (itemList && itemList.length){
    if (typeof initItemsFromBuilder === 'function') initItemsFromBuilder(itemList);
    else if (typeof window !== 'undefined') window._pendingItems = itemList;
  }
}

// ============================================================================
// Conditional Map Initialization and Global Export
// ============================================================================

/**
 * ROOT baseline ability items (grid coordinates + payload + optional elevation)
 * Centralized so both the original sample map builder and any late authoritative
 * empty snapshots (offline JSON or network items_full) can re-seed them.
 * NOTE: Keep in sync with the builder.item calls inside buildSampleMap().
 */
const __ROOT_BASELINE_ITEMS = [
  { gx:3,  gy:19, y:0.75, payload:'ABILITY_BACK' },
  { gx:3,  gy:3,  y:0.75, payload:'ABILITY_MOVE' },
  { gx:14, gy:20, y:0.75, payload:'ABILITY_JUMP' },
  { gx:12, gy:10, y:0.75, payload:'ABILITY_WALLJUMP' },
  { gx:14, gy:4,  y:23.00, payload:'ABILITY_DASH' }
];

/**
 * Spawn baseline ability items for ROOT if the current active item list is empty.
 * Invoked only after the item system is loaded (spawnItemWorld present) and we
 * detect an empty authoritative snapshot for ROOT. This prevents an empty
 * offline JSON (or server snapshot) from wiping tutorial progression.
 */
function spawnRootBaselineItemsIfEmpty(){
  try {
    if (typeof window === 'undefined') return;
    if (typeof MP_LEVEL === 'string' && MP_LEVEL !== 'ROOT') return; // only for ROOT
    // Prefer global fallback if MP_LEVEL not yet defined
    if (typeof MP_LEVEL !== 'string' && typeof window.MP_LEVEL === 'string' && window.MP_LEVEL !== 'ROOT') return;
    // Require item query helpers to judge emptiness (fallback to length check later)
    let existing = 0;
    try { if (typeof window.listActiveItems === 'function') existing = window.listActiveItems().length|0; } catch(_){ }
    if (existing > 0) return; // already have items (authoritative snapshot had some)
    if (typeof window.spawnItemWorld !== 'function') return; // item system not ready
    const W = (typeof MAP_W === 'number') ? MAP_W : (window.MAP_W||24);
    const H = (typeof MAP_H === 'number') ? MAP_H : (window.MAP_H||24);
    for (const it of __ROOT_BASELINE_ITEMS){
      if (!it) continue;
      const x = (it.gx + 0.5) - W * 0.5;
      const z = (it.gy + 0.5) - H * 0.5;
      const y = (typeof it.y === 'number') ? it.y : 0.75;
      try { window.spawnItemWorld(x, y, z, it.payload || '', { ghost:false }); } catch(_){ }
    }
    try { console.info('[ROOT][baseline-items] Injected baseline ability items (authoritative snapshot empty)'); } catch(_){ }
  } catch(_){ }
}

try { if (typeof window !== 'undefined') window.spawnRootBaselineItemsIfEmpty = spawnRootBaselineItemsIfEmpty; } catch(_){ }

/**
 * Auto-build sample map for ROOT level, preserve blank state for multiplayer levels
 * Allows level-specific initialization while maintaining consistent map structure
 */
try {
  const currentLevel = (typeof window !== 'undefined' && typeof window.MP_LEVEL === 'string') ? window.MP_LEVEL : 'ROOT';
  if (currentLevel === 'ROOT') buildSampleMap();
} catch(_){ 
  buildSampleMap(); // Fallback to sample map on any initialization error
}

/**
 * Export map builder function for runtime level switching and dynamic content
 */
try { 
  if (typeof window !== 'undefined') window.buildSampleMap = buildSampleMap; 
} catch(_){ }
