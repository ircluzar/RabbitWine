# Project Plan: Mobile "Safe-Mode" Editor Extension

Created: 2025-09-22  
Owner: (add owner)  
Related Core File(s): `mz/js/ui/editor.js` (+ supporting UI/CSS/asset files)  
Document Status: Draft (v0.1)

---
## 1. Goal / Executive Summary
Enable a lightweight, touch-friendly "safe-mode" version of the existing editor when the site is accessed on mobile devices (phones + small tablets) **without changing or regressing desktop behavior**. All current block types must remain add/remove capable; advanced desktop-only affordances (multi-panel layout, dense toolbars, drag precision, advanced shortcuts) may be simplified or deferred in safe‑mode.

---
## 2. Scope
### In Scope
- Runtime mobile detection & opt-in override.
- A reduced, resilient UI layer ("safe-mode editor shell").
- Responsive / adaptive layout & larger hit targets.
- Block lifecycle parity: add, select, edit minimal properties, reorder, delete.
- Minimal contextual toolbar or bottom sheet for actions.
- Keyboard / virtual keyboard coexistence (avoid viewport jump issues).
- Performance safeguards for lower memory / CPU environments.

### Out of Scope (Initial Phase)
- Full feature parity of advanced desktop editing shortcuts.
- Complex drag & drop gestures if they introduce instability (may provide tap-based reorder alternative initially).
- Offline sync / PWA storage beyond what already exists (future enhancement).

---
## 3. Success Criteria / Acceptance
| Category | Criteria |
|----------|----------|
| Desktop Regression | No behavioral or visual regression (pixel diff tolerance < 3% on key screens; all existing tests pass). |
| Mobile Detection | Devices with width < 900px or explicit query param `?editorMode=safe` auto-load safe-mode shell. |
| Block Operations | 100% of supported block types can be added, minimally configured, reordered, and removed. |
| Usability | Tap targets ≥ 44px; all primary actions reachable within 2 taps. |
| Performance | First interactive < 3s on mid-tier mobile (Chrome/Android, Safari/iOS); memory peak < 60% of desktop editor baseline for same document. |
| Stability | No uncaught exceptions introduced (error log parity with baseline). |
| Accessibility | Basic focus order & ARIA labels for toolbar/actions; color contrast AA for new UI elements. |
| Opt-Out | User can switch to full desktop editor via explicit toggle if desired (and revert). |

---
## 4. Constraints & Principles
1. **Non-invasive**: Prefer additive modules / feature flag branching over editing core desktop logic.  
2. **Progressive Enhancement**: Load safe-mode scaffold first, then conditionally hydrate advanced pieces if resources allow (future).  
3. **Isolation**: Introduce a namespaced wrapper (e.g., `SafeEditor`) that composes existing editor primitives rather than forking logic.  
4. **Fail Safe**: On detection ambiguity or runtime error during safe-mode init, fallback gracefully to desktop editor (with warning banner).  
5. **Low Coupling**: New CSS in a dedicated file (e.g., `editor.safe.css`) loaded conditionally to avoid cascade conflicts.

---
## 5. High-Level Architecture
```
[ Device / Query Detection ]
          |
          v
  Mode Resolver ------------------------------------
  |        (desktop) -> existing init path          |
  |        (safe)    -> SafeModeBootstrap           |
          |                                          
          v                                          
  SafeModeBootstrap
    - Lightweight state adapter
    - Block registry proxy
    - Event abstraction layer (tap vs mouse)
    - Layout manager (single column)
    - Action surface (toolbar / bottom sheet)
```

### Components to Add
- `mz/js/ui/safe/editorSafeMode.js` (bootstrap + adapter)
- `mz/css/editor.safe.css` (scoped responsive styles)
- `mz/js/ui/safe/gesture.js` (optional gesture simplification / shims)
- `mz/js/ui/safe/reorder.js` (tap-based reorder list; optional drag later)
- Feature detection utility `mz/js/util/runtime.js` (if not existing)

### Interaction Layer
- Replace complex drag handles with: press-hold (500ms) -> enters reorder list mode OR dedicated "Reorder" button presenting an ordered list with up/down controls.
- Floating Action Button (FAB) or bottom toolbar for: Add Block, Reorder, Save/Apply, Exit Desktop Mode.

---
## 6. Detection & Mode Selection
| Signal | Method | Notes |
|--------|--------|-------|
| Viewport Width | `window.innerWidth < 900` | Primary heuristic. |
| Pointer Type | `matchMedia('(pointer: coarse)')` | Helps for large tablets. |
| User Override | URL param `editorMode=desktop|safe`; persisted in `localStorage.editorModePref`. | Always wins. |
| Capability | Measure initial layout / memory (optional) | Future dynamic degrade. |

