/**
 * Shared types for renderer hooks (D3 and Three.js).
 */

import type { HoverHighlightConfig } from "@/hooks/useGraphHoverHighlight";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform } from "@/lib/semantic-colors";

/**
 * Base options shared by all renderer hooks.
 * Renderer-specific hooks extend this with their unique options.
 */
export interface BaseRendererOptions {
  /** Whether this renderer is currently active */
  enabled: boolean;
  activeNodes: KeywordNode[];
  activeEdges: SimilarityEdge[];
  /** Ref to project nodes - using ref avoids re-creating graph on position updates */
  projectNodesRef: React.RefObject<ProjectNode[]>;
  colorMixRatio: number;
  hoverConfig: HoverHighlightConfig;
  pcaTransform: PCATransform | null;
  getSavedPosition: (id: string) => { x: number; y: number } | undefined;
  // Stable callbacks
  onKeywordClick?: (keyword: string) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
  onFilterClick: () => void;
  // Cursor tracking refs (from useProjectCreation)
  isHoveringRef: React.MutableRefObject<boolean>;
  cursorWorldPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  cursorScreenPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  // Ref for suppressing click-to-filter after project interactions
  projectInteractionRef: React.MutableRefObject<boolean>;
}
