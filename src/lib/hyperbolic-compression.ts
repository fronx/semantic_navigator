/**
 * Hyperbolic compression utilities using tanh for smooth asymptotic falloff.
 *
 * Used for both position distortion (fisheye viewport) and scale computation (lens mode).
 */

/** Compression strength: 1.0 = gentle wide lens, 2.0 = balanced, 3.0 = tight dramatic. */
export const HYPERBOLIC_COMPRESSION_STRENGTH = 2.0;

/**
 * Compress a distance into a ratio in [0, 1] using tanh.
 * Returns 1 (no compression) when distance <= compressionStart,
 * smoothly approaching 0 (fully compressed) at the horizon.
 */
export function computeCompressionRatio(
  distance: number,
  compressionStart: number,
  maxRadius: number,
  strength: number = HYPERBOLIC_COMPRESSION_STRENGTH,
): number {
  // No compression if within start radius
  if (distance <= compressionStart) {
    return 1.0;
  }

  const excess = distance - compressionStart;
  const range = Math.max(1, maxRadius - compressionStart);
  const normalized = excess / range;

  // tanh maps [0, ∞) → [0, 1) smoothly
  const compressed = Math.tanh(normalized * strength);

  // Invert: 1 at start, 0 at horizon
  return 1 - compressed;
}

/**
 * Compress a distance value, mapping excess beyond compressionStart
 * into the remaining range using tanh. Result is always <= maxRadius.
 */
export function applyCompressionToDistance(
  distance: number,
  compressionStart: number,
  maxRadius: number,
  strength: number = HYPERBOLIC_COMPRESSION_STRENGTH,
): number {
  if (distance <= compressionStart) {
    return distance;
  }

  const excess = distance - compressionStart;
  const range = Math.max(1, maxRadius - compressionStart);
  const normalized = excess / range;

  // Compress excess into range
  const compressedExcess = range * Math.tanh(normalized * strength);

  return compressionStart + compressedExcess;
}
