# VRUN MZ (prototype)

Minimal app shell for Milestone M0.

- WebGL2 init with a full-viewport canvas.
- DPR-aware resize.
- Touch-first input logging (pointers + keys) with a lightweight HUD.
- Base internal target: 480×720 portrait (to be honored via dual-camera layout in M1).

How to run (static):
- Serve the `mz/` folder with any static server. Example options:
  - VS Code Live Server extension
  - `python -m http.server` from repo root and open `/mz/`

Notes:
- We prevent default scrolling/zoom to keep gestures inside the canvas.
- For now we clear the screen; rendering + dual cameras land in M1.
