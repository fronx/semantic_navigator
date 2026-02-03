/**
 * Camera controller with OrbitControls.
 * Narrow FOV (10°) for orthogonal-like perspective.
 * Auto-fits on mount and reports zoom changes.
 */

import { useRef, useEffect } from "react";
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsType } from "three-stdlib";
import { CAMERA_Z_SCALE_BASE } from "@/lib/three/camera-controller";

export interface CameraControllerProps {
  onZoomChange?: (zoomScale: number) => void;
}

export function CameraController({ onZoomChange }: CameraControllerProps) {
  const controlsRef = useRef<OrbitControlsType>(null);
  const { camera } = useThree();

  // Report zoom changes when camera moves
  const handleChange = () => {
    if (camera && onZoomChange) {
      // Zoom scale is inversely related to camera Z distance
      // k = CAMERA_Z_SCALE_BASE / cameraZ
      const zoomScale = CAMERA_Z_SCALE_BASE / camera.position.z;
      onZoomChange(zoomScale);
    }
  };

  return (
    <OrbitControls
      ref={controlsRef}
      enableRotate={false}
      enableDamping
      dampingFactor={0.05}
      zoomSpeed={0.5}
      panSpeed={0.5}
      minDistance={10}
      maxDistance={50000}
      mouseButtons={{
        LEFT: 0,  // LEFT mouse = pan (match D3/Three.js renderers)
        MIDDLE: 1,  // MIDDLE mouse = zoom
        RIGHT: 2,  // RIGHT mouse = rotate (disabled anyway)
      }}
      onChange={handleChange}
    />
  );
}
