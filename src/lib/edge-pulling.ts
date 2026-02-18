/**
 * Shared utilities for edge pulling (pulling off-screen nodes to viewport boundary).
 * Used by both KeywordNodes and ContentNodes.
 *
 * For fisheye compression (smooth radial compression for focus mode), see fisheye-viewport.ts
 */

import type * as THREE from "three";

// Import fisheye utilities (used by computePullPosition, re-exported for convenience)
import { applyFisheyeCompression, computeCompressionRadii, computeCompressionExtents } from "./fisheye-viewport";
export { applyFisheyeCompression, computeCompressionRadii, computeCompressionExtents };

// Screen-pixel-based constants (consistent at all zoom levels)
export const PULL_LINE_PX = 25;     // from viewport edge — where pulled nodes are placed
export const FOCUS_PULL_LINE_PX = 80; // from viewport edge — where focused keywords are placed (inner zone)
export const UI_PROXIMITY_PX = 10;   // extra margin on sides adjacent to UI chrome (sidebar left, header top)
export const VIEWPORT_OVERSCAN_PX = 40; // extend margin detection beyond visible edge (prevents pop-in)

export const MAX_PULLED_NODES = 20;          // keywords
export const MAX_PULLED_CONTENT_NODES = 20;  // content

/**
 * Viewport bounds with pull line and cliff boundaries.
 * All coordinates in world units.
 */
export interface ViewportZones {
  /** Viewport boundaries */
  viewport: {
    left: number;
    right: number;
    bottom: number;
    top: number;
    camX: number;
    camY: number;
  };
  /** Margin boundary (pull line) where nodes start clamping */
  pullBounds: {
    left: number;
    right: number;
    bottom: number;
    top: number;
  };
  /** Inner boundary (focus pull line) for focused keywords in focus mode - keeps them visible */
  focusPullBounds: {
    left: number;
    right: number;
    bottom: number;
    top: number;
  };
  /** Extended viewport boundaries (overscan beyond visible edge) */
  extendedViewport: {
    left: number;
    right: number;
    bottom: number;
    top: number;
    camX: number;
    camY: number;
  };
  /** World units per screen pixel (for screen-space calculations) */
  worldPerPx: number;
}

/**
 * Compute viewport zones for edge pulling.
 * Converts screen-pixel margins to world units based on current camera state.
 */
export function computeViewportZones(
  camera: THREE.PerspectiveCamera,
  canvasWidth: number,
  canvasHeight: number,
): ViewportZones {
  const cameraZ = camera.position.z;
  const fov = camera.fov * Math.PI / 180;
  const visibleHeight = 2 * cameraZ * Math.tan(fov / 2);
  const visibleWidth = visibleHeight * (canvasWidth / canvasHeight);
  const halfW = visibleWidth / 2;
  const halfH = visibleHeight / 2;
  const camX = camera.position.x;
  const camY = camera.position.y;

  // Convert screen-pixel margins to world units
  const worldPerPx = visibleWidth / canvasWidth;
  const pullPadBase = PULL_LINE_PX * worldPerPx;
  const focusPullPad = FOCUS_PULL_LINE_PX * worldPerPx;
  const uiPad = UI_PROXIMITY_PX * worldPerPx;
  const overscan = VIEWPORT_OVERSCAN_PX * worldPerPx;

  const marginPad = pullPadBase;
  const basePull = {
    left: camX - halfW + marginPad + uiPad,
    right: camX + halfW - marginPad,
    bottom: camY - halfH + marginPad,
    top: camY + halfH - marginPad - uiPad,
  };

  const focusPull = {
    left: camX - halfW + focusPullPad + uiPad,
    right: camX + halfW - focusPullPad,
    bottom: camY - halfH + focusPullPad,
    top: camY + halfH - focusPullPad - uiPad,
  };

  return {
    viewport: {
      left: camX - halfW,
      right: camX + halfW,
      bottom: camY - halfH,
      top: camY + halfH,
      camX,
      camY,
    },
    pullBounds: basePull,
    focusPullBounds: focusPull,
    extendedViewport: {
      left: camX - halfW - overscan,
      right: camX + halfW + overscan,
      bottom: camY - halfH - overscan,
      top: camY + halfH + overscan,
      camX,
      camY,
    },
    worldPerPx,
  };
}

/**
 * Clamp a node position to explicit bounds using ray-AABB intersection.
 * Casts a ray from (camX, camY) toward the node and returns the intersection
 * with the bounding box. Works for both off-screen nodes (projects inward)
 * and cliff-zone nodes (projects outward to the pull line).
 */
export function clampToBounds(
  nodeX: number,
  nodeY: number,
  camX: number,
  camY: number,
  left: number,
  right: number,
  bottom: number,
  top: number,
): { x: number; y: number } {
  const dx = nodeX - camX;
  const dy = nodeY - camY;

  let tMin = Infinity;
  if (dx > 0) tMin = Math.min(tMin, (right - camX) / dx);
  else if (dx < 0) tMin = Math.min(tMin, (left - camX) / dx);
  if (dy > 0) tMin = Math.min(tMin, (top - camY) / dy);
  else if (dy < 0) tMin = Math.min(tMin, (bottom - camY) / dy);

  if (tMin === Infinity) return { x: nodeX, y: nodeY };
  return { x: camX + dx * tMin, y: camY + dy * tMin };
}

/**
 * Check if a node is inside the viewport.
 */
export function isInViewport(
  x: number,
  y: number,
  viewport: ViewportZones["viewport"],
): boolean {
  return (
    x >= viewport.left &&
    x <= viewport.right &&
    y >= viewport.bottom &&
    y <= viewport.top
  );
}

/**
 * Check if a node is in the cliff zone (visible but near edge).
 */
export function isInCliffZone(
  x: number,
  y: number,
  pullBounds: ViewportZones["pullBounds"],
): boolean {
  return (
    x < pullBounds.left ||
    x > pullBounds.right ||
    y < pullBounds.bottom ||
    y > pullBounds.top
  );
}

/** Scale factor for pulled ghost nodes (shared across all views). */
export const PULLED_SCALE_FACTOR = 0.6;
/** Color multiplier for pulled ghost nodes (shared across all views). */
export const PULLED_COLOR_FACTOR = 0.4;

/**
 * Compute the clamped position for a pulled node.
 * When `useFisheye` is true, applies fisheye compression first (for focused nodes).
 * Otherwise clamps to pull bounds via ray-AABB intersection.
 */
export function computePullPosition(
  x: number,
  y: number,
  zones: ViewportZones,
  useFisheye: boolean,
): { x: number; y: number } {
  const { camX, camY } = zones.viewport;
  if (useFisheye) {
    const extents = computeCompressionExtents(zones);
    const compressed = applyFisheyeCompression(
      x, y, camX, camY,
      extents.compressionStartHalfWidth, extents.compressionStartHalfHeight,
      extents.horizonHalfWidth, extents.horizonHalfHeight
    );
    return {
      x: Math.max(zones.pullBounds.left, Math.min(zones.pullBounds.right, compressed.x)),
      y: Math.max(zones.pullBounds.bottom, Math.min(zones.pullBounds.top, compressed.y)),
    };
  }
  return clampToBounds(
    x, y, camX, camY,
    zones.pullBounds.left, zones.pullBounds.right,
    zones.pullBounds.bottom, zones.pullBounds.top
  );
}
