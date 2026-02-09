/**
 * Shared pan calculation logic for Three.js and R3F renderers.
 * Converts screen-space delta to world-space delta based on camera position.
 */

import { CAMERA_FOV_DEGREES } from "./zoom-to-cursor";

const CAMERA_FOV_RADIANS = CAMERA_FOV_DEGREES * Math.PI / 180;

export interface PanCalculationParams {
  /** Screen delta X (pixels) */
  screenDeltaX: number;
  /** Screen delta Y (pixels) */
  screenDeltaY: number;
  /** Current camera Z position */
  cameraZ: number;
  /** Container width in pixels */
  containerWidth: number;
  /** Container height in pixels */
  containerHeight: number;
}

export interface PanCalculationResult {
  /** World delta X (inverted - dragging "grabs" canvas) */
  worldDeltaX: number;
  /** World delta Y (inverted and flipped for Y-up coordinate system) */
  worldDeltaY: number;
}

/**
 * Calculate world-space pan delta from screen-space mouse movement.
 *
 * The calculation:
 * 1. Compute visible world dimensions at z=0 based on camera Z and FOV
 * 2. Convert pixels to world units using pixelsPerUnit ratio
 * 3. Invert direction (dragging "grabs" the canvas)
 * 4. Flip Y axis (screen Y down, world Y up)
 */
export function calculatePan(params: PanCalculationParams): PanCalculationResult {
  const { screenDeltaX, screenDeltaY, cameraZ, containerWidth, containerHeight } = params;

  // Calculate visible world dimensions at z=0
  const visibleHeight = 2 * cameraZ * Math.tan(CAMERA_FOV_RADIANS / 2);
  const visibleWidth = visibleHeight * (containerWidth / containerHeight);

  // Convert screen pixels to world units
  const pixelsPerUnit = containerHeight / visibleHeight;

  // Move camera (invert because dragging "grabs" the canvas)
  const worldDeltaX = -screenDeltaX / pixelsPerUnit;
  const worldDeltaY = screenDeltaY / pixelsPerUnit; // Y is inverted in screen coords

  return { worldDeltaX, worldDeltaY };
}
