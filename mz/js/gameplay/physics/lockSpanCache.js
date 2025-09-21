// ============================================================================
// Lock & Solid Span Cache
// ============================================================================
/**
 * Precomputes grouped information for column spans to accelerate collision queries.
 * - lockRangeByCell: Map<cellKey, {min:number,max:number,count:number}>
 * - solidSpansByCell: Map<cellKey, Array<{b:number,h:number,t:number}>> excluding decorative (fence/portal/lock)
 * - version counter increments when rebuild invoked
 *
 * Usage:
 *   rebuildLockSpanCache(); // after level load / edit
 *   const r = lockRangeByCell.get("gx,gy"); // O(1) lock presence & vertical range
 *   const solids = solidSpansByCell.get("gx,gy"); // pre-filtered solid spans
 */
(function(){
  if (typeof window === 'undefined') return; // browser only
  if (window.rebuildLockSpanCache) return; // idempotent

  const lockRangeByCell = new Map();
  const solidSpansByCell = new Map();
  let lockSpanCacheVersion = 0;

  function rebuildLockSpanCache(){
    lockRangeByCell.clear();
    solidSpansByCell.clear();
    if (!(window.columnSpans instanceof Map)){ lockSpanCacheVersion++; return; }
    for (const [key, spans] of window.columnSpans.entries()){
      if (!Array.isArray(spans) || spans.length===0) continue;
      let minL = Infinity, maxL = -Infinity, lockCount = 0;
      for (let i=0;i<spans.length;i++){
        const s = spans[i]; if (!s) continue; const h = (s.h|0); if (h<=0) continue; const t = ((s.t|0)||0); const b = (s.b|0);
        if (t===6){ // lock span
          lockCount++;
          if (b < minL) minL = b;
          const top = b + h; if (top > maxL) maxL = top;
          continue; // lock spans are decorative -> not solid
        }
        if (t===2||t===3||t===5) continue; // decorative non-solid (fence/portal)
        // solid span
        let arr = solidSpansByCell.get(key); if (!arr){ arr = []; solidSpansByCell.set(key, arr); }
        arr.push({ b, h, t });
      }
      if (lockCount && minL!==Infinity){ lockRangeByCell.set(key, { min:minL, max:maxL, count:lockCount }); }
    }
    lockSpanCacheVersion++;
  }

  // Helper fast queries
  function isInsideLockCached(gx, gz, py){
    const r = lockRangeByCell.get(`${gx},${gz}`);
    return !!(r && py >= r.min && py <= r.max - 0.02);
  }

  function getSolidSpansCached(key){ return solidSpansByCell.get(key) || null; }

  window.rebuildLockSpanCache = rebuildLockSpanCache;
  window.lockRangeByCell = lockRangeByCell;
  window.solidSpansByCell = solidSpansByCell;
  window.lockSpanCacheVersion = function(){ return lockSpanCacheVersion; };
  window.isInsideLockCached = isInsideLockCached;
  window.getSolidSpansCached = getSolidSpansCached;
})();
