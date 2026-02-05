/**
 * Hook for managing filter state in TopicsView.
 *
 * Handles:
 * - Internal filter state from click-to-drill-down
 * - Combination with external filter (from project selection)
 * - Position preservation across filter transitions
 */

import { useState, useMemo, useRef, useCallback } from "react";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";
import {
  computeEffectiveFilter,
  filterNodes,
  filterEdges,
  type SemanticFilter,
  type KeywordTierMap,
  computeKeywordTiers,
  getSemanticFilterKeywordIds,
  getSemanticFilterChunkKeywordIds,
  createSemanticFilter,
} from "@/lib/topics-filter";

export interface UseTopicsFilterOptions {
  keywordNodes: KeywordNode[];
  edges: SimilarityEdge[];
  externalFilter?: Set<string> | null;
  /** Search filter from semantic search */
  searchFilter?: Set<string> | null;
  /** Cluster data for cluster-based filtering */
  clusters?: Map<number, { id: number; members: string[] }> | null;
}

export interface UseTopicsFilterResult {
  /** Internal filter state from click-to-drill-down */
  filteredNodeIds: Set<string> | null;
  /** Current semantic filter state (selected + 1-hop + 2-hop) */
  semanticFilter: SemanticFilter | null;
  /** Current cluster filter (cluster ID if active) */
  clusterFilter: number | null;
  /** Keyword tier map for visual hierarchy (size scaling) */
  keywordTiers: KeywordTierMap | null;
  /** Keyword IDs that should have visible chunks (selected + 1-hop only) */
  chunkKeywordIds: Set<string> | null;
  /** Stack of keyword IDs (breadcrumb trail) */
  filterHistory: string[];
  /** Combined filter (external AND internal) */
  effectiveFilter: Set<string> | null;
  /** Filtered nodes based on effectiveFilter */
  activeNodes: KeywordNode[];
  /** Filtered edges based on effectiveFilter */
  activeEdges: SimilarityEdge[];
  /** Save current positions before applying a filter */
  capturePositions: (getPosition: (id: string) => { x: number; y: number } | undefined) => void;
  /** Get saved position for a node (for restoring after filter) */
  getSavedPosition: (id: string) => { x: number; y: number } | undefined;
  /** Apply a filter from highlighted IDs (click-to-filter action) */
  applyFilter: (highlightedIds: Set<string>) => void;
  /** Apply semantic filter from a clicked keyword */
  applySemanticFilter: (keywordId: string) => void;
  /** Apply cluster filter from a clicked cluster label */
  applyClusterFilter: (clusterId: number) => void;
  /** Clear the internal filter */
  clearFilter: () => void;
  /** Clear semantic filter (keep external filter) */
  clearSemanticFilter: () => void;
  /** Go back one level in history stack */
  goBackInHistory: () => void;
  /** Jump to specific point in history */
  goToHistoryIndex: (index: number) => void;
}

/**
 * Manage filter state for TopicsView.
 *
 * @example
 * const {
 *   activeNodes,
 *   activeEdges,
 *   capturePositions,
 *   getSavedPosition,
 *   applyFilter,
 * } = useTopicsFilter({
 *   keywordNodes,
 *   edges,
 *   externalFilter,
 * });
 */
