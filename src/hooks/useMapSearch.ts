import { useEffect, useState, useMemo } from "react";
import { performSearch, SearchResult } from "@/lib/search";

// Maps article label -> best similarity score
export type ArticleSimilarityMap = Map<string, number>;
// Maps keyword text -> best similarity score
export type KeywordSimilarityMap = Map<string, number>;

interface UseMapSearchResult {
  searchResults: SearchResult[];
  articleSimilarities: ArticleSimilarityMap | null;
  keywordSimilarities: KeywordSimilarityMap | null;
}

export function useMapSearch(searchQuery: string): UseMapSearchResult {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const results = await performSearch(searchQuery, { limit: 50 });
        setSearchResults(results);
      } catch (err) {
        console.error("Search failed:", err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Extract similarity scores for articles and keywords
  const { articleSimilarities, keywordSimilarities } = useMemo(() => {
    if (searchResults.length === 0) {
      return { articleSimilarities: null, keywordSimilarities: null };
    }

    const articles: ArticleSimilarityMap = new Map();
    const keywords: KeywordSimilarityMap = new Map();

    for (const result of searchResults) {
      // Extract filename, remove .md extension to match map article labels
      const filename = result.source_path.split("/").pop()?.replace(".md", "") || result.source_path;

      // Keep the best similarity score for each article
      const existing = articles.get(filename) || 0;
      if (result.similarity > existing) {
        articles.set(filename, result.similarity);
      }

      // Extract keyword similarities from matched_keywords
      for (const kw of result.matched_keywords || []) {
        const existingKw = keywords.get(kw.keyword) || 0;
        if (kw.similarity > existingKw) {
          keywords.set(kw.keyword, kw.similarity);
        }
      }
    }

    return { articleSimilarities: articles, keywordSimilarities: keywords };
  }, [searchResults]);

  return { searchResults, articleSimilarities, keywordSimilarities };
}
