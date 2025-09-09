// Basic Voice Chat (Phase 1 & partial Phase 3) for initial two‑client test
// Strategy: Capture mic -> downsample 48k->8k -> frame 40ms (320 samples) -> on each 100ms update
// encode ONLY the latest frame (Codec2 450) via CLI-style WASM wrapper (createC2Enc). Send as base64.
// Receive: decode frame (createC2Dec), upsample to 48k, immediate playback via AudioBuffer.
// NOTE: This is an MVP; not optimized. High latency / choppiness acceptable for first test.
(function(){
  const MODE = '450';
  const SAMPLES_PER_FRAME = 320; // 40 ms @ 8k
  const UPDATE_INTERVAL_MS = 100; // matches multiplayer tick
  const voice = {
    enabled: false,
    captureCtx: null,
    micStream: null,
    seq: 0,
    latestFrame: null,        // Int16Array(320) most recent captured frame
    latestFrameSeq: -1,       // seq of latestFrame
    encodedCache: { seq: -1, b64: null }, // reuse if already encoded
    capturing: false,
    downBuf: new Int16Array(0),
    lastSendSeq: -1,
    stats: { framesCaptured:0, framesEncoded:0, framesSent:0, framesRecv:0, framesDecoded:0, encodeMsTotal:0, decodeMsTotal:0 },
    decoderQueue: [],          // incoming frames awaiting decode
    decoding: false,
    remote: new Map(),         // id -> { lastSeq }
    playbackCtx: null,
    wsLoaded: false,
    wasmLoading: false,
    wasmReady: false,
  };
  window.voiceState = voice;

  function log(){ try{ console.log('[VOICE]', ...arguments);}catch(_){} }

  // Lazy load WASM wrappers once
  async function ensureWasm(){
    if (voice.wasmReady || voice.wasmLoading) return new Promise(r=>{ const i=setInterval(()=>{ if (voice.wasmReady){ clearInterval(i); r(); } },50); });
    voice.wasmLoading = true;
    function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=()=>res(); s.onerror=e=>rej(e); document.head.appendChild(s); }); }
    await loadScript('./codec2/c2enc.js');
    await loadScript('./codec2/c2dec.js');
    voice.wasmReady = true; voice.wasmLoading=false; log('WASM ready');
  }

  // Capture pipeline (ScriptProcessor MVP)
  async function startCapture(){
    if (voice.capturing) return;
    await ensureWasm();
    // Secure origin requirement check
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        log('Insecure context blocks getUserMedia. Use https or localhost.');
        throw new Error('Insecure origin (need HTTPS for microphone)');
      }
    }
    // Legacy shim
    if (!navigator.mediaDevices) navigator.mediaDevices = {};
    if (!navigator.mediaDevices.getUserMedia) {
      const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
      if (legacy) {
        navigator.mediaDevices.getUserMedia = (constraints)=> new Promise((res,rej)=>legacy.call(navigator,constraints,res,rej));
      }
    }
    if (!navigator.mediaDevices.getUserMedia) {
      log('No getUserMedia available even after legacy shim.');
      throw new Error('getUserMedia not supported');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    } catch(e){
      log('User media error', e && e.name, e);
      throw e;
    }
    voice.micStream = stream;
    const ctx = new (window.AudioContext||window.webkitAudioContext)({ sampleRate:48000 });
    voice.captureCtx = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048,1,1);
    proc.onaudioprocess = (ev)=>{
      if (!voice.enabled){ return; }
      const ch = ev.inputBuffer.getChannelData(0);
      // Downsample naive decimation 48k->8k (ratio 6)
      const ratio = 6; const needed = Math.floor(ch.length/ratio);
      const out = new Int16Array(needed);
      for(let i=0;i<needed;i++){ let s = ch[i*ratio]; if (s>1) s=1; else if (s<-1) s=-1; out[i] = (s*32767)|0; }
      // Append to buffer
      let merged = new Int16Array(voice.downBuf.length + out.length); merged.set(voice.downBuf,0); merged.set(out, voice.downBuf.length); voice.downBuf = merged;
      // Frame extraction
      while (voice.downBuf.length >= SAMPLES_PER_FRAME){
        const frame = voice.downBuf.subarray(0, SAMPLES_PER_FRAME);
        voice.latestFrame = new Int16Array(frame); // copy to detach
        voice.latestFrameSeq = ++voice.seq & 0xFFFFFFFF;
        voice.stats.framesCaptured++;
        voice.downBuf = voice.downBuf.subarray(SAMPLES_PER_FRAME);
      }
    };
    src.connect(proc); proc.connect(ctx.destination);
    voice.capturing = true;
    log('Capture started');
  }

  function stopCapture(){
    voice.enabled = false;
    try { if (voice.captureCtx) voice.captureCtx.close(); } catch(_){ }
    try { if (voice.micStream){ for (const t of voice.micStream.getTracks()) t.stop(); } } catch(_){ }
    voice.capturing=false; voice.captureCtx=null; voice.micStream=null;
  }

  async function encodeLatest(){
    if (!voice.latestFrame || voice.latestFrameSeq === voice.encodedCache.seq) return; // already encoded
    const seq = voice.latestFrameSeq;
    const raw = voice.latestFrame;
    const t0 = performance.now();
    // CLI-style encode (writes input.raw -> output.bit)
    const bytes = await new Promise((resolve)=>{
      const module = { arguments:[MODE,'in.raw','out.bit'], preRun:()=>{ module.FS.writeFile('in.raw', new Uint8Array(raw.buffer)); }, postRun:()=>{ const buf = module.FS.readFile('out.bit',{encoding:'binary'}); resolve(buf); } };
      createC2Enc(module);
    });
    const t1 = performance.now();
    voice.stats.framesEncoded++; voice.stats.encodeMsTotal += (t1-t0);
    // Base64 encode
    let bin=''; for (let i=0;i<bytes.length;i++){ bin += String.fromCharCode(bytes[i]); }
    const b64 = btoa(bin);
    voice.encodedCache = { seq, b64 };
  }

  // Attach hook invoked by multiplayer before sending update
  window.__voiceAttachUpdate = async function(payload){
    if (!voice.enabled) return;
    try { await encodeLatest(); } catch(e){ log('encode err', e); return; }
    if (voice.encodedCache.seq >= 0 && voice.encodedCache.seq !== voice.lastSendSeq){
      payload.voice = { seq: voice.encodedCache.seq, ts: Date.now(), codec: 'c2-450', d: voice.encodedCache.b64 };
      voice.lastSendSeq = voice.encodedCache.seq; voice.stats.framesSent++;
    }
  };

  // Incoming handling
  window.__voiceOnIncoming = function(msg){
    if (!msg || !msg.voice) return;
    const v = msg.voice; const id = msg.id; if (!id || id === window.MP_ID) return; // skip self
    const rec = voice.remote.get(id) || { lastSeq:-1 }; // seq wrap simple check
    const seq = v.seq>>>0; const last = rec.lastSeq>>>0;
    const forward = (rec.lastSeq<0) || (seq>last && (seq-last)<(1<<31)) || ((last-seq)>(1<<31));
    if (!forward) return;
    rec.lastSeq = seq; voice.remote.set(id, rec);
    // queue decode
    voice.decoderQueue.push({ id, seq, b64:v.d });
    if (!voice.decoding) processDecodeQueue();
  };

  async function processDecodeQueue(){
    if (voice.decoding) return; voice.decoding = true;
    await ensureWasm();
    if (!voice.playbackCtx){ voice.playbackCtx = new (window.AudioContext||window.webkitAudioContext)(); }
    while (voice.decoderQueue.length && voice.enabled){
      const item = voice.decoderQueue.shift(); if (!item) break;
      let bytes; try { const bin = atob(item.b64); bytes = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); } catch(e){ continue; }
      const t0 = performance.now();
      const raw = await new Promise((resolve)=>{ const module = { arguments:[MODE,'in.bit','out.raw'], preRun:()=>{ module.FS.writeFile('in.bit', bytes); }, postRun:()=>{ const buf=module.FS.readFile('out.raw',{encoding:'binary'}); resolve(buf); } }; createC2Dec(module); });
      const t1 = performance.now(); voice.stats.decodeMsTotal += (t1-t0); voice.stats.framesDecoded++;
      // raw expected Int16 PCM 320 samples @8k
      const pcm8 = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset+raw.byteLength));
      // Upsample linear to 48k (factor 6)
      const outLen = pcm8.length * 6; const f32 = new Float32Array(outLen);
      for(let i=0;i<pcm8.length-1;i++){ const a=pcm8[i]/32768, b=pcm8[i+1]/32768; for(let k=0;k<6;k++){ const t=k/6; f32[i*6+k] = a + (b-a)*t; } }
      const last = pcm8[pcm8.length-1]/32768; for(let k=0;k<6;k++){ f32[outLen-6+k]=last; }
      const audioBuf = voice.playbackCtx.createBuffer(1, f32.length, 48000); audioBuf.copyToChannel(f32,0,0);
      const src = voice.playbackCtx.createBufferSource(); src.buffer = audioBuf; src.connect(voice.playbackCtx.destination); src.start();
      voice.stats.framesRecv++;
    }
    voice.decoding = false;
  }

  // UI toggle button
  // UI toggle button temporarily disabled/hidden per request.
  // Retain functions so voice feature can be re-enabled programmatically later.
  function ensureUIButton(){ /* intentionally no-op (button hidden) */ }
  // No DOMContentLoaded listener to avoid injecting the button.

  // Expose stats for debugging
  window.voiceGetStats = ()=> ({ ...voice.stats });
})();
