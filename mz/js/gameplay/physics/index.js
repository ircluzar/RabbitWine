// Physics domain facade - re-exports legacy API during segmentation
// TODO: Will be populated as slices are extracted from physics.js

// Temporary pass-through to original monolith
// This will be replaced slice by slice during extraction cycles

// Export legacy globals that other modules expect
if (typeof window !== 'undefined') {
  // Globals will be re-exported here as slices are extracted
  // Examples: groundHeightAt, moveAndCollide, applyVerticalPhysics, etc.
}