/**
 * Hook that manages Three.js-based rendering for TopicsView.
 * Handles renderer initialization, hover highlighting, and event handlers.
 */

import { useEffect, useRef } from "react";
import { createThreeRenderer, type ThreeRenderer } from "@/lib/three-renderer";
import { buildAdjacencyMap, buildEmbeddingMap } from "@/lib/spatial-semantic";
import { computeHoverHighlight } from "@/lib/hover-highlight";
import { DEFAULT_HOVER_CONFIG, type HoverHighlightConfig } from "@/hooks/useGraphHoverHighlight";
import { convertToThreeNodes } from "@/lib/topics-graph-nodes";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import { computeNeighborAveragedColors, type PCATransform } from "@/lib/semantic-colors";

// ============================================================================
// Types
// ============================================================================

export interface UseThreeTopicsRendererOptions {
  /** Whether this renderer is currently active */
  enabled: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  activeNodes: KeywordNode[];
  activeEdges: SimilarityEdge[];
  projectNodes: ProjectNode[];
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

export interface UseThreeTopicsRendererResult {
  /** Three.js renderer instance (for cluster updates) */
  threeRendererRef: React.MutableRefObject<ThreeRenderer | null>;
  /** Highlighted IDs for click-to-filter */
  highlightedIdsRef: React.MutableRefObject<Set<string>>;
  /** Get position for a node ID */
  getNodePosition: (id: string) => { x: number; y: number } | undefined;
}

// ============================================================================
// Hook
// ============================================================================

export function useThreeTopicsRenderer(
  options: UseThreeTopicsRendererOptions
): UseThreeTopicsRendererResult {
  const {
    enabled,
    containerRef,
    activeNodes,
    activeEdges,
    projectNodes,
    colorMixRatio,
    hoverConfig,
    pcaTransform,
    getSavedPosition,
    onKeywordClick,
    onProjectClick,
    onProjectDrag,
    onZoomChange,
    onFilterClick,
    isHoveringRef,
    cursorWorldPosRef,
    cursorScreenPosRef,
    projectInteractionRef,
  } = options;

  // Refs to expose to parent
  const threeRendererRef = useRef<ThreeRenderer | null>(null);
  const highlightedIdsRef = useRef<Set<string>>(new Set());

  // Stable ref for hoverConfig (accessed in event handlers without triggering re-renders)
  const hoverConfigRef = useRef(hoverConfig);
  hoverConfigRef.current = hoverConfig;

  // Main Three.js rendering effect
  useEffect(() => {
    if (!enabled) return;
    if (!containerRef.current) return;

    const container = containerRef.current;
    let cancelled = false;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Convert nodes/edges using shared utility
    const { mapNodes, mapLinks } = convertToThreeNodes({
      keywordNodes: activeNodes,
      edges: activeEdges,
      projectNodes,
      width,
      height,
      getSavedPosition,
    });

    const immediateParams = {
      current: {
        dotScale: 1,
        edgeOpacity: 0.6,
        hullOpacity: 0.1,
        edgeCurve: 0.25,
        curveMethod: "hybrid" as const,
        curveType: "arc" as const,
        colorMixRatio,
      },
    };

    // Build lookups for hover highlighting
    const screenRadiusFraction = hoverConfig.screenRadiusFraction ?? DEFAULT_HOVER_CONFIG.screenRadiusFraction!;
    const adjacency = buildAdjacencyMap(activeEdges);
    const embeddings = buildEmbeddingMap(activeNodes, (n) => `kw:${n.label}`);

    // Event handlers (stored for cleanup)
    let handleMouseEnter: (() => void) | null = null;
    let handleMouseMove: ((event: MouseEvent) => void) | null = null;
    let handleMouseLeave: (() => void) | null = null;
    let handleClick: (() => void) | null = null;

    // Defer initialization to next frame to ensure container is fully laid out
    const frameId = requestAnimationFrame(() => {
      if (cancelled) return;

      (async () => {
        // Compute embedding-based colors with neighbor averaging
        const nodeColors = pcaTransform
          ? computeNeighborAveragedColors(activeNodes, activeEdges, pcaTransform)
          : undefined;

        const threeRenderer = await createThreeRenderer({
          container,
          nodes: mapNodes,
          links: mapLinks,
          immediateParams,
          nodeColors,
          callbacks: {
            onKeywordClick,
            onProjectClick,
            onProjectDrag,
            onZoomEnd: (transform) => onZoomChange?.(transform.k),
            onProjectInteractionStart: () => {
              projectInteractionRef.current = true;
            },
          },
        });

        if (cancelled) {
          threeRenderer.destroy();
          return;
        }

        threeRendererRef.current = threeRenderer;

        // Set up hover highlighting and cursor tracking
        const containerHeight = container.clientHeight;

        // Track hover state for project creation
        handleMouseEnter = () => {
          isHoveringRef.current = true;
        };

        const handleMouseLeaveProject = () => {
          isHoveringRef.current = false;
          cursorWorldPosRef.current = null;
          cursorScreenPosRef.current = null;
        };

        handleMouseMove = (event: MouseEvent) => {
          const rect = container.getBoundingClientRect();
          const screenX = event.clientX - rect.left;
          const screenY = event.clientY - rect.top;
          const { similarityThreshold, baseDim } = hoverConfigRef.current;

          // Track cursor position for project creation
          cursorScreenPosRef.current = { x: screenX, y: screenY };
          const worldPos = threeRenderer.screenToWorld({ x: screenX, y: screenY });
          cursorWorldPosRef.current = worldPos;

          // Check if cursor is over a project node - skip hover highlighting if so
          if (threeRenderer.isHoveringProject()) {
            highlightedIdsRef.current = new Set();
            threeRenderer.applyHighlight(new Set(), baseDim);
            return;
          }

          const rendererNodes = threeRenderer.getNodes();
          const { keywordHighlightedIds, isEmptySpace } = computeHoverHighlight({
            nodes: rendererNodes,
            screenCenter: { x: screenX, y: screenY },
            screenRadius: containerHeight * screenRadiusFraction,
            transform: threeRenderer.getTransform(),
            similarityThreshold,
            embeddings,
            adjacency,
            screenToWorld: (screen: { x: number; y: number }) => threeRenderer.screenToWorld(screen),
          });

          if (isEmptySpace) {
            highlightedIdsRef.current = new Set();
            threeRenderer.applyHighlight(null, baseDim);
          } else {
            highlightedIdsRef.current = keywordHighlightedIds;
            threeRenderer.applyHighlight(keywordHighlightedIds, baseDim);
          }
        };

        handleMouseLeave = () => {
          highlightedIdsRef.current = new Set();
          const { baseDim } = hoverConfigRef.current;
          threeRenderer.applyHighlight(new Set(), baseDim);
          // Also clear project creation state
          handleMouseLeaveProject();
        };

        handleClick = () => {
          if (projectInteractionRef.current) {
            projectInteractionRef.current = false;
            return;
          }
          onFilterClick();
        };

        container.addEventListener("mouseenter", handleMouseEnter);
        container.addEventListener("mousemove", handleMouseMove);
        container.addEventListener("mouseleave", handleMouseLeave);
        container.addEventListener("click", handleClick);
      })();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      if (handleMouseEnter) container.removeEventListener("mouseenter", handleMouseEnter);
      if (handleMouseMove) container.removeEventListener("mousemove", handleMouseMove);
      if (handleMouseLeave) container.removeEventListener("mouseleave", handleMouseLeave);
      if (handleClick) container.removeEventListener("click", handleClick);
      if (threeRendererRef.current) {
        threeRendererRef.current.destroy();
        threeRendererRef.current = null;
      }
    };
  }, [enabled, activeNodes, activeEdges, projectNodes, colorMixRatio, hoverConfig.screenRadiusFraction, pcaTransform, getSavedPosition, onKeywordClick, onProjectClick, onProjectDrag, onZoomChange, onFilterClick, isHoveringRef, cursorWorldPosRef, cursorScreenPosRef, projectInteractionRef, containerRef]);

  // Get position for a node ID (for click-to-filter position capture)
  const getNodePosition = (id: string): { x: number; y: number } | undefined => {
    const node = threeRendererRef.current?.getNodes().find((n) => n.id === id);
    if (node?.x !== undefined && node?.y !== undefined) {
      return { x: node.x, y: node.y };
    }
    return undefined;
  };

  return {
    threeRendererRef,
    highlightedIdsRef,
    getNodePosition,
  };
}
