"use client";

import { useEffect, useState, useMemo } from "react";
import { TopicsView, type RendererType } from "@/components/TopicsView";
import { ProjectSelector, type Project } from "@/components/ProjectSelector";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";

/** Debounce a value - returns the value after it stops changing for `delay` ms */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/** useState that persists to localStorage (SSR-safe) */
function useLocalStorageState<T>(key: string, defaultValue: T): [T, (value: T) => void, boolean] {
  const [value, setValue] = useState<T>(defaultValue);
  const [isReady, setIsReady] = useState(false);

  // Read from localStorage once on mount, then mark as ready
  useEffect(() => {
    const stored = localStorage.getItem(key);
    if (stored !== null) {
      try {
        setValue(JSON.parse(stored) as T);
      } catch {
        // Keep default
      }
    }
    setIsReady(true);
  }, [key]);

  // Write to localStorage when value changes (only after ready)
  useEffect(() => {
    if (isReady) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }, [key, value, isReady]);

  return [value, setValue, isReady];
}

interface TopicsData {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
}

// Convert linear slider (0-100) to logarithmic scale (0.01 to 10)
function sliderToStrength(value: number): number {
  if (value === 0) return 0;
  return Math.pow(10, (value - 50) / 50);
}

function strengthToSlider(strength: number): number {
  if (strength === 0) return 0;
  return Math.log10(strength) * 50 + 50;
}

