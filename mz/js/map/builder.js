"use strict";

/**
 * MapBuilder - Comprehensive fluent API for constructing complex tile-based 3D maps.
 * Provides an expressive, chainable interface for building game levels with walls, platforms,
 * columns, hazards, spawn points, and item placement. Supports both 2D tile layouts and
 * full 3D column geometries with variable heights, elevations, and multi-span structures.
 * 
 * Key Features:
 * - Chainable method calls for readable map construction code
 * - 3D column system with variable heights and base elevations
 * - Multi-span columns (platforms at different elevations on same tile)
 * - Hazard/safety flagging for gameplay mechanics
 * - Spawn point and item placement tracking
 * - Coordinate normalization and bounds checking
 * - Memory-efficient direct array manipulation
 * 
 * @fileoverview Advanced tile-based map construction with 3D column support
 * @exports MapBuilder class - Main map building interface
 * @dependencies None (intentionally standalone for maximum portability)
 * @sideEffects Directly modifies provided map array, maintains internal geometry data structures
 * 
 * @example
 * ```javascript
 * const b = new MapBuilder(MAP_W, MAP_H, map, TILE);
 * b.clear(TILE.OPEN)
 *  .border(TILE.WALL, 3.0)                    // 3-unit tall outer walls
 *  .rect(6,6,17,17,TILE.WALL)                 // Inner room walls  
 *  .platform(10,10,13,13, 2.0)               // Raised platform
 *  .pillars([[10,10],[13,13]], TILE.WALL, 4.0) // Tall support pillars
 *  .spawn(8, 8, 'N')                          // Player spawn facing north
 *  .items([[12,12,'key'], [15,15,'powerup']]) // Place collectibles
 *  .applyHeightData();                        // Finalize geometry
 * ```
 */

/**
 * MapBuilder class for fluent tile-based map construction with advanced 3D geometry support
 * Provides comprehensive toolset for creating complex game levels with platforms, columns,
 * hazards, spawn points, and item placement while maintaining efficient memory usage.
 */
class MapBuilder {
  /**
   * Initialize a new map builder with dimensions, backing storage, and tile constants
   * Sets up internal data structures for tracking 3D geometry, spawn points, and items
   * 
   * @param {number} w - Map width in tiles (must be positive integer)
   * @param {number} h - Map height in tiles (must be positive integer)  
   * @param {Uint8Array|Array<number>} mapArray - Backing tile storage array (length = w*h)
   * @param {Object} TILE_ENUM - Tile type constants object (e.g., {OPEN:0, WALL:1, HAZARD:2})
   */
  constructor(w, h, mapArray, TILE_ENUM){
    // ========================================================================
    // Core Map Dimensions and Storage
    // ========================================================================
    
    /** @type {number} Map width in tiles */
    this.w = w; 
    /** @type {number} Map height in tiles */
    this.h = h; 
    /** @type {Uint8Array|Array<number>} Direct reference to map tile data */
    this.map = mapArray; 
    /** @type {Object} Tile type enumeration constants */
    this.TILE = TILE_ENUM;
    
    // ========================================================================
    // 3D Column Geometry Systems  
    // ========================================================================
    
    /** @type {Array<Object>} Legacy single-span column storage: {x,y,h,b} objects */
    this.extraColumns = []; 
    /** @type {Map<string,number>} Fast height lookup: "x,y" -> height value */
    this.columnHeights = new Map(); 
    /** @type {Map<string,Array>} Multi-span column registry: "x,y" -> [{b,h,t}] array */
    this.columnSpans = new Map();
    
    // ========================================================================
    // Construction History and Debug Support
    // ========================================================================
    
    /** @type {Array<Object>} Removal operation history for debug visualization */
    this.removals = [];
    
    // ========================================================================
    // Gameplay Metadata Storage
    // ========================================================================
    
    /** @type {Object|null} Player spawn point: {x,y,angle} or null if unset */
    this._spawn = null; 
    /** @type {Array<Object>} Item placement list: [{x,y,payload}] for level setup */
    this._items = [];
  }
  
  // ========================================================================
  // Core Utility Methods for Coordinate and Bounds Management
  // ========================================================================
  
  /**
   * Convert 2D grid coordinates to linear array index for efficient array access
   * @param {number} x - Grid X coordinate (column)
   * @param {number} y - Grid Y coordinate (row)  
   * @returns {number} Linear index into map array
   */
  idx(x,y){ 
    return y * this.w + x; 
  }
  
