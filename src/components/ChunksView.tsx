/**
 * Orchestrator for the chunks UMAP visualization.
 * Extracts embeddings from chunk data, runs UMAP, and renders the canvas.
 */

import { useState, useMemo, useCallback } from "react";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import type { ChunksSettings } from "@/components/ChunksControlSidebar";
import { useUmapLayout } from "@/hooks/useUmapLayout";
import { usePersistedStore } from "@/hooks/usePersistedStore";
import { useSearch } from "@/hooks/useSearch";
import { ChunksControlSidebar } from "@/components/ChunksControlSidebar";
import { ChunksCanvas } from "./chunks-r3f/ChunksCanvas";
import { Reader } from "@/components/Reader";
import { exportUmapGraph } from "@/lib/export-umap-graph";

const CHUNKS_DEFAULTS: ChunksSettings = {
  nNeighbors: 15,
  minDist: 0.1,
  spread: 1.0,
  colorSaturation: 0.6,
  minSaturation: 0.45,
  chunkColorMix: 0.4,
  edgeThickness: 2,
  edgeMidpoint: 0.6,
  nodeSizeMin: 0.6,
  nodeSizeMax: 2.0,
  nodeSizePivot: 30,
  sidebarCollapsed: false,
  sectionStates: {
    UMAP: true,
  },
};

const MIN_SEARCH_OPACITY = 0.1;

interface ChunksViewProps {
  chunks: ChunkEmbeddingData[];
  isStale?: boolean;
}

export function ChunksView({ chunks, isStale = false }: ChunksViewProps) {
  const store = usePersistedStore("chunks-umap-v2", CHUNKS_DEFAULTS, 300);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChunkIds, setSelectedChunkIds] = useState<string[]>([]);

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

    const minMatchSimilarity = Math.min(...searchResults.map(r => r.similarity));
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
    if (chunkId === null) {
      setSelectedChunkIds([]);
      return;
    }
    setSelectedChunkIds((prev) => {
      if (prev.includes(chunkId)) return prev.filter((id) => id !== chunkId);
      return prev.length >= 2 ? [prev[1], chunkId] : [...prev, chunkId];
    });
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

      {/* Sidebar + Canvas */}
      <main className="flex-1 relative overflow-hidden flex">
        <ChunksControlSidebar store={store} />
        <div className="flex-1 relative min-w-0 overflow-hidden">
          <ChunksCanvas
            chunks={chunks}
            umapPositions={positions}
            searchOpacities={searchOpacities}
            neighborhoodEdges={neighborhoodEdges}
            neighborhoodEdgesVersion={neighborhoodEdgesVersion}
            isRunning={isRunning}
            onSelectChunk={handleSelectChunk}
            colorSaturation={store.values.colorSaturation}
            minSaturation={store.values.minSaturation}
            chunkColorMix={store.values.chunkColorMix}
            edgeThickness={store.values.edgeThickness}
            edgeMidpoint={store.values.edgeMidpoint}
            nodeSizeMin={store.values.nodeSizeMin}
            nodeSizeMax={store.values.nodeSizeMax}
            nodeSizePivot={store.values.nodeSizePivot}
          />
        </div>
        <Reader chunkId={selectedChunkIds.at(-1) ?? null} onClose={() => handleSelectChunk(null)} />
      </main>
    </div>
  );
}
