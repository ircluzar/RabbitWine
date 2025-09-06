"use strict";
/**
 * MapBuilder - Fluent helper for constructing tile-based maps.
 *
 * Design goals:
 *  - Keep raw map array & constants external (no hidden allocation)
 *  - Provide expressive, chainable primitives (border, rect, fill, lines, pillars)
 *  - Normalize and clamp coordinates to map bounds to avoid silent errors
 *  - Small & dependency-free (intentionally no fancy BSP etc. here)
 *
 * Usage example:
 *   const b = new MapBuilder(MAP_W, MAP_H, map, TILE);
 *   b.clear(TILE.OPEN)
 *    .border(TILE.WALL)
 *    .rect(6,6,17,17,TILE.WALL)
 *    .pillars([[10,10],[13,10],[10,13],[13,13]], TILE.WALL);
 *
 * All drawing operations write directly into the provided map Uint8Array.
 */
class MapBuilder {
  /**
   * @param {number} w Map width
   * @param {number} h Map height
   * @param {Uint8Array|Array<number>} mapArray Backing map array length = w*h
   * @param {Object} TILE_ENUM Reference to tile constants (e.g., {OPEN:0,WALL:1})
   */
  constructor(w, h, mapArray, TILE_ENUM){
    this.w = w; this.h = h; this.map = mapArray; this.TILE = TILE_ENUM;
    // Initialize height tracking system for 3D column support
    this.extraColumns = []; // Array of {x,y,h} objects for tall columns
    this.columnHeights = new Map(); // Fast lookup: "x,y" -> height
  // Optional spawn metadata (grid coords + facing angle in radians)
  this._spawn = null; // { x:number, y:number, angle:number }
  // Items to spawn: array of {x:number,y:number,payload:string}
  this._items = [];
  }
  /** Convert (x,y) to linear index */
  idx(x,y){ return y * this.w + x; }
  /** Internal clamp */
  _clamp(v,min,max){ return v < min ? min : v > max ? max : v; }
  /** Normalize coordinate pair ordering so x1<=x2, y1<=y2 */
  _norm(x1,y1,x2,y2){ if (x1>x2) [x1,x2]=[x2,x1]; if (y1>y2) [y1,y2]=[y2,y1]; return [x1,y1,x2,y2]; }
  /** Bounds check (soft) */
  _inBounds(x,y){ return x>=0 && y>=0 && x<this.w && y<this.h; }

  /** Internal: Set height for a coordinate */
  _setHeight(x,y,height){
    if (!this._inBounds(x,y)) return;
    const key = `${x},${y}`;
    this.columnHeights.set(key, height);
    // Update existing extraColumn entry if present; else add new
    let idx = -1;
    for (let i=this.extraColumns.length-1; i>=0; i--){
      const c = this.extraColumns[i];
      if (c && c.x === x && c.y === y){ idx = i; break; }
    }
    if (idx >= 0){
      const prev = this.extraColumns[idx];
      const base = (prev && typeof prev.b === 'number') ? prev.b|0 : 0;
      this.extraColumns[idx] = { x, y, h: height, b: base };
    } else {
      this.extraColumns.push({ x, y, h: height, b: 0 });
    }
  }

  /** Fill entire map with a tile value */
  clear(tile){ this.map.fill(tile); return this; }

  /** Draw outer border (1 tile thick) */
  border(tile){
    const w=this.w,h=this.h,m=this.map;
    for(let x=0;x<w;x++){ m[this.idx(x,0)]=tile; m[this.idx(x,h-1)]=tile; }
    for(let y=0;y<h;y++){ m[this.idx(0,y)]=tile; m[this.idx(w-1,y)]=tile; }
    return this;
  }

  /** Horizontal line inclusive of endpoints */
  hLine(x1,x2,y,tile){
    [x1,,x2] = this._norm(x1,0,x2,0); // only reorder x
    x1=this._clamp(x1,0,this.w-1); x2=this._clamp(x2,0,this.w-1);
    if (y<0||y>=this.h) return this;
    for(let x=x1;x<=x2;x++) this.map[this.idx(x,y)] = tile;
    return this;
  }

