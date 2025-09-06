"use strict";
// Simple music wrapper: single looping track player with configurable volume (default 50%).
(function(){
  if (typeof window === 'undefined') return;
  let _audio = null;
  let _volume = 0.5; // default 50%
  let _currentSrc = "";
  let _unlocked = false;
  let _pendingSrc = "";

  function clamp01(v){ return Math.max(0, Math.min(1, Number(v)||0)); }

  function init(){
    if (_audio) return _audio;
    try {
      _audio = new Audio();
      _audio.loop = true;
      _audio.preload = 'auto';
      _audio.volume = _volume;
      _audio.crossOrigin = 'anonymous';
  _audio.autoplay = false;
  // iOS Safari needs this to avoid fullscreen and allow inline playback
  _audio.playsInline = true;
    } catch(_){ /* ignore */ }
    return _audio;
  }

  function setVolume(v){
    _volume = clamp01(v);
    if (_audio) _audio.volume = _volume;
  }

  function getVolume(){ return _volume; }

  function _resolve(src){
    // Accept absolute URLs or relative paths as-is; callers should pass paths relative to mz/ root
    return String(src || "");
  }

  function _tryPlaySync(a){
    // Try normal play; on failure, try muted play then unmute
    try {
      const p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch(()=>{
          try {
            a.muted = true;
            const p2 = a.play();
            if (p2 && typeof p2.then === 'function') {
              p2.then(()=>{ setTimeout(()=>{ try { a.muted = false; a.volume = _volume; } catch(_){} }, 0); }).catch(()=>{});
            }
          } catch(_){}
        });
      }
    } catch(_){}
  }

  function play(src){
    const a = init();
    if (!a) return;
    const resolved = _resolve(src || _currentSrc);
    if (!resolved) return;
    if (!_unlocked){ _pendingSrc = resolved; return; }
    if (a.src !== resolved) { a.src = resolved; try { a.load(); } catch(_){} }
    _currentSrc = resolved;
    a.volume = _volume;
    _tryPlaySync(a);
  }

  function unlock(src){
    const a = init();
    _unlocked = true;
    const resolved = _resolve(src || _pendingSrc || _currentSrc);
    if (!a || !resolved) return;
    if (a.src !== resolved) { a.src = resolved; try { a.load(); } catch(_){} }
    _currentSrc = resolved;
    a.volume = _volume;
    _tryPlaySync(a);
    _pendingSrc = "";
  }

  function pause(){ if (_audio) { try { _audio.pause(); } catch(_){ } } }
  function stop(){ if (_audio) { try { _audio.pause(); _audio.currentTime = 0; } catch(_){ } } }
  function resume(){ if (_audio) { try { _audio.play(); } catch(_){ } } }

  window.music = {
    init,
    play,
  unlock,
    pause,
    stop,
    resume,
    setVolume,
  get isUnlocked(){ return _unlocked; },
    get volume(){ return getVolume(); },
    set volume(v){ setVolume(v); },
  };
})();
