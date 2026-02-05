/**
 * Camera controller for the Three.js renderer.
 * Handles viewport calculations, coordinate conversion, and fit-to-nodes animation.
 */

import type * as THREE from "three";
import { calculateZoomToCursor, calculateZoomFactor, CAMERA_FOV_DEGREES } from "./zoom-to-cursor";

const CAMERA_FOV_RADIANS = CAMERA_FOV_DEGREES * Math.PI / 180;
/** Base value used to convert perspective camera Z to a pseudo-zoom scale (k = BASE / z) */
export const CAMERA_Z_SCALE_BASE = 500;

export interface CameraControllerOptions {
  /** Function to get the 3d-force-graph camera */
  getCamera: () => THREE.Camera | undefined;
  /** Container element for dimensions */
  container: HTMLElement;
  /** Called when zoom/pan changes settle */
  onZoomEnd?: (transform: { k: number; x: number; y: number }) => void;
}

export interface CameraController {
  /** Get visible world dimensions at z=0 */
  getViewport(): { width: number; height: number };
  /** Convert world coordinates to screen coordinates */
  worldToScreen(world: { x: number; y: number }): { x: number; y: number } | null;
  /** Convert screen coordinates to world coordinates */
  screenToWorld(screen: { x: number; y: number }): { x: number; y: number };
  /** Get current camera Z position */
  getCameraZ(): number;
  /** Get transform info (k = pixels per world unit) */
  getTransform(): { k: number; x: number; y: number };
  /** Animate camera to fit all nodes in view */
  fitToNodes(nodes: Array<{ x?: number; y?: number }>, padding?: number): void;
  /** Apply world-space pan deltas directly */
  applyWorldPan(worldDeltaX: number, worldDeltaY: number): void;
  /** Zoom camera with cursor position (NDC coordinates -1 to +1) */
  zoom(deltaY: number, cursorNDC: { x: number; y: number }, isPinch?: boolean): void;
  /** Notify zoom change (calls onZoomEnd callback) */
  notifyZoomChange(): void;
  /** Cancel any running animation */
  cancelAnimation(): void;
}

