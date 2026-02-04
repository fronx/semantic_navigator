/**
 * Ref-based bridge for sharing camera state between R3F Canvas internals and DOM overlays.
 *
 * The camera state is stored in refs that are updated every frame by a component
 * inside Canvas, and read by the LabelsOverlay component outside Canvas.
 */

import type { SimNode } from "@/lib/map-renderer";
import type { ClusterColorInfo } from "@/lib/semantic-colors";
import type { LabelOverlayManager } from "@/lib/label-overlays";

// ============================================================================
// Types
// ============================================================================

/**
 * Camera state that's updated every frame.
 * Stored in a ref for cross-Canvas-boundary access.
 */
export interface CameraState {
  x: number;
  y: number;
  z: number;
}

/**
 * All refs needed for label rendering.
 * These are created in R3FTopicsCanvas and passed to child components.
 */
export interface LabelRefs {
  /** Camera state (updated by CameraBridge inside Canvas) */
  cameraStateRef: React.MutableRefObject<CameraState>;
  /** Container div for DOM overlay positioning */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Current simulation nodes */
  simNodesRef: React.MutableRefObject<SimNode[]>;
  /** Node degrees for keyword label visibility */
  nodeDegreesRef: React.MutableRefObject<Map<string, number>>;
  /** Cluster colors for label coloring */
  clusterColorsRef: React.MutableRefObject<Map<number, ClusterColorInfo>>;
  /** Label manager (created by LabelsOverlay) */
  labelManagerRef: React.MutableRefObject<LabelOverlayManager | null>;
}

/**
 * Handle exposed by LabelsOverlay via useImperativeHandle.
 * Used by TopicsView to trigger cluster label updates.
 */
export interface LabelsOverlayHandle {
  updateClusterLabels: () => void;
  updateKeywordLabels: () => void;
  updateChunkLabels: (parentColors: Map<string, string>) => void;
  /** Get current simulation nodes (for cluster label updates) */
  getNodes: () => SimNode[];
}
