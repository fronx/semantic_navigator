/**
 * Shared zoom-to-cursor calculation logic for both Three.js and R3F renderers.
 * Calculates new camera position to keep the point under cursor fixed during zoom.
 */

// Very narrow FOV (nearly orthographic) minimizes parallax between HTML labels and 3D nodes
export const CAMERA_FOV_DEGREES = 10;
const CAMERA_FOV_RADIANS = CAMERA_FOV_DEGREES * Math.PI / 180;

/**
 * Exponential zoom factor base.
 * Higher = faster zoom, lower = slower zoom.
 * Typical values: 1.005 (conservative), 1.008 (balanced), 1.01 (aggressive)
 */
const ZOOM_FACTOR_BASE = 1.003;

/**
 * Multiplier for pinch gestures to compensate for smaller deltaY values.
 */
const PINCH_ZOOM_MULTIPLIER = 3;

/**
 * Calculate exponential zoom factor from scroll delta.
 * Gives consistent perceptual zoom speed at all zoom levels.
 *
 * @param deltaY - Scroll delta from wheel event
 * @param isPinch - Whether this is a pinch gesture (applies multiplier)
 */
export function calculateZoomFactor(deltaY: number, isPinch = false): number {
  const effectiveDelta = isPinch ? deltaY * PINCH_ZOOM_MULTIPLIER : deltaY;
  return Math.pow(ZOOM_FACTOR_BASE, effectiveDelta);
}

export interface ZoomToCursorParams {
  /** Current camera Z position */
  oldZ: number;
  /** New camera Z position after zoom */
  newZ: number;
  /** Current camera X position */
  cameraX: number;
  /** Current camera Y position */
  cameraY: number;
  /** Cursor position in normalized device coordinates (-1 to +1) */
  cursorNDC: { x: number; y: number };
  /** Viewport aspect ratio (width / height) */
  aspect: number;
}

export interface ZoomToCursorResult {
  /** New camera X position */
  cameraX: number;
  /** New camera Y position */
  cameraY: number;
  /** Graph position that stayed fixed under cursor */
  fixedPoint: { x: number; y: number };
}

/**
 * Calculate new camera position for zoom-to-cursor behavior.
 * The point under the cursor remains fixed in screen space during zoom.
 */
export function calculateZoomToCursor(params: ZoomToCursorParams): ZoomToCursorResult {
  const { oldZ, newZ, cameraX, cameraY, cursorNDC, aspect } = params;

  // Calculate visible dimensions at z=0 before zoom
  const oldVisibleHeight = 2 * oldZ * Math.tan(CAMERA_FOV_RADIANS / 2);
  const oldVisibleWidth = oldVisibleHeight * aspect;

  // Calculate the graph position under the cursor before zoom
  const graphX = cameraX + cursorNDC.x * (oldVisibleWidth / 2);
  const graphY = cameraY + cursorNDC.y * (oldVisibleHeight / 2);

  // Calculate visible dimensions at z=0 after zoom
  const newVisibleHeight = 2 * newZ * Math.tan(CAMERA_FOV_RADIANS / 2);
  const newVisibleWidth = newVisibleHeight * aspect;

  // Adjust camera position so the point under cursor stays fixed
  const newCameraX = graphX - cursorNDC.x * (newVisibleWidth / 2);
  const newCameraY = graphY - cursorNDC.y * (newVisibleHeight / 2);

  return {
    cameraX: newCameraX,
    cameraY: newCameraY,
    fixedPoint: { x: graphX, y: graphY },
  };
}