export function createCameraController(options: CameraControllerOptions): CameraController {
  const { getCamera, container, onZoomEnd } = options;

  let animationFrameId: number | null = null;

  function getViewport(): { width: number; height: number } {
    const camera = getCamera();
    if (!camera) return { width: 1, height: 1 };

    const cameraZ = camera.position.z;
    const rect = container.getBoundingClientRect();
    const visibleHeight = 2 * cameraZ * Math.tan(CAMERA_FOV_RADIANS / 2);
    const visibleWidth = visibleHeight * (rect.width / rect.height);
    return { width: visibleWidth, height: visibleHeight };
  }

  function worldToScreen(world: { x: number; y: number }): { x: number; y: number } | null {
    const camera = getCamera();
    if (!camera) return null;

    const rect = container.getBoundingClientRect();
    const viewport = getViewport();

    // Convert world to NDC
    const ndcX = (world.x - camera.position.x) / (viewport.width / 2);
    const ndcY = (world.y - camera.position.y) / (viewport.height / 2);

    // Convert NDC to screen coordinates
    return {
      x: ((ndcX + 1) / 2) * rect.width,
      y: ((1 - ndcY) / 2) * rect.height, // Flip Y (screen Y down, world Y up)
    };
  }

  function screenToWorld(screen: { x: number; y: number }): { x: number; y: number } {
    const camera = getCamera();
    if (!camera) return { x: 0, y: 0 };

    const rect = container.getBoundingClientRect();
    const viewport = getViewport();

    // Convert screen to normalized device coordinates (-1 to +1)
    const ndcX = (screen.x / rect.width) * 2 - 1;
    const ndcY = -((screen.y / rect.height) * 2 - 1); // Flip Y (screen Y down, world Y up)

    // Convert NDC to world coordinates
    return {
      x: camera.position.x + ndcX * (viewport.width / 2),
      y: camera.position.y + ndcY * (viewport.height / 2),
    };
  }

  function getCameraZ(): number {
    return getCamera()?.position.z ?? 1000;
  }

  function getTransform(): { k: number; x: number; y: number } {
    const camera = getCamera();
    if (!camera) return { k: 1, x: 0, y: 0 };

    const rect = container.getBoundingClientRect();
    const viewport = getViewport();
    // k = pixels per world unit (for proper radius conversion)
    const k = rect.height / viewport.height;

    return { k, x: 0, y: 0 };
  }

  function notifyZoomChange(): void {
    if (onZoomEnd) {
      const camera = getCamera();
      if (camera) {
        const k = CAMERA_Z_SCALE_BASE / camera.position.z;
        onZoomEnd({ k, x: camera.position.x, y: camera.position.y });
      }
    }
  }

  function applyWorldPan(worldDeltaX: number, worldDeltaY: number): void {
    const camera = getCamera();
    if (!camera) return;

    camera.position.x += worldDeltaX;
    camera.position.y += worldDeltaY;
  }

  function zoom(deltaY: number, cursorNDC: { x: number; y: number }, isPinch = false): void {
    const camera = getCamera();
    if (!camera) return;

    const oldZ = camera.position.z;

    // Exponential zoom: each scroll unit changes zoom by constant percentage
    // This gives consistent perceptual zoom speed at all levels
    const zoomFactor = calculateZoomFactor(deltaY, isPinch);

    // Use centralized camera range from chunk-zoom-config
    const { CAMERA_Z_MIN, CAMERA_Z_MAX } = require('@/lib/chunk-zoom-config');
    const newZ = Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, oldZ * zoomFactor));

    if (Math.abs(newZ - oldZ) < 0.01) return;

    // Calculate new camera position using shared zoom-to-cursor logic
    const rect = container.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const result = calculateZoomToCursor({
      oldZ,
      newZ,
      cameraX: camera.position.x,
      cameraY: camera.position.y,
      cursorNDC,
      aspect,
    });

    // Update camera position
    camera.position.x = result.cameraX;
    camera.position.y = result.cameraY;
    camera.position.z = newZ;
  }

  function fitToNodes(nodes: Array<{ x?: number; y?: number }>, padding = 0.2): void {
    const camera = getCamera();
    if (!camera || nodes.length === 0) return;

    // Compute bounding box
    const xs = nodes.map(n => n.x ?? 0);
    const ys = nodes.map(n => n.y ?? 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const graphWidth = (maxX - minX) || 1;
    const graphHeight = (maxY - minY) || 1;
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    // Calculate camera Z to fit the graph with padding
    const rect = container.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const paddedWidth = graphWidth * (1 + padding);
    const paddedHeight = graphHeight * (1 + padding);

    // Z needed to see the full height/width
    const zForHeight = paddedHeight / (2 * Math.tan(CAMERA_FOV_RADIANS / 2));
    const zForWidth = paddedWidth / (2 * Math.tan(CAMERA_FOV_RADIANS / 2) * aspect);

    // Use the larger Z (more zoomed out) to fit both dimensions
    const { CAMERA_Z_MIN } = require('@/lib/chunk-zoom-config');
    const newZ = Math.max(zForHeight, zForWidth, CAMERA_Z_MIN);

    // Smoothly animate camera to new position
    const startX = camera.position.x;
    const startY = camera.position.y;
    const startZ = camera.position.z;
    const duration = 500; // ms
    const startTime = performance.now();

    function animateCamera() {
      // Re-check camera in case it was disposed during animation
      const cam = getCamera();
      if (!cam) {
        animationFrameId = null;
        return;
      }

      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - t, 3);

      cam.position.x = startX + (graphCenterX - startX) * eased;
      cam.position.y = startY + (graphCenterY - startY) * eased;
      cam.position.z = startZ + (newZ - startZ) * eased;

      if (t < 1) {
        animationFrameId = requestAnimationFrame(animateCamera);
      } else {
        animationFrameId = null;
        // Notify after animation completes
        if (onZoomEnd) {
          const k = CAMERA_Z_SCALE_BASE / newZ;
          onZoomEnd({ k, x: graphCenterX, y: graphCenterY });
        }
      }
    }

    animationFrameId = requestAnimationFrame(animateCamera);
  }

  function cancelAnimation(): void {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  return {
    getViewport,
    worldToScreen,
    screenToWorld,
    getCameraZ,
    getTransform,
    fitToNodes,
    applyWorldPan,
    zoom,
    notifyZoomChange,
    cancelAnimation,
  };
}