Pseudo-flow:
1. Parse query param override.  
2. If none, evaluate viewport + pointer.  
3. If still ambiguous (e.g., width 900–1100, pointer fine), default desktop.  
4. Expose toggle in UI to switch (triggers page reload with param or sets persisted pref).  

---
## 7. UI / UX Adjustments (Safe Mode)
| Desktop Feature | Safe Mode Strategy |
|-----------------|--------------------|
| Multi-pane / sidebars | Single column scroll; collapsible overlays for settings. |
| Dense toolbar icons | Simplified 4–6 primary actions; overflow sheet for secondary. |
| Precise drag | Reorder list mode with arrow buttons or drag handle bigger (≥44px). |
| Inline text editing | Retain, but ensure virtual keyboard not covering caret (scroll into view + padding). |
| Hotkeys | Minimal: maybe only undo/redo if feasible; document full list in help modal. |

### Layout
- Wrapper adds class `safe-mode` to root editor element; all overrides nest under `.safe-mode` to avoid leakage.
- Ensure no horizontal scroll: enforce max-width and auto-scale embedded previews.

---
## 8. Block Lifecycle Parity
Maintain a block registry proxy: 
- Expose subset of metadata: id, label, icon (SVG or emoji fallback), minimal config schema.
- Add Block Flow: FAB -> Modal / bottom sheet -> categorized list (search optional for v2).
- Edit Block: Tap selects; second tap or explicit Edit opens properties panel sheet.
- Delete Block: Long-press or explicit Delete button in selection toolbar.
- Reorder: Enter reorder mode; list with each block label + up/down; commit or cancel.

Edge Cases: 
- Blocks with heavy preview rendering: lazy-mount preview only when scrolled into view (IntersectionObserver) OR fallback static thumbnail.
- Blocks requiring pointer hover states: convert to tap toggles.

---
## 9. Data & State Strategy
- Reuse existing underlying data model, accessed through an adapter that maps simplified events (e.g., `onBlockAdd`, `onBlockUpdate`).
- Avoid duplicating state: safe-mode merely orchestrates UI wiring; core model unchanged.
- Provide transaction wrapper so undo stack stays consistent (if existing). If not, document potential future addition.

---
## 10. Performance Optimizations
Short Term:
- Conditional importing (`dynamic import()`) of safe-mode bundles only on need.
- Debounce expensive resize / scroll handlers.
- Use CSS `prefers-reduced-motion` to disable heavy animations.

Medium Term (Stretch):
- Virtualize long block lists (approx. > 30 blocks).
- Idle-time hydration for secondary panels.

Metrics Collection (if existing telemetry or simple counters):
- Record init time, memory snapshot (via `performance.memory` where available), block add latency, reorder latency.

---
## 11. Accessibility Considerations
- All interactive elements reachable via sequential focus order.
- ARIA roles for list reordering (e.g., `aria-grabbed` or `aria-dropeffect` fallback messaging for screen readers).
- Provide visible focus outlines (2px high contrast) even on touch (do not suppress). 
- Labels / aria-label for icon-only actions.

