/**
 * Hook that manages R3F-based rendering for TopicsView.
 * Follows the same pattern as useD3TopicsRenderer and useThreeTopicsRenderer.
 */

import { useRef } from "react";
import type { BaseRendererOptions } from "@/lib/renderer-types";

export interface UseR3FTopicsRendererOptions extends BaseRendererOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseR3FTopicsRendererResult {
  /** Highlighted IDs for click-to-filter */
  highlightedIdsRef: React.MutableRefObject<Set<string>>;
  /** Get position for a node ID */
  getNodePosition: (id: string) => { x: number; y: number } | undefined;
}

export function useR3FTopicsRenderer(
  options: UseR3FTopicsRendererOptions
): UseR3FTopicsRendererResult {
  const { enabled } = options;

  // Refs to expose to parent
  const highlightedIdsRef = useRef<Set<string>>(new Set());

  // For MVP, we don't have position tracking yet (Phase 2 feature)
  const getNodePosition = (id: string): { x: number; y: number } | undefined => {
    // TODO: Implement position tracking
    return undefined;
  };

  // For MVP, the R3F renderer is purely declarative
  // All rendering happens in R3FTopicsCanvas component
  // Hover highlighting will be added in Phase 2

  if (!enabled) {
    return {
      highlightedIdsRef,
      getNodePosition,
    };
  }

  return {
    highlightedIdsRef,
    getNodePosition,
  };
}
