/**
 * Camera controller with OrbitControls.
 * Narrow FOV (10°) for orthogonal-like perspective.
 * Implements zoom-to-cursor behavior matching Three.js renderer.
 * Implements manual pan for maximum code sharing with Three.js renderer.
 */

import { useRef, useEffect, useCallback, type RefObject } from "react";
import { OrbitControls } from "@react-three/drei";
import { useThree, useFrame } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsType } from "three-stdlib";
import type { Camera, WebGLRenderer, PerspectiveCamera } from "three";
import { CAMERA_Z_SCALE_BASE } from "@/lib/rendering-utils/camera-controller";
import { CAMERA_Z_MIN, CAMERA_Z_MAX } from "@/lib/content-zoom-config";
import { calculateZoomToCursor, calculateZoomFactor, CAMERA_FOV_DEGREES } from "@/lib/rendering-utils/zoom-to-cursor";
import { createPanHandler } from "@/lib/rendering-utils/pan-handler";
import { classifyWheelGesture } from "@/lib/rendering-utils/gesture-classifier";
import { calculatePan } from "@/lib/rendering-utils/pan-camera";

export interface CameraControllerProps {
  onZoomChange?: (zoomScale: number) => void;
  maxDistance?: number;
  /** Ref that will be populated with a flyTo(x, y) function for animated camera pan */
  flyToRef?: React.MutableRefObject<((x: number, y: number) => void) | null>;
  /** Enable drag-panning (default: true). Set to false to rely on scroll-panning only. */
  enableDragPan?: boolean;
  /** Callback fired whenever the camera pans or zooms (with world-space metadata). */
  onTransform?: (event: CameraTransformEvent) => void;
}

export interface CameraTransformViewport {
  width: number;
  height: number;
  worldPerPx: number;
}

export type CameraTransformEvent =
  | {
      type: "pan";
      cameraX: number;
      cameraY: number;
      cameraZ: number;
      worldDelta: { x: number; y: number };
      viewport: CameraTransformViewport;
    }
  | {
      type: "zoom";
      cameraX: number;
      cameraY: number;
      cameraZ: number;
      anchor: { x: number; y: number };
      direction: "in" | "out";
      zoomFactor: number;
      viewport: CameraTransformViewport;
    };

function computeViewportInfo(camera: Camera, width: number, height: number): CameraTransformViewport {
  const perspective = camera as PerspectiveCamera;
  const fovRadians = ((perspective?.fov ?? CAMERA_FOV_DEGREES) * Math.PI) / 180;
  const cameraZ = (camera.position?.z ?? 1);
  const visibleHeight = 2 * cameraZ * Math.tan(fovRadians / 2);
  const visibleWidth = visibleHeight * (width / Math.max(height, 1));
  return {
    width,
    height,
    worldPerPx: width > 0 ? visibleWidth / width : 0,
  };
}

/**
 * Custom hook to handle pan events with shared pan handler.
 * Updates camera position and OrbitControls target, triggers zoom change callback.
 */
function usePanHandler(
  camera: Camera,
  gl: WebGLRenderer,
  controlsRef: RefObject<OrbitControlsType | null>,
  size: { width: number; height: number },
  onZoomChange?: (zoomScale: number) => void,
  onTransform?: (event: CameraTransformEvent) => void,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled) return;

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

        if (onTransform) {
          onTransform({
            type: "pan",
            cameraX: camera.position.x,
            cameraY: camera.position.y,
            cameraZ: camera.position.z,
            worldDelta: { x: worldDeltaX, y: worldDeltaY },
            viewport: computeViewportInfo(camera, size.width, size.height),
          });
        }
      },
    });

    return cleanupPanHandler;
  }, [camera, gl, controlsRef, size.width, size.height, onZoomChange, onTransform, enabled]);
}

