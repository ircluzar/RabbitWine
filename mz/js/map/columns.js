/**
 * Dynamic tall column registry & height lookup.
 * This file intentionally does NOT hardcode any column geometry.
 * The map builder (buildSampleMap or other generators) is responsible for
 * populating columns via applyHeightData().
 *
 * Exports:
 *  - extraColumns: Array<{x:number,y:number,h:number,b?:number}>
 *  - columnHeights: Map key "x,y" -> height (h only, base elevation optional)
 *  - columnBases: Map key "x,y" -> base elevation (b), defaults to 0 when absent
 *  - applyHeightData(heightData): merges builder-produced data
 */
const extraColumns = [];
const columnHeights = new Map();
const columnBases = new Map();
// Debug-only: record carved REMOVE volumes for visualization [{x,y,b,h}]
const removeVolumes = [];
// Phase 2: multi-span registry per tile: Map key "x,y" -> Array of {b:int,h:int,t?:int}
const columnSpans = new Map();

/**
 * Apply builder-produced height data.
 * @param {{extraColumns:Array<{x:number,y:number,h:number,b?:number}>, columnHeights:Map<string,number>}} heightData
 * @param {boolean} replace When true (default) replaces existing data; false merges.
 */
function applyHeightData(heightData, replace=true){
  if (!heightData) return;
  const { extraColumns: cols, columnHeights: heights } = heightData;
  if (replace){
    extraColumns.length = 0;
    columnHeights.clear();
    columnBases.clear();
    columnSpans.clear();
  removeVolumes.length = 0;
  }
  // Phase 2 path: accept provided spans if present
  if (heightData && heightData.columnSpans instanceof Map){
    for (const [key, spans] of heightData.columnSpans.entries()){
      if (!Array.isArray(spans)) continue;
      // Normalize: only integer, positive heights
      const norm = spans
        .filter(s => s && typeof s.b === 'number' && typeof s.h === 'number')
        .map(s => ({ b: (s.b|0), h: Math.max(0, s.h|0), t: ((s.t|0)||0) }))
        .filter(s => s.h > 0);
      if (norm.length){ columnSpans.set(key, norm); }
      // Derive topmost span for legacy maps
      if (norm.length){
        const top = norm.reduce((a,b)=> ((a.b+a.h) >= (b.b+b.h) ? a : b));
        const [gx,gy] = key.split(',').map(n=>parseInt(n,10));
        if (Number.isFinite(gx) && Number.isFinite(gy)){
          // Reflect a representative extraColumn for debug/visual parity
          extraColumns.push({ x: gx, y: gy, h: top.h, b: top.b });
        }
        columnHeights.set(key, top.h);
        columnBases.set(key, top.b|0);
      }
    }
  } else {
    // Phase 1 path: use cols/heights
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

// Expose globally (no module system assumed)
if (typeof window !== 'undefined'){
  window.extraColumns = extraColumns;
  window.columnHeights = columnHeights;
  window.columnBases = columnBases;
  window.columnSpans = columnSpans;
  window.removeVolumes = removeVolumes;
  if (typeof window.VERTICALITY_PHASE2 === 'undefined') window.VERTICALITY_PHASE2 = false;
  window.applyHeightData = applyHeightData;
  if (window._pendingMapHeights){
    applyHeightData(window._pendingMapHeights, true);
    delete window._pendingMapHeights;
  }
}

// Utilities for Phase 2 (optional; exposed via window only)
if (typeof window !== 'undefined'){
  window.getSpansAt = function(gx,gy){
    const key = `${gx},${gy}`; return columnSpans.get(key) ? columnSpans.get(key).map(s=>({ ...s })) : [];
  };
  window.setSpansAt = function(gx,gy,spans){
    const key = `${gx},${gy}`;
    if (Array.isArray(spans)) {
      columnSpans.set(key, spans
        .map(s=>({ b:(s.b|0), h:(s.h|0), ...( (s.t|0)===1 ? { t:1 } : {}) }))
        .filter(s=>s.h>0));
    }
    // Derive topmost for legacy maps
    const arr = columnSpans.get(key) || [];
    if (arr.length){ const top = arr.reduce((a,b)=> ((a.b+a.h) >= (b.b+b.h) ? a : b)); columnHeights.set(key, top.h); columnBases.set(key, top.b|0);
    } else { columnHeights.delete(key); columnBases.delete(key); }
  };
}
