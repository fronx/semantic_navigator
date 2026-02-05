/**
 * Pure filter computation functions for TopicsView.
 * These are stateless utilities that can be easily tested.
 */

import type { SimilarityEdge } from "@/lib/graph-queries";

/**
 * Compute effective filter by intersecting external and internal filters.
 * Returns null if no filtering should be applied.
 */
export function computeEffectiveFilter(
  externalFilter: Set<string> | null | undefined,
  filteredNodeIds: Set<string> | null
): Set<string> | null {
  if (!externalFilter && !filteredNodeIds) return null;
  if (!externalFilter) return filteredNodeIds;
  if (!filteredNodeIds) return externalFilter;
  // Intersection: show only nodes in both filters
  return new Set([...filteredNodeIds].filter((id) => externalFilter.has(id)));
}

/**
 * Filter nodes by a filter set.
 * Returns all nodes if filter is null.
 */
export function filterNodes<T extends { id: string }>(
  nodes: T[],
  filter: Set<string> | null
): T[] {
  if (!filter) return nodes;
  return nodes.filter((n) => filter.has(n.id));
}

/**
 * Filter edges where both endpoints are in the filter set.
 * Returns all edges if filter is null.
 */
export function filterEdges(
  edges: SimilarityEdge[],
  filter: Set<string> | null
): SimilarityEdge[] {
  if (!filter) return edges;
  return edges.filter((e) => filter.has(e.source) && filter.has(e.target));
}

// ============================================================================
// Semantic Filter Types and Functions
// ============================================================================

/**
 * Semantic filter state representing selected keyword and its neighborhood.
 */
export interface SemanticFilter {
  /** The clicked keyword that is the focus of the filter */
  selectedKeywordId: string;
  /** Direct neighbors (1-hop) of the selected keyword */
  oneHopIds: Set<string>;
  /** Second-degree neighbors (2-hop) of the selected keyword */
  twoHopIds: Set<string>;
}

/**
 * Visual tier for a keyword in semantic filter view.
 * Determines size scaling and visual prominence.
 */
export type KeywordTier = "selected" | "neighbor-1" | "neighbor-2";

/**
 * Map of keyword ID to its tier in the current semantic filter.
 */
export type KeywordTierMap = Map<string, KeywordTier>;

/**
 * Compute 1-hop and 2-hop neighborhoods using adjacency map.
 */
export function computeSemanticNeighborhoods(
  selectedId: string,
  adjacency: Map<string, Set<string>>
): { oneHopIds: Set<string>; twoHopIds: Set<string> } {
  const oneHopIds = adjacency.get(selectedId) ?? new Set();
  const twoHopIds = new Set<string>();

  // Collect 2-hop neighbors (neighbors of neighbors)
  for (const neighborId of oneHopIds) {
    const neighborsOfNeighbor = adjacency.get(neighborId);
    if (neighborsOfNeighbor) {
      for (const secondHopId of neighborsOfNeighbor) {
        // Exclude selected and 1-hop nodes from 2-hop set
        if (secondHopId !== selectedId && !oneHopIds.has(secondHopId)) {
          twoHopIds.add(secondHopId);
        }
      }
    }
  }

  return { oneHopIds, twoHopIds };
}

/**
 * Create semantic filter from a selected keyword.
 */
export function createSemanticFilter(
  selectedId: string,
  edges: SimilarityEdge[]
): SemanticFilter {
  // Build adjacency map from edges
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  const { oneHopIds, twoHopIds } = computeSemanticNeighborhoods(selectedId, adjacency);

  return {
    selectedKeywordId: selectedId,
    oneHopIds,
    twoHopIds,
  };
}

/**
 * Compute keyword tier map for visual hierarchy.
 * Returns size scale multipliers for rendering.
 */
export function computeKeywordTiers(filter: SemanticFilter): KeywordTierMap {
  const tierMap = new Map<string, KeywordTier>();

  tierMap.set(filter.selectedKeywordId, "selected");

  for (const id of filter.oneHopIds) {
    tierMap.set(id, "neighbor-1");
  }

  for (const id of filter.twoHopIds) {
    tierMap.set(id, "neighbor-2");
  }

  return tierMap;
}

/**
 * Get all visible keyword IDs from semantic filter.
 * Used for filtering nodes and edges.
 */
export function getSemanticFilterKeywordIds(filter: SemanticFilter): Set<string> {
  const allIds = new Set<string>();
  allIds.add(filter.selectedKeywordId);
  for (const id of filter.oneHopIds) allIds.add(id);
  for (const id of filter.twoHopIds) allIds.add(id);
  return allIds;
}

/**
 * Determine which chunks to show: those linked to selected + 1-hop keywords.
 * 2-hop keywords get no chunks (just keywords for navigation).
 */
export function getSemanticFilterChunkKeywordIds(filter: SemanticFilter): Set<string> {
  const chunkKeywordIds = new Set<string>();
  chunkKeywordIds.add(filter.selectedKeywordId);
  for (const id of filter.oneHopIds) chunkKeywordIds.add(id);
  return chunkKeywordIds;
}

/**
 * Check if a click on a keyword should pivot the filter.
 * Pivot when clicking a 2-hop keyword (makes it the new selected keyword).
 */
export function shouldPivotFilter(
  clickedKeywordId: string,
  currentFilter: SemanticFilter | null
): boolean {
  if (!currentFilter) return false;
  return currentFilter.twoHopIds.has(clickedKeywordId);
}
