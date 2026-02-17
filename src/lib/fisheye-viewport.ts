/**
 * Fisheye viewport compression: keeps focused content visible by smoothly
 * compressing positions as they approach viewport edges.
 *
 * - Content near center stays at natural positions
 * - Content farther out gets progressively compressed toward the edge
 * - Nothing goes off-screen (asymptotic approach to rounded rectangle horizon)
 *
 * Uses Lp norm (p=6) to create a directional horizon that fills the viewport
 * as a rounded rectangle instead of a circle, maximizing screen space usage.
 *
 * @see docs/patterns/rounded-rectangle-fisheye.md for mathematical derivation and implementation details
 * @see docs/patterns/fisheye-compression.md for original circular compression
 * @see docs/architecture/edge-pulling.md for integration with edge pulling system
 */

import { applyCompressionToDistance } from "./hyperbolic-compression";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const EPSILON = 1e-4;

/**
 * Default Lp norm exponent for rounded rectangle approximation.
 * p=2 → circle, p→∞ → square, p=6 → nice rounded rectangle feel.
 */
export const DEFAULT_LP_NORM_P = 6;

/**
 * Compute directional horizon distance using Lp norm.
 * Returns the distance from camera at which a ray in direction (dx, dy)
 * hits the rounded rectangle boundary defined by viewport extents.
 *
 * @param dx - X offset from camera
 * @param dy - Y offset from camera
 * @param distance - Euclidean distance sqrt(dx² + dy²)
 * @param halfWidth - Viewport half-width in world units
 * @param halfHeight - Viewport half-height in world units
 * @param lpNormP - Lp norm exponent (2=circle, 6=rounded rect, ∞=square)
 * @returns Distance to horizon along this ray
 */
function computeDirectionalHorizon(
  dx: number,
  dy: number,
  distance: number,
  halfWidth: number,
  halfHeight: number,
  lpNormP: number,
): number {
  if (distance === 0) return 0;

  // Normalize direction to viewport aspect ratio
  const nx = dx / halfWidth;
  const ny = dy / halfHeight;

  // Lp norm distance (dimensionless, 1.0 = at horizon)
  // Use repeated multiplication when p is an integer for efficiency
  const nx2 = nx * nx;
  const ny2 = ny * ny;
  const nxP = lpNormP === 6 ? nx2 * nx2 * nx2 : Math.pow(Math.abs(nx), lpNormP);
  const nyP = lpNormP === 6 ? ny2 * ny2 * ny2 : Math.pow(Math.abs(ny), lpNormP);
  const lpDistance = Math.pow(nxP + nyP, 1 / lpNormP);

  // Avoid division by zero
  if (lpDistance === 0) return distance;

  // Scale back to world units along this direction
  return distance / lpDistance;
}

/**
 * Compress a 2D position toward the viewport using hyperbolic falloff with
 * directional horizon (rounded rectangle boundary).
 *
 * Positions within the compression start boundary are unchanged; positions beyond
 * are compressed to stay within the horizon boundary while preserving direction.
 *
 * @param nodeX - Node X position in world space
 * @param nodeY - Node Y position in world space
 * @param camX - Camera X position in world space
 * @param camY - Camera Y position in world space
 * @param compressionStartHalfWidth - Half-width of inner boundary in world units
 * @param compressionStartHalfHeight - Half-height of inner boundary in world units
 * @param horizonHalfWidth - Half-width of outer horizon in world units
 * @param horizonHalfHeight - Half-height of outer horizon in world units
 * @param compressionStrength - Hyperbolic compression strength (default from hyperbolic-compression.ts)
 * @param lpNormP - Lp norm exponent for horizon shape (default: DEFAULT_LP_NORM_P)
 */
export function applyFisheyeCompression(
  nodeX: number,
  nodeY: number,
  camX: number,
  camY: number,
  compressionStartHalfWidth: number,
  compressionStartHalfHeight: number,
  horizonHalfWidth: number,
  horizonHalfHeight: number,
  compressionStrength?: number,
  lpNormP: number = DEFAULT_LP_NORM_P,
): { x: number; y: number } {
  const dx = nodeX - camX;
  const dy = nodeY - camY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Avoid division by zero
  if (distance === 0) {
    return { x: nodeX, y: nodeY };
  }

  // Compute directional horizon distance for this direction
  const horizonDistance = computeDirectionalHorizon(
    dx, dy, distance, horizonHalfWidth, horizonHalfHeight, lpNormP
  );

  // Compute directional compression start distance
  const compressionStartDistance = computeDirectionalHorizon(
    dx, dy, distance, compressionStartHalfWidth, compressionStartHalfHeight, lpNormP
  );

  // No compression needed if within start boundary
  if (distance <= compressionStartDistance) {
    return { x: nodeX, y: nodeY };
  }

  // Apply hyperbolic compression using directional horizons
  const compressedDistance = applyCompressionToDistance(
    distance, compressionStartDistance, horizonDistance, compressionStrength
  );

  // Preserve direction, apply compressed distance
  const ratio = compressedDistance / distance;
  return {
    x: camX + dx * ratio,
    y: camY + dy * ratio,
  };
}

