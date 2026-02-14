/**
 * Hook for creating and managing a Three.js clipping plane to visually crop text
 * at container boundaries without truncating the actual text content.
 *
 * Usage:
 * 1. Create plane: const clippingPlane = useTextClippingPlane()
 * 2. Add to material: material.clippingPlanes = [clippingPlane]
 * 3. Update position each frame: updateClippingPlane(...)
 * 4. Enable on renderer: gl.localClippingEnabled = true
 */

import { useMemo } from "react";
import * as THREE from "three";

export interface ClippingPlaneUpdater {
  /**
   * Update the clipping plane to clip at the bottom edge of a container.
   * @param containerY - Y position of the container center
   * @param containerHeight - Height of the container
   */
  setBottomClip: (containerY: number, containerHeight: number) => void;
}

/**
 * Creates a clipping plane for text that can be updated each frame.
 * The plane clips geometry below a specified Y coordinate (bottom edge of container).
 *
 * @returns Tuple of [clippingPlane, updater]
 */
export function useTextClippingPlane(): readonly [THREE.Plane, ClippingPlaneUpdater] {
  const clippingPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  const updater: ClippingPlaneUpdater = useMemo(
    () => ({
      setBottomClip: (containerY: number, containerHeight: number) => {
        const bottomEdgeY = containerY - containerHeight / 2;
        // Plane with normal pointing up (0, 1, 0) clips below the bottom edge
        clippingPlane.setFromNormalAndCoplanarPoint(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(0, bottomEdgeY, 0)
        );
      },
    }),
    [clippingPlane]
  );

  return [clippingPlane, updater] as const;
}
