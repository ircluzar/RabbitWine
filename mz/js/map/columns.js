/**
 * Dynamic 3D column registry and height lookup system for game world geometry.
 * Provides centralized management of tall structures, platforms, and multi-level geometry
 * without hardcoding any specific column data. Map builders populate this system via
 * applyHeightData() to enable physics, rendering, and gameplay systems to query 3D world structure.
 * 
 * Key Features:
 * - Multi-span columns: Multiple platforms at different elevations on single tile
 * - Height and base elevation tracking for complex vertical geometry  
 * - Special span markers: hazards, fences, portals, locks, climbing restrictions
 * - Legacy single-span compatibility for simple column use cases
 * - Debug visualization support for carved removal volumes
 * - Memory-efficient coordinate-based lookup system
 * 
 * @fileoverview Central 3D world geometry registry and span management
 * @exports extraColumns, columnHeights, columnBases, columnSpans - Core geometry data structures
 * @exports applyHeightData() - Main integration function for map builders  
 * @exports getSpansAt(), setSpansAt() - Span manipulation utilities (Phase 2)
 * @dependencies None (intentionally standalone for maximum compatibility)
 * @sideEffects Maintains global geometry state, integrates with pending map data if present
 */

// ============================================================================
// Core 3D Geometry Data Structures
// ============================================================================

/** 
 * Legacy single-span column storage for simple tall structures
 * @type {Array<Object>} Array of {x, y, h, b?} column descriptors
 */
const extraColumns = [];

/** 
 * Fast height lookup for physics and rendering systems
 * @type {Map<string,number>} Map from "x,y" coordinate keys to height values
 */
const columnHeights = new Map();

/** 
 * Base elevation lookup for elevated platform support  
 * @type {Map<string,number>} Map from "x,y" coordinate keys to base elevation values
 */
const columnBases = new Map();

/** 
 * Debug tracking for removal operations to visualize carved spaces
 * @type {Array<Object>} Array of {x, y, b, h} removal volume descriptors
 */
const removeVolumes = [];

/** 
 * Advanced multi-span column registry for complex 3D geometry
 * Supports multiple platforms/structures at different elevations on same tile
 * @type {Map<string,Array>} Map from "x,y" to arrays of {b, h, t} span descriptors
 * Span properties: b=base elevation, h=height, t=type marker (0=normal, 1=hazard, etc.)
 */
const columnSpans = new Map();

// ============================================================================
// Map Builder Integration and Data Application
// ============================================================================

/**
 * Apply height data produced by map builders to populate the global geometry registry
 * Merges or replaces existing column data with new geometry from MapBuilder instances
 * Supports both legacy single-span and modern multi-span column systems
 * 
 * @param {Object} heightData - Geometry data from MapBuilder with structure:
 *   @param {Array} heightData.extraColumns - Legacy column array [{x,y,h,b?}]
 *   @param {Map} heightData.columnHeights - Height lookup map "x,y" -> height  
 *   @param {Map} heightData.columnSpans - Multi-span map "x,y" -> [{b,h,t}]
 *   @param {Array} heightData.removeVolumes - Removal debug volumes [{x,y,b,h}]
 * @param {boolean} replace - When true (default), replaces all existing data; false merges
 */
function applyHeightData(heightData, replace=true){
  if (!heightData) return;
  
  const { extraColumns: cols, columnHeights: heights } = heightData;
  
  // Clear existing data if replacing (default behavior)
  if (replace){
    extraColumns.length = 0;
    columnHeights.clear();
    columnBases.clear();
    columnSpans.clear();
    removeVolumes.length = 0;
  }
  
  // ========================================================================
  // Multi-Span Column System (Phase 2) - Primary Path
  // ========================================================================
  
  if (heightData && heightData.columnSpans instanceof Map){
    for (const [key, spans] of heightData.columnSpans.entries()){
      if (!Array.isArray(spans)) continue;
      
      // Normalize span data: ensure integer bases and positive heights
      const normalizedSpans = spans
        .filter(s => s && typeof s.b === 'number' && typeof s.h === 'number')
        .map(s => ({ 
          b: (s.b|0),                                    // Integer base elevation
          h: Math.max(0, Number(s.h) || 0),              // Positive height only
          t: ((s.t|0)||0)                                // Type marker (default: normal)
        }))
        .filter(s => s.h > 0);  // Remove zero-height spans
      
      if (normalizedSpans.length){ 
        columnSpans.set(key, normalizedSpans); 
      }
      
      // Derive topmost span for legacy compatibility systems
      if (normalizedSpans.length){
        const topSpan = normalizedSpans.reduce((a,b)=> ((a.b+a.h) >= (b.b+b.h) ? a : b));
        const [gx,gy] = key.split(',').map(n=>parseInt(n,10));
        
        if (Number.isFinite(gx) && Number.isFinite(gy)){
          // Create representative extraColumn entry for debug/visual systems
          extraColumns.push({ x: gx, y: gy, h: topSpan.h, b: topSpan.b });
        }
        
        // Update legacy lookup maps with topmost span data
        columnHeights.set(key, topSpan.h);
        columnBases.set(key, topSpan.b|0);
      }
    }
  } else {
    // ========================================================================
    // Legacy Single-Span System (Phase 1) - Compatibility Path
    // ========================================================================
    if (Array.isArray(cols)){
      for (const c of cols){
        if (c && typeof c.x === 'number' && typeof c.y === 'number'){
          extraColumns.push(c);
          if (typeof c.h === 'number') columnHeights.set(`${c.x},${c.y}`, c.h);
          if (typeof c.b === 'number') columnBases.set(`${c.x},${c.y}`, c.b|0);
          // Seed spans from Phase 1 data
          const key = `${c.x},${c.y}`;
          const b = (typeof c.b === 'number') ? (c.b|0) : 0;
          const h = (typeof c.h === 'number') ? (c.h|0) : 0;
          if (h > 0){ columnSpans.set(key, [{ b, h, t: 0 }]); }
        }
      }
    }
    if (heights instanceof Map){
      for (const [k,v] of heights.entries()){
        if (!columnHeights.has(k)) columnHeights.set(k,v);
        if (!columnSpans.has(k)){
          const b = (columnBases.has(k) ? (columnBases.get(k)|0) : 0);
          const h = (v|0);
          if (h > 0) columnSpans.set(k, [{ b, h, t: 0 }]);
        }
      }
    }
  }

  // Merge/replace removal debug volumes if provided
  if (heightData && Array.isArray(heightData.removeVolumes)){
    if (replace) removeVolumes.length = 0;
    for (const r of heightData.removeVolumes){
      if (!r) continue;
      const x = r.x|0, y = r.y|0;
      const b = (r.b|0)||0, h = (r.h|0)||0;
      if (h > 0) removeVolumes.push({ x, y, b, h });
    }
  }
}

