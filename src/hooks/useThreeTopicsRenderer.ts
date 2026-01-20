/**
 * Hook that manages Three.js-based rendering for TopicsView.
 * Handles renderer initialization, hover highlighting, and event handlers.
 */

import { useEffect, useRef } from "react";
import { createThreeRenderer, type ThreeRenderer } from "@/lib/three-renderer";
import { convertToThreeNodes } from "@/lib/topics-graph-nodes";
import { createHoverController } from "@/lib/topics-hover-controller";
import type { BaseRendererOptions } from "@/lib/renderer-types";

// ============================================================================
// Types
// ============================================================================

export interface UseThreeTopicsRendererOptions extends BaseRendererOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
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
    projectNodesRef,
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
    // Use ref for projectNodes to avoid re-creating graph on position updates
    const { mapNodes, mapLinks } = convertToThreeNodes({
      keywordNodes: activeNodes,
      edges: activeEdges,
      projectNodes: projectNodesRef.current,
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

    // Event handlers (stored for cleanup)
    let handleMouseEnter: (() => void) | null = null;
    let handleMouseMove: ((event: MouseEvent) => void) | null = null;
    let handleMouseLeave: (() => void) | null = null;
    let handleClick: (() => void) | null = null;

    // Defer initialization to next frame to ensure container is fully laid out
    const frameId = requestAnimationFrame(() => {
      if (cancelled) return;

      (async () => {
        const threeRenderer = await createThreeRenderer({
          container,
          nodes: mapNodes,
          links: mapLinks,
          immediateParams,
          pcaTransform: pcaTransform ?? undefined,
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

        // Create hover controller - ThreeRenderer implements RendererAdapter
        const hoverController = createHoverController({
          activeNodes,
          activeEdges,
          hoverConfigRef,
          containerHeight: container.clientHeight,
          isHoveringRef,
          cursorWorldPosRef,
          cursorScreenPosRef,
          projectInteractionRef,
          highlightedIdsRef,
          onFilterClick,
          renderer: threeRenderer,
        });

        // Wire up DOM event listeners to hover controller
        handleMouseEnter = () => hoverController.handleMouseEnter();

        handleMouseMove = (event: MouseEvent) => {
          const rect = container.getBoundingClientRect();
          const screenX = event.clientX - rect.left;
          const screenY = event.clientY - rect.top;
          hoverController.handleMouseMove(screenX, screenY);
        };

        handleMouseLeave = () => hoverController.handleMouseLeave();

        handleClick = () => hoverController.handleClick();

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
  // Note: projectNodes excluded from deps - we use projectNodesRef to avoid re-creating
  // the graph when project positions are updated via drag.
  }, [enabled, activeNodes, activeEdges, colorMixRatio, hoverConfig.screenRadiusFraction, pcaTransform, getSavedPosition, onKeywordClick, onProjectClick, onProjectDrag, onZoomChange, onFilterClick, isHoveringRef, cursorWorldPosRef, cursorScreenPosRef, projectInteractionRef, containerRef]);

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
