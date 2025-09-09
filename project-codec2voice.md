# Project: Realtime Low‑Bitrate Voice (Codec2) for MZ Multiplayer

## Goal
Add low‑latency positional(ish) peer voice using existing WebSocket multiplayer channel, leveraging bundled `codec2` WASM encoder/decoder. Voice is attached to the existing player state update loop (10 Hz) as very small fragments (frames) so that every update may optionally carry the most recent compressed speech frame. Each client hears the latest frame from every other player, mixed locally.

---
## Key Principles
Add low‑latency proximity voice using existing WebSocket multiplayer channel, leveraging bundled `codec2` WASM encoder/decoder. We will use the **lowest supported Codec2 bitrate (450 bps mode)** to minimize bandwidth. Voice frames piggyback on the existing 10 Hz player updates (or are batched if multiple 450 bps frames occur between updates). Each client hears the latest frame from every other player, mixed locally with distance-based gain.
- Server stays stateless regarding voice history: only most recent frame per player (plus metadata) is kept.
- Extremely low bitrate using the minimum Codec2 mode: 450 bps (≈56 bytes/sec raw) to fit inside frequent updates with negligible overhead.
- Latency target: 150–250 ms mouth‑to‑ear (capture → encode → network → decode → playout buffer).
2. Resample to 8000 Hz (Codec2 typical) & frame into 40 ms windows for 450 bps (the mode list in `main.js` includes `450` and `450PWB`; we choose `450` narrowband). Lower rates often imply fixed frame durations—assume 40 ms here.
3. Encode each 40 ms frame with `c2enc.wasm` mode `450`. Approx bits per frame: 450 bps * 0.04 s ≈ 18 bits (packed to 3 bytes; actual container may align to a few bytes—empirically confirm). Base64 encode (≈4 bytes per frame after overhead).
4. On each positional `update` (currently every 100 ms), attach the **newest one or up to N (<=3)** pending 450 bps frames. Primary structure (single frame): `{ voice:{ seq, ts, codec:'c2-450', d:'<b64>' } }`. If batching later: `{ voice:{ seqStart, codec:'c2-450', frames:['b64','b64',...] } }`.
`codec`: value: `c2-450` (lowest supported) for v1. (Future optional: `c2-450pwb`, `c2-700c`, higher rates.)
5. Config constants to add:
   - `VOICE_MAX_B64 = 32`  (450 bps frame base64 expected << 32; tight cap detects malformed data)
   - `VOICE_ALLOWED_CODECS = {"c2-450"}` (future: add others if enabled)
   - `VOICE_MAX_FPS = 40` (450 bps frames every 25 ms worst case if we later move to 20 ms framing; we accept up to 40/s but typically generate 25/s at 40 ms) — still we only broadcast newest per 100 ms unless batching.
   - `VOICE_BATCH_MAX = 3` (max frames piggybacked in one update when batching is implemented)
```json
{
  "type":"update","id":"...","pos":{"x":..,"y":..,"z":..},"state":"good|ball","channel":"C","level":"L", "rotation":<opt>, "frozen":true|false,
  "voice": { "seq":123, "ts":1736453452345, "codec":"c2-450", "d":"BASE64" }
}
```
`voice` optional; included only if new frame(s) exist since previous send. We send newest single frame (v1) or a small batch (future) to avoid dropping content when capture >10 Hz. Duplicates deduped by `seq`.
`d`: base64 of compressed bytes (hard cap 32 bytes; expect 4–8 bytes after base64 for 450 bps frame packing overhead).
- Maintain a simple ring buffer for pending encoded frames (size 4–6). On each 100 ms `update`, attach newest (v1) or up to last 3 frames (upgrade) to minimize loss (450 bps payloads are tiny so batching cost negligible).
- Silence detection (VAD) optional later; initial version always encodes if `voice.enabled` is true (no push‑to‑talk). Extremely low bitrate means continuous transmission cost is minimal.
  - (Optional future) codec select to allow switching from 450 to higher bitrates if quality insufficient.
