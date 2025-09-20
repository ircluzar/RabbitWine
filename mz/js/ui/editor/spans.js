/**
 * Editor span manipulation utilities
 * Extracted from editor.js - handles span normalization and get/set operations
 * 
 * @fileoverview Span manipulation helpers for editor block operations
 * @dependencies window.columnSpans, window.setSpansAt
 */

/**
 * Get spans array for a grid cell (safe copy)
 * @param {number} gx - Grid X coordinate
 * @param {number} gy - Grid Y coordinate
 * @returns {Array} Copy of spans array
 */
function __getSpans(gx, gy){
  const key = `${gx},${gy}`;
  try { return (window.columnSpans.get(key) || []).slice(); } catch(_){ return []; }
}

/**
 * Set spans array for a grid cell
 * @param {number} gx - Grid X coordinate
 * @param {number} gy - Grid Y coordinate
 * @param {Array} spans - Spans array to set
 */
function __setSpans(gx, gy, spans){ 
  try { window.setSpansAt(gx, gy, spans); } catch(_){} 
}

/**
 * Normalize spans array by merging same-type adjacent/overlapping spans
 * @param {Array} spans - Raw spans array
 * @returns {Array} Normalized spans array
 */
function __normalize(spans){
  // Normalize spans and merge only same-type overlaps/adjacency to avoid type infection
  const arr = (Array.isArray(spans)?spans:[])
    .filter(s=>s && (Number(s.h)||0) > 0)
    .map(s=>{
      const tt = (s.t|0)||0;
      const o = { b: (s.b|0), h: (typeof s.h==='number'? s.h : (s.h|0)) };
      if (tt===1||tt===2||tt===3||tt===4||tt===5||tt===6||tt===9) o.t = tt;
      return o;
    });
  arr.sort((a,b)=> (a.b - b.b) || (((a.t|0)||0) - ((b.t|0)||0)) );
  const out=[];
  for (const s of arr){
    if (!out.length){ out.push({ ...s }); continue; }
    const t = out[out.length-1];
    const sT = (s.t|0)||0; const tT = (t.t|0)||0;
    if (sT===tT && s.b <= t.b + t.h + 1e-6){
      const top = Math.max(t.b + t.h, s.b + s.h); t.h = top - t.b;
    } else { out.push({ ...s }); }
  }
  return out;
}

// Export span utilities
if (typeof window !== 'undefined') {
  window.__getSpans = __getSpans;
  window.__setSpans = __setSpans;
  window.__normalize = __normalize;
}