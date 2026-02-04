/**
 * Hook that manages R3F-based rendering for TopicsView.
 * Follows the same pattern as useD3TopicsRenderer and useThreeTopicsRenderer.
 */

import { useRef } from "react";
import type { BaseRendererOptions } from "@/lib/renderer-types";
import type { LabelsOverlayHandle } from "@/components/topics-r3f/R3FLabelContext";

export interface UseR3FTopicsRendererOptions extends BaseRendererOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseR3FTopicsRendererResult {
  /** Highlighted IDs for click-to-filter */
  highlightedIdsRef: React.MutableRefObject<Set<string>>;
  /** Get position for a node ID */
  getNodePosition: (id: string) => { x: number; y: number } | undefined;
  /** Ref to labels overlay handle (for cluster label updates and getNodes) */
  labelsRef: React.RefObject<LabelsOverlayHandle | null>;
}

export function useR3FTopicsRenderer(
  _options: UseR3FTopicsRendererOptions
): UseR3FTopicsRendererResult {
  const highlightedIdsRef = useRef<Set<string>>(new Set());
  const labelsRef = useRef<LabelsOverlayHandle | null>(null);

  function getNodePosition(id: string): { x: number; y: number } | undefined {
    const nodes = labelsRef.current?.getNodes();
    if (!nodes) return undefined;
    const node = nodes.find(n => n.id === id);
    if (node?.x !== undefined && node?.y !== undefined) {
      return { x: node.x, y: node.y };
    }
    return undefined;
  }

  return { highlightedIdsRef, getNodePosition, labelsRef };
}