export function useTopicsFilter(options: UseTopicsFilterOptions): UseTopicsFilterResult {
  const { keywordNodes, edges, externalFilter, searchFilter, clusters } = options;

  const [filteredNodeIds, setFilteredNodeIds] = useState<Set<string> | null>(null);
  const [semanticFilter, setSemanticFilter] = useState<SemanticFilter | null>(null);
  const [clusterFilter, setClusterFilter] = useState<number | null>(null);
  const [filterHistory, setFilterHistory] = useState<string[]>([]);
  const positionMapRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Compute keyword tiers for visual hierarchy
  const keywordTiers = useMemo(
    () => (semanticFilter ? computeKeywordTiers(semanticFilter) : null),
    [semanticFilter]
  );

  // Compute which keywords should show chunks (selected + 1-hop)
  const chunkKeywordIds = useMemo(
    () => (semanticFilter ? getSemanticFilterChunkKeywordIds(semanticFilter) : null),
    [semanticFilter]
  );

  // Compute effective filter combining external, search, and semantic filters
  const effectiveFilter = useMemo(() => {
    // Semantic filter takes precedence (drill-down)
    if (semanticFilter) {
      const semanticIds = getSemanticFilterKeywordIds(semanticFilter);
      return computeEffectiveFilter(externalFilter, semanticIds);
    }

    // Combine external (project) and search filters
    let baseFilter: Set<string> | null = null;

    if (externalFilter && searchFilter) {
      // Both active: intersection (only keywords in both)
      baseFilter = new Set<string>();
      for (const id of externalFilter) {
        if (searchFilter.has(id)) {
          baseFilter.add(id);
        }
      }
    } else if (externalFilter) {
      baseFilter = externalFilter;
    } else if (searchFilter) {
      baseFilter = searchFilter;
    }

    // Combine with internal filter (click-to-filter)
    return computeEffectiveFilter(baseFilter, filteredNodeIds);
  }, [externalFilter, searchFilter, semanticFilter, filteredNodeIds]);

  const activeNodes = useMemo(
    () => filterNodes(keywordNodes, effectiveFilter),
    [keywordNodes, effectiveFilter]
  );

  const activeEdges = useMemo(
    () => filterEdges(edges, effectiveFilter),
    [edges, effectiveFilter]
  );

  const capturePositions = useCallback(
    (getPosition: (id: string) => { x: number; y: number } | undefined) => {
      const newMap = new Map<string, { x: number; y: number }>();
      for (const node of keywordNodes) {
        const pos = getPosition(node.id);
        if (pos) newMap.set(node.id, pos);
      }
      positionMapRef.current = newMap;
    },
    [keywordNodes]
  );

  const getSavedPosition = useCallback(
    (id: string) => positionMapRef.current.get(id),
    []
  );

  const applyFilter = useCallback((highlightedIds: Set<string>) => {
    if (highlightedIds.size === 0) {
      // No highlighted nodes - reset filter if one exists
      setFilteredNodeIds((current) => (current !== null ? null : current));
    } else {
      setFilteredNodeIds(highlightedIds);
    }
  }, []);

  const clearFilter = useCallback(() => {
    setFilteredNodeIds(null);
    setClusterFilter(null);
  }, []);

  const applyClusterFilter = useCallback(
    (clusterId: number) => {
      if (!clusters) {
        return;
      }

      const cluster = clusters.get(clusterId);

      if (!cluster || cluster.members.length === 0) {
        return;
      }

      // Create set of member keyword IDs (cluster.members are labels, need to convert to IDs)
      const memberIds = new Set(cluster.members.map(label => `kw:${label}`));

      // Set cluster filter state
      setClusterFilter(clusterId);
      setFilteredNodeIds(memberIds);
      setSemanticFilter(null); // Clear semantic filter
      setFilterHistory([]); // Clear history (cluster filters don't use history)
    },
    [clusters]
  );

  const applySemanticFilter = useCallback(
    (keywordId: string) => {
      // Check if this is navigation within current filter (clicking 1-hop or selected)
      const isWithinCurrentFilter =
        semanticFilter &&
        (semanticFilter.selectedKeywordId === keywordId || semanticFilter.oneHopIds.has(keywordId));

      // Create new filter
      const newFilter = createSemanticFilter(keywordId, edges);
      setSemanticFilter(newFilter);

      // Update history
      setFilterHistory((prev) => {
        // If clicking within current filter, replace top of stack
        if (isWithinCurrentFilter && prev.length > 0) {
          return [...prev.slice(0, -1), keywordId];
        }
        // Otherwise push to history
        return [...prev, keywordId];
      });
    },
    [edges, semanticFilter]
  );

  const clearSemanticFilter = useCallback(() => {
    setSemanticFilter(null);
    setClusterFilter(null);
    setFilterHistory([]);
  }, []);

  const goBackInHistory = useCallback(() => {
    setFilterHistory((prev) => {
      if (prev.length <= 1) {
        // Last item - clear filter entirely
        setSemanticFilter(null);
        return [];
      }
      // Pop current, apply previous
      const newHistory = prev.slice(0, -1);
      const previousKeywordId = newHistory[newHistory.length - 1];
      const newFilter = createSemanticFilter(previousKeywordId, edges);
      setSemanticFilter(newFilter);
      return newHistory;
    });
  }, [edges]);

  const goToHistoryIndex = useCallback(
    (index: number) => {
      setFilterHistory((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        const newHistory = prev.slice(0, index + 1);
        const keywordId = newHistory[newHistory.length - 1];
        const newFilter = createSemanticFilter(keywordId, edges);
        setSemanticFilter(newFilter);
        return newHistory;
      });
    },
    [edges]
  );

  return {
    filteredNodeIds,
    semanticFilter,
    clusterFilter,
    keywordTiers,
    chunkKeywordIds,
    filterHistory,
    effectiveFilter,
    activeNodes,
    activeEdges,
    capturePositions,
    getSavedPosition,
    applyFilter,
    applySemanticFilter,
    applyClusterFilter,
    clearFilter,
    clearSemanticFilter,
    goBackInHistory,
    goToHistoryIndex,
  };
}
