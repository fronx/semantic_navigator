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
import { computeEffectiveFilter, filterNodes, filterEdges } from "@/lib/topics-filter";

export interface UseTopicsFilterOptions {
  keywordNodes: KeywordNode[];
  edges: SimilarityEdge[];
  externalFilter?: Set<string> | null;
}

export interface UseTopicsFilterResult {
  /** Internal filter state from click-to-drill-down */
  filteredNodeIds: Set<string> | null;
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
  /** Clear the internal filter */
  clearFilter: () => void;
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
  const { keywordNodes, edges, externalFilter } = options;

  const [filteredNodeIds, setFilteredNodeIds] = useState<Set<string> | null>(null);
  const positionMapRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const effectiveFilter = useMemo(
    () => computeEffectiveFilter(externalFilter, filteredNodeIds),
    [externalFilter, filteredNodeIds]
  );

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

  const clearFilter = useCallback(() => setFilteredNodeIds(null), []);

  return {
    filteredNodeIds,
    effectiveFilter,
    activeNodes,
    activeEdges,
    capturePositions,
    getSavedPosition,
    applyFilter,
    clearFilter,
  };
}