/**
 * Extract viewport extents from zones for directional fisheye compression.
 *
 * Returns half-widths and half-heights (in world units) for both the outer horizon
 * boundary (pull zone) and inner compression start boundary (focus pull zone).
 *
 * @param zones - Viewport zones with camera position and boundary extents
 * @returns Extents for directional compression
 */
export function computeCompressionExtents(zones: {
  viewport: { camX: number; camY: number };
  pullBounds: { left: number; right: number; top: number; bottom: number };
  focusPullBounds: { left: number; right: number; top: number; bottom: number };
}): {
  horizonHalfWidth: number;
  horizonHalfHeight: number;
  compressionStartHalfWidth: number;
  compressionStartHalfHeight: number;
} {
  const { camX, camY } = zones.viewport;

  return {
    horizonHalfWidth: zones.pullBounds.right - camX,
    horizonHalfHeight: zones.pullBounds.top - camY,
    compressionStartHalfWidth: zones.focusPullBounds.right - camX,
    compressionStartHalfHeight: zones.focusPullBounds.top - camY,
  };
}

/**
 * @deprecated Use computeCompressionExtents instead. This function computed circular
 * radii for the old circular fisheye compression. The new implementation uses
 * directional extents for rounded rectangle compression.
 */
export function computeCompressionRadii(zones: {
  viewport: { camX: number; camY: number };
  pullBounds: { right: number; top: number };
  focusPullBounds: { right: number; top: number };
}): { maxRadius: number; compressionStartRadius: number } {
  const { camX, camY } = zones.viewport;

  return {
    maxRadius: Math.min(zones.pullBounds.right - camX, zones.pullBounds.top - camY),
    compressionStartRadius: Math.min(zones.focusPullBounds.right - camX, zones.focusPullBounds.top - camY),
  };
}

// ----------------------------------------------------------------------------
// Directional range compression (rounded-rect remapping)
// ----------------------------------------------------------------------------

export interface DirectionalRangeCompressionConfig {
  pivot: number;
  innerExponent: number;
  outerExponent: number;
  blend: number;
}

export interface DirectionalRangeCompressionExtents {
  horizonHalfWidth: number;
  horizonHalfHeight: number;
  compressionStartHalfWidth: number;
  compressionStartHalfHeight: number;
}

/**
 * Create a compression config describing how aggressively to remap normalized distances.
 * pivot: where the response transitions from expansion to compression (0-1 normalized radius).
 * innerExponent < 1 spreads close nodes, outerExponent > 1 compresses far nodes.
 * blend mixes the remapped value back toward the original for partial effect.
 */
export function createDirectionalRangeCompressionConfig(
  compressionStrength: number,
  extents: DirectionalRangeCompressionExtents,
): DirectionalRangeCompressionConfig {
  const ratioX = extents.compressionStartHalfWidth / Math.max(extents.horizonHalfWidth, EPSILON);
  const ratioY = extents.compressionStartHalfHeight / Math.max(extents.horizonHalfHeight, EPSILON);
  const avgRatio = (ratioX + ratioY) * 0.5;
  const normalizedStrength = clamp(compressionStrength, 0.6, 3);
  return {
    pivot: clamp(avgRatio * 0.9, 0.3, 0.6),
    innerExponent: clamp(0.6 - (normalizedStrength - 1) * 0.08, 0.35, 0.85),
    outerExponent: clamp(1.2 + (normalizedStrength - 1) * 0.35, 1.1, 2.1),
    blend: clamp(0.6 + (normalizedStrength - 1) * 0.12, 0.5, 0.95),
  };
}

function remapNormalizedDistance(value: number, config: DirectionalRangeCompressionConfig): number {
  const pivot = clamp(config.pivot, 0.1, 0.85);
  const normalized = clamp(value, 0, 1.2);
  if (normalized <= 0) return 0;
  if (normalized < pivot) {
    const ratio = normalized / Math.max(pivot, EPSILON);
    const eased = Math.pow(Math.max(ratio, 0), config.innerExponent);
    return pivot * eased;
  }
  const span = Math.max(EPSILON, 1 - pivot);
  const ratio = (normalized - pivot) / span;
  const eased = Math.pow(Math.max(ratio, 0), config.outerExponent);
  return pivot + span * eased;
}

export function applyDirectionalRangeCompression(
  nodeX: number,
  nodeY: number,
  camX: number,
  camY: number,
  horizonHalfWidth: number,
  horizonHalfHeight: number,
  config: DirectionalRangeCompressionConfig,
): { x: number; y: number } {
  const dx = nodeX - camX;
  const dy = nodeY - camY;
  const normalized = Math.max(
    Math.abs(dx) / Math.max(Math.abs(horizonHalfWidth), EPSILON),
    Math.abs(dy) / Math.max(Math.abs(horizonHalfHeight), EPSILON),
  );
  if (!Number.isFinite(normalized) || normalized <= EPSILON) {
    return { x: nodeX, y: nodeY };
  }
  const remapped = remapNormalizedDistance(normalized, config);
  const target = clamp(normalized + (remapped - normalized) * config.blend, 0, 0.995);
  if (Math.abs(target - normalized) < EPSILON || normalized <= 0) {
    return { x: nodeX, y: nodeY };
  }
  const scale = target / normalized;
  return {
    x: camX + dx * scale,
    y: camY + dy * scale,
  };
}