---
## 12. Testing Strategy
### Test Categories
1. Unit: Mode resolver, adapter functions, block add/remove events.  
2. Integration: Safe-mode init with sample document; reorder scenarios; keyboard overlay reposition handling.  
3. Visual / Snapshot: Key safe-mode layouts (empty state, many blocks).  
4. Manual Device Matrix:
   - iOS Safari (latest, iPhone SE / 14 Pro)
   - Android Chrome (Pixel mid-tier)
   - Small tablet (iPad Mini / Android 8"), large tablet (iPad Pro - ensures desktop fallback where intended)
5. Regression: Ensure existing desktop Cypress (or similar) runs unchanged.

### Automation Hooks
- Introduce a test fixture with `?editorMode=safe&fixture=sample1` for deterministic loading.
- Add CI job branch executing safe-mode test suite.

---
## 13. Phased Implementation Plan
| Phase | Duration (est) | Deliverables |
|-------|----------------|--------------|
| 0 – Discovery | 1–2d | Inventory current editor APIs; identify blockers. |
| 1 – Bootstrap & Detection | 2–3d | Mode resolver; conditional safe-mode root; no editing yet. |
| 2 – Basic Block Listing & Add/Delete | 3–4d | FAB + add sheet; block registry proxy; deletion. |
| 3 – Selection & Edit Panel | 3–4d | Property sheet; minimal validation. |
| 4 – Reorder Mechanism | 2–3d | Reorder list view; commit/cancel actions. |
| 5 – Visual Polish & A11y | 2–3d | Tap targets; focus; ARIA. |
| 6 – Performance & Lazy Loading | 2–3d | Lazy previews; dynamic imports. |
| 7 – QA & Regression | 3–5d | Automated + manual passes; address bugs. |
| 8 – Beta Rollout | 2d | Feature flag partial rollout; telemetry review. |
| 9 – Hardening & Launch | 2–3d | Fixes; docs; announcement. |

---
## 14. Risk Assessment & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Hidden coupling in existing editor code | Delays | Abstract minimal adapter; document touched surfaces early. |
| Performance on low-end devices | Poor UX | Progressive rendering; virtualization stretch goal. |
| Touch gesture conflicts | User frustration | Start with explicit buttons; introduce gestures later. |
| Regression leakage (CSS cascade) | Desktop breakage | Scope all rules under `.safe-mode`; isolate stylesheet. |
| Reorder UX too slow vs drag | Dissatisfaction | Provide optional experimental drag once stable. |
| Long previews block main thread | Jank | Lazy load & thumbnail fallback. |

---
## 15. Tooling & Code Changes (Initial Checklist)
- [x] Add mode resolver module. (`mz/js/ui/safe/modeResolver.js`)
- [x] Add safe-mode bootstrap JS (mount point creation, class injection). (`mz/js/ui/safe/editorSafeMode.js`)
- [x] Add scoped safe CSS file & conditional loader. (`mz/css/editor.safe.css`)
- [ ] Implement block registry proxy (currently in-memory placeholder; must integrate spans/map).
- [x] Implement Add Block sheet (basic list UI) – placeholder types.
- [ ] Implement Delete flow (confirm inline or undo snackbar?). (Basic inline remove only)
- [ ] Implement Selection + Edit panel.
- [ ] Implement Reorder interface (real data model). (UI present; not wired to real ordering semantics)
- [x] Implement user toggle (switch to desktop / safe) with persistence (button + query param).
- [ ] Add analytics hooks (optional).
- [ ] Add initial unit tests.
- [ ] Document developer usage in `readme.md` (link to this plan).

---
## 16. Minimal Technical Spec (Key APIs)
```ts
// runtime/modeResolver.js
export function resolveEditorMode({ query, width, pointer, stored }) {
  // returns 'desktop' | 'safe'
}

// safe/editorSafeMode.js
export function initSafeModeEditor(containerEl, coreEditorApi, opts) {
  return {
    destroy(),
    addBlock(type, initialData?),
    removeBlock(id),
    selectBlock(id),
    reorderBlocks(orderArray),
  };
}
```
Adapter leverages existing `coreEditorApi` surface (to be cataloged in Phase 0). If surfaces are missing, create non-breaking additions rather than modifying existing signatures.

---
## 17. Deployment & Rollout Strategy
1. Ship behind runtime detection only (no manual toggle visible) to internal testers.  
2. Add visible toggle + query param after initial QA.  
3. Gradually broaden by enabling safe-mode default for < 700px first week, then < 900px.  
4. Monitor error logs & abandon rates; refine.  
5. Publish docs & invite user feedback channel.

Rollback: If critical issue, disable via remote config (or temporary patch making resolver return desktop unconditionally) + remove toggle.

---
## 18. Future Enhancements (Post v1)
- Gesture-based drag reorder with auto-scroll.
- Offline draft queue & sync indicators.
- Block search & category filters with fuzzy match.
- Collaborative editing presence indicators (mobile-tailored).
- Adaptive density scaling (progressive reveal advanced tools on tablets).
- Local caching of heavy assets (e.g., previews) via service worker.

---
## 19. Open Questions
| Question | Owner | Resolution Needed By |
|----------|-------|----------------------|
| Canonical list of supported block types & properties? | Phase 0 | Phase 1 start |
| Undo/redo architecture stable for mobile usage? | Phase 0 | Phase 2 |
| Existing telemetry hooks available? | Phase 0 | Phase 2 |
| Are there licensing constraints for adding new icons? | TBD | Before Phase 2 |

---
## 20. Next Immediate Actions (Updated)
1. Catalog and map core editor block add/remove functions to SafeEditor adapter (replace placeholder model).
2. Define canonical block metadata map (id -> span/tile operation + optional prompts).
3. Implement adapter methods: `addBlock(type)`, `removeBlock(id)` translating to existing `addBlockAtVisor`/span ops without requiring 3D camera (decide coordinate strategy for mobile).
4. Introduce selection state + simple properties panel scaffold (even if read-only initially).
5. Wire reorder list to a logical ordering (decide: chronological placement log or explicit serialized ordering for export?).
6. Add unit tests for `__resolveEditorMode` and SafeEditor basic flows (add, remove, reorder simulation).
7. Add analytics instrumentation stub (init + event fire) guarded by try/catch.
8. Update README with safe-mode usage and override instructions.

---
## 21. Approval / Sign-Off
Add reviewer names & sign-off checklist here.

---
End of document.
