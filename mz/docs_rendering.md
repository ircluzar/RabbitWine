# Rendering Stack Decision

Choice: Start with raw WebGL2. Rationale:
- The project needs custom dual-camera composition and a bespoke post-process chain (palette + ordered dithering across combined views). Raw WebGL2 gives full control with minimal overhead.
- The repo already has several custom Web/WebGL utilities; avoiding a large framework keeps bundle small and reduces abstraction friction.
- If complexity grows (shadowing, loaders, complex materials), we can selectively adopt utility libs (gl-matrix for math, tiny-shader helpers) without committing to a full scene graph.

Tradeoffs:
- Slightly longer ramp than Three.js for conveniences (cameras, materials).
- We'll build a tiny scene/camera module tailored to this game.

Revisit criteria:
- If M1–M2 progress shows too much boilerplate, consider Three.js for cameras + basic materials while still managing post-process + composition manually.
