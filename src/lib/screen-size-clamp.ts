/**
 * Utilities for clamping world-space objects to screen-pixel size limits.
 * Prevents 3D elements from growing unbounded as the camera zooms in.
 */

/**
 * Compute units-per-pixel for a perspective camera at a given distance.
 * This is how many world units correspond to one screen pixel.
 */
export function perspectiveUnitsPerPixel(fovRadians: number, distance: number, viewportHeight: number, dpr = 1): number {
  return (2 * Math.tan(fovRadians / 2) * distance) / (viewportHeight / dpr);
}

/**
 * Compute the maximum scale factor so that a world-space object
 * doesn't exceed a given screen-pixel size.
 *
 * @param worldSize - The object's base world-space size (diameter, width, etc.) before scaling
 * @param maxScreenPx - Maximum allowed size in screen pixels
 * @param unitsPerPixel - World units per screen pixel (from camera/viewport)
 * @returns The maximum scale factor to apply
 */
export function maxScaleForScreenSize(worldSize: number, maxScreenPx: number, unitsPerPixel: number): number {
  const maxWorldSize = maxScreenPx * unitsPerPixel;
  return maxWorldSize / worldSize;
}