40 ms 450 bps frame ≈ 18 bits (packed). Empirically expect 3 raw bytes → base64 4 chars. Confirm by test harness; adjust cap if packing differs.
Base64 overhead negligible at this size (3 raw bytes → 4 chars = 4 bytes). If we send 1 frame per 40 ms (25 fps capture) but only include newest per 100 ms update, effective upstream voice inside updates ≈ 4 * 10 = 40 bytes/s plus JSON overhead (<120 bytes/s total). With batching of up to 3 frames/update: 12 bytes * 10 = 120 bytes/s.
```js
if (latestVoiceFrame && latestVoiceFrame.seq !== lastSentVoiceSeq) {
  payload.voice = {
    seq: latestVoiceFrame.seq,
    ts: Date.now(),
    codec: 'c2-450',
    d: latestVoiceFrame.b64
  };
  lastSentVoiceSeq = latestVoiceFrame.seq;
}
```
- Explicit user setting to enable voice (always-on while enabled) + persistent indicator; user can disable any time. Lowest bitrate minimizes unintended bandwidth use while enabled.
voice_codec: str
voice_ts: int
voice_data_b64: str  # raw latest frame
voice_updated_ms: int
```

### Server → Client Broadcast / Snapshot
- `update` echoes `voice` ONLY when the stored `voice_seq` changed since last broadcast to that channel+level audience.
- `snapshot.players[]` MAY (optionally) include a `voice` block for immediate seeding. (Optional for v1 – can skip to reduce snapshot size.)
- Consider separate message type `voice` (future) if decoupling needed; v1 piggybacks.

---
## Server Logic Additions (multi_server.py)
1. Parse `voice` object inside `validate_update` (size limits, base64 sanity, allowed codec enum, seq monotonic: allow > or wrap with large delta).
2. Store only latest; reject frame if larger than limit or too frequent (rate limit: max 25 frames / 5s per player ~ 200 ms average) to avoid flooding.
3. On broadcast: include `voice` only if (a) newly stored this tick AND (b) not older than e.g. 750 ms to avoid replaying stale frames after silence gap.
4. Cleanup: nothing special—voice data removed when player record expires.
5. Config constants to add:
   - `VOICE_MAX_B64 = 128`
   - `VOICE_ALLOWED_CODECS = {"c2-3200","c2-2400"}`
   - `VOICE_MAX_FPS = 25` (enforced by timestamp or last accept ms)

Minimal incremental change; no persistence needed.

---
## Client Architecture Additions
### Capture & Encode Pipeline
```
getUserMedia(audio)
  ↓
AudioWorklet (16-bit mono downmix + resample 48k→8k) in 128/256 frame pulls
  ↓ (accumulate until 40 ms = 320 samples)
Frame Buffer → call encodeFrame(codec2EncoderPtr, int16[320])
  ↓ compressed bytes (Uint8Array)
Base64 encode + push to outbound queue
```
- Maintain a simple ring buffer for pending encoded frames (size 2–3). On each 100 ms `update`, pop newest (or all? choose newest single) to attach.
- Silence detection (VAD) optional later; initial version always encodes if microphone enabled & push‑to‑talk active.

### Decode & Mix Pipeline
```
Incoming update.voice (seq, codec, data)
  ↓ de-dupe per player (seq cache)
Base64 decode → compressed bytes → decodeFrame() → PCM int16[320]
  ↓ push into player.jitterQueue (array of frames with serverRecvMs)
Mixer Worklet (runs at 48k):
  - Maintains resampler 8k→48k (zero-order hold or linear / WebAudio resample) per frame
  - Each render quantum, if output needs N samples, pull & mix from each player's resample buffer.
  - Simple attenuation: peak normalization or per-player gain (=1/numActive optional) to prevent clipping.
