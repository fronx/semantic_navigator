/**
 * Camera controller for the Three.js renderer.
 * Handles viewport calculations, coordinate conversion, and fit-to-nodes animation.
 */

import type * as THREE from "three";

// Very narrow FOV (nearly orthographic) minimizes parallax between HTML labels and 3D nodes
export const CAMERA_FOV_DEGREES = 10;
const CAMERA_FOV_RADIANS = CAMERA_FOV_DEGREES * Math.PI / 180;

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
  /** Pan camera by screen delta */
  pan(screenDeltaX: number, screenDeltaY: number): void;
  /** Zoom camera with cursor position (NDC coordinates -1 to +1) */
  zoom(deltaY: number, cursorNDC: { x: number; y: number }): void;
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
        const k = 500 / camera.position.z;
        onZoomEnd({ k, x: camera.position.x, y: camera.position.y });
      }
    }
  }

  function pan(screenDeltaX: number, screenDeltaY: number): void {
    const camera = getCamera();
    if (!camera) return;

    const viewport = getViewport();
    const rect = container.getBoundingClientRect();
    const pixelsPerUnit = rect.height / viewport.height;

    // Move camera (invert because dragging "grabs" the canvas)
    camera.position.x -= screenDeltaX / pixelsPerUnit;
    camera.position.y += screenDeltaY / pixelsPerUnit; // Y is inverted in screen coords
  }

  function zoom(deltaY: number, cursorNDC: { x: number; y: number }): void {
    const camera = getCamera();
    if (!camera) return;

    const oldZ = camera.position.z;
    const zoomSensitivity = camera.position.z * 0.003;
    // Allow zooming out far enough to see large graphs at 50% screen height
    const newZ = Math.max(50, Math.min(20000, oldZ + deltaY * zoomSensitivity));

    if (Math.abs(newZ - oldZ) < 0.01) return;

    // Calculate the graph position under the cursor before zoom
    const oldViewport = getViewport();
    const graphX = camera.position.x + cursorNDC.x * (oldViewport.width / 2);
    const graphY = camera.position.y + cursorNDC.y * (oldViewport.height / 2);

    // Update Z first so getViewport returns new dimensions
    camera.position.z = newZ;

    // Calculate new visible area and adjust camera position so the point under cursor stays fixed
    const newViewport = getViewport();
    camera.position.x = graphX - cursorNDC.x * (newViewport.width / 2);
    camera.position.y = graphY - cursorNDC.y * (newViewport.height / 2);
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
    const newZ = Math.max(zForHeight, zForWidth, 50); // Min zoom of 50

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
          const k = 500 / newZ;
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
    pan,
    zoom,
    notifyZoomChange,
    cancelAnimation,
  };
}
