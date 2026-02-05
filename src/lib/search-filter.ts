/**
 * Utilities for converting search results to filters.
 */

import type { KeywordNode } from "@/lib/graph-queries";

export interface MatchedKeyword {
  keyword: string;
  similarity: number;
}

export interface SearchResult {
  id: string;
  content: string;
  summary: string;
  node_type: string;
  source_path: string;
  similarity: number;
  matched_keywords: MatchedKeyword[];
}

/**
 * Extract unique keyword labels from search results.
 */
function collectMatchedKeywordLabels(searchResults: SearchResult[]): Set<string> {
  const labels = new Set<string>();
  for (const result of searchResults) {
    for (const kw of result.matched_keywords || []) {
      labels.add(kw.keyword);
    }
  }
  return labels;
}

/**
 * Convert search results to a Set of keyword node IDs for filtering.
 */
export function searchResultsToKeywordIds(
  searchResults: SearchResult[],
  allKeywordNodes: KeywordNode[]
): Set<string> {
  const matchedLabels = collectMatchedKeywordLabels(searchResults);

  const keywordIds = new Set<string>();
  for (const node of allKeywordNodes) {
    if (matchedLabels.has(node.label)) {
      keywordIds.add(node.id);
    }
  }
  return keywordIds;
}

/**
 * Extract keyword labels from search results for display.
 */
export function extractMatchedKeywords(searchResults: SearchResult[]): string[] {
  return Array.from(collectMatchedKeywordLabels(searchResults));
}
