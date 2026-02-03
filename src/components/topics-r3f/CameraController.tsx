/**
 * Camera controller with OrbitControls.
 * Narrow FOV (10°) for orthogonal-like perspective.
 * Implements zoom-to-cursor behavior matching Three.js renderer.
 */

import { useRef, useEffect } from "react";
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsType } from "three-stdlib";
import { CAMERA_Z_SCALE_BASE } from "@/lib/three/camera-controller";
import { CAMERA_Z_MIN, CAMERA_Z_MAX } from "@/lib/chunk-zoom-config";
import { calculateZoomToCursor } from "@/lib/three/zoom-to-cursor";

export interface CameraControllerProps {
  onZoomChange?: (zoomScale: number) => void;
}

export function CameraController({ onZoomChange }: CameraControllerProps) {
  const controlsRef = useRef<OrbitControlsType>(null);
  const { camera, gl, size } = useThree();

  // Report zoom changes when camera moves
  const handleChange = () => {
    if (camera && onZoomChange) {
      // Zoom scale is inversely related to camera Z distance
      // k = CAMERA_Z_SCALE_BASE / cameraZ
      const zoomScale = CAMERA_Z_SCALE_BASE / camera.position.z;
      onZoomChange(zoomScale);
    }
  };

  // Implement zoom-to-cursor behavior
  useEffect(() => {
    const canvas = gl.domElement;

    const handleWheel = (event: WheelEvent) => {
      if (!controlsRef.current) return;

      // Prevent default OrbitControls zoom behavior
      event.preventDefault();
      event.stopPropagation();

      const controls = controlsRef.current;
      const oldZ = camera.position.z;

      // Calculate zoom delta with sensitivity based on current zoom level
      const zoomSensitivity = camera.position.z * 0.003;
      const newZ = Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, oldZ + event.deltaY * zoomSensitivity));

      if (Math.abs(newZ - oldZ) < 0.01) return;

      // Get cursor position in normalized device coordinates (-1 to +1)
      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const ndcX = (screenX / rect.width) * 2 - 1;
      const ndcY = -((screenY / rect.height) * 2 - 1); // Flip Y

      // Calculate new camera position using shared zoom-to-cursor logic
      const result = calculateZoomToCursor({
        oldZ,
        newZ,
        cameraX: camera.position.x,
        cameraY: camera.position.y,
        cursorNDC: { x: ndcX, y: ndcY },
        aspect: size.width / size.height,
      });

      // Update camera position
      camera.position.x = result.cameraX;
      camera.position.y = result.cameraY;
      camera.position.z = newZ;

      // Update OrbitControls target to match new camera position
      controls.target.set(camera.position.x, camera.position.y, 0);
      controls.update();

      // Notify zoom change
      handleChange();
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [camera, gl, size, onZoomChange]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableRotate={false}
      enableDamping
      dampingFactor={0.05}
      zoomSpeed={0.5}
      panSpeed={0.5}
      minDistance={CAMERA_Z_MIN}  // Match our zoom limits
      maxDistance={CAMERA_Z_MAX}  // Match our zoom limits
      enableZoom={false}  // Disable built-in zoom (we handle it manually)
      mouseButtons={{
        LEFT: 0,  // LEFT mouse = pan (match D3/Three.js renderers)
        MIDDLE: 1,  // MIDDLE mouse = zoom (disabled, using wheel instead)
        RIGHT: 2,  // RIGHT mouse = rotate (disabled anyway)
      }}
      onChange={handleChange}
    />
  );
}
