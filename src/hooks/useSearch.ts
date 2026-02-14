import { useEffect, useState } from "react";
import { performSearch, type SearchResult } from "@/lib/search";

interface UseSearchResult {
  results: SearchResult[];
  loading: boolean;
}

export function useSearch(
  query: string,
  options: { limit?: number; nodeType?: string } = {},
  debounceMs = 300
): UseSearchResult {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const { limit, nodeType } = options;

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await performSearch(query, { limit, nodeType });
        setResults(data);
      } catch (err) {
        console.error("Search failed:", err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, limit, nodeType, debounceMs]);

  return { results, loading };
}
