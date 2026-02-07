/**
 * Focus mode computation for click-to-focus interaction.
 * Keeps all nodes visible but identifies which should be pushed to viewport margins.
 */

import {
  createSemanticFilter,
  computeKeywordTiers,
  type SemanticFilter,
  type KeywordTierMap,
} from "./topics-filter";
import type { SimilarityEdge } from "@/lib/graph-queries";

/**
 * Focus state for click-to-focus interaction.
 * All nodes remain visible; non-neighbors are pushed to viewport margins.
 */
export interface FocusState {
  /** The clicked keyword that is the focus */
  focusedKeywordId: string;
  /** All node IDs that stay in place (selected + 1-hop + 2-hop) */
  focusedNodeIds: Set<string>;
  /** All node IDs that get pushed to margins */
  marginNodeIds: Set<string>;
  /** Keyword tiers for visual hierarchy */
  keywordTiers: KeywordTierMap;
}

/**
 * Create focus state from a selected keyword.
 * Computes 1-hop and 2-hop neighborhoods; everything else is margin.
 */
export function createFocusState(
  selectedKeywordId: string,
  allNodeIds: string[],
  edges: SimilarityEdge[],
): FocusState {
  const semanticFilter = createSemanticFilter(selectedKeywordId, edges);
  const keywordTiers = computeKeywordTiers(semanticFilter);

  const focusedNodeIds = new Set<string>();
  focusedNodeIds.add(selectedKeywordId);
  for (const id of semanticFilter.oneHopIds) focusedNodeIds.add(id);
  for (const id of semanticFilter.twoHopIds) focusedNodeIds.add(id);

  const marginNodeIds = new Set<string>();
  for (const id of allNodeIds) {
    if (!focusedNodeIds.has(id)) {
      marginNodeIds.add(id);
    }
  }

  return {
    focusedKeywordId: selectedKeywordId,
    focusedNodeIds,
    marginNodeIds,
    keywordTiers,
  };
}
