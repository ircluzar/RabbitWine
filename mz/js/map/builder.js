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
    this.extraColumns.push({x,y,h:height});
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

  /** Rectangle outline (inclusive) with optional height for 3D columns */
  rect(x1,y1,x2,y2,tile,height=1.0){
    [x1,y1,x2,y2]=this._norm(x1,y1,x2,y2);
    this.hLine(x1,x2,y1,tile);
    this.hLine(x1,x2,y2,tile);
    this.vLine(x1,y1,y2,tile);
    this.vLine(x2,y1,y2,tile);
    
    // If height specified and > 1.0, register all wall tiles as tall columns
    if (height > 1.0) {
      // Top and bottom horizontal lines
      for(let x=x1;x<=x2;x++) this._setHeight(x,y1,height);
      for(let x=x1;x<=x2;x++) this._setHeight(x,y2,height);
      // Left and right vertical lines (excluding corners to avoid duplicates)
      for(let y=y1+1;y<y2;y++) this._setHeight(x1,y,height);
      for(let y=y1+1;y<y2;y++) this._setHeight(x2,y,height);
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
}

// Expose globally (no module system assumed)
if (typeof window !== 'undefined') window.MapBuilder = MapBuilder;
else if (typeof globalThis !== 'undefined') globalThis.MapBuilder = MapBuilder;