  /**
   * Clamp numeric value to specified range for safe coordinate handling
   * @param {number} v - Value to clamp
   * @param {number} min - Minimum allowed value (inclusive)
   * @param {number} max - Maximum allowed value (inclusive)
   * @returns {number} Clamped value guaranteed to be in [min,max] range
   */
  _clamp(v,min,max){ 
    return v < min ? min : v > max ? max : v; 
  }
  
  /**
   * Normalize coordinate pair ordering to ensure consistent rectangle bounds
   * Swaps coordinates if needed so that x1<=x2 and y1<=y2 for proper rect operations
   * @param {number} x1,y1,x2,y2 - Input coordinates (potentially unordered)
   * @returns {Array<number>} Normalized coordinates [x1,y1,x2,y2] with x1<=x2, y1<=y2
   */
  _norm(x1,y1,x2,y2){ 
    if (x1>x2) [x1,x2]=[x2,x1]; 
    if (y1>y2) [y1,y2]=[y2,y1]; 
    return [x1,y1,x2,y2]; 
  }
  
  /**
   * Check if coordinates are within map boundaries (soft bounds checking)
   * @param {number} x - Grid X coordinate to test
   * @param {number} y - Grid Y coordinate to test
   * @returns {boolean} True if coordinates are valid, false if out of bounds
   */
  _inBounds(x,y){ 
    return x>=0 && y>=0 && x<this.w && y<this.h; 
  }

  // ========================================================================
  // 3D Column Height and Span Management System
  // ========================================================================
  
  /**
   * Set or update column span data for a specific grid coordinate with advanced geometry support
   * Manages multi-span columns (multiple platforms at different elevations on same tile),
   * hazard flagging, and maintains both legacy single-span and modern multi-span data structures
   * 
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate  
   * @param {number} height - Column height in world units (must be positive)
   * @param {number} base - Base elevation offset in world units (default: 0)
   * @param {boolean} isBad - Hazard flag: true for dangerous/damaging columns (default: false)
   */
  _setHeight(x,y,height, base=0, isBad=false){
    if (!this._inBounds(x,y)) return; // Skip out-of-bounds coordinates
    
    const key = `${x},${y}`;
    const newBase = (typeof base === 'number') ? (base|0) : 0;  // Integer base elevation
    const newH = Math.max(0, +height);                          // Positive height only
    const newT = isBad ? 1 : 0;                                 // Type: 0=normal, 1=hazardous

    // Update multi-span registry
    let spans = this.columnSpans.get(key);
    if (!spans){ spans = []; this.columnSpans.set(key, spans); }
    // Try to find existing span with same base and same hazard flag; keep the taller/topmost for that base
    let foundSameBase = false;
    for (let i=0;i<spans.length;i++){
      const s = spans[i]; if (!s) continue;
      if ((s.b|0) === newBase && ((s.t|0) === newT)){
        foundSameBase = true;
        const prevTop = (s.b|0) + (+s.h||0);
        const newTop = newBase + newH;
        if (newTop >= prevTop){ spans[i] = { b: newBase, h: newH, t: newT }; }
        break;
      }
    }
    if (!foundSameBase){ spans.push({ b: newBase, h: newH, t: newT }); }
    // Normalize: remove non-positive and sort by base then height
    for (let i=spans.length-1;i>=0;i--){ const s=spans[i]; if (!s || !(s.h>0)) spans.splice(i,1); }
    spans.sort((a,b)=> (a.b-b.b) || (a.h-b.h));

    // Update compatibility single-span stores using the topmost span
    if (spans.length > 0){
      // topmost by highest (b+h)
      const top = spans.reduce((a,b)=> ((a.b+a.h) >= (b.b+b.h) ? a : b));
      this.columnHeights.set(key, top.h);
      // Update or add representative in extraColumns
      let idx = -1;
      for (let i=this.extraColumns.length-1; i>=0; i--){ const c = this.extraColumns[i]; if (c && c.x===x && c.y===y){ idx=i; break; } }
      if (idx >= 0){ this.extraColumns[idx] = { x, y, h: top.h, b: top.b };
      } else { this.extraColumns.push({ x, y, h: top.h, b: top.b }); }
    } else {
      this.columnHeights.delete(key);
      // Remove any representative entry
      for (let i=this.extraColumns.length-1; i>=0; i--){ const c=this.extraColumns[i]; if (c && c.x===x && c.y===y){ this.extraColumns.splice(i,1); break; } }
    }
  }

  // ========================================================================
  // Fundamental Map Drawing Operations
  // ========================================================================
  
