import * as THREE from "three";

export interface ScreenRect {
  x: number; // screen center X (pixels)
  y: number; // screen center Y (pixels)
  width: number; // screen width (pixels)
  height: number; // screen height (pixels)
  z: number; // World z for text positioning (card z + TEXT_Z_OFFSET)
  /** Exact world-space half-height of the card (passed through from halfHeight arg). Used for
   *  clipping and localCardHeight instead of screenRect.height * unitsPerPixel, which
   *  overestimates for off-axis cards due to Euclidean vs view-space-Z divergence. */
  worldHalfHeight: number;
}

/**
 * Project a world-space card into a screen-space rect.
 * Uses three pre-allocated Vector3 scratch buffers to avoid GC pressure.
 * Same pattern used by ContentNodes.tsx and ChunksScene.tsx for text label sizing.
 */
export function projectCardToScreenRect(
  x: number,
  y: number,
  z: number,
  halfWidth: number,
  halfHeight: number,
  camera: THREE.Camera,
  size: { width: number; height: number },
  // Pre-allocated scratch vectors (reuse to avoid GC)
  centerVec: THREE.Vector3,
  edgeVecX: THREE.Vector3,
  edgeVecY: THREE.Vector3,
): ScreenRect {
  centerVec.set(x, y, z);
  centerVec.project(camera);
  edgeVecX.set(x + halfWidth, y, z);
  edgeVecX.project(camera);
  edgeVecY.set(x, y + halfHeight, z);
  edgeVecY.project(camera);

  const screenCenterX = ((centerVec.x + 1) / 2) * size.width;
  const screenCenterY = ((1 - centerVec.y) / 2) * size.height;
  const screenHalfWidth = Math.abs(((edgeVecX.x + 1) / 2) * size.width - screenCenterX);
  const screenHalfHeight = Math.abs(((1 - edgeVecY.y) / 2) * size.height - screenCenterY);

  return {
    x: screenCenterX,
    y: screenCenterY,
    width: screenHalfWidth * 2,
    height: screenHalfHeight * 2,
    z,
    worldHalfHeight: halfHeight,
  };
}