export default function TopicsPage() {
  const [data, setData] = useState<TopicsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Layout controls (persisted)
  const [knnStrength, setKnnStrength, knnReady] = useLocalStorageState("topics-knnStrength", 4.0);
  const [contrast, setContrast, contrastReady] = useLocalStorageState("topics-contrast", 5.0);

  // Zoom-based clustering (persisted)
  const [zoomScale, setZoomScale, zoomReady] = useLocalStorageState("topics-zoomScale", 1);
  const [clusterSensitivity, setClusterSensitivity, clusterSensReady] = useLocalStorageState("topics-clusterSensitivity", 1.5);

  // Derive resolution from zoom + slider
  // zoom 0.5x + sensitivity 1.5 → resolution 0.75 (few clusters)
  // zoom 2.0x + sensitivity 1.5 → resolution 3.0 (many clusters)
  // Cap based on node count to ensure minimum cluster size of ~5 nodes
  // Heuristic: at resolution R, Louvain produces ~R * nodeCount/20 clusters
  // To get avgSize >= 5: clusters <= N/5, so R <= 4. Scale with N for safety.
  const nodeCount = data?.nodes.length ?? 100;
  const maxResolution = Math.max(2, nodeCount / 30);
  const effectiveResolution = Math.max(0.3, Math.min(maxResolution, zoomScale * clusterSensitivity));

  // Debounce cluster resolution to avoid wasted Louvain/Haiku calls while zooming
  const debouncedClusterResolution = useDebouncedValue(effectiveResolution, 300);

  // Hover highlighting controls (persisted)
  const [hoverSimilarity, setHoverSimilarity, hoverSimReady] = useLocalStorageState("topics-hoverSimilarity", 0.7);
  const [baseDim, setBaseDim, baseDimReady] = useLocalStorageState("topics-baseDim", 0.7);

  // Color mixing (0 = cluster color, 1 = node color) (persisted)
  const [colorMixRatio, setColorMixRatio, colorMixReady] = useLocalStorageState("topics-colorMixRatio", 0.3);

  // Renderer selection (persisted)
  const [rendererType, setRendererType, rendererReady] = useLocalStorageState<RendererType>("topics-rendererType", "d3");

  // Project filtering
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectKeywords, setProjectKeywords] = useState<string[] | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);

  // Fetch project neighborhood when project selected
  useEffect(() => {
    if (!selectedProject) {
      setProjectKeywords(null);
      return;
    }

    setProjectLoading(true);
    fetch(`/api/projects/${selectedProject.id}/neighborhood?hops=2`)
      .then((r) => r.json())
      .then((data) => {
        // keywordLabels come from the API as raw labels
        setProjectKeywords(data.keywordLabels || []);
      })
      .catch((err) => {
        console.error("Failed to fetch project neighborhood:", err);
        setProjectKeywords([]);
      })
      .finally(() => setProjectLoading(false));
  }, [selectedProject]);

  // Convert keyword labels to filter set (format matches TopicsView: node.id = "kw:label")
  const projectFilter = useMemo(() => {
    if (!projectKeywords) return null;
    return new Set(projectKeywords.map((label) => `kw:${label}`));
  }, [projectKeywords]);

  // Wait for all persisted settings to load before rendering
  const settingsReady = knnReady && contrastReady && zoomReady && clusterSensReady &&
                        hoverSimReady && baseDimReady && colorMixReady && rendererReady;

  // Fetch data with localStorage cache fallback
  useEffect(() => {
    const CACHE_KEY = "topics-data-cache";

    // Pre-warm Anthropic connection for faster label generation
    fetch("/api/cluster-labels/warm").catch(() => {});

    async function fetchData() {
      setLoading(true);
      setIsStale(false);

      try {
        const res = await fetch("/api/topics");
        const data = await res.json();

        if (data.error) {
          throw new Error(data.error);
        }

        // Cache successful response
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        setData(data);
        setError(null);
      } catch (err) {
        // Try to load from cache
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          setData(JSON.parse(cached));
          setIsStale(true);
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : "Unknown error");
          setData(null);
        }
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading || !settingsReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">Loading topics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-red-500">Error: {error}</span>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">No topics found. Import some articles first.</span>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex-shrink-0 border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="px-3 py-1.5 flex items-center gap-3">
          <ProjectSelector
            selectedProject={selectedProject}
            onSelect={setSelectedProject}
          />

          <h1 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {projectFilter ? (
              <>
                {projectFilter.size} keywords
                {projectLoading && <span className="ml-1 text-zinc-400">(loading...)</span>}
              </>
            ) : (
              <>
                Topics ({data.nodes.length} keywords, {data.edges.length} edges)
              </>
            )}
            {isStale && (
              <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">(offline - cached data)</span>
            )}
          </h1>

          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <label className="flex items-center gap-1">
              <span>Cluster sens:</span>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.1"
                value={clusterSensitivity}
                onChange={(e) => setClusterSensitivity(parseFloat(e.target.value))}
                className="w-20 h-3"
              />
              <span className="w-8 tabular-nums">{clusterSensitivity.toFixed(1)}</span>
            </label>

            <label className="flex items-center gap-1">
              <span>Contrast:</span>
              <input
                type="range"
                min="1"
                max="5"
                step="0.1"
                value={contrast}
                onChange={(e) => setContrast(parseFloat(e.target.value))}
                className="w-20 h-3"
              />
              <span className="w-8 tabular-nums">{contrast.toFixed(1)}</span>
            </label>

            <label className="flex items-center gap-1">
              <span>k-NN:</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={strengthToSlider(knnStrength)}
                onChange={(e) => setKnnStrength(sliderToStrength(parseFloat(e.target.value)))}
                className="w-20 h-3"
              />
              <span className="w-12 tabular-nums">{knnStrength.toFixed(2)}</span>
            </label>

            <span className="text-zinc-300 dark:text-zinc-600">|</span>

            <label className="flex items-center gap-1">
              <span>Hover sim:</span>
              <input
                type="range"
                min="0.3"
                max="0.95"
                step="0.05"
                value={hoverSimilarity}
                onChange={(e) => setHoverSimilarity(parseFloat(e.target.value))}
                className="w-20 h-3"
              />
              <span className="w-8 tabular-nums">{hoverSimilarity.toFixed(2)}</span>
            </label>

            <label className="flex items-center gap-1">
              <span>Base dim:</span>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.05"
                value={baseDim}
                onChange={(e) => setBaseDim(parseFloat(e.target.value))}
                className="w-20 h-3"
              />
              <span className="w-8 tabular-nums">{(baseDim * 100).toFixed(0)}%</span>
            </label>

            <label className="flex items-center gap-1">
              <span>Color mix:</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={colorMixRatio}
                onChange={(e) => setColorMixRatio(parseFloat(e.target.value))}
                className="w-20 h-3"
              />
              <span className="w-8 tabular-nums">{(colorMixRatio * 100).toFixed(0)}%</span>
            </label>

            <span className="text-zinc-300 dark:text-zinc-600">|</span>

            <label className="flex items-center gap-1">
              <span>Renderer:</span>
              <select
                value={rendererType}
                onChange={(e) => setRendererType(e.target.value as RendererType)}
                className="text-xs bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1 py-0.5"
              >
                <option value="d3">D3/SVG</option>
                <option value="three">Three.js</option>
              </select>
            </label>
          </div>

          <a
            href="/"
            className="text-xs text-blue-500 hover:text-blue-600 ml-auto"
          >
            Back to Map
          </a>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden bg-white dark:bg-zinc-900">
        <TopicsView
          nodes={data.nodes}
          edges={data.edges}
          knnStrength={knnStrength}
          contrast={contrast}
          clusterResolution={debouncedClusterResolution}
          colorMixRatio={colorMixRatio}
          hoverConfig={{
            similarityThreshold: hoverSimilarity,
            baseDim,
          }}
          onKeywordClick={(keyword) => {
            console.log("Clicked keyword:", keyword);
          }}
          onZoomChange={setZoomScale}
          rendererType={rendererType}
          externalFilter={projectFilter}
        />
      </main>
    </div>
  );
}
