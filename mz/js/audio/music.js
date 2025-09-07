"use strict";
// Simple, reliable looping music player modeled after sfx.js behavior.
// - Single HTMLAudioElement instance
// - Explicit unlock gated by a user gesture (mobile-friendly)
// - No muted/unmute hacks; play is attempted directly within/until after the gesture
// - Minimal API compatibility with prior music.js
(function(){
  if (typeof window === 'undefined') return;

  let _audio = null;
  let _volume = 0.20; // default 50%
  let _currentSrc = "";
  let _unlocked = false;
  let _pendingSrc = "";
  // Optional Web Audio for filtering during first acceleration
  let _ctx = null; // AudioContext
  let _srcNode = null; // MediaElementSourceNode
  let _filterNode = null; // BiquadFilterNode (lowpass)
  let _wired = false; // whether the graph is connected

  function clamp01(v){ return Math.max(0, Math.min(1, Number(v)||0)); }

  function _resolve(src){ return String(src || ""); }

  function init(){
    if (_audio) return _audio;
    try {
      _audio = new Audio();
      _audio.loop = true;
      _audio.preload = 'auto';
      _audio.volume = _volume;
      // Match sfx.js behavior for consistency
      _audio.crossOrigin = 'anonymous';
      // iOS inline playback hint
      _audio.playsInline = true;
      _audio.autoplay = false;
      // Default: allow pitch to change with playbackRate
      try {
        if ('preservesPitch' in _audio) _audio.preservesPitch = false;
        if ('mozPreservesPitch' in _audio) _audio.mozPreservesPitch = false;
        if ('webkitPreservesPitch' in _audio) _audio.webkitPreservesPitch = false;
      } catch(_){}
    } catch(_){ /* ignore */ }
    return _audio;
  }

  function setVolume(v){
    _volume = clamp01(v);
    if (_audio) {
      try { _audio.volume = _volume; } catch(_){}
    }
  }
  function getVolume(){ return _volume; }

  function _setSrcIfNeeded(a, src){
    if (!a) return false;
    if (src && a.src !== src){
      try { a.src = src; } catch(_){ /* ignore */ }
      return true;
    }
    return false;
  }

  function _attemptPlay(a){
    try {
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(()=>{});
    } catch(_){}
  }

  function _ensureWebAudio(){
    try {
      if (!_ctx){
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx){
          try {
            // Prefer higher-latency playback mode to reduce risk of underflow/pops
            _ctx = new Ctx({ latencyHint: 'playback' });
          } catch(_){
            _ctx = new Ctx();
          }
        }
      }
      if (_ctx && _audio && !_srcNode){
        _srcNode = _ctx.createMediaElementSource(_audio);
      }
      if (_ctx && !_filterNode){
        _filterNode = _ctx.createBiquadFilter();
        _filterNode.type = 'lowpass';
        _filterNode.frequency.value = 18000;
        _filterNode.Q.value = 0.707;
      }
      if (_ctx && _srcNode && _filterNode && !_wired){
        // Connect once: source -> filter -> destination
        _srcNode.connect(_filterNode);
        _filterNode.connect(_ctx.destination);
        _wired = true;
      }
      if (_ctx && _ctx.state === 'suspended'){
        _ctx.resume().catch(()=>{});
      }
    } catch(_){}
  }

  function setPlaybackRate(rate){
    const a = init();
    if (!a) return;
    try { a.playbackRate = Math.max(0.25, Math.min(4.0, Number(rate)||1)); } catch(_){}
  }

  function play(src){
    const a = init();
    if (!a) return;
    const resolved = _resolve(src || _currentSrc);
    if (!resolved){ return; }
    if (!_unlocked){ _pendingSrc = resolved; return; }
    _currentSrc = resolved;
    _setSrcIfNeeded(a, resolved);
    a.loop = true;
    a.volume = _volume;
  _ensureWebAudio();
    _attemptPlay(a);
  }

  function unlock(src){
    const a = init();
    _unlocked = true;
    const resolved = _resolve(src || _pendingSrc || _currentSrc);
    if (!a || !resolved){ return; }
    _currentSrc = resolved;
    _setSrcIfNeeded(a, resolved);
    a.loop = true;
    a.volume = _volume;
    _ensureWebAudio();
    // Attempt immediate playback inside the gesture call stack
    _attemptPlay(a);
    _pendingSrc = "";
  }

  function pause(){ if (_audio) { try { _audio.pause(); } catch(_){ } } }
  function stop(){ if (_audio) { try { _audio.pause(); _audio.currentTime = 0; } catch(_){ } } }
  function resume(){ if (_audio && _unlocked) { try { _attemptPlay(_audio); } catch(_){ } } }

  function setPlaybackRate(rate){
    const a = init();
    if (!a) return;
    try { a.playbackRate = Math.max(0.25, Math.min(4.0, Number(rate)||1)); } catch(_){}
  }

  function setPreservesPitch(flag){
    const a = init();
    if (!a) return;
    try {
      if ('preservesPitch' in a) a.preservesPitch = !!flag;
      if ('mozPreservesPitch' in a) a.mozPreservesPitch = !!flag;
      if ('webkitPreservesPitch' in a) a.webkitPreservesPitch = !!flag;
    } catch(_){}
  }

  function setFilterCutoffHz(hz){
    _ensureWebAudio();
    if (_filterNode){
      try { _filterNode.frequency.value = Math.max(40, Math.min(20000, Number(hz)||20000)); } catch(_){}
    }
  }

  function setFilterProgress(u){
    // u: 0..1 -> lowpass cutoff from gentle (a bit muffled) to open
    const t = Math.max(0, Math.min(1, Number(u)||0));
    // Map 1.6kHz -> 18kHz
    const hz = 1600 + (18000 - 1600) * t;
    setFilterCutoffHz(hz);
  }

  window.music = {
    init,
    play,
    unlock,
    pause,
    stop,
    resume,
    setVolume,
  setPlaybackRate,
  setPreservesPitch,
  setFilterCutoffHz,
  setFilterProgress,
    get isUnlocked(){ return _unlocked; },
    get volume(){ return getVolume(); },
    set volume(v){ setVolume(v); },
  };
})();
