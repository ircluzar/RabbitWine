// Instance offsets for tiles (moved from scene.js)
let instOpen = new Float32Array(0), instWall = new Float32Array(0);
function rebuildInstances(){
  const opens=[], walls=[];
  for(let y=0;y<MAP_H;y++){
    for(let x=0;x<MAP_W;x++){
      const v = map[mapIdx(x,y)];
      if (v === TILE.WALL) walls.push(x,y); else opens.push(x,y);
    }
  }
  instOpen = new Float32Array(opens);
  instWall = new Float32Array(walls);
}
rebuildInstances();
