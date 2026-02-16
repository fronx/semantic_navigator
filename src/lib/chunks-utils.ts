/**
 * General utilities for chunks visualization.
 */

/**
 * Hash a string to a hue in [0, 1) for deterministic color assignment.
 */
export function hashToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (((hash % 360) + 360) % 360) / 360;
}
