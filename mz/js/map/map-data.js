/**
 * Tilemap data structure and sample map generation.
 * Defines the game world grid with walls and open spaces, provides map indexing utilities.
 * Exports: TILE enum, MAP_W, MAP_H constants, map array, mapIdx(), buildSampleMap() functions.
 * Dependencies: None. Side effects: Initializes global map array when buildSampleMap() is called.
 */

// Tilemap representation (moved from scene.js)
const TILE = { OPEN: 0, WALL: 1 };
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
 * Generate a sample map with border walls and interior rooms
 */
function buildSampleMap(){
  // Simple border walls and a few interior blocks
  for (let y=0;y<MAP_H;y++){
    for (let x=0;x<MAP_W;x++){
      const border = x===0||y===0||x===MAP_W-1||y===MAP_H-1;
      map[mapIdx(x,y)] = border ? TILE.WALL : TILE.OPEN;
    }
  }
  // Interior rooms
  for (let y=6;y<18;y++){
    map[mapIdx(6,y)] = TILE.WALL;
    map[mapIdx(17,y)] = TILE.WALL;
  }
  for (let x=6;x<18;x++){
    map[mapIdx(x,6)] = TILE.WALL;
    map[mapIdx(x,17)] = TILE.WALL;
  }
  // Some pillars
  [[10,10],[13,10],[10,13],[13,13]].forEach(([x,y])=>{ map[mapIdx(x,y)] = TILE.WALL; });
}
buildSampleMap();
