import { useMemo } from "react";
import { useSearch } from "./useSearch";
import type { SearchResult } from "@/lib/search";

// Maps keyword text -> best similarity score
export type KeywordSimilarityMap = Map<string, number>;

interface UseTopicsSearchResult {
  searchResults: SearchResult[];
  keywordSimilarities: KeywordSimilarityMap | null;
  loading: boolean;
}

export function useTopicsSearch(
  searchQuery: string,
  nodeType: 'article' | 'chunk'
): UseTopicsSearchResult {
  const { results: searchResults, loading } = useSearch(searchQuery, {
    limit: 50,
    nodeType,
  });

  // Extract similarity scores for keywords
  const keywordSimilarities = useMemo(() => {
    if (searchResults.length === 0) return null;

    const keywords: KeywordSimilarityMap = new Map();
    for (const result of searchResults) {
      for (const kw of result.matched_keywords || []) {
        const existing = keywords.get(kw.keyword) || 0;
        if (kw.similarity > existing) {
          keywords.set(kw.keyword, kw.similarity);
        }
      }
    }
    return keywords;
  }, [searchResults]);

  return { searchResults, keywordSimilarities, loading };
}
