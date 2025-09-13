/**
 * Instance data management for map tile rendering.
 * Generates and maintains instanced rendering data for open tiles and wall tiles based on map layout.
 * Exports: instOpen, instWall arrays, rebuildInstances() function.
 * Dependencies: MAP_W, MAP_H, TILE, map, mapIdx from map-data.js. Side effects: Allocates Float32Array buffers, called during map changes.
 */

// Instance offsets for tiles (moved from scene.js)
let instOpen = new Float32Array(0), instWall = new Float32Array(0), instBad = new Float32Array(0);

/**
 * Rebuild instance data arrays for tile rendering
 * Separates open and wall tiles into different instance buffers
 */
function rebuildInstances(){
  const opens=[], walls=[], bads=[];
  for(let y=0;y<MAP_H;y++){
    for(let x=0;x<MAP_W;x++){
  const v = map[mapIdx(x,y)];
  const isWall = (v === TILE.WALL) || (v === TILE.FILL) || (v === TILE.BAD) || (v === TILE.HALF) || (v === TILE.FENCE) || (v === TILE.BADFENCE) || (v === TILE.LEVELCHANGE) || (v === TILE.NOCLIMB);
  if (v === TILE.BAD) bads.push(x,y);
  if (isWall) walls.push(x,y); 
      else opens.push(x,y);
    }
  }
  instOpen = new Float32Array(opens);
  instWall = new Float32Array(walls);
  instBad = new Float32Array(bads);
}

// Initialize instance data
rebuildInstances();

// Expose for editor/save actions
if (typeof window !== 'undefined'){
  window.rebuildInstances = rebuildInstances;
  window.instBad = instBad;
}
