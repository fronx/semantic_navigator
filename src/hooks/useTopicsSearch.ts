import { useEffect, useState, useMemo } from "react";
import { performSearch, SearchResult } from "@/lib/search";

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
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await performSearch(searchQuery, { limit: 50, nodeType });
        setSearchResults(results);
      } catch (err) {
        console.error("Search failed:", err);
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, nodeType]);

  // Extract similarity scores for keywords
  const keywordSimilarities = useMemo(() => {
    if (searchResults.length === 0) {
      return null;
    }

    const keywords: KeywordSimilarityMap = new Map();

    for (const result of searchResults) {
      // Extract keyword similarities from matched_keywords
      for (const kw of result.matched_keywords || []) {
        const existingKw = keywords.get(kw.keyword) || 0;
        if (kw.similarity > existingKw) {
          keywords.set(kw.keyword, kw.similarity);
        }
      }
    }

    return keywords;
  }, [searchResults]);

  return { searchResults, keywordSimilarities, loading };
}
