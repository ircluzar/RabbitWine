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

  // ------------------------------------------------------------------------
  // Stale Lock (t:6) Span Pruning
  // In some edge cases (e.g., deleting lock spans, then reloading / applying a
  // partial diff or mismatched baseline) orphaned lock spans can persist in
  // columnSpans even though the editor/view no longer shows them. This causes
  // camera lock to activate unexpectedly and can override future block edits.
  // Strategy: After a full replace apply (replace===true), scan for lock spans
  // whose column has no other non-lock span AND (optional) a global flag to
  // enable pruning (default on). We remove zero-support lock spans so only
  // intentional locks remain. Opt-out via window.__DISABLE_LOCK_PRUNE = true.
  try {
    // Use new reusable helper if available so logic stays consistent across triggers
    if (replace && typeof window !== 'undefined' && typeof window.pruneLockSpans === 'function' && !window.__DISABLE_LOCK_PRUNE){
      window.pruneLockSpans({ source: 'applyHeightData/replace' });
    } else if (replace && typeof window !== 'undefined' && !window.__DISABLE_LOCK_PRUNE){
      // Fallback inline (older builds before helper defined elsewhere in bundle order)
      let prunedCells = 0; let prunedSpans = 0;
      for (const [key, spans] of columnSpans.entries()){
        if (!Array.isArray(spans) || !spans.length) continue;
        const hasNonLock = spans.some(s=>s && (s.t|0)!==6);
        if (hasNonLock) continue;
        columnSpans.delete(key);
        prunedCells++; prunedSpans += spans.length;
        columnHeights.delete(key); columnBases.delete(key);
      }
      if ((prunedCells>0) && window.__DEBUG_LOCK_PRUNE){
        try { console.log('[LOCK][prune][fallback] removed', prunedSpans, 'lock spans in', prunedCells, 'orphan columns'); } catch(_){ }
      }
    }
  } catch(_){ }
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

  // -----------------------------------------------------------------------
  // Runtime Lock Column Pruner
  // Provides a reusable way to remove illegitimate lock-only columns (all spans t:6)
  // that can arise from stale diffs, snapshot merges, or partial editor undo sequences.
  // Heuristic: a column whose every span has t:6 is considered transient marker-only
  // and pruned unless user disables via __DISABLE_LOCK_PRUNE. Safe because genuine
  // lock usage should accompany at least one solid/platform span in same column or
  // can be immediately re-authored by the editor after pruning. Returns stats.
  if (typeof window.pruneLockSpans !== 'function'){
    window.pruneLockSpans = function(opts){
      if (window.__DISABLE_LOCK_PRUNE) return { removedColumns:0, removedSpans:0, skipped:true };
      let removedColumns=0, removedSpans=0; const removedKeys=[];
      let overlapRemoved=0, overlapTrimmed=0, overlapColumns=0;
      const isSolidType=(t)=>{ const tt=(t|0)||0; return (tt===0||tt===1||tt===9); };
      // Pass 1: remove pure lock columns (legacy behavior)
      for (const [key, spans] of columnSpans.entries()){
        if (!Array.isArray(spans) || spans.length===0) continue;
        let allLock=true; for (const s of spans){ if (!s || (s.t|0)!==6){ allLock=false; break; } }
        if (!allLock) continue;
        removedColumns++; removedSpans += spans.length; removedKeys.push(key);
        columnSpans.delete(key); columnHeights.delete(key); columnBases.delete(key);
      }
      // Pass 2: (optional) prune lock spans that sit ON TOP OF or OVERLAP solid span vertical ranges.
      // Rationale: ghost reloads sometimes re-inject lock spans coextensive with restored solids. These should vanish.
      if (!window.__DISABLE_LOCK_OVERLAP_FIX){
        for (const [key, spans] of columnSpans.entries()){
          if (!Array.isArray(spans) || spans.length===0) continue;
            const solids = spans.filter(s=> s && isSolidType(s.t));
            if (!solids.length) continue; // nothing to compare
            const locks = spans.filter(s=> s && (s.t|0)===6);
            if (!locks.length) continue;
            // Build merged solid coverage intervals for quick overlap tests
            const solidIntervals = solids.map(s=>({ b:s.b|0, e:(s.b|0)+Number(s.h||0) })).filter(iv=>iv.e>iv.b).sort((a,b)=>a.b-b.b);
            const mergedSolids=[]; for (const iv of solidIntervals){ if (!mergedSolids.length){ mergedSolids.push({ ...iv }); continue; } const last=mergedSolids[mergedSolids.length-1]; if (iv.b <= last.e){ last.e = Math.max(last.e, iv.e); } else { mergedSolids.push({ ...iv }); } }
            let changed=false; const kept=[];
            for (const s of spans){ if (!s) continue; if ((s.t|0)!==6){ kept.push(s); continue; }
              const sStart = s.b|0; const sEnd = sStart + Number(s.h||0);
              // Determine portions of lock span not overlapping any solid interval
              let cursor = sStart; const freeSegments=[];
              for (const iv of mergedSolids){ if (iv.e <= cursor) continue; if (iv.b >= sEnd) break; // no further overlap
                if (iv.b > cursor){ freeSegments.push({ b:cursor, e:Math.min(iv.b, sEnd) }); }
                cursor = Math.max(cursor, iv.e);
                if (cursor >= sEnd) break;
              }
              if (cursor < sEnd){ freeSegments.push({ b:cursor, e:sEnd }); }
              // Reconstruct lock pieces for non-overlapping regions
              if (!freeSegments.length){ overlapRemoved++; changed=true; continue; }
              if (freeSegments.length===1 && freeSegments[0].b===sStart && freeSegments[0].e===sEnd){ kept.push(s); continue; }
              // Partial trims
              for (const seg of freeSegments){ const h = seg.e - seg.b; if (h>0){ kept.push({ b:seg.b, h, t:6 }); overlapTrimmed++; } }
              changed=true;
            }
            if (changed){
              overlapColumns++;
              // Merge adjacency among new lock fragments
              kept.sort((a,b)=> (a.b - b.b) || (((a.t|0)||0) - ((b.t|0)||0)) );
              const merged=[]; for (const s of kept){ if (!merged.length){ merged.push({ ...s }); continue; } const t=merged[merged.length-1]; if (((s.t|0)||0)===((t.t|0)||0) && s.b <= t.b + t.h){ const top=Math.max(t.b+t.h, s.b+s.h); t.h = top - t.b; } else { merged.push({ ...s }); } }
              columnSpans.set(key, merged);
              // Update legacy top span info
              if (merged.length){ const topSpan = merged.reduce((a,b)=> ((a.b+a.h) >= (b.b+b.h)?a:b)); columnHeights.set(key, topSpan.h); columnBases.set(key, topSpan.b|0); } else { columnHeights.delete(key); columnBases.delete(key); }
            }
        }
      }
      if ((removedColumns || overlapRemoved || overlapTrimmed) && window.__DEBUG_LOCK_PRUNE){
        try { console.log('[LOCK][prune]', { pureRemovedColumns:removedColumns, pureRemovedSpans:removedSpans, overlapRemoved, overlapTrimmed, overlapColumns, source: opts?opts.source:undefined }); } catch(_){ }
      }
      return { removedColumns, removedSpans, overlapRemoved, overlapTrimmed, overlapColumns, source: opts?opts.source:undefined, keys: removedKeys };
    };
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

    // Opportunistic pruning: if this update resulted in a pure lock-only column (all spans t:6)
    // and auto-pruning is enabled, remove it immediately to prevent ghost locks lingering until next full cycle.
    try {
      if (typeof window !== 'undefined' && !window.__DISABLE_AUTO_LOCK_PRUNE && typeof window.pruneLockSpans === 'function'){
        // Light check first to avoid scanning entire map if column clearly not all locks
        const allLock = spanArray.length && spanArray.every(s=> s && (s.t|0)===6);
        if (allLock){ window.pruneLockSpans({ source: 'setSpansAt/opportunistic' }); }
      }
    } catch(_){ }
  };
}
