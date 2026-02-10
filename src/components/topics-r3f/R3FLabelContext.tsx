/**
 * Ref-based bridge for sharing camera state between R3F Canvas internals and DOM overlays.
 *
 * The camera state is stored in refs that are updated every frame by a component
 * inside Canvas, and read by the LabelsOverlay component outside Canvas.
 */

import type { SimNode } from "@/lib/map-renderer";
import type { ClusterColorInfo } from "@/lib/semantic-colors";

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
 * Screen-space bounding rectangle for a content node.
 * Calculated by ContentNodes during rendering, shared with label system.
 */
export interface ContentScreenRect {
  /** Screen X position (center, pixels) */
  x: number;
  /** Screen Y position (center, pixels) */
  y: number;
  /** Screen width (pixels) */
  width: number;
  /** Screen height (pixels) */
  height: number;
  /** World Z position */
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
  /** Runtime cluster IDs from useClusterLabels (Leiden clustering) */
  nodeToClusterRef: React.MutableRefObject<Map<string, number>>;
  /** Content screen rects (updated by ContentNodes every frame, read by label system) */
  contentScreenRectsRef: React.MutableRefObject<Map<string, ContentScreenRect>>;
  /** Cursor position in world coordinates (from hover controller) */
  cursorWorldPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  /** Currently hovered keyword ID (set by label overlay hover detection) */
  hoveredKeywordIdRef: React.MutableRefObject<string | null>;
  /** Currently hovered content node ID (set by ContentNodes hover detection) */
  hoveredContentIdRef: React.MutableRefObject<string | null>;
  /** Pulled (off-screen) keyword positions clamped to viewport edge (written by KeywordNodes, read by edges + labels) */
  pulledPositionsRef: React.MutableRefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
  /** Pulled (off-screen) content positions clamped to viewport edge (written by ContentNodes, read by content edges) */
  pulledContentPositionsRef: React.MutableRefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
}

/**
 * Handle exposed by R3FTopicsCanvas via useImperativeHandle.
 * Used by TopicsView to access simulation nodes.
 */
export interface LabelsOverlayHandle {
  /** Get current simulation nodes (for cluster label updates) */
  getNodes: () => SimNode[];
}
