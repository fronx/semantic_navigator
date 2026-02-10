/**
 * Fisheye Viewport Compression
 *
 * Implements a fisheye distortion effect that keeps focused content visible by smoothly
 * compressing positions as they approach viewport edges. Unlike hard clamping (which snaps
 * nodes to boundaries), fisheye creates a smooth gradient where:
 * - Content near the center stays at natural positions
 * - Content farther out gets progressively compressed into an inner ring
 * - Content never goes off-screen, asymptotically approaching the viewport edge
 *
 * This is used in focus mode to ensure all focused keywords remain visible even when
 * they would naturally be positioned outside the viewport.
 *
 * ## Visual Concept
 *
 * ```
 *                    viewport edge
 *                    │
 *    maxRadius ──────┤
 *                ····│····  ← asymptotic compression zone
 *              ··    │    ··
 *            ··      │      ··
 *          ··        │        ··
 *        ··          │          ··
 *      ··            │            ··
 *    ··              │              ··
 *   ·                │                ·
 *   ·                │                ·
 *   ·   compressionStartRadius        ·
 *   ·        ┌───────┼───────┐        ·
 *   ·        │       │       │        ·
 *   ·        │       ●       │        ·  ← camera center
 *   ·        │    (natural  │        ·
 *   ·        │     positions)│        ·
 *   ·        └───────┼───────┘        ·
 *   ·                │                ·
 *   ·                │                ·
 *    ··              │              ··
 *      ··            │            ··
 *        ··          │          ··
 *          ··        │        ··
 *            ··      │      ··
 *              ··    │    ··
 *                ····│····
 *                    │
 *
 * Inner zone (r < compressionStartRadius):  No compression, natural positions
 * Compression zone (r >= compressionStartRadius): Smooth asymptotic compression
 * ```
 *
 * ## When to Use Fisheye vs Clamping
 *
 * **Use fisheye compression when:**
 * - You need to keep a KNOWN SET of nodes visible (e.g., focused keywords)
 * - The set can be large (10+ nodes scattered across space)
 * - You want smooth, continuous positioning without hard boundaries
 * - Visual continuity matters (animating between states)
 *
 * **Use hard clamping (clampToBounds) when:**
 * - You're pulling UNKNOWN neighbors from off-screen (edge pulling)
 * - You want discrete boundary behavior (cliff zones)
 * - You need nodes to snap to exact edge positions
 * - You're working with non-focused content
 *
 * @see docs/patterns/fisheye-compression.md for detailed explanation
 * @see docs/architecture/edge-pulling.md for integration with edge pulling system
 */

/**
 * Apply fisheye compression to a position in focus mode.
 *
 * Maps positions smoothly using asymptotic compression:
 * - Positions within compressionStartRadius: unchanged (natural positions)
 * - Positions beyond compressionStartRadius: compressed toward maxRadius
 * - All positions: guaranteed to stay within maxRadius from center
 *
 * The compression uses an asymptotic curve: `compressed = start + range * (excess / (excess + scale))`
 * This ensures the output never exceeds maxRadius no matter how far the input is.
 *
 * @param nodeX - Node's natural x position
 * @param nodeY - Node's natural y position
 * @param camX - Camera center x
 * @param camY - Camera center y
 * @param compressionStartRadius - Distance from center where compression starts (world units)
 *                                  Typically corresponds to focus pull zone (80px from edge)
 * @param maxRadius - Maximum allowed distance from center (world units)
 *                    Typically corresponds to regular pull zone (25px from edge)
 * @returns Compressed position that stays within maxRadius
 *
 * @example
 * // Node at natural position (150, 100) with camera at (0, 0)
 * // compressionStartRadius = 100, maxRadius = 120
 * const compressed = applyFisheyeCompression(150, 100, 0, 0, 100, 120);
 * // Result: node is pulled closer to maxRadius boundary
 * // Distance from center: sqrt(150^2 + 100^2) ≈ 180 (outside maxRadius)
 * // Compressed distance: < 120 (guaranteed within maxRadius)
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

  // Asymptotic compression: smoothly maps [compressionStartRadius, infinity) → [compressionStartRadius, maxRadius]
  // The farther the node is, the more it gets compressed toward maxRadius
  const excess = distance - compressionStartRadius;
  const compressionRange = maxRadius - compressionStartRadius;

  // Asymptotic mapping: excess / (excess + scale)
  // This guarantees compressedExcess ≤ compressionRange for all inputs
  // Scale controls how aggressive the compression is (lower = more aggressive)
  const scale = compressionRange * 0.5; // Tune this for desired compression curve
  const compressedExcess = compressionRange * (excess / (excess + scale));
  const compressedDistance = compressionStartRadius + compressedExcess;

  // Preserve direction, apply compressed distance
  const ratio = compressedDistance / distance;
  return {
    x: camX + dx * ratio,
    y: camY + dy * ratio,
  };
}

/**
 * Compute compression zone radii from viewport zones.
 *
 * Extracts the typical radii needed for fisheye compression from viewport zones.
 * Returns the two key boundaries:
 * - maxRadius: outer boundary (pull zone, typically 25px from edge)
 * - compressionStartRadius: inner boundary (focus pull zone, typically 80px from edge)
 *
 * @param zones - Viewport zones from computeViewportZones()
 * @returns Object with maxRadius and compressionStartRadius
 */
export function computeCompressionRadii(zones: {
  viewport: { camX: number; camY: number };
  pullBounds: { right: number; top: number };
  focusPullBounds: { right: number; top: number };
}): { maxRadius: number; compressionStartRadius: number } {
  const camX = zones.viewport.camX;
  const camY = zones.viewport.camY;

  // Outer boundary: distance from center to pull zone
  const pullZoneDistanceRight = zones.pullBounds.right - camX;
  const pullZoneDistanceTop = zones.pullBounds.top - camY;
  const maxRadius = Math.min(pullZoneDistanceRight, pullZoneDistanceTop);

  // Inner boundary: distance from center to focus pull zone
  const focusPullDistanceRight = zones.focusPullBounds.right - camX;
  const focusPullDistanceTop = zones.focusPullBounds.top - camY;
  const compressionStartRadius = Math.min(focusPullDistanceRight, focusPullDistanceTop);

  return { maxRadius, compressionStartRadius };
}