// ============================================================================
// Global Exports for Cross-Module Integration
// ============================================================================

/**
 * Export all geometry data structures and functions to global scope
 * Enables physics, rendering, and gameplay systems to access world geometry
 */
if (typeof window !== 'undefined'){
  // Core geometry data structures
  window.extraColumns = extraColumns;        // Legacy single-span columns
  window.columnHeights = columnHeights;      // Height lookup map  
  window.columnBases = columnBases;          // Base elevation map
  window.columnSpans = columnSpans;          // Multi-span geometry registry
  window.removeVolumes = removeVolumes;      // Debug removal tracking
  
  // Configuration flags and integration functions
  if (typeof window.VERTICALITY_PHASE2 === 'undefined') window.VERTICALITY_PHASE2 = false;
  window.applyHeightData = applyHeightData;  // Map builder integration function
  
  // Process any pending geometry data from early map loading
  if (window._pendingMapHeights){
    applyHeightData(window._pendingMapHeights, true);
    delete window._pendingMapHeights;
  }
}

// ============================================================================
// Advanced Span Manipulation Utilities (Phase 2)
// ============================================================================

/**
 * Export span manipulation utilities for advanced geometry editing
 * Provides direct access to multi-span column data for dynamic level editing
 */
if (typeof window !== 'undefined'){
  /**
   * Get all span data for a specific grid coordinate with safe copying
   * @param {number} gx - Grid X coordinate
   * @param {number} gy - Grid Y coordinate  
   * @returns {Array<Object>} Array of span objects {b, h, t} (safely copied)
   */
  window.getSpansAt = function(gx,gy){
    const key = `${gx},${gy}`; 
    return columnSpans.get(key) ? columnSpans.get(key).map(s=>({ ...s })) : [];
  };
  
  /**
   * Set span data for a specific grid coordinate with validation and normalization
   * Updates both multi-span registry and legacy compatibility lookup maps
   * @param {number} gx - Grid X coordinate
   * @param {number} gy - Grid Y coordinate
   * @param {Array<Object>} spans - Array of span objects {b, h, t} to set
   */
  window.setSpansAt = function(gx,gy,spans){
    const key = `${gx},${gy}`;
    
    if (Array.isArray(spans)) {
      // Normalize and validate span data with special marker preservation
      columnSpans.set(key, spans
        .map(s=>{
          const tVal = ((s.t|0)||0);
          // Preserve special markers: 1=BAD, 2=FENCE, 3=BADFENCE, 4=HALF-SLAB, 5=PORTAL, 6=LOCK, 9=NOCLIMB
          const preservedType = (tVal>=1 && tVal<=6 || tVal===9) ? tVal : 0;
          return { 
            b: (s.b|0),                                    // Integer base elevation
            h: Math.max(0, Number(s.h) || 0),              // Positive height only
            t: preservedType                               // Validated type marker
          };
        })
        .filter(s=>s.h>0));  // Remove invalid spans
    }
    
    // Update legacy compatibility lookup maps with topmost span
    const spanArray = columnSpans.get(key) || [];
    if (spanArray.length){ 
      const topSpan = spanArray.reduce((a,b)=> ((a.b+a.h) >= (b.b+b.h) ? a : b)); 
      columnHeights.set(key, topSpan.h); 
      columnBases.set(key, topSpan.b|0);
    } else { 
      columnHeights.delete(key); 
      columnBases.delete(key); 
    }
  };
}