Output to destination
## Key Principles
- Minimal protocol expansion: reuse `update` & `snapshot` flows.
- Server stays stateless regarding voice history: only most recent frame per player (plus metadata) is kept.
- Extremely low bitrate to fit inside frequent updates without congestion. Target: Codec2 3200 bps (≈400 bytes/sec raw) or 2400 bps if needed.
- Latency target: 150–250 ms mouth‑to‑ear (capture → encode → network → decode → playout buffer).
- Simple, loss‑tolerant: if a frame is lost, we skip (no retransmit).
- Always-on capture while feature enabled (no push‑to‑talk). A single user setting toggles voice chat globally on/off client‑side.
- Distance / proximity based loudness: players within a comfortable radius hear each other at full volume; outside that zone volume attenuates smoothly toward 0 without rapid wobble.
- Anti-wobble smoothing & hysteresis so micro movements do not cause perceptible volume pumping.
- Local mute list & master enable toggle; rate limiting & size caps server‑side.
- For each `playerId`: track `lastSeq` (uint32). Accept if `(newSeq > lastSeq)` OR wrap (`lastSeq - newSeq > 2^31`). Reject duplicates.
### Configuration (Globals / Settings UI)
- `voice.enabled` (default false; when true mic is always streaming frames)
- `voice.codec` select (3200 / 2400) – maybe dynamic.
- `voice.volumes` map for per-player override & mute.
- `voice.distanceModel` params (tunable constants, likely hidden from normal UI):
  - `R_FULL` (meters / world units) radius for full volume plateau.
  - `R_MAX` max hearing radius beyond which volume=0.
  - `VOL_CURVE` choice (e.g. 'smoothstep', 'linear', 'exp').
  - `SMOOTH_ALPHA` for exponential smoothing of per-player gain.
  - `HYSTERESIS_EPS` small deadband in effective distance to prevent chatter.
- `voice.codec` select (3200 / 2400) – maybe dynamic.
### Capture & Encode Pipeline
- Silence detection (VAD) optional later; initial version always encodes if `voice.enabled` is true (no push‑to‑talk).

### Decode & Mix Pipeline
Mixer Worklet (runs at 48k):
  - Maintains resampler 8k→48k (zero-order hold or linear / WebAudio resample) per frame
  - Each render quantum, if output needs N samples, pull & mix from each player's resample buffer.
  - Applies distance-based gain per player (see Proximity Volume Model) with smoothing & hysteresis.
  - Optional global normalization (=1/numActive) to prevent clipping.
- 40 ms frame contains 3200 * 0.04 = 128 bits = 16 bytes (typical for some modes).
We treat positional distance between local player (listener) and remote player (talker) using existing position updates.

