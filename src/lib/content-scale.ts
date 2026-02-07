/**
 * Scale interpolation calculator for keyword/content node visualization
 *
 * Controls the transition between keyword-focused (far away) and content-focused (close up) views
 * based on camera Z position.
 *
 * ==============================================================================
 * TO ADJUST BEHAVIOR: Edit src/lib/content-zoom-config.ts
 * ==============================================================================
 * All values are expressed as ratios of BASE_CAMERA_Z for easy tweaking.
 * - Change BASE_CAMERA_Z to scale everything proportionally
 * - Change CONTENT_TRANSITION_START/END to adjust when content nodes appear
 * - Change CONTENT_Z_OFFSET to adjust 3D depth separation
 * ==============================================================================
 */

import {
  CONTENT_Z_TRANSITION_MIN,
  CONTENT_Z_TRANSITION_MAX,
} from "./content-zoom-config";
import type { ZoomRange } from "./zoom-phase-config";
import { normalizeZoom } from "./zoom-phase-config";

const DEFAULT_RANGE: ZoomRange = {
  near: CONTENT_Z_TRANSITION_MIN,
  far: CONTENT_Z_TRANSITION_MAX,
};

// Debug: Set to true to log scale calculations
const DEBUG_SCALES = false;

/**
 * Scale values for different visual elements
 */
export interface ScaleValues {
  /** Linear interpolation: 1.0 far (keywords full size), 0.15 close (keywords at minimum size) */
  keywordScale: number;
  /** Exponential interpolation: 0.0 far (content nodes hidden), 1.0 close (content nodes visible) */
  contentScale: number;
  /** Opacity for content node edges */
  contentEdgeOpacity: number;
  /** Opacity for keyword similarity edges (fades out as content edges fade in) */
  keywordEdgeOpacity: number;
  /** Opacity for keyword labels */
  keywordLabelOpacity: number;
  /** Opacity for content node labels */
  contentLabelOpacity: number;
}

/**
 * Calculate scale values based on camera Z position
 *
 * @param cameraZ - Current camera Z distance (100 = close, 500 = far)
 * @param range - Zoom range controlling the crossfade window
 * @returns Scale values for keywords, content nodes, and their labels/edges
 */
export function calculateScales(cameraZ: number, range: ZoomRange = DEFAULT_RANGE): ScaleValues {
  // Normalized interpolation factor: 0 = close (near), 1 = far
  const t = normalizeZoom(cameraZ, range);

  // Inverse factor for content node scaling
  const invT = 1 - t;

  // Minimum keyword scale to keep them visible at a reasonable size
  const MIN_KEYWORD_SCALE = 0.3;

  const scales = {
    keywordScale: MIN_KEYWORD_SCALE + t * (1 - MIN_KEYWORD_SCALE), // Scale from MIN to 1.0, never fully disappears
    contentScale: invT ** 2,              // Exponential: appear as we zoom in
    contentEdgeOpacity: invT ** 2,        // Fade in with content nodes
    keywordEdgeOpacity: 0.4 * (1 - invT ** 2), // Cross-fade: visible far, hidden close
    keywordLabelOpacity: 0.0 + t * 1.0, // Partial fade: 0.0 (zoomed in) to 1.0 (zoomed out)
    contentLabelOpacity: invT ** 2,       // Fade in with content nodes
  };

  if (DEBUG_SCALES) {
    console.log('[Scale Calc] cameraZ:', cameraZ.toFixed(0),
      't:', t.toFixed(3),
      'kw:', scales.keywordScale.toFixed(3),
      'content:', scales.contentScale.toFixed(3));
  }

  return scales;
}

/**
 * Compute a proximity-based scale multiplier for a node relative to screen center.
 * Uses smoothstep falloff: 1.0 at center, minScale at radius edge and beyond.
 *
 * @param nodeX - Node world X position
 * @param nodeY - Node world Y position
 * @param cameraX - Camera world X position (screen center)
 * @param cameraY - Camera world Y position (screen center)
 * @param worldRadius - Focus radius in world units
 * @param minScale - Minimum scale at and beyond the radius edge (default 0.3)
 */
export function computeProximityScale(
  nodeX: number,
  nodeY: number,
  cameraX: number,
  cameraY: number,
  worldRadius: number,
  minScale: number = 0.3,
): number {
  const dx = nodeX - cameraX;
  const dy = nodeY - cameraY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const t = Math.min(dist / worldRadius, 1.0);
  const smooth = t * t * (3 - 2 * t); // smoothstep(0, 1, t)
  return 1.0 - smooth * (1.0 - minScale);
}
