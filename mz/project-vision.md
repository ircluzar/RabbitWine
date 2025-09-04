# VRUN MZ — Project Worksheet

Source: see `mz/vision.md` for the high-level concept. This worksheet explodes every area into concrete tasks with checkboxes and acceptance criteria.

---

## Goals and Success Criteria

- [ ] Base render target is 480×720 (portrait). Game is touch-first and optimized for vertical displays.
- [ ] Canvas fills the browser viewport on any device/orientation; cameras adapt without changing internal render resolution.
- [ ] Dual 3D third-person viewports stacked vertically: Top = close bike view with tall walls, Bottom = far map view with flattened walls.
- [ ] Draggable seam between views with generous touch hitbox; moving seam adjusts cameras (zoom/tilt) and controls bike speed (more map = slower; less map = faster).
- [ ] Core loop: navigate, leave trail, trap ghosts via closed loop; maze tiles condemn over time.
- [ ] Tail rule: hitting your own tail does NOT kill you; it invalidates the current capture loop attempt.
- [ ] Visual style: rounded/soft look, glow trails, 256-color shader + mild ordered dithering.
- [ ] Audio: procedural SFX and minimal reactive music.
- [ ] 6+ consumables implemented with UI and balance.
- [ ] Level progression with increasing challenge, plus an endless mode.

---

## Milestones (Incremental Delivery)

### M0 — Project Setup (1–2 days)
- [x] Decide rendering stack: WebGL2 (raw) — documented rationale in `mz/docs_rendering.md`.
- [x] Minimal app shell under `mz/` with `index.html`, `main.js`, `styles.css`.
- [x] Mobile-first viewport meta, canvas sizing to fill viewport, DPR handling; portrait-first.
- [x] Base render at fixed 480×720 with letterboxed present; NEAREST scaling to fill screen while preserving aspect ratio.
- [ ] Dev build: simple local server and hot-reload (optional) documented in `mz/README.md`.
- [ ] Lint/format baseline (ESLint + Prettier) or skip to keep repo style.
- [x] Input logger: touch/mouse + keyboard fallback with HUD overlay.
Acceptance: Page loads without errors; canvas fills viewport; HUD shows pointer/key events; manual checklist recorded in commits.

### M1 — Core Scene + Dual Cameras + Grid (2–4 days)
- [ ] Grid/maze representation: tilemap data structure (uint8 grid with flags: solid, open, condemned, void).
- [x] Grid/maze representation: tilemap data structure (uint8 grid; OPEN/WALL placeholders for now).
- [ ] Two third-person cameras:
  - [x] Bike View (top): close angle placeholder via perspective; grid for reference.
  - [x] Map View (bottom): far/zoomed-out placeholder; grid for reference.
- [x] Viewport layout: two stacked sub-viewports in one framebuffer with adjustable split.
- [x] Seam handle UI element with generous touch target; drag updates layout in real time.
- [x] Camera adaptation: seam changes adjust camera zoom/tilt/FOV, not the internal render resolution. (placeholder implemented via camera params on shader grid)
- [x] Resize handling: canvas fills viewport; DPR-aware; seam maintains ratio.
  - Present path letterboxes to preserve 480×720 aspect; seam aligns to letterboxed area.
Acceptance: Two viewports render stacked with a draggable seam; placeholder grid shows distinct scales; stable 60 FPS on simple grid.
Update: Basic tile floor/walls render in both viewports before debug grid; performance remains smooth.

### M2 — Player Movement + Trail + Touch Controls (4–6 days)
- [x] Player entity: position, velocity, steering (arrow + A/D keys; swipe left/right on touch).
- [x] Primary input: touch swipes left/right to turn; keyboard fallback.
- [x] Seam-driven speed: scales baseline velocity with seam position.
- [x] Collision with walls (void/condemned TBD).
- [x] Trail generation: polyline with cap and min spacing.
- [ ] Trail rendering: glow/bloom look (placeholder line-strip now).
Acceptance: Basic control loop playable; speed reflects seam; walls block; trail draws. Glow/bloom deferred.

### M3 — Loop Detection + Ghost Interaction (5–7 days)
- [ ] Loop closure detection when trail intersects itself forming a closed region.
- [ ] Region test: determine if a ghost lies inside a newly closed loop (point-in-polygon).
- [ ] Loop collapse effect: closed loop shrinks inward and destroys ghosts within.
- [ ] Scoring + feedback on ghost kill.
Acceptance: Trapping a ghost with a loop consistently kills it; visuals/readout confirm.