  /**
   * Fill entire map with a single tile type for initialization or reset
   * Clears all existing tile data but preserves 3D geometry and metadata
   * @param {number} tile - Tile type constant to fill map with (e.g., TILE.OPEN)
   * @returns {MapBuilder} This instance for method chaining
   */
  clear(tile){ 
    this.map.fill(tile); 
    return this; 
  }

  /**
   * Draw outer border walls around map perimeter with optional 3D column heights
   * Creates a complete perimeter barrier with configurable thickness and elevation
   * 
   * @param {number} tile - Tile value to place on border (e.g., TILE.WALL)
   * @param {number|Object} [height=1.0] - Column height in units, or options object
   * @param {Object} [opts] - Additional options for border customization
   * @param {number} [opts.height=1.0] - Column height when height param is options object
   * @param {number} [opts.y=0] - Base elevation for border columns
   * @returns {MapBuilder} This instance for method chaining
   */
  border(tile, height=1.0, opts){
    // Support overloaded call signature: border(tile, opts)
    if (typeof height === 'object' && height){ 
      opts = height; 
      height = (opts.height!=null ? +opts.height : 1.0); 
    }
    opts = opts || {};
    const baseY = (opts.y!=null ? (opts.y|0) : 0);  // Base elevation offset
    const w=this.w, h=this.h, m=this.map;
    
    // Draw horizontal borders (top and bottom edges)
    for(let x=0; x<w; x++){
      if (baseY === 0) m[this.idx(x,0)] = tile;      // Top edge
      if (baseY === 0) m[this.idx(x,h-1)] = tile;    // Bottom edge
      
      // Add 3D column data for tall or elevated borders
      if (height > 1.0 || baseY > 0){
        this._setHeight(x, 0, height, baseY);         // Top edge columns
        this._setHeight(x, h-1, height, baseY);       // Bottom edge columns
      }
    }
    
    // Draw vertical borders (left and right edges)
    for(let y=0; y<h; y++){
      if (baseY === 0) m[this.idx(0,y)] = tile;
      if (baseY === 0) m[this.idx(w-1,y)] = tile;
      if (height > 1.0 || baseY > 0){
        this._setHeight(0, y, height, baseY);
        this._setHeight(w-1, y, height, baseY);
      }
    }
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
  fillRect(x1,y1,x2,y2,tile, opts){
    opts = opts || {};
    const baseY = (opts.y!=null ? (opts.y|0) : 0);
    const height = (opts.height!=null ? +opts.height : 1.0);
    [x1,y1,x2,y2] = this._norm(x1,y1,x2,y2);
    x1=this._clamp(x1,0,this.w-1); x2=this._clamp(x2,0,this.w-1);
    y1=this._clamp(y1,0,this.h-1); y2=this._clamp(y2,0,this.h-1);
    for(let y=y1;y<=y2;y++){
      for(let x=x1;x<=x2;x++){
        if (baseY === 0) this.map[this.idx(x,y)] = tile;
  if (height > 1.0 || baseY > 0){ this._setHeight(x,y,height, baseY, false); }
      }
    }
    return this;
  }

  /** Rectangle (inclusive).
   *  - If tile === TILE.FILL, fill the area with WALLs (and set heights if >1).
   *  - If tile === TILE.REMOVE, carve the area to OPEN and clear any height data.
  *  - If tile === TILE.BAD, mark map as BAD and register spans like wall segments.
   *  - Else, draw outline with optional height on outline tiles.
   */
  rect(x1,y1,x2,y2,tile,height=1.0, opts){
    // Overloads: rect(..., tile, opts) or rect(..., tile, height, opts)
    if (typeof height === 'object' && height){ opts = height; height = (opts.height!=null ? +opts.height : 1.0); }
    opts = opts || {};
    const baseY = (opts.y!=null ? (opts.y|0) : 0);
    [x1,y1,x2,y2]=this._norm(x1,y1,x2,y2);
  const isFill = (this.TILE && tile === this.TILE.FILL);
  const isRemove = (this.TILE && tile === this.TILE.REMOVE);
  const isBad = (this.TILE && tile === this.TILE.BAD);
    if (isFill) {
      // Fill entire rect with WALLs (treat FILL as a directive to place WALL tiles)
      for(let y=y1; y<=y2; y++){
        for(let x=x1; x<=x2; x++){
          if (baseY === 0) this.map[this.idx(x,y)] = this.TILE.WALL;
          if (height > 1.0 || baseY > 0){
            // If we're drawing an elevated slab over an existing ground wall,
            // don't overwrite that wall's column metadata. The wall already occupies this cell.
            const cell = this.map[this.idx(x,y)];
            const isGroundWall = (cell === this.TILE.WALL) && (baseY > 0);
            if (!isGroundWall){ this._setHeight(x,y,height, baseY, false); }
          }
        }
      }
  } else if (isRemove) {
      // Carve from the BOTTOM: raise base offset and decrease visible height.
      // Always mark map as OPEN so the floor becomes passable beneath any remaining column.
      const remUnits = Math.max(0, Math.floor((+height||0) + 1e-6));
      const yR = (opts && opts.y!=null) ? (opts.y|0) : null; // removal base when provided
      for(let y=y1; y<=y2; y++){
        for(let x=x1; x<=x2; x++){
          this.map[this.idx(x,y)] = this.TILE.OPEN;
          const key = `${x},${y}`;
          // Prefer multi-span carving when available
          const spans = this.columnSpans.get(key);
          if (Array.isArray(spans) && spans.length){
            if (remUnits > 0){
              const remBase = (yR==null ? 0 : (yR|0));
              const remTop = remBase + remUnits;
              for (let i=spans.length-1; i>=0; i--){
                const s = spans[i]; if (!s) continue;
                const curBase = (s.b|0); const curTop = curBase + (s.h|0);
                const overlap = Math.max(0, Math.min(curTop, remTop) - Math.max(curBase, remBase));
                if (overlap <= 0) continue;
                const overlapStart = Math.max(curBase, remBase);
                const overlapEnd = Math.min(curTop, remTop);
                const hitsBottom = overlapStart <= curBase + 0;
                const hitsTop = overlapEnd >= curTop - 0;
                if (hitsBottom && hitsTop){
                  // Full removal of this span
                  spans.splice(i,1);
                } else if (hitsBottom){
                  // Carved from bottom
                  s.b = curBase + overlap;
                  s.h = (curTop - s.b);
                } else if (hitsTop){
                  // Carved from top
                  s.h = (overlapStart - curBase);
                } else {
                  // Middle cut -> keep upper segment only
                  s.b = overlapEnd;
                  s.h = (curTop - s.b);
                }
              }
            }
            // Normalize spans and update compatibility stores
            for (let i=spans.length-1;i>=0;i--){ const s=spans[i]; if (!s || (s.h|0) <= 0) spans.splice(i,1); }
            if (spans.length){
              const top = spans.reduce((a,b)=> ((a.b+a.h) >= (b.b+b.h) ? a : b));
              // Update representative
              this.columnHeights.set(key, top.h|0);
              // update extraColumns entry for this (x,y)
              let repIdx = -1; for (let i=this.extraColumns.length-1;i>=0;i--){ const c=this.extraColumns[i]; if (c && c.x===x && c.y===y){ repIdx=i; break; } }
              if (repIdx>=0){ this.extraColumns[repIdx] = { x, y, h: top.h|0, b: top.b|0 }; }
              else { this.extraColumns.push({ x, y, h: top.h|0, b: top.b|0 }); }
            } else {
              // All spans removed at this tile
              this.columnSpans.delete(key);
              this.columnHeights.delete(key);
              for (let i=this.extraColumns.length-1;i>=0;i--){ const c=this.extraColumns[i]; if (c && c.x===x && c.y===y){ this.extraColumns.splice(i,1); break; } }
            }
            // Record the removal volume for debug visualization at this cell
            if (remUnits > 0){ const visualBase = (yR==null ? 0 : yR|0); this.removals.push({ x, y, b: visualBase|0, h: remUnits|0 }); }
            continue;
          }

          const curHVal = this.columnHeights.get(key);
          // Determine the visualized removal base for debug overlay
          let visualBase = (yR==null ? 0 : yR|0);
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
            // If no explicit base provided, we carved starting from current base
            if (yR==null) visualBase = curBase|0;
            // Determine overlap range for removal
            const remBase = (yR==null ? curBase : yR|0);
            const spanTop = curBase + curH;
            const remTop = remBase + remUnits;
            const overlap = Math.max(0, Math.min(spanTop, remTop) - Math.max(curBase, remBase));
            if (overlap <= 0){ continue; }
            let newBase = curBase;
            let newH = curH;
            const overlapStart = Math.max(curBase, remBase);
            const overlapEnd = Math.min(spanTop, remTop);
            const hitsBottom = overlapStart <= curBase + 0;
            const hitsTop = overlapEnd >= spanTop - 0;
            if (hitsBottom && hitsTop){
              // Full removal
              newH = 0;
            } else if (hitsBottom){
              // Carved from bottom
              newBase = curBase + overlap;
              newH = curH - overlap;
            } else if (hitsTop){
              // Carved from top
              newBase = curBase;
              newH = curH - overlap;
            } else {
              // Middle cut (Phase 1): keep the upper segment only
              newBase = overlapEnd;
              newH = spanTop - overlapEnd;
            }
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
            // Record the removal volume for debug visualization at this cell
            if (remUnits > 0){ this.removals.push({ x, y, b: visualBase|0, h: remUnits|0 }); }
          } else {
            // No tall column metadata: if this was a base wall (1 unit), OPEN is sufficient.
            // Fractional removals are ignored (integer voxel units only).
            // Still record the removal volume for debug visualization (from provided base or ground)
            if (remUnits > 0){ this.removals.push({ x, y, b: (visualBase|0), h: remUnits|0 }); }
          }
        }
      }
    } else if (isBad) {
      // BAD behaves like a wall segment for geometry/collision but flagged hazardous in spans
      for(let y=y1; y<=y2; y++){
        for(let x=x1; x<=x2; x++){
          // Only mark the ground tile BAD when the hazard is at ground level
          if (baseY === 0) this.map[this.idx(x,y)] = this.TILE.BAD;
          // Register hazardous spans (including ground-level BAD) for 3D logic/rendering
          this._setHeight(x,y,height, baseY, true);
        }
      }
    } else {
      // Outline only
      if (baseY === 0){
        this.hLine(x1,x2,y1,tile);
        this.hLine(x1,x2,y2,tile);
        this.vLine(x1,y1,y2,tile);
        this.vLine(x2,y1,y2,tile);
      }
      // Height registration for outline tiles (at ground and/or elevated)
      if (height > 1.0 || baseY > 0) {
        for(let x=x1;x<=x2;x++) this._setHeight(x,y1,height, baseY, false);
        for(let x=x1;x<=x2;x++) this._setHeight(x,y2,height, baseY, false);
        for(let y=y1+1;y<y2;y++) this._setHeight(x1,y,height, baseY, false);
        for(let y=y1+1;y<y2;y++) this._setHeight(x2,y,height, baseY, false);
      }
    }
    return this;
  }

