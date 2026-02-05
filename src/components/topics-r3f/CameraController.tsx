/**
 * Camera controller with OrbitControls.
 * Narrow FOV (10°) for orthogonal-like perspective.
 * Implements zoom-to-cursor behavior matching Three.js renderer.
 * Implements manual pan for maximum code sharing with Three.js renderer.
 */

import { useRef, useEffect, type RefObject } from "react";
import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsType } from "three-stdlib";
import type { Camera, WebGLRenderer } from "three";
import { CAMERA_Z_SCALE_BASE } from "@/lib/three/camera-controller";
import { CAMERA_Z_MIN, CAMERA_Z_MAX } from "@/lib/chunk-zoom-config";
import { calculateZoomToCursor, calculateZoomFactor } from "@/lib/three/zoom-to-cursor";
import { createPanHandler } from "@/lib/three/pan-handler";
import { classifyWheelGesture } from "@/lib/three/gesture-classifier";
import { calculatePan } from "@/lib/three/pan-camera";

export interface CameraControllerProps {
  onZoomChange?: (zoomScale: number) => void;
  maxDistance?: number;
}

/**
 * Custom hook to handle pan events with shared pan handler.
 * Updates camera position and OrbitControls target, triggers zoom change callback.
 */
function usePanHandler(
  camera: Camera,
  gl: WebGLRenderer,
  controlsRef: RefObject<OrbitControlsType | null>,
  onZoomChange?: (zoomScale: number) => void
) {
  useEffect(() => {
    const canvas = gl.domElement;

    const cleanupPanHandler = createPanHandler({
      canvas,
      getCameraZ: () => camera.position.z,
      onPan: (worldDeltaX, worldDeltaY) => {
        // Update camera position
        camera.position.x += worldDeltaX;
        camera.position.y += worldDeltaY;

        // Update OrbitControls target to match (keeps controls in sync)
        if (controlsRef.current) {
          controlsRef.current.target.set(camera.position.x, camera.position.y, 0);
          controlsRef.current.update();
        }

        // Notify zoom change (for state updates)
        if (onZoomChange) {
          const zoomScale = CAMERA_Z_SCALE_BASE / camera.position.z;
          onZoomChange(zoomScale);
        }
      },
    });

    return cleanupPanHandler;
  }, [camera, gl, controlsRef, onZoomChange]);
}

export function CameraController({ onZoomChange, maxDistance = CAMERA_Z_MAX }: CameraControllerProps) {
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

  // Handle pan events with shared handler
  usePanHandler(camera, gl, controlsRef, onZoomChange);

  // Implement unified gesture handling: scroll-to-pan, pinch/modifier-to-zoom
  useEffect(() => {
    const canvas = gl.domElement;

    const handleWheel = (event: WheelEvent) => {
      if (!controlsRef.current) return;

      event.preventDefault();
      event.stopPropagation();

      const gesture = classifyWheelGesture(event);

      if (gesture === 'scroll-pan') {
        // Two-finger scroll without modifiers → pan
        const rect = canvas.getBoundingClientRect();
        const { worldDeltaX, worldDeltaY } = calculatePan({
          screenDeltaX: -event.deltaX,  // Negative for natural scroll direction
          screenDeltaY: -event.deltaY,
          cameraZ: camera.position.z,
          containerWidth: rect.width,
          containerHeight: rect.height,
        });

        // Update camera position
        camera.position.x += worldDeltaX;
        camera.position.y += worldDeltaY;

        // Sync OrbitControls target
        controlsRef.current.target.set(camera.position.x, camera.position.y, 0);
        controlsRef.current.update();

        // Notify zoom change (for state updates)
        handleChange();
      } else {
        // 'pinch' or 'scroll-zoom' → zoom to cursor
        const controls = controlsRef.current;
        const oldZ = camera.position.z;

        // Exponential zoom: each scroll unit changes zoom by constant percentage
        // This gives consistent perceptual zoom speed at all levels
        const isPinch = gesture === 'pinch';
        const zoomFactor = calculateZoomFactor(event.deltaY, isPinch);
        const newZ = Math.max(CAMERA_Z_MIN, Math.min(maxDistance, oldZ * zoomFactor));

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
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [camera, gl, size, onZoomChange, maxDistance]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableRotate={false}
      enablePan={false}  // Disable OrbitControls pan (we handle it manually)
      enableDamping
      dampingFactor={0.05}
      minDistance={CAMERA_Z_MIN}  // Match our zoom limits
      maxDistance={maxDistance}  // Dynamic zoom limit based on graph size
      enableZoom={false}  // Disable built-in zoom (we handle it manually)
      onChange={handleChange}
    />
  );
}
