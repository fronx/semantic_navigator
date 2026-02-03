/**
 * Scale interpolation calculator for keyword/chunk visualization
 *
 * Controls the transition between keyword-focused (far away) and chunk-focused (close up) views
 * based on camera Z position.
 *
 * ==============================================================================
 * TO ADJUST BEHAVIOR: Edit src/lib/chunk-zoom-config.ts
 * ==============================================================================
 * All values are expressed as ratios of BASE_CAMERA_Z for easy tweaking.
 * - Change BASE_CAMERA_Z to scale everything proportionally
 * - Change CHUNK_TRANSITION_START/END to adjust when chunks appear
 * - Change CHUNK_Z_OFFSET to adjust 3D depth separation
 * ==============================================================================
 */

import {
  CHUNK_Z_TRANSITION_MIN,
  CHUNK_Z_TRANSITION_MAX,
} from './chunk-zoom-config';

const MIN_Z = CHUNK_Z_TRANSITION_MIN;  // Very close - chunks fully visible
const MAX_Z = CHUNK_Z_TRANSITION_MAX;  // Far away - keywords fully visible

// Debug: Set to true to log scale calculations
const DEBUG_SCALES = false;

/**
 * Scale values for different visual elements
 */
export interface ScaleValues {
  /** Linear interpolation: 1.0 far (keywords visible), 0.0 close (keywords hidden) */
  keywordScale: number;
  /** Exponential interpolation: 0.0 far (chunks hidden), 1.0 close (chunks visible) */
  chunkScale: number;
  /** Opacity for chunk edges */
  chunkEdgeOpacity: number;
  /** Opacity for keyword labels */
  keywordLabelOpacity: number;
  /** Opacity for chunk labels */
  chunkLabelOpacity: number;
}

/**
 * Calculate scale values based on camera Z position
 *
 * @param cameraZ - Current camera Z distance (100 = close, 500 = far)
 * @returns Scale values for keywords, chunks, and their labels/edges
 */
export function calculateScales(cameraZ: number): ScaleValues {
  // Normalized interpolation factor: 0 = close (MIN_Z), 1 = far (MAX_Z)
  const t = Math.max(0, Math.min(1, (cameraZ - MIN_Z) / (MAX_Z - MIN_Z)));

  // Inverse factor for chunk scaling
  const invT = 1 - t;

  const scales = {
    keywordScale: t,                    // Linear: fade out as we zoom in
    chunkScale: invT ** 2,              // Exponential: appear as we zoom in
    chunkEdgeOpacity: invT ** 2,        // Fade in with chunks
    keywordLabelOpacity: t,             // Fade out as we zoom in
    chunkLabelOpacity: invT ** 2,       // Fade in with chunks
  };

  if (DEBUG_SCALES) {
    console.log('[Scale Calc] cameraZ:', cameraZ.toFixed(0),
      't:', t.toFixed(3),
      'kw:', scales.keywordScale.toFixed(3),
      'chunk:', scales.chunkScale.toFixed(3));
  }

  return scales;
}