  /** Place a list of [x,y] points with tile value and optional height.
   * Accepts formats: [x,y], [[x,y],...], or {x:number,y:number}.
   */
  pillars(points,tile,height=1.0, opts){
    // Overload support: pillars(points,tile,opts)
    if (typeof height === 'object' && height){ opts = height; height = (opts.height!=null ? +opts.height : 1.0); }
    opts = opts || {};
    const baseY = (opts.y!=null ? (opts.y|0) : 0);
    /** @type {Array<[number,number]>} */
    const list = [];
    if (Array.isArray(points)){
      if (points.length === 2 && typeof points[0]==='number' && typeof points[1]==='number'){
        list.push([points[0], points[1]]);
      } else if (points.length && Array.isArray(points[0])){
        for (const p of points){
          if (Array.isArray(p) && p.length>=2){ list.push([p[0], p[1]]); }
        }
      } else if (points.length && typeof points[0]==='object' && points[0]){
        for (const p of points){ if (p && typeof p.x==='number' && typeof p.y==='number') list.push([p.x,p.y]); }
      }
    } else if (points && typeof points.x==='number' && typeof points.y==='number'){
      list.push([points.x, points.y]);
    }
  for(const [x,y] of list){
      if (this._inBounds(x,y)){
  if (baseY === 0) this.map[this.idx(x,y)] = tile;
  if (height > 1.0 || baseY > 0) this._setHeight(x,y,height, baseY, false);
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
  columnHeights: new Map(this.columnHeights),
  columnSpans: new Map(this.columnSpans),
  removeVolumes: this.removals.slice()
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

  /** Add an item at grid coords with a string payload; optional opts.y sets world Y */
  item(gx, gy, payload="", opts){
    if (typeof payload === 'object' && payload){ opts = payload; payload = (opts.payload!=null ? opts.payload : ""); }
    gx=this._clamp(Math.floor(gx),0,this.w-1); gy=this._clamp(Math.floor(gy),0,this.h-1);
    const it = { x: gx, y: gy, payload: String(payload||"") };
    if (opts && typeof opts.y === 'number'){
      // Provide multiple key aliases for forward compatibility with items module
      it.yWorld = +opts.y;
    }
    this._items.push(it);
    return this;
  }
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

// ============================================================================
// Global Export for Cross-Module Integration
// ============================================================================

/**
 * Export MapBuilder class to global scope for maximum compatibility
 * Supports both browser window and Node.js globalThis contexts
 */
if (typeof window !== 'undefined') window.MapBuilder = MapBuilder;
else if (typeof globalThis !== 'undefined') globalThis.MapBuilder = MapBuilder;
