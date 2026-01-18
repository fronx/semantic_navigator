/**
 * Hover highlight computation.
 *
 * Wraps spatialSemanticFilter to exclude project nodes from highlights.
 * Used by both D3 and Three.js renderers in TopicsView.
 */

import {
  spatialSemanticFilter,
  type SpatialSemanticFilterOptions,
  type SpatialSemanticFilterResult,
} from "./spatial-semantic";

export interface HoverFilterInput {
  nodes: Array<{ id: string; x?: number; y?: number }>;
  screenCenter: { x: number; y: number };
  screenRadius: number;
  transform: { k: number; x: number; y: number };
  similarityThreshold: number;
  embeddings: Map<string, number[]>;
  adjacency: Map<string, Set<string>>;
  screenToWorld?: (screen: { x: number; y: number }) => { x: number; y: number };
}

export interface HoverFilterResult {
  /** IDs to highlight (excluding project nodes) */
  keywordHighlightedIds: Set<string>;
  /** True if cursor is in empty space (no spatial nodes found) */
  isEmptySpace: boolean;
  /** Debug info from spatial-semantic filter */
  debug?: SpatialSemanticFilterResult["debug"];
}

/**
 * Compute highlighted keyword IDs from hover position.
 * Excludes project nodes (ids starting with "proj:") from the result.
 */
export function computeHoverHighlight(input: HoverFilterInput): HoverFilterResult {
  const result = spatialSemanticFilter({
    nodes: input.nodes,
    screenCenter: input.screenCenter,
    screenRadius: input.screenRadius,
    transform: input.transform,
    similarityThreshold: input.similarityThreshold,
    embeddings: input.embeddings,
    adjacency: input.adjacency,
    screenToWorld: input.screenToWorld,
  });

  // Filter out project nodes from highlighted IDs
  const keywordHighlightedIds = new Set(
    [...result.highlightedIds].filter((id) => !id.startsWith("proj:"))
  );

  return {
    keywordHighlightedIds,
    isEmptySpace: result.spatialIds.size === 0,
    debug: result.debug,
  };
}
