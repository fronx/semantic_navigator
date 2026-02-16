/**
 * Fisheye viewport compression: keeps focused content visible by smoothly
 * compressing positions as they approach viewport edges.
 *
 * - Content near center stays at natural positions
 * - Content farther out gets progressively compressed toward the edge
 * - Nothing goes off-screen (asymptotic approach to maxRadius)
 *
 * Used in focus mode to ensure all focused keywords remain visible.
 *
 * @see docs/patterns/fisheye-compression.md for visual diagrams and detailed explanation
 * @see docs/architecture/edge-pulling.md for integration with edge pulling system
 */

import { applyCompressionToDistance } from "./hyperbolic-compression";

/**
 * Compress a 2D position toward the viewport center using hyperbolic falloff.
 * Positions within compressionStartRadius are unchanged; positions beyond
 * are compressed to stay within maxRadius while preserving direction.
 */
export function applyFisheyeCompression(
  nodeX: number,
  nodeY: number,
  camX: number,
  camY: number,
  compressionStartRadius: number,
  maxRadius: number,
): { x: number; y: number } {
  const dx = nodeX - camX;
  const dy = nodeY - camY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // No compression needed if within start radius
  if (distance <= compressionStartRadius) {
    return { x: nodeX, y: nodeY };
  }

  // Avoid division by zero
  if (distance === 0) {
    return { x: nodeX, y: nodeY };
  }

  // Apply hyperbolic compression using shared logic
  const compressedDistance = applyCompressionToDistance(distance, compressionStartRadius, maxRadius);

  // Preserve direction, apply compressed distance
  const ratio = compressedDistance / distance;
  return {
    x: camX + dx * ratio,
    y: camY + dy * ratio,
  };
}

/**
 * Extract compression radii from viewport zones.
 * maxRadius = outer boundary (pull zone), compressionStartRadius = inner boundary (focus pull zone).
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
