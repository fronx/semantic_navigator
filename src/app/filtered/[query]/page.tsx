"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { use } from "react";
import { MapView } from "@/components/MapView";

interface Props {
  params: Promise<{ query: string }>;
}

export default function FilteredPage({ params }: Props) {
  const { query } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialThreshold = parseFloat(searchParams.get("threshold") || "0.5");
  const level = parseInt(searchParams.get("level") || "3", 10);
  const [searchQuery, setSearchQuery] = useState("");
  const [synonymThreshold, setSynonymThreshold] = useState(initialThreshold);
  const [draftThreshold, setDraftThreshold] = useState(initialThreshold);

  const filterQuery = decodeURIComponent(query);

  function buildParams() {
    const params = new URLSearchParams();
    params.set("threshold", synonymThreshold.toString());
    params.set("level", level.toString());
    return params;
  }

  function handleFilter() {
    if (searchQuery.trim()) {
      router.push(`/filtered/${encodeURIComponent(searchQuery.trim())}?${buildParams()}`);
      setSearchQuery("");
    }
  }

  function handleKeywordClick(keyword: string) {
    router.push(`/filtered/${encodeURIComponent(keyword)}?${buildParams()}`);
  }

  function handleClearFilter() {
    const params = new URLSearchParams();
    params.set("level", level.toString());
    router.push(`/?${params}`);
  }

  function handleThresholdChange(newThreshold: number) {
    setSynonymThreshold(newThreshold);
    const params = new URLSearchParams();
    params.set("threshold", newThreshold.toString());
    params.set("level", level.toString());
    router.replace(`/filtered/${encodeURIComponent(filterQuery)}?${params}`, { scroll: false });
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex-shrink-0 border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="px-3 py-1.5 flex items-center gap-3">
          <h1 className="text-sm font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">Semantic Navigator</h1>

          <div className="flex-1 max-w-md mx-auto flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleFilter()}
              placeholder="Search..."
              autoFocus
              className="flex-1 px-3 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-zinc-800 dark:border-zinc-700"
            />
            <button
              onClick={handleFilter}
              disabled={!searchQuery.trim()}
              className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Filter
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <label className="flex items-center gap-1">
              <span>Threshold:</span>
              <input
                type="range"
                min="0.25"
                max="0.95"
                step="0.05"
                value={draftThreshold}
                onChange={(e) => setDraftThreshold(parseFloat(e.target.value))}
                onPointerUp={(e) => handleThresholdChange(parseFloat((e.target as HTMLInputElement).value))}
                className="w-16 h-3"
              />
              <span className="w-8">{draftThreshold.toFixed(2)}</span>
            </label>
          </div>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <MapView
          searchQuery={searchQuery}
          filterQuery={filterQuery}
          synonymThreshold={synonymThreshold}
          onKeywordClick={handleKeywordClick}
          onClearFilter={handleClearFilter}
        />
      </main>
    </div>
  );
}
