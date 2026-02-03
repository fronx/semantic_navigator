/**
 * Shared hover/interaction controller for TopicsView.
 * Encapsulates all hover highlighting, cursor tracking, and click handling
 * logic that is shared between D3 and Three.js renderers.
 */

import { buildAdjacencyMap, buildEmbeddingMap } from "@/lib/spatial-semantic";
import { computeHoverHighlight } from "@/lib/hover-highlight";
import { DEFAULT_HOVER_CONFIG, type HoverHighlightConfig } from "@/hooks/useGraphHoverHighlight";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";
import type { SimNode } from "@/lib/map-renderer";

// ============================================================================
// Types
// ============================================================================

export interface RendererAdapter {
  getTransform(): { k: number; x: number; y: number };
  screenToWorld(screen: { x: number; y: number }): { x: number; y: number };
  isHoveringProject(): boolean;
  getNodes(): SimNode[];
  applyHighlight(ids: Set<string> | null, baseDim: number): void;
}

export interface HoverControllerOptions {
  activeNodes: KeywordNode[];
  activeEdges: SimilarityEdge[];
  hoverConfigRef: React.RefObject<HoverHighlightConfig>;
  containerHeight: number;
  // Cursor tracking refs
  isHoveringRef: React.MutableRefObject<boolean>;
  cursorWorldPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  cursorScreenPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  // Interaction refs
  projectInteractionRef: React.MutableRefObject<boolean>;
  highlightedIdsRef: React.MutableRefObject<Set<string>>;
  // Callbacks
  onFilterClick: () => void;
  // Renderer adapter
  renderer: RendererAdapter;
}

export interface HoverController {
  handleMouseEnter(): void;
  handleMouseMove(screenX: number, screenY: number): void;
  handleMouseLeave(): void;
  handleClick(): void;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a hover controller that manages all hover/interaction logic.
 * This is renderer-agnostic - both D3 and Three.js use the same controller.
 */
export function createHoverController(options: HoverControllerOptions): HoverController {
  const {
    activeNodes,
    activeEdges,
    hoverConfigRef,
    containerHeight,
    isHoveringRef,
    cursorWorldPosRef,
    cursorScreenPosRef,
    projectInteractionRef,
    highlightedIdsRef,
    onFilterClick,
    renderer,
  } = options;

  // Build lookups for hover highlighting (computed once at creation)
  const screenRadiusFraction =
    hoverConfigRef.current.screenRadiusFraction ?? DEFAULT_HOVER_CONFIG.screenRadiusFraction!;
  const adjacency = buildAdjacencyMap(activeEdges);
  const embeddings = buildEmbeddingMap(activeNodes, (n) => `kw:${n.label}`);

  // Throttle state for hover highlight computation
  // Use requestAnimationFrame to batch updates at 60fps, giving simulation time to run
  let rafId: number | null = null;
  let pendingMousePos: { x: number; y: number } | null = null;

  /**
   * Compute and apply hover highlight for the given screen position.
   * This is the expensive operation that we want to throttle.
   */
  function computeAndApplyHighlight(screenX: number, screenY: number) {
    const { similarityThreshold, baseDim } = hoverConfigRef.current;

    // Track cursor position for project creation
    cursorScreenPosRef.current = { x: screenX, y: screenY };
    cursorWorldPosRef.current = renderer.screenToWorld({ x: screenX, y: screenY });

    // Skip hover highlighting if cursor is over a project node
    if (renderer.isHoveringProject()) {
      highlightedIdsRef.current = new Set();
      renderer.applyHighlight(new Set(), baseDim);
      return;
    }

    const nodes = renderer.getNodes();
    const { keywordHighlightedIds, isEmptySpace } = computeHoverHighlight({
      nodes,
      screenCenter: { x: screenX, y: screenY },
      screenRadius: containerHeight * screenRadiusFraction,
      transform: renderer.getTransform(),
      similarityThreshold,
      embeddings,
      adjacency,
      screenToWorld: (screen) => renderer.screenToWorld(screen),
    });

    if (isEmptySpace) {
      highlightedIdsRef.current = new Set();
      renderer.applyHighlight(null, baseDim);
    } else {
      highlightedIdsRef.current = keywordHighlightedIds;
      renderer.applyHighlight(keywordHighlightedIds, baseDim);
    }
  }

  return {
    handleMouseEnter() {
      isHoveringRef.current = true;
    },

    handleMouseMove(screenX: number, screenY: number) {
      // Always update cursor position immediately (cheap operation)
      cursorScreenPosRef.current = { x: screenX, y: screenY };
      cursorWorldPosRef.current = renderer.screenToWorld({ x: screenX, y: screenY });

      // Throttle the expensive hover highlight computation using RAF
      // Store the latest mouse position and schedule a single update
      pendingMousePos = { x: screenX, y: screenY };

      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (pendingMousePos) {
            computeAndApplyHighlight(pendingMousePos.x, pendingMousePos.y);
            pendingMousePos = null;
          }
        });
      }
    },

    handleMouseLeave() {
      // Cancel any pending hover highlight computation
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingMousePos = null;

      const { baseDim } = hoverConfigRef.current;
      highlightedIdsRef.current = new Set();
      renderer.applyHighlight(new Set(), baseDim);
      // Clear cursor tracking state
      isHoveringRef.current = false;
      cursorWorldPosRef.current = null;
      cursorScreenPosRef.current = null;
    },

    handleClick() {
      // Suppress click-to-filter after project interactions (drag, click on project)
      if (projectInteractionRef.current) {
        projectInteractionRef.current = false;
        return;
      }
      onFilterClick();
    },
  };
}