  /** Vertical line inclusive of endpoints */
  vLine(x,y1,y2,tile){
    [y1,,y2] = this._norm(y1,0,y2,0); // reorder y via placeholder pattern
    y1=this._clamp(y1,0,this.h-1); y2=this._clamp(y2,0,this.h-1);
    if (x<0||x>=this.w) return this;
    for(let y=y1;y<=y2;y++) this.map[this.idx(x,y)] = tile;
    return this;
  }

  /** Filled rectangle (inclusive) */
  fillRect(x1,y1,x2,y2,tile){
    [x1,y1,x2,y2] = this._norm(x1,y1,x2,y2);
    x1=this._clamp(x1,0,this.w-1); x2=this._clamp(x2,0,this.w-1);
    y1=this._clamp(y1,0,this.h-1); y2=this._clamp(y2,0,this.h-1);
    for(let y=y1;y<=y2;y++){
      for(let x=x1;x<=x2;x++) this.map[this.idx(x,y)] = tile;
    }
    return this;
  }

  /** Rectangle (inclusive).
   *  - If tile === TILE.FILL, fill the area with WALLs (and set heights if >1).
   *  - If tile === TILE.REMOVE, carve the area to OPEN and clear any height data.
   *  - Else, draw outline with optional height on outline tiles.
   */
  rect(x1,y1,x2,y2,tile,height=1.0){
    [x1,y1,x2,y2]=this._norm(x1,y1,x2,y2);
    const isFill = (this.TILE && tile === this.TILE.FILL);
    const isRemove = (this.TILE && tile === this.TILE.REMOVE);
    if (isFill) {
      // Fill entire rect with WALLs (treat FILL as a directive to place WALL tiles)
      for(let y=y1; y<=y2; y++){
        for(let x=x1; x<=x2; x++){
          this.map[this.idx(x,y)] = this.TILE.WALL;
          if (height > 1.0) this._setHeight(x,y,height);
        }
      }
    } else if (isRemove) {
      // Carve from the BOTTOM: raise base offset and decrease visible height.
      // Always mark map as OPEN so the floor becomes passable beneath any remaining column.
      const remUnits = Math.max(0, Math.floor((+height||0) + 1e-6));
      for(let y=y1; y<=y2; y++){
        for(let x=x1; x<=x2; x++){
          this.map[this.idx(x,y)] = this.TILE.OPEN;
          const key = `${x},${y}`;
          const curHVal = this.columnHeights.get(key);
          // If there is a tall column registered, adjust its base and height
          if (typeof curHVal === 'number'){
            const curH = Math.max(0, Math.floor(curHVal + 1e-6));
            if (remUnits <= 0){ continue; }
            // Find or create the matching extraColumn entry for base (b)
            let idx = -1; let curBase = 0;
            for (let i=this.extraColumns.length-1; i>=0; i--){
              const c = this.extraColumns[i];
              if (c && c.x === x && c.y === y){ idx = i; curBase = (c.b|0)||0; break; }
            }
            const newBase = curBase + remUnits;
            const newH = Math.max(0, curH - remUnits);
            if (newH <= 0){
              // Entire column removed -> clear height/base metadata
              this.columnHeights.delete(key);
              if (idx >= 0) this.extraColumns.splice(idx,1);
            } else {
              // Update height map and extraColumns with raised base
              this.columnHeights.set(key, newH);
              if (idx >= 0){ this.extraColumns[idx] = { x, y, h: newH, b: newBase };
              } else { this.extraColumns.push({ x, y, h: newH, b: newBase }); }
            }
          } else {
            // No tall column metadata: if this was a base wall (1 unit), OPEN is sufficient.
            // Fractional removals are ignored (integer voxel units only).
          }
        }
      }
    } else {
      // Outline only
      this.hLine(x1,x2,y1,tile);
      this.hLine(x1,x2,y2,tile);
      this.vLine(x1,y1,y2,tile);
      this.vLine(x2,y1,y2,tile);
      // Height registration for outline tiles
      if (height > 1.0) {
        for(let x=x1;x<=x2;x++) this._setHeight(x,y1,height);
        for(let x=x1;x<=x2;x++) this._setHeight(x,y2,height);
        for(let y=y1+1;y<y2;y++) this._setHeight(x1,y,height);
        for(let y=y1+1;y<y2;y++) this._setHeight(x2,y,height);
      }
    }
    return this;
  }