### M4 — Ghosts + Maze Condemnation (4–6 days)
- [ ] Ghost entities: movement controller (wander + avoid walls).
- [ ] Condemnation mechanic: tiles behind ghost path convert to condemned then to void over a timer.
- [ ] Visuals for condemned vs. void; safe/unsafe state clearly readable.
- [ ] Basic difficulty scaling parameters (number of ghosts, speeds, condemnation rate).
Acceptance: Ghosts roam; leave dangerous tiles; area collapses over time.

### M5 — Consumables System (4–6 days)
- [ ] Spawn points/logic; pickup UI and durations.
- [ ] Implement effects:
  - [ ] Speed Boost
  - [ ] Ghost Magnet
  - [ ] Time Freeze
  - [ ] Trail Extend/Shorten (toggle)
  - [ ] Condemnation Shield
  - [ ] Light Burst
- [ ] Status HUD: active effects with timers.
Acceptance: Each consumable can be picked up; effect applies; UI shows state; no stacking bugs.

### M6 — Visual Style Pass (3–5 days)
- [ ] 256-color palette post-process with ordered dithering.
- [ ] Rounded aesthetic: soft corners on walls and trails (geometry or shader trick).
- [ ] Shimmer/specular oscillation on major objects.
- [ ] Ghost flicker near defeat.
- [ ] Maintain stylistic coherence across two simultaneously visible scales (close vs. map view).
Acceptance: Side-by-side screenshots match design intent across both viewports.

### M7 — Audio (3–4 days)
- [ ] Wire WebAudio; select instrument approach (WebAudio nodes vs. existing repo synth assets).
- [ ] SFX: trail hum (speed-linked), ghost chatter, loop-closure zap, consumable arps.
- [ ] Generative music bed with level-intensity parameter.
Acceptance: All listed SFX present; music intensity rises with level/danger.

### M8 — Progression + Levels (3–5 days)
- [ ] Level data format; few handcrafted mazes + parameters.
- [ ] Level escalation: ghosts count/AI, condemnation speed, spawn rules.
- [ ] Endless mode: periodic re-seeding or shifting maze.
Acceptance: 6+ levels playable; endless unlocked after set condition.

### M9 — UX + Polish (2–4 days)
- [ ] Title screen, pause, game over, results (score, bonus multipliers).
- [ ] Onboarding tips and control overlay.
- [ ] Visual juice: pulses, UI glow, subtle camera parallax.
Acceptance: Cohesive user flow from boot to gameplay to results.

### M10 — Performance, QA, and Release (3–5 days)
- [ ] Profiling and optimization (CPU: AI/geometry; GPU: passes/bandwidth).
- [ ] Smoke/regression tests; geometry/math unit tests.
- [ ] Build/host pipeline (static deploy; GitHub Pages or current site structure).
- [ ] README + credits + license.
Acceptance: Stable 60 FPS target; clean console; deployed URL.

---

## Systems Breakdown and Detailed Tasks

### 1) Rendering Pipeline
- [ ] Choose stack: raw WebGL2 vs. Three.js (note pros/cons in `docs/rendering.md`).
- [ ] Scene graph or ECS-lite for entities (player, ghosts, pickups, effects).
- [ ] Dual-camera composition: two sub-viewports in a single main framebuffer; stack vertically.
- [ ] Seam control: draggable handle adjusts viewport split; cameras adapt via zoom/FOV/tilt (no internal res change).
- [ ] Batching for floor/maze rendering; instancing for tiles if needed.
- [ ] Post-process chain: scene pass -> 256-color + ordered dithering -> UI pass (applied after composing both views).
- [ ] Palette management: configurable palette JSON; runtime swap for effects.
- [ ] Glow for trails: multi-pass blur or lightweight screen-space approach; per-view performance budgets.
- [ ] Render order: floor -> walls -> trails -> entities -> compose -> post -> HUD.
- [ ] DPR/responsiveness: canvas fills viewport on any device; preserve base 480×720 target; upscale/downscale sensibly.
Acceptance: Seam/camera adaptation works smoothly; post-process applies uniformly across both views.