export function CameraController({
  onZoomChange,
  maxDistance = CAMERA_Z_MAX,
  flyToRef,
  enableDragPan = true,
  onTransform,
}: CameraControllerProps) {
  const controlsRef = useRef<OrbitControlsType>(null);
  const { camera, gl, size } = useThree();

  // Animated flyTo state (ref-driven, no React re-renders)
  const flyToAnimRef = useRef<{
    startX: number; startY: number;
    targetX: number; targetY: number;
    startTime: number; duration: number;
  } | null>(null);
  const lastFlyToPosRef = useRef<{ x: number; y: number } | null>(null);

  // Ease-out cubic: decelerates smoothly
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

  // Animate flyTo per frame
  useFrame(() => {
    const anim = flyToAnimRef.current;
    if (!anim) {
      lastFlyToPosRef.current = null;
      return;
    }

    const elapsed = performance.now() - anim.startTime;
    const t = Math.min(1, elapsed / anim.duration);
    const eased = easeOutCubic(t);

    const x = anim.startX + (anim.targetX - anim.startX) * eased;
    const y = anim.startY + (anim.targetY - anim.startY) * eased;

    camera.position.x = x;
    camera.position.y = y;

    if (controlsRef.current) {
      controlsRef.current.target.set(x, y, 0);
      controlsRef.current.update();
    }

    if (onZoomChange) {
      const zoomScale = CAMERA_Z_SCALE_BASE / camera.position.z;
      onZoomChange(zoomScale);
    }

    const prev = lastFlyToPosRef.current;
    const deltaX = prev ? x - prev.x : 0;
    const deltaY = prev ? y - prev.y : 0;
    if (onTransform && (Math.abs(deltaX) > 1e-3 || Math.abs(deltaY) > 1e-3)) {
      onTransform({
        type: "pan",
        cameraX: camera.position.x,
        cameraY: camera.position.y,
        cameraZ: camera.position.z,
        worldDelta: { x: deltaX, y: deltaY },
        viewport: computeViewportInfo(camera, size.width, size.height),
      });
    }
    lastFlyToPosRef.current = { x, y };

    if (t >= 1) {
      flyToAnimRef.current = null;
      lastFlyToPosRef.current = null;
    }
  });

  // Expose flyTo function via ref
  const flyTo = useCallback((targetX: number, targetY: number) => {
    flyToAnimRef.current = {
      startX: camera.position.x,
      startY: camera.position.y,
      targetX,
      targetY,
      startTime: performance.now(),
      duration: 400,
    };
  }, [camera]);

  useEffect(() => {
    if (flyToRef) flyToRef.current = flyTo;
    return () => { if (flyToRef) flyToRef.current = null; };
  }, [flyToRef, flyTo]);

  // Report zoom changes when camera moves
  const handleChange = () => {
    if (camera && onZoomChange) {
      // Zoom scale is inversely related to camera Z distance
      // k = CAMERA_Z_SCALE_BASE / cameraZ
      const zoomScale = CAMERA_Z_SCALE_BASE / camera.position.z;
      onZoomChange(zoomScale);
    }
  };

  // Handle pan events with shared handler (only if drag panning is enabled)
  usePanHandler(camera, gl, controlsRef, size, onZoomChange, onTransform, enableDragPan);

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

        if (onTransform) {
          onTransform({
            type: "pan",
            cameraX: camera.position.x,
            cameraY: camera.position.y,
            cameraZ: camera.position.z,
            worldDelta: { x: worldDeltaX, y: worldDeltaY },
            viewport: computeViewportInfo(camera, size.width, size.height),
          });
        }
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

        if (onTransform) {
          onTransform({
            type: "zoom",
            cameraX: camera.position.x,
            cameraY: camera.position.y,
            cameraZ: camera.position.z,
            anchor: result.fixedPoint,
            direction: newZ < oldZ ? "in" : "out",
            zoomFactor,
            viewport: computeViewportInfo(camera, size.width, size.height),
          });
        }
      }
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [camera, gl, size, onZoomChange, maxDistance, onTransform]);

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
