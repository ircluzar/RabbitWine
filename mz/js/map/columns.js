/**
 * Tall column definitions and height lookup system.
 * Defines extra-tall columns that extend above normal wall height with fast coordinate-based lookup.
 * Exports: extraColumns array, columnHeights Map for height queries by coordinate.
 * Dependencies: None. Side effects: Populates columnHeights Map at module load time.
 */

// Extra tall columns (moved from scene.js)
const extraColumns = [
  { x: 10, y: 10, h: 6 },
  { x: 13, y: 10, h: 6 },
  { x: 10, y: 13, h: 6 },
  { x: 13, y: 13, h: 6 },
];

// Fast lookup: tile "x,y" -> height
const columnHeights = new Map();
for (const c of extraColumns){ 
  columnHeights.set(`${c.x},${c.y}`, c.h); 
}
