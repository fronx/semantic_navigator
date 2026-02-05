/**
 * Centralized configuration for chunk zoom behavior
 *
 * All values are expressed relative to BASE_CAMERA_Z to make tweaking easier.
 * Change BASE_CAMERA_Z to scale everything proportionally.
 */

// ==============================================================================
// ANCHOR POINT - Change this one value to scale everything
// ==============================================================================
export const BASE_CAMERA_Z = 1000;

// ==============================================================================
// Camera zoom limits (as multipliers of BASE_CAMERA_Z)
// ==============================================================================
export const CAMERA_MIN_ZOOM = 0.05;  // 5% of base (50 when base=1000)
export const CAMERA_MAX_ZOOM = 20.0;  // 20x base (20000 when base=1000)

// ==============================================================================
// Chunk transition range (as multipliers of BASE_CAMERA_Z)
// ==============================================================================
export const CHUNK_TRANSITION_START = 10.0;  // Chunks start appearing (far)
export const CHUNK_TRANSITION_END = 0.05;    // Chunks fully visible (close)

// ==============================================================================
// 3D positioning (as multipliers of BASE_CAMERA_Z)
// ==============================================================================
export const CHUNK_Z_OFFSET = 0.5;  // Fixed depth in relation to keywords (z=0)

// ==============================================================================
// Computed absolute values (for actual use)
// ==============================================================================
export const CAMERA_Z_MIN = BASE_CAMERA_Z * CAMERA_MIN_ZOOM;
export const CAMERA_Z_MAX = BASE_CAMERA_Z * CAMERA_MAX_ZOOM;
export const CHUNK_Z_TRANSITION_MIN = BASE_CAMERA_Z * CHUNK_TRANSITION_END;
export const CHUNK_Z_TRANSITION_MAX = BASE_CAMERA_Z * CHUNK_TRANSITION_START;
export const CHUNK_Z_DEPTH = BASE_CAMERA_Z * CHUNK_Z_OFFSET;

// ==============================================================================
// Chunk positioning (single source of truth)
// ==============================================================================

/**
 * Calculate the Z position for chunk nodes based on camera position.
 * This is the single source of truth used by both 3D rendering and 2D label positioning.
 *
 * @param cameraZ - Current camera Z position (unused for static positioning)
 * @returns Z coordinate for chunk nodes
 */
export function calculateChunkZ(cameraZ: number): number {
  // Static positioning: chunks at fixed depth behind keywords (z=0)
  return CHUNK_Z_DEPTH;

  // Alternative dynamic positioning (commented out):
  // Places chunks at 50% of camera distance + fixed offset
  // This would make chunks move with zoom, staying in front of blur panel
  // return (cameraZ * 0.50) + 100;
}

// ==============================================================================
// Debug helpers
// ==============================================================================
export function logConfig(): void {
  console.log('[Chunk Zoom Config]', {
    BASE_CAMERA_Z,
    cameraRange: [CAMERA_Z_MIN, CAMERA_Z_MAX],
    transitionRange: [CHUNK_Z_TRANSITION_MIN, CHUNK_Z_TRANSITION_MAX],
    chunkDepth: CHUNK_Z_DEPTH,
  });
}

// Log on import (remove after debugging)
if (typeof window !== 'undefined') {
  logConfig();
}
