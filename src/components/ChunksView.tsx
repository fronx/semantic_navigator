/**
 * Orchestrator for the chunks UMAP visualization.
 * Extracts embeddings from chunk data, runs UMAP, and renders the canvas.
 * Fetches cached layout (positions + cluster labels) from the server on mount,
 * and POSTs UMAP results after completion to persist for future loads.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import type { ChunksSettings, LabelFadeConfig } from "@/components/ChunksControlSidebar";
import { useUmapLayout } from "@/hooks/useUmapLayout";
import { usePersistedStore } from "@/hooks/usePersistedStore";
import { useSearch } from "@/hooks/useSearch";
import { ChunksControlSidebar } from "@/components/ChunksControlSidebar";
import { ChunksCanvas } from "./chunks-r3f/ChunksCanvas";
import { Reader } from "@/components/Reader";
import { exportUmapGraph } from "@/lib/export-umap-graph";

interface CachedLayout {
  positions: number[];
  edges: Array<{ source: number; target: number; weight: number; restLength?: number | null }>;
  chunkIds: string[];
  coarseResolution: number;
  fineResolution: number;
  coarseClusters: Record<number, number>;
  fineClusters: Record<number, number>;
  coarseLabels: Record<number, string>;
  fineLabels: Record<number, string>;
  createdAt: string;
}

const CHUNKS_DEFAULTS: ChunksSettings = {
  nNeighbors: 15,
  minDist: 0.1,
  spread: 1.0,
  colorSaturation: 0.6,
  minSaturation: 0.45,
  chunkColorMix: 0.4,
  edgeThickness: 4,
  edgeMidpoint: 0.6,
  edgeCountPivot: 200,
  edgeCountFloor: 0.3,
  nodeSizeMin: 0.6,
  nodeSizeMax: 2.0,
  nodeSizePivot: 30,
  hoverRadius: 70,
  shapeMorphNear: 800,
  shapeMorphFar: 3000,
  coarseResolution: 0.3,
  fineResolution: 1.5,
  coarseFadeIn:  { start: 8000, full: 5000 },
  coarseFadeOut: { start: 3000, full: 1500 },
  fineFadeIn:    { start: 2500, full: 1500 },
  fineFadeOut:   { start: 1000, full: 200  },
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
  const store = usePersistedStore("chunks-umap-v3", CHUNKS_DEFAULTS, 300);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChunkIds, setSelectedChunkIds] = useState<string[]>([]);
  const [cameraZ, setCameraZ] = useState<number | undefined>(undefined);

  const [cachedLayout, setCachedLayout] = useState<CachedLayout | null>(null);
  const [isLoadingCache, setIsLoadingCache] = useState(true);
  const [isReclustering, setIsReclustering] = useState(false);
  const cachedLayoutRef = useRef<CachedLayout | null>(null);
  cachedLayoutRef.current = cachedLayout;

  const [umapSeed, setUmapSeed] = useState(0);

  // Fetch cached layout on mount
  useEffect(() => {
    fetch("/api/chunks/layout")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CachedLayout | null) => setCachedLayout(data))
      .catch(() => null)
      .finally(() => setIsLoadingCache(false));
  }, []);

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
    seed: umapSeed,
  });

  // Stable refs so handleLayoutSettled doesn't go stale
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const neighborhoodEdgesRef = useRef(neighborhoodEdges);
  neighborhoodEdgesRef.current = neighborhoodEdges;
  const coarseResolutionRef = useRef(store.debounced.coarseResolution);
  coarseResolutionRef.current = store.debounced.coarseResolution;
  const fineResolutionRef = useRef(store.debounced.fineResolution);
  fineResolutionRef.current = store.debounced.fineResolution;

  // POST force-simulated positions to server after force layout settles (only when no cache exists)
  const handleLayoutSettled = useCallback((layoutPositions: Float32Array) => {
    if (cachedLayoutRef.current || layoutPositions.length === 0) return;
    const chunkIds = chunksRef.current.map((c) => c.id);
    const edges = neighborhoodEdgesRef.current.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      restLength: e.restLength,
    }));
    const coarseResolution = coarseResolutionRef.current;
    const fineResolution = fineResolutionRef.current;
    fetch("/api/chunks/layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positions: Array.from(layoutPositions),
        edges,
        chunkIds,
        coarseResolution,
        fineResolution,
      }),
    })
      .then((r) => r.json())
      .then((data) =>
        setCachedLayout({
          positions: Array.from(layoutPositions),
          edges,
          chunkIds,
          coarseResolution,
          fineResolution,
          coarseClusters: data.coarseClusters,
          fineClusters: data.fineClusters,
          coarseLabels: data.coarseLabels,
          fineLabels: data.fineLabels,
          createdAt: new Date().toISOString(),
        })
      )
      .catch(console.error);
  }, []);

  // Recluster when resolution sliders change (only if cached layout exists)
  useEffect(() => {
    if (!cachedLayoutRef.current) return;
    setIsReclustering(true);
    fetch("/api/chunks/layout/recluster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coarseResolution: store.debounced.coarseResolution,
        fineResolution: store.debounced.fineResolution,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.coarseClusters) {
          setCachedLayout((prev) =>
            prev
              ? {
                ...prev,
                coarseClusters: data.coarseClusters,
                fineClusters: data.fineClusters,
                coarseLabels: data.coarseLabels,
                fineLabels: data.fineLabels,
                coarseResolution: store.debounced.coarseResolution,
                fineResolution: store.debounced.fineResolution,
              }
              : null
          );
        }
      })
      .catch(console.error)
      .finally(() => setIsReclustering(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.debounced.coarseResolution, store.debounced.fineResolution]);

  const handleRedoUmap = useCallback(() => {
    setCachedLayout(null);
    setUmapSeed((s) => s + 1);
    fetch("/api/chunks/layout", { method: "DELETE" }).catch(console.error);
  }, []);

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

  const [focusChunk, setFocusChunk] = useState<{ id: string; seq: number } | null>(null);
  const handleActiveChunkChange = useCallback((chunkId: string) => {
    setFocusChunk((prev) => ({ id: chunkId, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  // Decide what positions/edges to show: prefer cached layout if available.
  // Memoized to avoid allocating a new Float32Array on every render (UMAP progress triggers frequent re-renders).
  // When using cached edges, use version=0 so background UMAP progress doesn't restart the force sim.
  const displayPositions = useMemo(
    () => cachedLayout ? new Float32Array(cachedLayout.positions) : positions,
    [cachedLayout, positions]
  );
  const displayEdges = cachedLayout ? cachedLayout.edges : neighborhoodEdges;
  const displayEdgesVersion = cachedLayout ? 0 : neighborhoodEdgesVersion;
  const displayIsRunning = isRunning && !cachedLayout;

  const labelFades = useMemo<LabelFadeConfig>(() => ({
    coarseFadeIn: store.values.coarseFadeIn,
    coarseFadeOut: store.values.coarseFadeOut,
    fineFadeIn: store.values.fineFadeIn,
    fineFadeOut: store.values.fineFadeOut,
  }), [store.values.coarseFadeIn, store.values.coarseFadeOut, store.values.fineFadeIn, store.values.fineFadeOut]);

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

        {isReclustering && (
          <span className="text-xs text-zinc-400">Relabeling...</span>
        )}

        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {searchOpacities.size > 0
            ? `${matchCount} / ${chunks.length} chunks`
            : `${chunks.length} chunks`}
          {isStale && <span className="ml-2 text-amber-600 dark:text-amber-400">(offline)</span>}
        </span>

        {displayIsRunning && (
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
        <ChunksControlSidebar store={store} onRedoUmap={handleRedoUmap} cameraZ={cameraZ} />
        <div className="flex-1 relative min-w-0 overflow-hidden">
          {!isLoadingCache && (
            <ChunksCanvas
              chunks={chunks}
              umapPositions={displayPositions}
              searchOpacities={searchOpacities}
              neighborhoodEdges={displayEdges}
              neighborhoodEdgesVersion={displayEdgesVersion}
              isRunning={displayIsRunning}
              onSelectChunk={handleSelectChunk}
              colorSaturation={store.values.colorSaturation}
              minSaturation={store.values.minSaturation}
              chunkColorMix={store.values.chunkColorMix}
              edgeThickness={store.values.edgeThickness}
              edgeMidpoint={store.values.edgeMidpoint}
              edgeCountPivot={store.values.edgeCountPivot}
              edgeCountFloor={store.values.edgeCountFloor}
              nodeSizeMin={store.values.nodeSizeMin}
              nodeSizeMax={store.values.nodeSizeMax}
              nodeSizePivot={store.values.nodeSizePivot}
              hoverRadius={store.values.hoverRadius}
              shapeMorphNear={store.values.shapeMorphNear}
              shapeMorphFar={store.values.shapeMorphFar}
              coarseClusters={cachedLayout?.coarseClusters ?? null}
              fineClusters={cachedLayout?.fineClusters ?? null}
              coarseLabels={cachedLayout?.coarseLabels ?? null}
              fineLabels={cachedLayout?.fineLabels ?? null}
              labelFades={labelFades}
              onLayoutSettled={handleLayoutSettled}
              onCameraZChange={setCameraZ}
              focusChunk={focusChunk}
            />
          )}
        </div>
        <Reader
          chunkId={selectedChunkIds.at(-1) ?? null}
          onClose={() => handleSelectChunk(null)}
          onActiveChunkChange={handleActiveChunkChange}
        />
      </main>
    </div>
  );
}
