"use client";

import { useState } from "react";

interface MatchedKeyword {
  keyword: string;
  similarity: number;
}

interface SearchResult {
  id: string;
  content: string;
  summary: string;
  node_type: string;
  source_path: string;
  similarity: number;
  matched_keywords: MatchedKeyword[];
}

interface Props {
  onSelectNode: (id: string) => void;
}

export function SearchBar({ onSelectNode }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 10 }),
    });
    const data = await res.json();
    setResults(data.results || []);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your knowledge base..."
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
              onClick={() => onSelectNode(result.id)}
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
                        className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded"
                        title={`${(kw.similarity * 100).toFixed(0)}% match`}
                      >
                        {kw.keyword}
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
