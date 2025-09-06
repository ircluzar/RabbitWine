/**
 * Tilemap data structure and sample map generation.
 * Defines the game world grid with walls and open spaces, provides map indexing utilities.
 * Exports: TILE enum, MAP_W, MAP_H constants, map array, mapIdx(), buildSampleMap() functions.
 * Dependencies: None. Side effects: Initializes global map array when buildSampleMap() is called.
 */

// Tilemap representation (moved from scene.js)
const TILE = { OPEN: 0, WALL: 1, FILL: 2, REMOVE: 3 };
const MAP_W = 24, MAP_H = 24;
const map = new Uint8Array(MAP_W * MAP_H);

/**
 * Convert 2D map coordinates to 1D array index
 * @param {number} x - Grid X coordinate (0 to MAP_W-1)
 * @param {number} y - Grid Y coordinate (0 to MAP_H-1)
 * @returns {number} Array index for the map data
 */
function mapIdx(x,y){ return y*MAP_W + x; }

/**
 * Generate a sample map with border walls and interior rooms.
 * Creates a structured dungeon-like layout with:
 * - Outer perimeter walls (boundary containment)
 * - Central rectangular room outline
 * - Four decorative pillar obstacles within the room
 * 
 * Layout dimensions: 24x24 grid
 * Interior room: 12x12 area (coordinates 6,6 to 17,17)
 * Pillar positions: Symmetrical 2x2 pattern within room center
 */
function buildSampleMap(){
  // Initialize MapBuilder instance for structured map construction
  // Targets: 24x24 grid, writes to global 'map' Uint8Array, uses TILE enum
  const builder = new MapBuilder(MAP_W, MAP_H, map, TILE);

  // Establish base terrain - Fill entire grid with open walkable space
  builder.clear(TILE.OPEN);

  // Create outer boundary walls for map containment
  builder.border(TILE.WALL);

  // Step 3: Interior room structure - Rectangular outline in center area with elevated height
  // Coordinates: Top-left (6,6) to bottom-right (17,17)
  // Dimensions: 12x12 outer boundary, creating 10x10 interior space
  // Height: 10.0 units (significantly taller than standard 1.0 wall height)
  // Purpose: Defines a contained room within the larger map area with imposing tall walls
  // Wall pattern: Hollow rectangle (outline only, interior remains open)
  builder.rect(6, 6, 17, 17, TILE.WALL, 5.0);

  builder.rect(6, 1, 6, 5, TILE.WALL, 1.0);
  builder.rect(17, 17, 24,24, TILE.FILL, 1.0);

  builder.rect(11, 6, 12,6, TILE.REMOVE, 2.0);
  // Step 4: Decorative pillar obstacles within the interior room at varying heights
  // Pattern: 2x2 symmetric arrangement in room center quadrants
  // Height variation: Progressive elevation from 1.0 to 4.0 units for testing
  // Coordinates with heights:
  //   - Northwest pillar (10,10): Height 1.0 - ground level obstacle
  //   - Northeast pillar (13,10): Height 2.0 - low elevated column  
  //   - Southwest pillar (10,13): Height 3.0 - medium elevated column
  //   - Southeast pillar (13,13): Height 4.0 - high elevated column
  // Spacing: 3-tile gaps between pillars, 2-tile clearance from room walls
  // Purpose: Create navigation obstacles with height variety for gameplay testing
  const pillarPositions = [
    [10, 10], // Northwest pillar - ground level (height 1.0)
    [13, 10], // Northeast pillar - low elevation (height 2.0)
    [10, 13], // Southwest pillar - medium elevation (height 3.0)
    [13, 13]  // Southeast pillar - high elevation (height 4.0)
  ];
  const pillarHeights = [1.0, 2.0, 3.0, 4.0]; // Progressive height testing
  
  // Place pillars individually to assign different heights
  pillarPositions.forEach((pos, index) => {
    builder.pillars([pos], TILE.WALL, pillarHeights[index] );
  });

  // Step 5: Default player spawn (grid 12,12 facing East)
  // Converts later to world coords (center of tile) and applied to state.player
  builder.spawn(3,12, 'S');

  // Step 5.5: Place a few items with payload strings
  builder
    .item(12, 12, 'center-key')
    .item(3, 19, 'orb-a')
    .item(3, 3, 'orb-b');

  // Step 6: Export & apply height data (defer if applyHeightData not yet loaded)
  const heightData = builder.getHeightData();
  if (typeof applyHeightData === 'function') {
    applyHeightData(heightData, true);
  } else if (typeof window !== 'undefined') {
    window._pendingMapHeights = heightData;
  }
  // Refresh instance buffers if system is loaded so removed objects disappear
  if (typeof rebuildInstances === 'function') rebuildInstances();

  // Step 7: Apply spawn to player state if available
  const sp = builder.getSpawn && builder.getSpawn();
  if (sp && typeof state !== 'undefined' && state.player){
    // Grid -> world: center of cell, origin at map center
    state.player.x = (sp.x + 0.5) - MAP_W * 0.5;
    state.player.z = (sp.y + 0.5) - MAP_H * 0.5;
    state.player.angle = sp.angle || 0.0; // 0 faces -Z
    // Leave y=0 so vertical physics will settle to ground height on first frame
  }

  // Initialize items into gameplay system
  const itemList = builder.getItems && builder.getItems();
  if (itemList && itemList.length){
    if (typeof initItemsFromBuilder === 'function') initItemsFromBuilder(itemList);
    else if (typeof window !== 'undefined') window._pendingItems = itemList;
  }
}
buildSampleMap();
