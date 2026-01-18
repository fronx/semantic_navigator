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
