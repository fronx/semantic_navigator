/**
 * Fade coordinator for cross-fading between cluster labels and keyword labels.
 *
 * Returns a normalized value (0-1) based on camera Z:
 * - 0 = far away: cluster labels visible, keyword labels hidden
 * - 1 = close: keyword labels visible, cluster labels hidden
 *
 * Used by ClusterLabels3D, KeywordLabels3D, and KeywordNodes to stay in sync.
 */

import { smoothstep } from "./three-text-utils";

export interface LabelFadeRange {
  /** Camera Z where keyword labels are fully hidden (far) */
  start: number;
  /** Camera Z where keyword labels are fully visible (close) */
  full: number;
}

/**
 * Compute cross-fade value between cluster and keyword labels.
 *
 * @param cameraZ - Current camera Z position
 * @param range - Z thresholds from zoomPhaseConfig.keywordLabels
 * @returns 0 (far, clusters visible) to 1 (close, keywords visible)
 */
export function computeLabelFade(cameraZ: number, range: LabelFadeRange): number {
  const far = Math.max(range.start, range.full);
  const close = Math.min(range.start, range.full);
  const span = far - close;
  if (span <= 0) return 1;

  const t = (far - cameraZ) / span;
  return smoothstep(Math.max(0, Math.min(1, t)));
}
