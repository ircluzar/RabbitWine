Here’s a structured **vision document** for *VRUN MZ* in Markdown format:

---

# VRUN MZ

*A Top-Down Tron-Maze Battle Game*

---

## Overview

**VRUN MZ** is a stylized 3D WebGL arcade game that combines the thrill of Tron light-cycle gameplay with the classic tension of a Pac-Man maze. Players control a shimmering cycle from a **top-down perspective**, navigating a maze while avoiding ghosts, trapping them within light circles, and surviving as the maze is slowly condemned piece by piece.

The game emphasizes:

* **Smooth, glowing visuals** with rounded shapes and reflective shimmer.
* **Retro-modern fidelity**: 640×480 rendering, rasterized with a **256-color shader + mild dithering**.
* **Procedural sound effects** powered by **WebFont synths**.

---

## Core Gameplay Loop

1. **Navigate the Maze**

   * Move your Tron cycle freely in all directions within the maze.
   * Leave behind a **light trail**.

2. **Battle Ghosts**

   * Ghosts roam unpredictably and **condemn maze tiles** behind them (making them unusable).
   * To kill a ghost, the player must **complete a loop around them** with their cycle trail, forming a glowing circle that shrinks in and disintegrates the ghost.

3. **Survive the Collapse**

   * Condemned areas disappear into a void, shrinking safe play space.
   * Strategy balances between **chasing ghosts** and **keeping a safe path forward**.

4. **Collect & Toggle Consumables**

   * Consumables placed throughout the maze alter the loop dynamics, offering tactical advantages or risky trade-offs.

5. **Level Progression**

   * Each level increases **maze complexity, ghost intelligence, and condemnation speed**, escalating tension.

---

## Visual Design

* **Camera**: Top-down, slightly tilted for depth.
* **Shapes**: Rounded edges, smooth transitions, no sharp polygons.
* **Lighting**: Overhead source casting shimmer on trails, walls, and ghosts.
* **Post-processing**: Framebuffer shader limits output to **256 colors**, with subtle **ordered dithering** for texture.
* **Effects**: Trail glow, maze reflection pulses, ghost flicker when near defeat.

---

## Audio Design

* **WebFont Synth SFX**:

  * Trail hum: oscillating sine tone that rises with speed.
  * Ghost chatter: arpeggiated bleeps in minor scale.
  * Loop closure (killing ghost): downward FM-synth zap.
  * Consumables: short chiptune arpeggios.
* **Music**: Reactive generative patterns (trance-like pulses) increasing intensity with levels.

---

## Consumables & Toggles

Consumables and togglables spawn in maze corridors, collected by driving through them.

* **Speed Boost**: Temporarily increases cycle velocity, trail shimmers brighter.
* **Ghost Magnet**: Attracts nearest ghost toward the player, useful for trapping.
* **Time Freeze**: Stops ghost movement for 3 seconds.
* **Trail Extend/Shorten Toggle**: Adjusts trail persistence; longer trails are good for trapping, shorter trails for mobility.
* **Condemnation Shield**: Temporarily halts maze decay.
* **Light Burst**: Creates an instant small circle that damages ghosts nearby.

---

## Workflow & Progression

### Game Flow

1. **Level Start**

   * Maze layout generated/selected.
   * Ghosts spawn, consumables seeded.

2. **Active Play**

   * Player survives, traps ghosts, manages consumables.
   * Maze decay accelerates as time passes.

3. **Level Clear**

   * Once all ghosts are defeated OR player survives until timer ends, next level begins.

4. **Failure**

   * Player crashes into condemned space, ghost, or their own trail.

---

### Progression Model

* **Level 1**: Basic maze, 1–2 ghosts, slow condemnation.
* **Level 2–5**: More complex mazes, faster condemnation, more ghosts.
* **Level 6+**: Ghosts gain **AI improvements** (flanking, chasing in pairs, blocking paths).
* **Endgame**: Endless survival mode with procedurally shifting mazes.

**Scoring**:

* +100 points per ghost destroyed.
* +10 points per consumable collected.
* Bonus multiplier for surviving with little maze space left.

---

## Development Notes

* **WebGL Rendering**: Core pipeline + framebuffer shader for color/dither effect.
* **Input**: Keyboard (WASD/Arrow) and optional gamepad.
* **Physics**: Lightweight collision checks for trails, ghosts, and maze decay.
* **AI**: Ghosts use a mix of random wandering and targeted aggression.
* **Shimmer Effect**: Vertex shader applies oscillating specular highlights to all major objects.

---

## Future Expansion Ideas

* **Multiplayer Mode**: Compete/cooperate to trap ghosts, or duel each other with trails.
* **Boss Ghosts**: Larger, multi-hit ghosts with special movement patterns.
* **Maze Variants**: Circular arenas, shifting walls, vertical ramps.
* **Custom Synth Packs**: User-selectable retro sound banks.

---

Would you like me to also **draft a technical breakdown** (like pseudocode/workflow diagrams for rendering, AI, and shader pipeline), or keep this doc purely **vision + design-focused**?
