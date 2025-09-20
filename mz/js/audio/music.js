/**
 * @fileoverview Simple, reliable looping music player for MZ game
 * @description Provides a single-instance HTML5 audio player with Web Audio API
 * filtering support. Designed for mobile-friendly music playback with explicit
 * user gesture unlock requirements and pitch-preserving playback rate control.
 * 
 * @author MZ Team
 * @version 1.0.0
 * 
 * @requires None - Standalone audio system
 * @exports {Object} Global music system methods added to window
 */

"use strict";

(function(){
  if (typeof window === 'undefined') return;

  // === Private State Variables ===
  /** @type {HTMLAudioElement|null} Single audio element for music playback */
  let _audio = null;
  
  /** @type {number} Master volume level (0.0 - 1.0) */
  let _volume = 0.20; // Default 20% volume
  
  /** @type {string} Currently loaded audio source URL */
  let _currentSrc = "";
  
  /** @type {boolean} Whether audio context has been unlocked by user gesture */
  let _unlocked = false;
  
  /** @type {string} Audio source pending unlock */
  let _pendingSrc = "";
  
  // === Web Audio API Components (for filtering) ===
  /** @type {AudioContext|null} Web Audio context for advanced processing */
  let _ctx = null;
  
  /** @type {MediaElementSourceNode|null} Source node connecting HTML audio to Web Audio */
  let _srcNode = null;
  
  /** @type {BiquadFilterNode|null} Lowpass filter for acceleration effects */
  let _filterNode = null;
  
  /** @type {boolean} Whether Web Audio graph is connected */
  let _wired = false;

  /**
   * Clamps value to 0-1 range
   * @param {number} v - Value to clamp
   * @returns {number} Clamped value between 0 and 1
   */
  function clamp01(v){ 
    return Math.max(0, Math.min(1, Number(v) || 0)); 
  }

  /**
   * Resolves and validates audio source URL
   * @param {string} src - Audio source URL
   * @returns {string} Validated source string
   */
  function _resolve(src){ 
    return String(src || ""); 
  }

  /**
   * Initializes the HTML5 audio element with optimal settings
   * Configures cross-origin, mobile playback, and pitch preservation settings.
   * 
   * @returns {HTMLAudioElement|null} Initialized audio element or null on failure
   */
  function init(){
    if (_audio) return _audio;
    
    try {
      _audio = new Audio();
      _audio.loop = true;
      _audio.preload = 'auto';
      _audio.volume = _volume;
      
      // Cross-origin settings for compatibility with sfx.js
      _audio.crossOrigin = 'anonymous';
      
      // Mobile-friendly playback settings
      _audio.playsInline = true;
      _audio.autoplay = false;
      
      // Configure pitch preservation for playback rate changes
      try {
        if ('preservesPitch' in _audio) _audio.preservesPitch = false;
        if ('mozPreservesPitch' in _audio) _audio.mozPreservesPitch = false;
        if ('webkitPreservesPitch' in _audio) _audio.webkitPreservesPitch = false;
      } catch(_){
        // Ignore pitch preservation errors on unsupported browsers
      }
    } catch(_){ 
      // Audio element creation failed
    }
    
    return _audio;
  }

  /**
   * Sets master volume level for music playback
   * @param {number} v - Volume level (0.0 - 1.0)
   */
  function setVolume(v){
    _volume = clamp01(v);
    if (_audio) {
      try { 
        _audio.volume = _volume; 
      } catch(_){
        // Volume setting failed
      }
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

  function setCurrentTimeSeconds(sec){
    const a = init();
    if (!a) return;
    try {
      const t = Math.max(0, Number(sec)||0);
      // If metadata not ready, set a.pending seek by attaching a one-shot handler
      if (isNaN(a.duration) || !isFinite(a.duration)){
        const handler = ()=>{ try { a.currentTime = t; } catch(_){ } a.removeEventListener('loadedmetadata', handler); };
        try { a.addEventListener('loadedmetadata', handler, { once: true }); } catch(_){ }
      } else {
        const dur = Number(a.duration)||0; a.currentTime = (dur > 0) ? (t % dur) : t;
      }
    } catch(_){ }
  }

  function getCurrentTimeSeconds(){ try { return _audio ? Number(_audio.currentTime)||0 : 0; } catch(_){ return 0; } }
  function getDurationSeconds(){ try { return _audio && isFinite(_audio.duration) ? Number(_audio.duration)||0 : 0; } catch(_){ return 0; } }
  function isReady(){ try { return !!(_audio && isFinite(_audio.duration) && _audio.duration>0); } catch(_){ return false; } }

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
  setCurrentTimeSeconds,
  getCurrentTimeSeconds,
  getDurationSeconds,
  isReady,
    get isUnlocked(){ return _unlocked; },
    get volume(){ return getVolume(); },
    set volume(v){ setVolume(v); },
  };
})();
