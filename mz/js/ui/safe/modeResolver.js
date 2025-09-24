// Mobile / Safe Mode Resolver
// Returns 'safe' or 'desktop' based on heuristics + overrides.
(function(){
  if (typeof window === 'undefined') return;
  function parseQuery(){
    try { return new URLSearchParams(window.location.search); } catch(_) { return new Map(); }
  }
  function getStoredPref(){
    try { return localStorage.getItem('editorModePref') || ''; } catch(_){ return ''; }
  }
  function setStoredPref(v){
    try { localStorage.setItem('editorModePref', v); } catch(_){ }
  }
  function resolve(){
    const q = parseQuery();
    const override = (q.get('editorMode')||'').toLowerCase();
    if (override === 'safe' || override === 'desktop'){ setStoredPref(override); return override; }
    const stored = (getStoredPref()||'').toLowerCase();
    if (stored === 'safe' || stored === 'desktop') return stored;
    // Heuristics: width + pointer type coarse => safe
    const w = window.innerWidth || document.documentElement.clientWidth || 0;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (w < 900 || coarse) return 'safe';
    return 'desktop';
  }
  window.__resolveEditorMode = resolve;
})();