  /** Place a list of [x,y] points with tile value and optional height */
  pillars(points,tile,height=1.0){
    for(const [x,y] of points){ 
      if (this._inBounds(x,y)) {
        this.map[this.idx(x,y)] = tile;
        if (height > 1.0) this._setHeight(x,y,height);
      }
    }
    return this;
  }

  /** Carve (set to OPEN) inside area leaving outline (simple room helper) */
  room(x1,y1,x2,y2,wallTile=this.TILE.WALL, floorTile=this.TILE.OPEN){
    this.rect(x1,y1,x2,y2,wallTile);
    if (x2-x1>2 && y2-y1>2){ this.fillRect(x1+1,y1+1,x2-1,y2-1,floorTile); }
    return this;
  }

  /** Return underlying map */
  toArray(){ return this.map; }

  /** Get generated height data for integration with existing column system */
  getHeightData(){ 
    return { 
      extraColumns: [...this.extraColumns], 
      columnHeights: new Map(this.columnHeights) 
    }; 
  }

  /**
   * Designate player spawn on the grid with initial facing direction.
   * @param {number} gx - grid X (0..w-1)
   * @param {number} gy - grid Y (0..h-1)
   * @param {number|string|[number,number]} dir - facing: radians number, or 'N'|'E'|'S'|'W', or [dx,dz] vector
   */
  spawn(gx, gy, dir='N'){
    // Clamp to bounds
    gx = this._clamp(Math.floor(gx), 0, this.w-1);
    gy = this._clamp(Math.floor(gy), 0, this.h-1);
    const ang = this._parseDir(dir);
    this._spawn = { x: gx, y: gy, angle: ang };
    return this;
  }

  /** Return spawn metadata if set: {x,y,angle} in grid coords and radians */
  getSpawn(){ return this._spawn ? { ...this._spawn } : null; }

  /** Add an item at grid coords with a string payload */
  item(gx, gy, payload=""){ gx=this._clamp(Math.floor(gx),0,this.w-1); gy=this._clamp(Math.floor(gy),0,this.h-1); this._items.push({x:gx,y:gy,payload:String(payload||"")}); return this; }
  /** Add multiple items from array of {x,y,payload} or [x,y,payload] */
  items(arr){ if(Array.isArray(arr)){ for(const e of arr){ if(Array.isArray(e)) this.item(e[0], e[1], e[2]||""); else if (e && typeof e.x==='number' && typeof e.y==='number') this.item(e.x, e.y, e.payload||""); } } return this; }
  /** Get items array */
  getItems(){ return this._items.map(it=>({ ...it })); }

  /** Internal: normalize dir into radians where 0 faces -Z */
  _parseDir(dir){
    if (Array.isArray(dir) && dir.length>=2){
      const dx = +dir[0] || 0, dz = +dir[1] || 0;
      if (dx===0 && dz===0) return 0;
      return Math.atan2(dx, -dz);
    }
    if (typeof dir === 'number'){
      return dir; // assume radians
    }
    if (typeof dir === 'string'){
      const d = dir.trim().toUpperCase();
      if (d === 'N') return 0.0;           // -Z
      if (d === 'E') return Math.PI*0.5;   // +X
      if (d === 'S') return Math.PI;       // +Z
      if (d === 'W') return -Math.PI*0.5;  // -X
    }
    return 0.0;
  }
}

// Expose globally (no module system assumed)
if (typeof window !== 'undefined') window.MapBuilder = MapBuilder;
else if (typeof globalThis !== 'undefined') globalThis.MapBuilder = MapBuilder;
