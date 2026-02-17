/**
 * Reusable hook for zoom-based focus mode exit logic.
 *
 * Implements dual-threshold system:
 * - Absolute threshold: Exit when camera Z exceeds a fixed value
 * - Relative threshold: Exit when zoomed out beyond focus entry point
 *
 * Both must be met to prevent flickering near boundaries.
 */

import { useState, useRef } from "react";
import { useStableCallback } from "@/hooks/useStableRef";
import { CAMERA_Z_SCALE_BASE } from "@/lib/rendering-utils/camera-controller";

export interface UseFocusZoomExitOptions {
  /**
   * Whether focus mode is currently active.
   * Hook only checks for exit when this is true.
   */
  isFocused: boolean;

  /**
   * Callback to exit focus mode.
   * Called when both absolute and relative thresholds are met.
   */
  onExitFocus: () => void;

  /**
   * Absolute camera Z threshold (larger Z = more zoomed out).
   * Focus will exit when camera Z exceeds this value.
   *
   * Recommended values:
   * - TopicsView: keywordLabels.start * 1.3 (~18,149)
   * - ChunksView: 8000 (80% of max distance 10000)
   */
  absoluteThreshold: number;

  /**
   * Relative zoom-out multiplier beyond focus entry point.
   * Focus will exit when camera Z > entry Z * this multiplier.
   *
   * Default: 1.05 (5% zoom out)
   * Higher values require more zoom-out to exit.
   */
  relativeMultiplier?: number;

  /**
   * Base value for converting zoom scale to camera Z.
   * cameraZ = CAMERA_Z_SCALE_BASE / zoomScale
   *
   * Default: 500 (CAMERA_Z_SCALE_BASE from rendering-utils/camera-controller)
   */
  cameraZScaleBase?: number;
}

export interface UseFocusZoomExitReturn {
  /**
   * Call this from your zoom change handler.
   * Checks thresholds and calls onExitFocus if both are met.
   *
   * @param zoomScale - Current zoom scale (k value from transform)
   */
  handleZoomChange: (zoomScale: number) => void;

  /**
   * Call this when entering focus mode to capture the current camera Z.
   * This sets the baseline for the relative threshold.
   *
   * @param cameraZ - Current camera Z position (optional, calculated from last zoom if not provided)
   */
  captureEntryZoom: (cameraZ?: number) => void;

  /**
   * Current camera Z position (derived from last zoom change).
   * Useful for other components that need camera Z tracking.
   */
  cameraZ: number | undefined;
}

/**
 * Hook for zoom-based focus mode exit with dual-threshold system.
 *
 * @example
 * // TopicsView usage
 * const absoluteThreshold = zoomPhaseConfig.keywordLabels.start * 1.3;
 * const { handleZoomChange, captureEntryZoom, cameraZ } = useFocusZoomExit({
 *   isFocused: focusState !== null,
 *   onExitFocus: () => setFocusState(null),
 *   absoluteThreshold,
 * });
 *
 * // In focus entry handler
 * setFocusState(newFocusState);
 * captureEntryZoom();
 *
 * @example
 * // ChunksView usage
 * const { handleZoomChange, captureEntryZoom } = useFocusZoomExit({
 *   isFocused: selectedChunkId !== null,
 *   onExitFocus: () => onSelectChunk(null),
 *   absoluteThreshold: 8000,
 * });
 */
export function useFocusZoomExit({
  isFocused,
  onExitFocus,
  absoluteThreshold,
  relativeMultiplier = 1.05,
  cameraZScaleBase = CAMERA_Z_SCALE_BASE,
}: UseFocusZoomExitOptions): UseFocusZoomExitReturn {
  const [cameraZ, setCameraZ] = useState<number | undefined>(undefined);
  const focusEntryZRef = useRef<number | null>(null);

  // Capture entry zoom level (called when focus mode starts)
  const captureEntryZoom = useStableCallback((providedCameraZ?: number) => {
    const z = providedCameraZ ?? cameraZ;
    focusEntryZRef.current = z ?? null;
  });

  // Handle zoom changes and check exit thresholds
  const handleZoomChange = useStableCallback((zoomScale: number) => {
    if (!Number.isFinite(zoomScale) || zoomScale <= 0) return;

    const newCameraZ = cameraZScaleBase / zoomScale;
    setCameraZ(newCameraZ);

    // Only check exit conditions when focus is active
    if (!isFocused) return;

    // Both thresholds must be met to exit (prevents flickering)
    const relativeLimit = (focusEntryZRef.current ?? 0) * relativeMultiplier;
    const shouldExit = newCameraZ > absoluteThreshold && newCameraZ > relativeLimit;

    if (shouldExit) {
      focusEntryZRef.current = null;
      onExitFocus();
    }
  });

  return {
    handleZoomChange,
    captureEntryZoom,
    cameraZ,
  };
}
