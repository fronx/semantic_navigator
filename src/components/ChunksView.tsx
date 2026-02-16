/**
 * Orchestrator for the chunks UMAP visualization.
 * Extracts embeddings from chunk data, runs UMAP, and renders the canvas.
 */

import { useState, useMemo, useCallback } from "react";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import { useUmapLayout } from "@/hooks/useUmapLayout";
import { usePersistedStore } from "@/hooks/usePersistedStore";
import { useSearch } from "@/hooks/useSearch";
import { Slider } from "@/components/Slider";
import { ChunksCanvas } from "./chunks-r3f/ChunksCanvas";
import { exportUmapGraph } from "@/lib/export-umap-graph";

const UMAP_DEFAULTS = {
  nNeighbors: 15,
  minDist: 0.1,
  spread: 1.0,
};

const MIN_SEARCH_OPACITY = 0.1;

interface ChunksViewProps {
  chunks: ChunkEmbeddingData[];
  isStale?: boolean;
}

export function ChunksView({ chunks, isStale = false }: ChunksViewProps) {
  const store = usePersistedStore("chunks-umap-v1", UMAP_DEFAULTS, 300);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);

  const embeddings = useMemo(
    () => chunks.map((c) => c.embedding),
    [chunks]
  );

  const {
    positions,
    progress,
    isRunning,
    neighborhoodEdges,
    neighborhoodEdgesVersion,
  } = useUmapLayout(embeddings, {
    nNeighbors: store.debounced.nNeighbors,
    minDist: store.debounced.minDist,
    spread: store.debounced.spread,
  });

  const { results: searchResults, loading: searchLoading } = useSearch(
    searchQuery,
    { limit: 100, nodeType: "chunk" }
  );

  const searchOpacities = useMemo(() => {
    const map = new Map<string, number>();
    if (!searchQuery.trim() || searchResults.length === 0) return map;

    const matched = new Map<string, number>();
    for (const r of searchResults) matched.set(r.id, r.similarity);

    // Find min similarity among matches to ensure all matches are brighter than non-matches
    const minMatchSimilarity = Math.min(...searchResults.map(r => r.similarity));
    // Remap: matches keep original similarity, non-matches get scaled below the minimum match
    const nonMatchOpacity = Math.min(MIN_SEARCH_OPACITY, minMatchSimilarity * 0.8);

    for (const chunk of chunks) {
      const sim = matched.get(chunk.id);
      map.set(chunk.id, sim !== undefined ? sim : nonMatchOpacity);
    }
    return map;
  }, [searchQuery, searchResults, chunks]);

  const progressPercent = Math.round(progress * 100);
  const matchCount = searchResults.length;

  const handleExport = useCallback(() => {
    if (positions.length === 0) {
      alert("No graph data to export. Wait for UMAP to complete.");
      return;
    }
    exportUmapGraph(chunks, positions, neighborhoodEdges);
  }, [chunks, positions, neighborhoodEdges]);

  const handleSelectChunk = useCallback((chunkId: string | null) => {
    setSelectedChunkId((prev) => (prev === chunkId ? null : chunkId));
  }, []);

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header bar */}
      <header className="flex-shrink-0 px-3 py-1.5 flex items-center gap-4 border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <input
          type="text"
          placeholder="Search chunks..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 max-w-md px-3 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        {searchLoading && (
          <span className="text-xs text-zinc-400">Searching...</span>
        )}

        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {searchOpacities.size > 0
            ? `${matchCount} / ${chunks.length} chunks`
            : `${chunks.length} chunks`}
          {isStale && <span className="ml-2 text-amber-600 dark:text-amber-400">(offline)</span>}
        </span>

        <Slider
          label="Neighbors"
          value={store.values.nNeighbors}
          onChange={(v) => store.update("nNeighbors", v)}
          min={2} max={100} step={1}
          format={(v) => `${v}`}
        />
        <Slider
          label="Min dist"
          value={store.values.minDist}
          onChange={(v) => store.update("minDist", v)}
          min={0} max={1} step={0.01}
        />
        <Slider
          label="Spread"
          value={store.values.spread}
          onChange={(v) => store.update("spread", v)}
          min={0.1} max={5} step={0.1}
          format={(v) => v.toFixed(1)}
        />

        {isRunning && (
          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-[width] duration-100 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-zinc-400">
              UMAP {progressPercent}%
            </span>
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={positions.length === 0}
          className="px-3 py-1 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Export graph to JSON file"
        >
          Export Graph
        </button>
      </header>

      {/* Canvas area */}
      <main className="flex-1 relative overflow-hidden">
        <ChunksCanvas
          chunks={chunks}
          umapPositions={positions}
          searchOpacities={searchOpacities}
          neighborhoodEdges={neighborhoodEdges}
          neighborhoodEdgesVersion={neighborhoodEdgesVersion}
          isRunning={isRunning}
          selectedChunkId={selectedChunkId}
          onSelectChunk={handleSelectChunk}
        />
      </main>
    </div>
  );
}
