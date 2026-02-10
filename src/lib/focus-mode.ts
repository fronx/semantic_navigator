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
import type { ContentNode } from "./content-loader";

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
 * Computes 1-hop, 2-hop, and 3-hop neighborhoods; everything else is margin.
 */
export function createFocusState(
  selectedKeywordId: string,
  allNodeIds: string[],
  edges: SimilarityEdge[],
  maxHops: number = 3,
): FocusState {
  const semanticFilter = createSemanticFilter(selectedKeywordId, edges);
  const keywordTiers = computeKeywordTiers(semanticFilter);

  const focusedNodeIds = new Set<string>();
  focusedNodeIds.add(selectedKeywordId);

  // Add hops up to maxHops
  if (maxHops >= 1) {
    for (const id of semanticFilter.oneHopIds) focusedNodeIds.add(id);
  }
  if (maxHops >= 2) {
    for (const id of semanticFilter.twoHopIds) focusedNodeIds.add(id);
  }
  if (maxHops >= 3) {
    for (const id of semanticFilter.threeHopIds) focusedNodeIds.add(id);
  }

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

/**
 * Build reverse mapping: content node ID → set of keyword IDs
 * Note: ContentNode entries are (content, keyword) pairs, so multiple entries
 * can share the same content node ID but have different keywordIds
 */
function buildContentToKeywordsMap(
  contentsByKeyword: Map<string, ContentNode[]>
): Map<string, Set<string>> {
  const contentToKeywords = new Map<string, Set<string>>();

  for (const [keywordId, contentNodes] of contentsByKeyword) {
    for (const node of contentNodes) {
      if (!contentToKeywords.has(node.id)) {
        contentToKeywords.set(node.id, new Set());
      }
      contentToKeywords.get(node.id)!.add(keywordId);
    }
  }

  return contentToKeywords;
}

/**
 * Create focus state from a set of keyword IDs (e.g., search results).
 * For each keyword, computes its neighborhood (1-hop, 2-hop, etc.) just like clicking it.
 * Merges all neighborhoods into a single focus state.
 */
export function createFocusStateFromSet(
  keywordIds: Set<string>,
  allNodeIds: string[],
  edges: SimilarityEdge[],
  maxHops: number = 3
): FocusState {
  const focusedNodeIds = new Set<string>();
  const keywordTiers: KeywordTierMap = new Map();

  // For each search result keyword, compute its neighborhood
  for (const keywordId of keywordIds) {
    const semanticFilter = createSemanticFilter(keywordId, edges);

    // Mark this keyword as selected
    focusedNodeIds.add(keywordId);
    keywordTiers.set(keywordId, "selected");

    // Add neighbors based on maxHops (same logic as clicking a keyword)
    if (maxHops >= 1) {
      for (const id of semanticFilter.oneHopIds) {
        focusedNodeIds.add(id);
        // Only set tier if not already set (prioritize closer tier)
        if (!keywordTiers.has(id)) {
          keywordTiers.set(id, "neighbor-1");
        }
      }
    }
    if (maxHops >= 2) {
      for (const id of semanticFilter.twoHopIds) {
        focusedNodeIds.add(id);
        if (!keywordTiers.has(id)) {
          keywordTiers.set(id, "neighbor-2");
        }
      }
    }
    if (maxHops >= 3) {
      for (const id of semanticFilter.threeHopIds) {
        focusedNodeIds.add(id);
        if (!keywordTiers.has(id)) {
          keywordTiers.set(id, "neighbor-3");
        }
      }
    }
  }

  // Everything else goes to margins
  const marginNodeIds = new Set<string>();
  for (const id of allNodeIds) {
    if (!focusedNodeIds.has(id)) {
      marginNodeIds.add(id);
    }
  }

  return {
    focusedKeywordId: keywordIds.values().next().value ?? "", // First result as nominal focus
    focusedNodeIds,
    marginNodeIds,
    keywordTiers,
  };
}

/**
 * Create content-aware focus state that hops through content nodes.
 * Hop pattern: keyword → content → keyword → content → keyword
 *
 * This provides a different navigation experience compared to direct keyword-keyword hops:
 * - Shows keywords that share actual content with the selected keyword
 * - More constrained neighborhood (only keywords with shared content, not all similar keywords)
 */
export function createContentAwareFocusState(
  selectedKeywordId: string,
  allNodeIds: string[],
  contentsByKeyword: Map<string, ContentNode[]>,
  maxHops: number = 3,
): FocusState {
  // Build reverse mapping: content → keywords
  const contentToKeywords = buildContentToKeywordsMap(contentsByKeyword);

  // Track keywords by hop distance
  const keywordsByHop = new Map<number, Set<string>>();
  keywordsByHop.set(0, new Set([selectedKeywordId]));

  // BFS through keyword→content→keyword bipartite graph
  for (let hop = 1; hop <= maxHops; hop++) {
    const currentHopKeywords = new Set<string>();
    const prevHopKeywords = keywordsByHop.get(hop - 1)!;

    // For each keyword in previous hop
    for (const keywordId of prevHopKeywords) {
      const contentNodes = contentsByKeyword.get(keywordId);
      if (!contentNodes) continue;

      // Find all keywords connected through content nodes
      for (const contentNode of contentNodes) {
        const connectedKeywords = contentToKeywords.get(contentNode.id);
        if (!connectedKeywords) continue;

        for (const connectedKeywordId of connectedKeywords) {
          // Skip if already seen in previous hops
          let alreadySeen = false;
          for (let prevHop = 0; prevHop < hop; prevHop++) {
            if (keywordsByHop.get(prevHop)?.has(connectedKeywordId)) {
              alreadySeen = true;
              break;
            }
          }

          if (!alreadySeen) {
            currentHopKeywords.add(connectedKeywordId);
          }
        }
      }
    }

    keywordsByHop.set(hop, currentHopKeywords);
  }

  // Build tier map for visual hierarchy
  const keywordTiers: KeywordTierMap = new Map();
  keywordTiers.set(selectedKeywordId, "selected");

  for (const id of keywordsByHop.get(1) || []) {
    keywordTiers.set(id, "neighbor-1");
  }

  for (const id of keywordsByHop.get(2) || []) {
    keywordTiers.set(id, "neighbor-2");
  }

  for (const id of keywordsByHop.get(3) || []) {
    keywordTiers.set(id, "neighbor-3");
  }

  // Collect all focused nodes
  const focusedNodeIds = new Set<string>();
  for (let hop = 0; hop <= maxHops; hop++) {
    const hopKeywords = keywordsByHop.get(hop);
    if (hopKeywords) {
      for (const id of hopKeywords) {
        focusedNodeIds.add(id);
      }
    }
  }

  // Everything else is margin
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
