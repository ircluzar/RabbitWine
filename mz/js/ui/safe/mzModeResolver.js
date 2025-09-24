// Safe Mode Resolver specifically for MZ in-game editor button
(function(){
  if (typeof window==='undefined') return;
  if (window.__mzResolveEditorMode) return; // avoid duplicate
  function parseQuery(){ try { return new URLSearchParams(window.location.search); } catch(_) { return new Map(); } }
  function getStored(){ try { return localStorage.getItem('mzEditorModePref')||''; } catch(_){ return ''; } }
  function setStored(v){ try { localStorage.setItem('mzEditorModePref', v); } catch(_){ } }
  function resolve(){
    const q = parseQuery();
    const override = (q.get('mzEditorMode')||'').toLowerCase();
    if (override==='safe' || override==='desktop'){ setStored(override); return override; }
    const stored = (getStored()||'').toLowerCase();
    if (stored==='safe' || stored==='desktop') return stored;
    const w = window.innerWidth || document.documentElement.clientWidth || 0;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (w < 900 || coarse) return 'safe';
    return 'desktop';
  }
  window.__mzResolveEditorMode = resolve;
})();
