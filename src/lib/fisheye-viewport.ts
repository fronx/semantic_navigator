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

/**
 * Lp norm exponent for rounded rectangle approximation.
 * p=2 → circle, p→∞ → square, p=6 → nice rounded rectangle feel.
 */
const LP_NORM_P = 6;

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
 * @returns Distance to horizon along this ray
 */
function computeDirectionalHorizon(
  dx: number,
  dy: number,
  distance: number,
  halfWidth: number,
  halfHeight: number,
): number {
  if (distance === 0) return 0;

  // Normalize direction to viewport aspect ratio
  const nx = dx / halfWidth;
  const ny = dy / halfHeight;

  // Compute Lp norm distance (dimensionless, 1.0 = at horizon)
  // Optimize: use repeated multiplication for p=6
  const nx2 = nx * nx;
  const ny2 = ny * ny;
  const nx6 = nx2 * nx2 * nx2;
  const ny6 = ny2 * ny2 * ny2;
  const lpDistance = Math.pow(Math.abs(nx6) + Math.abs(ny6), 1 / LP_NORM_P);

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
    dx, dy, distance, horizonHalfWidth, horizonHalfHeight
  );

  // Compute directional compression start distance
  const compressionStartDistance = computeDirectionalHorizon(
    dx, dy, distance, compressionStartHalfWidth, compressionStartHalfHeight
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