### Distances & Curve
- `d` = Euclidean distance in world units (or horizontal distance if vertical difference shouldn't attenuate strongly).
- Full-volume plateau inside `R_FULL` (e.g. 6.0 units): gain = 1.0.
- Fade region between `R_FULL` and `R_MAX` (e.g. 6.0 → 28.0 units).
- Beyond `R_MAX`: gain = 0.

### Suggested Curve
Use a smoothstep-based ease to avoid abrupt transitions:
```
if d <= R_FULL: g = 1
elif d >= R_MAX: g = 0
else:
    t = (d - R_FULL) / (R_MAX - R_FULL)  # 0→1
    # smootherstep (6t^5 - 15t^4 + 10t^3)
    s = t*t*t*(t*(t*6 - 15) + 10)
    g = 1 - s
```

### Anti-Wobble Techniques
1. Distance Quantization: compute effective distance `d_eff = round(d * Q) / Q` with Q=10 (0.1 unit precision) so small jitter does not change gain.
2. Deadband / Hysteresis: keep last distance; if |d - last_d| < 0.05 keep last_d.
3. Exponential Smoothing of gain per player:
```
g_smooth = (1 - α) * g_prev + α * g_raw   # α ≈ 0.15
```
4. Update gain only when a new position update arrives (10 Hz) rather than every audio frame; inside Worklet use the smoothed gain.

### Additional Considerations
- Clamp minimal gain for *audible hint* (e.g. if g would be between 0 and 0.02 set to 0) to avoid far-away faint noise.
- Optionally apply a short (15 ms) fade ramp when gain changes sharply to prevent clicks.

### Spatialization (Not v1)
- We are NOT doing panning yet; only scalar gain. Future: stereo pan by horizontal angle; distance-based low-pass filter.

- Base64 overhead ≈ 4/3 → ~22 bytes per frame.
- Sending 1 frame every 100 ms (10 Hz) => 10 * 22 = 220 bytes/s per speaking player (plus JSON overhead). Well within typical constraints.
### Phase 4 – UX & Controls
- Add voice enable/disable toggle (always-on when enabled) + indicator (mic icon lit while enabled, NOT per-frame activity yet).
- Mute self / mute others list; persistence in `localStorage`.
- Settings modal integration (distance model constants hidden or advanced section).

---
## Recommended Initial Implementation Order
### Phase 0 – Sandbox Validation
- Load `c2enc.wasm` / `c2dec.wasm` directly in a test HTML page.
- Hardcode a recorded PCM sample; encode → decode → play; verify timing & payload sizes.

### Phase 1 – Client Encode Path
- AudioWorklet for 8 kHz mono capture & framing.
- Codec2 WASM init & single frame encode baseline.
- Outbound ring of frames (newest only selection).
## Edge Cases & Mitigations
| Issue | Mitigation |
|-------|------------|
| Burst / flooding | Rate limit accept (VOICE_MAX_FPS), size cap, drop excess. |
| Out of order seq | Accept if uint32 distance < 2^31 and greater than last (wrap logic). |
| Lost frames | Jitter buffer + hold last frame one interval. |
| High latency users | Larger jitter buffer (configurable), but keep default small to preserve low latency. |
| Browser denial of mic | Feature disabled gracefully; UI shows warning; auto sets `voice.enabled = false`. |
| Muting player | Client discards frames or sets gain=0 for that ID. |
| Self playback / feedback | Skip mixing own ID. |
| Different codecs future | Include codec id per frame; decoder selects matching instance. |
| Volume pumping near boundary | Plateau (`R_FULL`) + distance quantization + smoothing + hysteresis. |
| Listener inside crowded area | Optional normalization (divide by sqrt(N) or soft limiter). |

## Security / Privacy Considerations
- Explicit user setting to enable voice (always-on while enabled) + persistent indicator; user can disable any time.
- No server retention beyond most recent frame; ephemeral.
- Potential future: profanity detection / abuse reporting (out of scope v1).
- Option: auto-disable capture when tab hidden (configurable) to reduce unintended background capture.

## Immediate TODO Checklist
- [ ] Phase 0 test page with codec2 wasm roundtrip.
- [ ] Add server constants + Player fields + accept logic.
- [ ] Implement client AudioWorklet capture + resample 48k→8k.
- [ ] Integrate encode + attach voice field in update.
- [ ] Implement receive decode + simple JS mixer.
- [ ] Voice enable/disable toggle & mute UI.
- [ ] Implement proximity gain curve (R_FULL/R_MAX) + smoothing + hysteresis.
- [ ] QA latency, intelligibility, and gain stability (ensure no pumping in plateau zone).
- [ ] Refactor mixer into AudioWorklet; add small jitter buffer.
- [ ] Documentation: user instructions & troubleshooting.

### Phase 5 – Quality & Optimization
- Optional: Batch frames in updates to reduce choppiness.
- Add basic energy VAD to skip silent frames (threshold on RMS of 40 ms window).
- Move to delta frequency of updates: decouple voice send timer from position (e.g. 25 Hz voice, still 10 Hz position) if required (would then justify separate message type).

## Open Questions (Decide Early)
1. Single frame vs. batch frames per update? (Start single; revisit.)
2. 20 ms vs 40 ms frames? (Start 40 ms for simplicity; can lower for latency.)
3. Where to resample (Worklet vs JS)? (Worklet.)
4. Do we send voice in snapshots? (Skip in v1; reduces complexity.)
5. Fallback if codec2 fails to init? (Disable feature & UI message.)
6. Should attenuation ignore vertical distance (use 2D) for multi-level maps? (Likely yes initially.)
7. Normalization strategy when many nearby speakers? (Soft limiter vs per-speaker scaling.)
### Phase 6 – Hardening
- Abuse prevention: server discard > VOICE_MAX_FPS.
- Metrics endpoints (counts of voice frames/s accepted, dropped, active talkers).
- Graceful degradation if wasm fails (disable feature, warn UI).

---
## Data Structures (Client)
```ts
interface VoiceFrame { seq:number; pcm:Int16Array; msPerFrame:number; tsRecv:number; }
interface PlayerVoiceBuffer {
  lastSeq:number;
  queue: VoiceFrame[]; // jitter buffer (FIFO)
  resampleState: { frac:number; lastSample:number };
  muted:boolean;
}
```
Mixer Worklet shared memory (optional optimization):
- Ring buffer per player in SharedArrayBuffer for zero-copy decode insertion.
- For v1, simple message passing (postMessage) adequate (small payloads).

---
## Minimal Code Snippets (Illustrative Only)
### Outbound Attach (client)
```js
if (latestVoiceFrame && latestVoiceFrame.seq !== lastSentVoiceSeq) {
  payload.voice = {
    seq: latestVoiceFrame.seq,
    ts: Date.now(),
    codec: currentCodecId, // 'c2-3200'
    d: latestVoiceFrame.b64
  };
  lastSentVoiceSeq = latestVoiceFrame.seq;
}
```
### Server Update Handling (pseudo)
```python
vobj = data.get('voice')
if vobj:
    b64 = vobj.get('d','')
    if len(b64) <= VOICE_MAX_B64 and vobj.get('codec') in VOICE_ALLOWED_CODECS:
        seq = int(vobj.get('seq',0)) & 0xffffffff
        if should_accept(player.voice_seq, seq, now_ms):
            player.voice_seq = seq
            player.voice_codec = vobj['codec']
            player.voice_ts = int(vobj.get('ts', now_ms))
            player.voice_data_b64 = b64
            player.voice_updated_ms = now_ms
            include_voice_in_broadcast = True
```

---
## Edge Cases & Mitigations
| Issue | Mitigation |
|-------|------------|
| Burst / flooding | Rate limit accept (VOICE_MAX_FPS), size cap, drop excess. |
| Out of order seq | Accept if uint32 distance < 2^31 and greater than last (wrap logic). |
| Lost frames | Jitter buffer + hold last frame one interval. |
| High latency users | Larger jitter buffer (configurable), but keep default small to preserve low latency. |
| Browser denial of mic | Feature disabled gracefully; UI shows warning. |
| Muting player | Client simply discards frames from muted IDs. |
| Self playback / feedback | Do not enqueue self frames (or set muted flag for own ID). |
| Different codecs future | Include codec id per frame; decoder selects matching instance. |

---
## Security / Privacy Considerations
- Explicit user action to enable mic (push‑to‑talk or toggle) + indicator.
- No server retention beyond most recent frame; ephemeral.
- Potential future: profanity detection / abuse reporting (out of scope v1).
- Disable automatically when tab hidden (optional energy saving).

---
## Testing Strategy
1. Offline encode/decode fidelity: compare waveform RMS diff, basic intelligibility test.
2. Latency measurement: inject a clap sound; measure capture to playback by logging timestamps at encode & decode mix insertion.
3. Packet loss simulation: randomly drop X% update.voice; subjective quality check.
4. Load test: 20 synthetic talkers (simulated clients) verifying server throughput & no memory growth.

---
## Success Criteria (v1)
- < 300 ms end‑to‑end latency under nominal conditions (single LAN client pair).
- Position updates unaffected (no noticeable increase in jitter or size > ~1 KB/update).
- CPU overhead < 10% on mid‑range laptop when 5 concurrent talkers.
- Graceful disable on unsupported browser (no console spam after first warning).

---
## Future Enhancements (Not in v1)
- Spatialization (panning & distance attenuation) using Web Audio `PannerNode` (requires positional audio framework tie‑in).
- Server mix option (centralized) for bandwidth reduction (trade: server CPU).
- Adaptive bitrate (switch Codec2 mode based on packet loss or RTT).
- Silence suppression + comfort noise (CNG).
- WebRTC fallback path for richer voice if needed (kept separate from minimal WS path).

---
## Immediate TODO Checklist
- [ ] Phase 0 test page with codec2 wasm roundtrip.
- [ ] Add server constants + Player fields + accept logic.
- [ ] Implement client AudioWorklet capture + resample 48k→8k.
- [ ] Integrate encode + attach voice field in update.
- [ ] Implement receive decode + simple JS mixer.
- [ ] Add push‑to‑talk & mute UI.
- [ ] QA latency & quality; adjust frame size if needed.
- [ ] Refactor mixer into AudioWorklet; add small jitter buffer.
- [ ] Documentation: user instructions & troubleshooting.

---
## Open Questions (Decide Early)
1. Single frame vs. batch frames per update? (Start single; revisit.)
2. 20 ms vs 40 ms frames? (Start 40 ms for simplicity; can lower for latency.)
3. Where to resample (Worklet vs JS)? (Worklet.)
4. Do we send voice in snapshots? (Skip in v1; reduces complexity.)
5. Fallback if codec2 fails to init? (Disable feature & UI message.)

---
## Summary
This plan integrates ultra‑low bitrate speech with minimal protocol changes by embedding the latest Codec2 frame in existing movement updates. Complexity stays client‑side (capture, encode/decode, jitter, mix). Server impact is slight: store & forward the most recent frame. Incremental phases allow early validation before investing in advanced features like batching, VAD, or spatial audio.

---
## Work Breakdown & Tracking Worksheet
Legend: ☐ = not started, ◐ = in progress (manually change to `- [ ]` -> `- [x]` or add notes), ✔ = done

### Phase 0 – Sandbox Validation (Codec2 450 bps)
- [x] P0.1 Verify WASM modules load (`c2enc.js/.wasm`, `c2dec.js/.wasm`). (voice-test.html loader)
- [x] P0.2 Build tiny page: capture mic 1s → encode (mode 450) → decode → play back. (`mz/voice-test.html`)
- [x] P0.3 Log raw frame byte length (confirm expected ~3 bytes/frame @40 ms; record actual). (Console log in test page)
- [ ] P0.4 Measure encode/decode time per frame (target << 2 ms on typical machine).
- [ ] P0.5 Decide if batching needed immediately (if >1 frame produced between 100 ms updates) – document.

### Phase 1 – Client Encode Path
- [x] P1.1 Implement `AudioWorkletProcessor` for mic capture (mono 48 kHz → 8 kHz). (MVP uses ScriptProcessor; Worklet deferred)
  - [x] P1.1.a Downmix & convert Float32 → Int16. (Decimation loop)
  - [x] P1.1.b Simple linear resample (opt: incremental state) 48k→8k. (Naive decimation; refine later)
- [x] P1.2 Frame aggregator (collect 320 samples = 40 ms) push to encode queue.
- [x] P1.3 WASM encoder init & reuse encoder instance. (Per-frame module; optimize later)
- [x] P1.4 Encode loop: pop frame → get compressed bytes → base64 encode.
- [ ] P1.5 Ring buffer (capacity 6) store latest encoded frames + seq numbers. (Deferred; latest-only cache)
- [x] P1.6 Expose debug metrics (`window.voiceGetStats()`).

### Phase 2 – Server Protocol Extension
- [x] P2.1 Add constants (`VOICE_ALLOWED_CODECS={'c2-450'}`, `VOICE_MAX_B64=32`, `VOICE_MAX_FPS=40`).
- [x] P2.2 Extend `validate_update` to parse optional `voice` object.
- [x] P2.3 Add voice fields to `Player` dataclass (seq, codec, ts, data, updated_ms).
- [x] P2.4 Add monotonic / wrap sequence accept function (inline logic implemented).
- [x] P2.5 Rate limit: drop if <25 ms since last accepted frame (derives from `VOICE_MAX_FPS`).
- [x] P2.6 Broadcast path: include `voice` only if new this tick and age < 750 ms.
- [ ] P2.7 Snapshot optional inclusion (flag; default off v1). (Deferred / not needed yet)
- [x] P2.8 Logging: count accepted & dropped frames (global counters added + voice_stats query).
- [ ] P2.9 Basic unit test (optional) or manual test script for sequence logic. (Pending)

### Phase 3 – Client Receive + Decode + Basic Mix
- [x] P3.1 Data structure: simplified `remote` map with lastSeq.
- [x] P3.2 Dedup / wrap sequence logic mirror server.
- [x] P3.3 Base64 decode & call WASM decoder.
- [ ] P3.4 Jitter buffer: target 2 frames (80 ms) start threshold. (Pending)
- [x] P3.5 Simple JS mixer prototype (immediate per-frame playback only).
- [ ] P3.6 Replace with `AudioWorklet` mixer (48 kHz) pulling from per-player buffers.
- [x] P3.7 Resample 8 kHz→48 kHz (linear) per decoded frame (inline).
- [ ] P3.8 PLC (packet loss concealment) (Pending)
- [ ] P3.9 Debug overlay (Pending)

### Phase 4 – UX & Controls
- [x] P4.1 Global toggle (enable/disable voice) persists to `localStorage`.
- [ ] P4.2 Mute list UI (per-player) persists. (Pending)
- [x] P4.3 Visual mic active indicator (button text updates; simple states OFF/ON/ERR).
- [ ] P4.4 Settings fields for advanced (R_FULL, R_MAX) in hidden/advanced panel. (Pending)
- [x] P4.5 Error states: mic denied; wasm init fail → disable feature gracefully (error label & alert).

### Phase 5 – Proximity Gain & Quality
- [ ] P5.1 Implement distance calculation (likely horizontal only / ignore Y option).
- [ ] P5.2 Smootherstep gain curve R_FULL→R_MAX.
- [ ] P5.3 Hysteresis (deadband) & quantization.
- [ ] P5.4 Exponential smoothing (alpha ~0.15) per player.
- [ ] P5.5 Optional normalization when >N (config threshold) active talkers.
- [ ] P5.6 Microbench: ensure mix worklet <2 ms per render quantum with 10 talkers.
- [ ] P5.7 Tune constants to avoid pumping (record before/after logs).

### Phase 6 – Optimization / Hardening
- [ ] P6.1 Batch frames (up to VOICE_BATCH_MAX=3) if measurable speech choppiness observed.
- [ ] P6.2 Optional lightweight VAD (RMS threshold) to skip silence frames.
- [ ] P6.3 Add counters: dropped (rate limit), decoded, mixed, underruns.
- [ ] P6.4 Fail-safe: auto-disable if consecutive decoder errors > X.
- [ ] P6.5 Memory audit (ensure queues bounded, no growth).
- [ ] P6.6 Documentation update (README / user help panel).

### Phase 7 – Testing & Verification
- [ ] T7.1 Latency measurement harness (encode ts → mix insertion ts).
- [ ] T7.2 Packet loss simulation (drop p% updates) subjective clarity rating.
- [ ] T7.3 Load test script: spawn N synthetic clients (no mic) replay canned frames.
- [ ] T7.4 Cross-browser sanity (Chrome, Firefox, Edge) for WASM & Worklets.
- [ ] T7.5 Mobile feasibility check (throttle CPU) — optional.

### Phase 8 – Release Prep
- [ ] R8.1 Final pass: remove verbose console logs (keep metrics behind flag).
- [ ] R8.2 Version bump / changelog entry.
- [ ] R8.3 Feature toggle default (decide enabled or disabled by default for new users).
- [ ] R8.4 Crash / error telemetry hooks (optional).

### Stretch / Future (Unscored)
- [ ] S.F1 Stereo panning by relative azimuth.
- [ ] S.F2 Distance-based LPF for realism.
- [ ] S.F3 Adaptive bitrate (switch 450 ↔ 700C on low loss).
- [ ] S.F4 Comfort noise insertion for extended silence.
- [ ] S.F5 WebRTC hybrid path for high-fidelity rooms.

### Quick Status Dashboard (fill manually)
| Phase | Core Goal | Status | Notes |
|-------|-----------|--------|-------|
| 0 | WASM validate & frame size | ◐ | Test page created; need timing metrics (P0.4) |
| 1 | Capture & encode pipeline | ◐ | MVP (ScriptProcessor) working; ring buffer & Worklet pending |
| 2 | Server protocol & storage | ◐ | Core relay implemented; snapshot inclusion & tests pending |
| 3 | Decode & basic mixing | ◐ | Immediate playback; jitter buffer & PLC pending |
| 4 | UX toggles & mute | ◐ | Toggle + persistence + error UX done; mute UI pending |
| 5 | Proximity gains tuning | ☐ | |
| 6 | Optimization & batching | ☐ | |
| 7 | Testing & validation | ☐ | |
| 8 | Release prep | ☐ | |

