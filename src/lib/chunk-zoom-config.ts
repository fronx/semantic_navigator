/**
 * Centralized configuration for chunk zoom behavior
 *
 * All values are expressed relative to BASE_CAMERA_Z to make tweaking easier.
 * Change BASE_CAMERA_Z to scale everything proportionally.
 */

// ==============================================================================
// ANCHOR POINT - Change this one value to scale everything
// ==============================================================================
const BASE_CAMERA_Z = 1000;

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
export const CHUNK_Z_OFFSET = -0.15;  // Chunks positioned behind keywords

// ==============================================================================
// Computed absolute values (for actual use)
// ==============================================================================
export const CAMERA_Z_MIN = BASE_CAMERA_Z * CAMERA_MIN_ZOOM;
export const CAMERA_Z_MAX = BASE_CAMERA_Z * CAMERA_MAX_ZOOM;
export const CHUNK_Z_TRANSITION_MIN = BASE_CAMERA_Z * CHUNK_TRANSITION_END;
export const CHUNK_Z_TRANSITION_MAX = BASE_CAMERA_Z * CHUNK_TRANSITION_START;
export const CHUNK_Z_DEPTH = BASE_CAMERA_Z * CHUNK_Z_OFFSET;

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
