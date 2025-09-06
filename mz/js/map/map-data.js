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

  builder.clear(TILE.OPEN);  // Establish base terrain - Fill entire grid with open walkable space
  builder.border(TILE.WALL,2.0); // Create outer boundary walls for map containment

  builder.rect(6, 6, 17, 17, TILE.WALL, 5.0); // central wall

  builder.rect(6, 1, 6, 5, TILE.WALL, 1.0); // bump at top
  builder.rect(17, 17, 24,24, TILE.FILL, 1.0); // fill bottom-right corner

  builder.rect(11, 6, 12,6, TILE.REMOVE, 2.0); // hole in central wall



  builder.pillars([10, 10], TILE.WALL, 1.0 ); // Northwest pillar - ground level (height 1.0)
  builder.pillars([13, 10], TILE.WALL, 2.0 ); // Northeast pillar - low elevation (height 2.0)
  builder.pillars([10, 13], TILE.WALL, 3.0 ); // Southwest pillar - medium elevation (height 3.0)
  builder.pillars([13, 13], TILE.WALL, 4.0 ); // Southeast pillar - high elevation (height 4.0)


  builder.spawn(3,12, 'S'); //Player Spawn


  builder.item(3, 19, 'ABILITY_BACK');
  builder.item(3, 3, 'ABILITY_MOVE');
  builder.item(14, 20, 'ABILITY_JUMP');
  builder.item(12, 12, 'ABILITY_WALLJUMP');
  builder.item(13, 12, 'ABILITY_DASH');


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
