"use client";

import { useState, useEffect } from "react";
import type { SearchResult, MatchedKeyword } from "@/lib/search-filter";

export type { SearchResult, MatchedKeyword };

interface Props {
  /** Callback when a search result node is selected (Map view) */
  onSelectNode?: (id: string) => void;
  /** Callback when search query changes (Topics view) */
  onSearch?: (query: string, results: SearchResult[]) => void;
  /** Display mode: "results" shows result panel, "inline" is just the input */
  displayMode?: "results" | "inline";
  /** Placeholder text for search input */
  placeholder?: string;
  /** Node type filter for search API */
  nodeType?: 'article' | 'chunk';
  /** Show filter button (inline mode only) */
  showFilterButton?: boolean;
  /** Callback when filter button clicked */
  onFilter?: () => void;
  /** Whether filter is currently active */
  filterActive?: boolean;
}

export function SearchBar({
  onSelectNode,
  onSearch,
  displayMode = "results",
  placeholder = "Search your knowledge base...",
  nodeType,
  showFilterButton = false,
  onFilter,
  filterActive = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  // For inline mode, perform debounced search automatically on query change
  useEffect(() => {
    if (displayMode === "inline") {
      if (!query.trim()) {
        setResults([]);
        onSearch?.("", []);
        return;
      }

      setLoading(true);
      const timer = setTimeout(async () => {
        try {
          const res = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, limit: 50, nodeType }),
          });
          const data = await res.json();
          const searchResults = data.results || [];
          setResults(searchResults);
          onSearch?.(query, searchResults);
        } catch (err) {
          console.error("Search failed:", err);
          setResults([]);
          onSearch?.(query, []);
        } finally {
          setLoading(false);
        }
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [query, displayMode, nodeType, onSearch]);

  // For results mode, search on form submit
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 10, nodeType }),
      });
      const data = await res.json();
      const searchResults = data.results || [];
      setResults(searchResults);
      onSearch?.(query, searchResults);
    } catch (err) {
      console.error("Search failed:", err);
      setResults([]);
      onSearch?.(query, []);
    } finally {
      setLoading(false);
    }
  }

  // Inline mode: just the input field (optionally with filter button)
  if (displayMode === "inline") {
    if (showFilterButton) {
      return (
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                onFilter?.();
              }
            }}
            placeholder={placeholder}
            className="flex-1 px-3 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-zinc-800 dark:border-zinc-700"
          />
          <button
            onClick={onFilter}
            disabled={!query.trim()}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              filterActive
                ? "bg-amber-500 text-white hover:bg-amber-600"
                : "bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            }`}
          >
            {filterActive ? "Filtered" : "Filter"}
          </button>
        </div>
      );
    }

    return (
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-zinc-800 dark:border-zinc-700"
      />
    );
  }

  // Results mode: input + result panel
  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-800 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "..." : "Search"}
        </button>
      </form>

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((result) => (
            <button
              key={result.id}
              onClick={() => onSelectNode?.(result.id)}
              className="w-full text-left p-3 border rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 dark:border-zinc-700"
            >
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs px-2 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded">
                  {result.node_type}
                </span>
                <span className="text-xs text-zinc-500">
                  {(result.similarity * 100).toFixed(0)}% match
                </span>
                {result.matched_keywords?.length > 0 && (
                  <>
                    <span className="text-xs text-zinc-400">via</span>
                    {result.matched_keywords.map((kw) => (
                      <span
                        key={kw.keyword}
                        className={`text-xs px-2 py-0.5 rounded ${
                          kw.matchType === 'exact' || kw.matchType === 'both'
                            ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                            : kw.matchType === 'fuzzy'
                            ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300'
                            : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                        }`}
                        title={`${kw.matchType || 'semantic'} match: ${(kw.similarity * 100).toFixed(0)}%`}
                      >
                        {kw.keyword}
                        {(kw.matchType === 'exact' || kw.matchType === 'both') && ' ✓'}
                      </span>
                    ))}
                  </>
                )}
              </div>
              <div className="text-sm font-medium truncate">
                {result.summary || result.content.slice(0, 100)}
              </div>
              <div className="text-xs text-zinc-500 truncate">
                {result.source_path}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
