"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { TopicsView, type RendererType } from "@/components/TopicsView";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useErrorNotification } from "@/hooks/useErrorNotification";
import { ProjectSelector, type Project } from "@/components/ProjectSelector";
import { ProjectSidebar, type Project as SidebarProject } from "@/components/ProjectSidebar";
import { InlineTitleInput } from "@/components/InlineTitleInput";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import { CAMERA_Z_MIN, CAMERA_Z_MAX } from "@/lib/chunk-zoom-config";
import { DEFAULT_ZOOM_PHASE_CONFIG, sanitizeZoomPhaseConfig, type ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import { CAMERA_Z_SCALE_BASE } from "@/lib/three/camera-controller";

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

const LOG_Z_MIN = Math.log10(CAMERA_Z_MIN);
const LOG_Z_MAX = Math.log10(CAMERA_Z_MAX);

function cameraZToSliderValue(z: number): number {
  const clamped = Math.max(CAMERA_Z_MIN, Math.min(CAMERA_Z_MAX, z));
  const ratio = (Math.log10(clamped) - LOG_Z_MIN) / (LOG_Z_MAX - LOG_Z_MIN);
  return Math.round(ratio * 100);
}

function sliderValueToCameraZ(value: number): number {
  const ratio = Math.max(0, Math.min(1, value / 100));
  return Math.pow(10, LOG_Z_MIN + (LOG_Z_MAX - LOG_Z_MIN) * ratio);
}

function formatZoomMarker(z: number): string {
  const zoomValue = Math.round(z).toLocaleString();
  const kValue = (CAMERA_Z_SCALE_BASE / z).toFixed(2);
  return `${zoomValue} (k≈${kValue}x)`;
}

function formatZoomWindow(far: number, near: number): string {
  return `${formatZoomMarker(Math.max(far, near))} → ${formatZoomMarker(Math.min(far, near))}`;
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

  // Zoom phase tuning (persisted)
  const [zoomPhaseConfigRaw, setZoomPhaseConfig, zoomPhaseReady] = useLocalStorageState<ZoomPhaseConfig>(
    "topics-zoomPhases",
    DEFAULT_ZOOM_PHASE_CONFIG
  );
  const zoomPhaseConfig = useMemo(() => sanitizeZoomPhaseConfig(zoomPhaseConfigRaw), [zoomPhaseConfigRaw]);

  useEffect(() => {
    const rawString = JSON.stringify(zoomPhaseConfigRaw);
    const sanitizedString = JSON.stringify(zoomPhaseConfig);
    if (rawString !== sanitizedString) {
      setZoomPhaseConfig(zoomPhaseConfig);
    }
  }, [zoomPhaseConfigRaw, zoomPhaseConfig, setZoomPhaseConfig]);

  const updateZoomPhaseConfig = useCallback(
    (mutator: (prev: ZoomPhaseConfig) => ZoomPhaseConfig) => {
      const next = sanitizeZoomPhaseConfig(mutator(zoomPhaseConfig));
      setZoomPhaseConfig(next);
    },
    [zoomPhaseConfig, setZoomPhaseConfig]
  );

  // Project filtering
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectKeywords, setProjectKeywords] = useState<string[] | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);

  // Project nodes for graph display
  const [graphProjects, setGraphProjects] = useState<ProjectNode[]>([]);

  // Project creation and editing
  const [creatingAt, setCreatingAt] = useState<{
    worldPos: { x: number; y: number };
    screenPos: { x: number; y: number };
  } | null>(null);
  const [editingProject, setEditingProject] = useState<SidebarProject | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Error notification for background operations (cluster labels, etc.)
  const { error: notificationError, notify: notifyError, clear: clearError } = useErrorNotification();

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

  // Handle project creation request from TopicsView (N key press)
  const handleCreateProject = useCallback((worldPos: { x: number; y: number }, screenPos: { x: number; y: number }) => {
    setCreatingAt({ worldPos, screenPos });
  }, []);

  // Create project via API
  const handleConfirmCreate = useCallback(async (title: string) => {
    if (!creatingAt) return;

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          position_x: creatingAt.worldPos.x,
          position_y: creatingAt.worldPos.y,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error("Failed to create project:", data.error);
        return;
      }

      const project = await res.json();

      // Add new project to graph
      setGraphProjects((prev) => [
        ...prev,
        {
          id: project.id,
          title: project.title,
          content: project.content,
          position_x: project.position_x,
          position_y: project.position_y,
          embedding: project.embedding_256,
        },
      ]);

      // Open sidebar to edit the new project
      setEditingProject(project);
    } catch (err) {
      console.error("Failed to create project:", err);
    } finally {
      setCreatingAt(null);
    }
  }, [creatingAt]);

  // Cancel project creation
  const handleCancelCreate = useCallback(() => {
    setCreatingAt(null);
  }, []);

  // Update project via API
  const handleUpdateProject = useCallback(async (id: string, updates: { title?: string; content?: string }) => {
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error("Failed to update project:", data.error);
        return;
      }

      const updated = await res.json();
      setEditingProject(updated);
    } catch (err) {
      console.error("Failed to update project:", err);
    } finally {
      setIsUpdating(false);
    }
  }, []);

  // Close sidebar
  const handleCloseSidebar = useCallback(() => {
    setEditingProject(null);
  }, []);

  // Handle project node click (open sidebar)
  const handleProjectClick = useCallback(async (projectId: string) => {
    // Strip "proj:" prefix if present
    const id = projectId.startsWith("proj:") ? projectId.slice(5) : projectId;

    try {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setEditingProject(data.project);
    } catch (err) {
      console.error("Failed to fetch project:", err);
    }
  }, []);

  // Handle project node drag (update position)
  const handleProjectDrag = useCallback(async (projectId: string, position: { x: number; y: number }) => {
    // Strip "proj:" prefix if present
    const id = projectId.startsWith("proj:") ? projectId.slice(5) : projectId;

    // Update local state immediately for responsiveness
    setGraphProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, position_x: position.x, position_y: position.y } : p
      )
    );

    // Persist to database
    try {
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position_x: position.x, position_y: position.y }),
      });
    } catch (err) {
      console.error("Failed to update project position:", err);
    }
  }, []);

  const handleKeywordStartSlider = (value: number) => {
    updateZoomPhaseConfig((prev) => ({
      ...prev,
      keywordLabels: { ...prev.keywordLabels, start: sliderValueToCameraZ(value) },
    }));
  };

  const handleKeywordFullSlider = (value: number) => {
    updateZoomPhaseConfig((prev) => ({
      ...prev,
      keywordLabels: { ...prev.keywordLabels, full: sliderValueToCameraZ(value) },
    }));
  };

  const handleChunkFarSlider = (value: number) => {
    updateZoomPhaseConfig((prev) => ({
      ...prev,
      chunkCrossfade: { ...prev.chunkCrossfade, far: sliderValueToCameraZ(value) },
    }));
  };

  const handleChunkNearSlider = (value: number) => {
    updateZoomPhaseConfig((prev) => ({
      ...prev,
      chunkCrossfade: { ...prev.chunkCrossfade, near: sliderValueToCameraZ(value) },
    }));
  };

  const handleBlurFarSlider = (value: number) => {
    updateZoomPhaseConfig((prev) => ({
      ...prev,
      blur: { ...prev.blur, far: sliderValueToCameraZ(value) },
    }));
  };

  const handleBlurNearSlider = (value: number) => {
    updateZoomPhaseConfig((prev) => ({
      ...prev,
      blur: { ...prev.blur, near: sliderValueToCameraZ(value) },
    }));
  };

  const handleBlurStrengthSlider = (value: number) => {
    updateZoomPhaseConfig((prev) => ({
      ...prev,
      blur: { ...prev.blur, maxRadius: value },
    }));
  };

  // Wait for all persisted settings to load before rendering
  const settingsReady = knnReady && contrastReady && zoomReady && clusterSensReady &&
                        hoverSimReady && baseDimReady && colorMixReady && rendererReady &&
                        zoomPhaseReady;

  // Fetch data with localStorage cache fallback
  useEffect(() => {
    const CACHE_KEY = "topics-data-cache";

    // Pre-warm Anthropic connection for faster label generation
    fetch("/api/cluster-labels/warm").catch(() => {});

    async function fetchData() {
      setLoading(true);
      setIsStale(false);

      try {
        // Fetch topics and projects in parallel
        const [topicsRes, projectsRes] = await Promise.all([
          fetch("/api/topics"),
          fetch("/api/projects"),
        ]);

        const topicsData = await topicsRes.json();
        const projectsData = await projectsRes.json();

        if (topicsData.error) {
          throw new Error(topicsData.error);
        }

        // Cache successful response
        localStorage.setItem(CACHE_KEY, JSON.stringify(topicsData));
        setData(topicsData);

        // Transform projects into ProjectNode format
        if (Array.isArray(projectsData)) {
          setGraphProjects(
            projectsData.map((p: { id: string; title: string; content: string | null; position_x: number | null; position_y: number | null; embedding_256?: number[] }) => ({
              id: p.id,
              title: p.title,
              content: p.content,
              position_x: p.position_x,
              position_y: p.position_y,
              embedding: p.embedding_256,
            }))
          );
        }

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

  const keywordWindowSummary = formatZoomWindow(zoomPhaseConfig.keywordLabels.start, zoomPhaseConfig.keywordLabels.full);
  const chunkWindowSummary = formatZoomWindow(zoomPhaseConfig.chunkCrossfade.far, zoomPhaseConfig.chunkCrossfade.near);
  const blurWindowSummary = formatZoomWindow(zoomPhaseConfig.blur.far, zoomPhaseConfig.blur.near);

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <ErrorBanner message={notificationError} onDismiss={clearError} />
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
      <div className="px-3 pb-2 border-b bg-white dark:bg-zinc-900 dark:border-zinc-800 text-[11px] text-zinc-500 space-y-2">
        <div className="flex flex-wrap items-center gap-4">
          <span className="uppercase tracking-[0.08em] text-[10px] font-semibold text-zinc-400">Zoom Phases</span>
          <span>Clusters → Keywords: {keywordWindowSummary}</span>
          <span>Keyword Dots → Chunks: {chunkWindowSummary}</span>
          <span>Blur ramp: {blurWindowSummary} · peak {zoomPhaseConfig.blur.maxRadius.toFixed(1)}px</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3 text-[11px] text-zinc-600">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500 font-semibold">Keyword labels</div>
            <label className="flex items-center gap-2">
              <span className="w-12 text-[10px] uppercase text-zinc-500">Start</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={cameraZToSliderValue(zoomPhaseConfig.keywordLabels.start)}
                onChange={(e) => handleKeywordStartSlider(parseFloat(e.target.value))}
                className="flex-1 h-3"
              />
              <span className="w-36 tabular-nums text-right text-zinc-500">{formatZoomMarker(zoomPhaseConfig.keywordLabels.start)}</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 text-[10px] uppercase text-zinc-500">Full</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={cameraZToSliderValue(zoomPhaseConfig.keywordLabels.full)}
                onChange={(e) => handleKeywordFullSlider(parseFloat(e.target.value))}
                className="flex-1 h-3"
              />
              <span className="w-36 tabular-nums text-right text-zinc-500">{formatZoomMarker(zoomPhaseConfig.keywordLabels.full)}</span>
            </label>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500 font-semibold">Chunk crossfade</div>
            <label className="flex items-center gap-2">
              <span className="w-14 text-[10px] uppercase text-zinc-500">Fade out</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={cameraZToSliderValue(zoomPhaseConfig.chunkCrossfade.far)}
                onChange={(e) => handleChunkFarSlider(parseFloat(e.target.value))}
                className="flex-1 h-3"
              />
              <span className="w-36 tabular-nums text-right text-zinc-500">{formatZoomMarker(zoomPhaseConfig.chunkCrossfade.far)}</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-14 text-[10px] uppercase text-zinc-500">Full</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={cameraZToSliderValue(zoomPhaseConfig.chunkCrossfade.near)}
                onChange={(e) => handleChunkNearSlider(parseFloat(e.target.value))}
                className="flex-1 h-3"
              />
              <span className="w-36 tabular-nums text-right text-zinc-500">{formatZoomMarker(zoomPhaseConfig.chunkCrossfade.near)}</span>
            </label>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500 font-semibold">Blur overlay</div>
            <label className="flex items-center gap-2">
              <span className="w-12 text-[10px] uppercase text-zinc-500">Fade out</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={cameraZToSliderValue(zoomPhaseConfig.blur.far)}
                onChange={(e) => handleBlurFarSlider(parseFloat(e.target.value))}
                className="flex-1 h-3"
              />
              <span className="w-36 tabular-nums text-right text-zinc-500">{formatZoomMarker(zoomPhaseConfig.blur.far)}</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 text-[10px] uppercase text-zinc-500">Peak</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={cameraZToSliderValue(zoomPhaseConfig.blur.near)}
                onChange={(e) => handleBlurNearSlider(parseFloat(e.target.value))}
                className="flex-1 h-3"
              />
              <span className="w-36 tabular-nums text-right text-zinc-500">{formatZoomMarker(zoomPhaseConfig.blur.near)}</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-12 text-[10px] uppercase text-zinc-500">Max</span>
              <input
                type="range"
                min={0}
                max={20}
                step={0.5}
                value={zoomPhaseConfig.blur.maxRadius}
                onChange={(e) => handleBlurStrengthSlider(parseFloat(e.target.value))}
                className="flex-1 h-3"
              />
              <span className="w-24 tabular-nums text-right text-zinc-500">{zoomPhaseConfig.blur.maxRadius.toFixed(1)} px</span>
            </label>
          </div>
        </div>
      </div>

      <main className="flex-1 relative overflow-hidden bg-white dark:bg-zinc-900 flex">
        <div className="flex-1 relative min-w-0 overflow-hidden">
          <TopicsView
            nodes={data.nodes}
            edges={data.edges}
            projectNodes={graphProjects}
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
            onProjectClick={handleProjectClick}
            onZoomChange={setZoomScale}
            rendererType={rendererType}
            externalFilter={projectFilter}
            onCreateProject={handleCreateProject}
            onProjectDrag={handleProjectDrag}
            onError={notifyError}
            zoomPhaseConfig={zoomPhaseConfig}
          />

          {/* Inline title input for project creation */}
          {creatingAt && (
            <InlineTitleInput
              screenPosition={creatingAt.screenPos}
              onConfirm={handleConfirmCreate}
              onCancel={handleCancelCreate}
            />
          )}
        </div>

        {/* Project sidebar */}
        <ProjectSidebar
          project={editingProject}
          onClose={handleCloseSidebar}
          onUpdate={handleUpdateProject}
          isUpdating={isUpdating}
        />
      </main>
    </div>
  );
}