### 2) Shaders
- [ ] Vertex: shimmer oscillation (time uniform); rounded corners via distance fields or normals hack.
- [ ] Fragment: palette quantization with serpentine/ordered dithering; avoid banding.
- [ ] Trail material: additive with falloff; inner core + outer halo.
- [ ] Ghost flicker thresholding; near-death pulse.
- [ ] Map view wall flattening: shader or material that visually compresses wall height cues (lighting/normal trick or alt material).
- [ ] Debug visualize: show normals, depth, palette index, and camera view masks.
Acceptance: Shader toggles show intended effect in both cameras; no major artifacts when resizing seam.

### 3) Maze & World
- [ ] Data: grid of tiles; enums: Wall, Open, Condemned, Void, Spawn, Pickup.
- [ ] Importer: load JSON maps; editor-friendly format.
- [ ] Generator (optional): simple procedural layouts (rooms + corridors). 
- [ ] Transition rules: Condemned -> Void time; rendering and collision update.
- [ ] Pathfinding graph extraction (for ghosts if needed).
- [ ] Debug overlay: heatmap of condemnation ages.
Acceptance: Maps load; state transitions animate and affect gameplay.

### 4) Player
- [ ] Input module: touch-first; swipe left/right to turn; vertical seam drag; mouse fallback; keyboard/gamepad optional.
- [ ] Gesture disambiguation: horizontal swipes for turning vs. vertical drag on seam; generous seam hitbox and visual handle.
 - [x] Gesture disambiguation: swipe-to-turn fires on drag; seam uses a small handle to avoid interference; canvas remains swipe-friendly.
- [ ] Movement model: top speed, acceleration, turn rate; speed scales with seam position.
- [ ] Collision with walls/void; sliding or bounce policy documented.
- [ ] Trail subsystem:
  - [ ] Segment append each tick; cap length by time/distance.
  - [ ] Simplify polyline (RDP tolerance) to reduce segment count.
  - [ ] Self-intersection detection to find closure candidates.
- [ ] Loop closure and tail rule:
  - [ ] Detect closed polygon at moment of intersection or proximity threshold.
  - [ ] Hitting own tail does NOT kill; it invalidates the current capture loop (reset loop candidate state only).
  - [ ] Compute polygon; prevent degenerate tiny loops.
  - [ ] Trigger loop collapse effect and damage ghosts inside.
Acceptance: Swipe turning and seam drag don’t conflict; speed changes predictably with seam; tail collision matches new rule.

### 5) Ghosts (AI)
- [ ] States: Wander, Probe, Aggro, Flee (near death), Pair (advanced).
- [ ] Steering: random walk with corridor bias; occasional target sampling (player/trail).
- [ ] Avoidance: wall proximity steering; condemned preferences (seek to expand decay).
- [ ] Condemnation writer: mark tiles passed; throttle frequency; prevent hard locks.
- [ ] Advanced behaviors (post-level 6): flanking (two-ghost coordination), blocking paths.
- [ ] Parameters per level: speed, jitter, aggression, condemnation radius.
Acceptance: Ghosts feel lively and threatening; parameters visibly change difficulty.

### 6) Condemnation & Collapse
- [ ] Tile state machine: Open -> Condemned (timer) -> Void.
- [ ] Visuals: color/texture differences; edge fracture shader on transition.
- [ ] Safety: ensure level is not soft-locked; keep at least one path to pickups.
- [ ] Edge cases: player on tile when it flips; grace period or knockback.
Acceptance: Clear readability; fair but tense shrinking play space.

### 7) Consumables & Toggles
- [ ] Spawn rules: density, min distance from player/ghosts, respawn timers.
- [ ] Effects implementation:
  - [ ] Speed Boost: +X% velocity; trail brightness up.
  - [ ] Ghost Magnet: attract nearest ghost (cap strength; avoid instant collisions).
  - [ ] Time Freeze: freeze ghosts for N seconds; visual tint.
  - [ ] Trail Extend/Shorten: adjust trail persistence live; clamp bounds.
  - [ ] Condemnation Shield: pause tile aging globally or in radius.
  - [ ] Light Burst: instant small loop around player; damage ghosts in ring.
- [ ] Stacking rules: queues vs. overwrite; display remaining durations.
- [ ] HUD chips: icons with timers; input to toggle extend/shorten.
Acceptance: All effects are audible/visible; risk-reward meaningful.

