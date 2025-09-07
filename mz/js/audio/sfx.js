"use strict";
// Simple SFX wrapper: fire-and-forget one-shots with configurable master volume (default 50%).
(function(){
  if (typeof window === 'undefined') return;
  let _volume = 0.45; // default 50%
  let _unlocked = false; // block SFX until start modal closes

  function clamp01(v){ return Math.max(0, Math.min(1, Number(v)||0)); }

  function setVolume(v){ _volume = clamp01(v); }
  function getVolume(){ return _volume; }
  function unlock(){ _unlocked = true; }
  function isUnlocked(){ return _unlocked; }

  function _resolve(src){ return String(src || ""); }

  function play(src, opts){
    // Block playback until unlocked, unless explicitly allowed
    if (!_unlocked && !(opts && opts.allowBeforeUnlock)) return null;
    const url = _resolve(src);
    if (!url) return null;
    let vol = _volume;
    if (opts && typeof opts.volume === 'number') vol = clamp01(opts.volume);
    try {
      const a = new Audio(url);
      a.volume = vol;
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      // Ensure playback attempt; ignore promise rejections for brevity
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(()=>{});
      // Auto release reference on end
      a.addEventListener('ended', ()=>{ try { a.src = ''; } catch(_){} });
      return a;
    } catch(_){ return null; }
  }

  window.sfx = {
    play,
    setVolume,
  unlock,
  get isUnlocked(){ return isUnlocked(); },
    get volume(){ return getVolume(); },
    set volume(v){ setVolume(v); },
  };
})();
