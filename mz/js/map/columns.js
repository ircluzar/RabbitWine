/**
 * Dynamic tall column registry & height lookup.
 * This file intentionally does NOT hardcode any column geometry.
 * The map builder (buildSampleMap or other generators) is responsible for
 * populating columns via applyHeightData().
 *
 * Exports:
 *  - extraColumns: Array<{x:number,y:number,h:number,b?:number}>
 *  - columnHeights: Map key "x,y" -> height (h only, base elevation optional)
 *  - applyHeightData(heightData): merges builder-produced data
 */
const extraColumns = [];
const columnHeights = new Map();

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
  }
  if (Array.isArray(cols)){
    for (const c of cols){
      if (c && typeof c.x === 'number' && typeof c.y === 'number'){
        extraColumns.push(c);
        if (typeof c.h === 'number') columnHeights.set(`${c.x},${c.y}`, c.h);
      }
    }
  }
  if (heights instanceof Map){
    for (const [k,v] of heights.entries()){
      if (!columnHeights.has(k)) columnHeights.set(k,v);
    }
  }
}

// Expose globally (no module system assumed)
if (typeof window !== 'undefined'){
  window.extraColumns = extraColumns;
  window.columnHeights = columnHeights;
  window.applyHeightData = applyHeightData;
  if (window._pendingMapHeights){
    applyHeightData(window._pendingMapHeights, true);
    delete window._pendingMapHeights;
  }
}