### 8) Scoring, Progression, and Levels
- [ ] Score events: ghost kill, consumables, survival bonus based on remaining safe area.
- [ ] Combo/multiplier system for fast successive kills.
- [ ] Level config schema with per-level tuning; loader.
- [ ] Win/lose conditions: all ghosts killed vs. survival timer; failure on crash.
- [ ] Endless: dynamic param curve; periodic mini-resets.
Acceptance: Scores feel fair; progression ramps naturally; seam-speed mechanic doesn’t create degenerate strategies.

### 9) UI/UX
- [ ] HUD: score, lives/health (if any), active effects, level/timer.
- [ ] Seam handle: high-contrast, touch-friendly; shows speed effect (icon or scale).
- [ ] Gesture orchestration: prevent scroll/zoom on mobile; passive listeners where needed; capture only game area.
- [ ] Menus: title, level select (debug), pause, results.
- [ ] Accessibility: colorblind-safe palette option; remappable controls (stretch goal).
- [ ] Feedback: screenshake/pulse on loop kill, ghost near-death flicker.
Acceptance: Clear info; seam easy to grab/drag on touch; no accidental page scrolls.

### 10) Audio
- [ ] SFX design doc: event list and parameterization.
- [ ] Synthesis: WebAudio or existing MIDI/sf2 tools in repo; abstraction layer.
- [ ] Music: tempo/intensity follows level danger metric; fade logic.
- [ ] Mix: limiter/compressor to avoid clipping; volume sliders.
Acceptance: Mix is clean; dynamic changes are noticeable and not fatiguing.

### 11) Performance & Tooling
- [ ] Perf HUD: frame time breakdown; entity counts; draw calls.
- [ ] Geometry budgets: max segments for trail; culling strategies.
- [ ] Mobile tests (primary): Android Chrome, iOS Safari; measure with Perf HUD.
- [ ] Prevent layout thrash: cache layout; use requestAnimationFrame; pointer events.
- [ ] Debug keys: toggle systems, slow-mo, freecam.
Acceptance: 60 FPS for target scenes on common phones; stable memory; no jank when dragging seam.

### 12) Testing & QA
- [ ] Unit tests for geometry math: polyline simplify, self-intersection, point-in-polygon, loop collapse.
- [ ] Deterministic seeds for AI to reproduce bugs.
- [ ] Gesture tests: swipe detection reliability; seam drag hitbox; multi-touch edge cases.
- [ ] Orientation/resize tests; prevent accidental browser navigation (back/forward swipe) and scroll.
- [ ] Playtest checklist; bug triage template.
- [ ] Crash/edge cases: pause during transitions; window resize; alt-tab audio.
Acceptance: Core math covered; gestures reliable; reproducible scenarios; low crash rate.

### 13) Build/Deploy/Docs
- [ ] Build script or simple static bundle; minify optional.
- [ ] Host under existing site structure; verify relative paths.
- [ ] `README` with controls, goals, credits; `CHANGELOG` for milestones.
- [ ] License/attributions for any third-party assets.
Acceptance: One-click or simple deploy; working public URL.

---

## Risks and Mitigations

- Loop detection robustness: Self-intersections can be noisy.
  - Mitigate with polyline simplification and intersection caching; unit tests.
- Performance of post-processing on low-end GPUs.
  - Profile; allow toggling glow strength and dithering resolution.
- Ghost AI pathing getting stuck or unfun.
  - Add light steering randomness; clamp to grid at intervals; tune.
- Readability of condemned vs. safe tiles.
  - Strong color/value separation and animated edges.

---

## Backlog (Nice-to-Haves)

- Multiplayer (versus/co-op).
- Boss ghosts with multi-hit patterns.
- Maze variants: circular arenas, shifting walls, ramps.
- Custom synth packs.
- Replays/ghost runs.

---

## Weekly Planner (Template)

- [ ] Week N: Focus area …
  - [ ] Task A
  - [ ] Task B
  - [ ] Review + demo capture

---

## Definition of Done (Per Feature)

- Code compiles/runs without console errors.
- Feature has acceptance criteria met and demo recorded (gif/webm).
- Basic unit tests added for any new math/algorithms.
- Performance checked vs. budget; no >5% frame spikes introduced.
- Docs updated (README or docs/). 
