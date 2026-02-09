"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { TopicsView } from "@/components/TopicsView";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SearchBar } from "@/components/SearchBar";
import type { SearchResult } from "@/components/SearchBar";
import { useErrorNotification } from "@/hooks/useErrorNotification";
import { useTopicsSettings } from "@/hooks/useTopicsSettings";
import { useContentLoading } from "@/hooks/useContentLoading";
import { ProjectSidebar, type Project as SidebarProject } from "@/components/ProjectSidebar";
import { InlineTitleInput } from "@/components/InlineTitleInput";
import { ControlSidebar } from "@/components/ControlSidebar";
import { GranularityToggle } from "@/components/GranularityToggle";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PrecomputedClusterData } from "@/hooks/useClusterLabels";
import type { SemanticFilter } from "@/lib/topics-filter";
import { CAMERA_Z_SCALE_BASE } from "@/lib/rendering-utils/camera-controller";
import { BASE_CAMERA_Z } from "@/lib/content-zoom-config";
import { setGlobalContrast } from "@/lib/rendering-utils/node-renderer";
import { isDarkMode, watchThemeChanges } from "@/lib/theme";
import { searchResultsToKeywordIds, extractMatchedKeywords } from "@/lib/search-filter";
import { StartOverlay } from "@/components/StartOverlay";

/** Debounce a value - returns the value after it stops changing for `delay` ms */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

interface TopicsData {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
}

export default function TopicsPage() {
  const [data, setData] = useState<TopicsData | null>(null);
  const [initialClusters, setInitialClusters] = useState<PrecomputedClusterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [started, setStarted] = useState(false);

  // Consolidated settings
  const { settings, isReady: settingsReady, update, updateZoomPhaseConfig, toggleSection } = useTopicsSettings();

  // Sync global contrast to module-level state (synchronous so children read it during same render)
  if (typeof window !== "undefined") {
    setGlobalContrast(settings.globalContrast, isDarkMode());
  }
  // Also listen for theme changes (dark/light toggle)
  useEffect(() => {
    return watchThemeChanges((d) => setGlobalContrast(settings.globalContrast, d));
  }, [settings.globalContrast]);

  // Zoom scale (not persisted - derived from camera position)
  const [zoomScale, setZoomScale] = useState(1);

  // Track cluster count for debug display
  const [clusterCount, setClusterCount] = useState(0);

  // Search state: query for highlighting, results for filter, active flag for locking
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchFilterActive, setSearchFilterActive] = useState(false);

  // Derive filtered keywords from results (only when filter is active)
  const searchFilterKeywords = useMemo(
    () => searchFilterActive ? extractMatchedKeywords(searchResults) : [],
    [searchFilterActive, searchResults]
  );

  // Derive cluster resolution from zoom + slider
  // Resolution determines cluster granularity (higher = more clusters)
  // Use quadratic scaling: visible area decreases with zoom², so cluster count should increase quadratically
  // - Zoomed out (zoomScale ~0.03): ~7 clusters
  // - Medium zoom (zoomScale ~0.1): ~20-24 clusters
  // - Zoomed in (zoomScale ~1): ~32+ clusters
  const nodeCount = data?.nodes.length ?? 100;
  const maxResolution = Math.max(2, nodeCount / 15); // Allow up to ~32 clusters with 489 nodes

  // Precomputed resolutions available (must match what's in the database)
  const PRECOMPUTED_RESOLUTIONS = [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0];

  // Calculate raw resolution based on mode:
  // - Dynamic mode: resolution changes with zoom AND cluster sensitivity
  // - Static mode: resolution only changes with cluster sensitivity slider (zoom ignored)
  const rawResolution = settings.dynamicClustering
    ? Math.max(0.1, Math.min(4.0, Math.pow(zoomScale, 2) * settings.clusterSensitivity))
    : Math.max(0.1, Math.min(4.0, settings.clusterSensitivity));

  // Snap to nearest precomputed resolution to avoid client-side clustering fallback
  const effectiveResolution = PRECOMPUTED_RESOLUTIONS.reduce((prev, curr) =>
    Math.abs(curr - rawResolution) < Math.abs(prev - rawResolution) ? curr : prev
  );

  const debouncedClusterResolution = useDebouncedValue(effectiveResolution, 300);

  // Project nodes for graph display
  const [graphProjects, setGraphProjects] = useState<ProjectNode[]>([]);

  // Project creation and editing
  const [creatingAt, setCreatingAt] = useState<{
    worldPos: { x: number; y: number };
    screenPos: { x: number; y: number };
  } | null>(null);
  const [editingProject, setEditingProject] = useState<SidebarProject | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Error notification for background operations
  const { error: notificationError, notify: notifyError, clear: clearError } = useErrorNotification();

  // Camera Z state for debug display
  const [currentCameraZ, setCurrentCameraZ] = useState<number | undefined>(undefined);

  // Hovered chunk debug info
  const [hoveredContentId, setHoveredContentId] = useState<string | null>(null);
  const [hoveredContentContent, setHoveredContentContent] = useState<string | null>(null);

  // Hovered keyword debug info
  const [hoveredKeywordId, setHoveredKeywordId] = useState<string | null>(null);
  const [keywordChunksDebug, setKeywordChunksDebug] = useState<string>("");

  // Semantic filter state (for breadcrumb navigation UI in ControlSidebar)
  const [semanticFilterData, setSemanticFilterData] = useState<{
    semanticFilter: SemanticFilter | null;
    filterHistory: string[];
    keywordNodes: KeywordNode[];
    clearSemanticFilter: () => void;
    goBackInHistory: () => void;
    goToHistoryIndex: (index: number) => void;
  } | null>(null);

  // Calculate chunk Z depth from offset multiplier
  // BASE_CAMERA_Z is 1000, so default offset of 0.5 gives depth of 500
  const contentZDepth = BASE_CAMERA_Z * settings.chunkZOffset;

  // Convert search results to filter set
  const searchFilter = useMemo(() => {
    if (!searchFilterActive || searchResults.length === 0 || !data) return null;
    return searchResultsToKeywordIds(searchResults, data.nodes);
  }, [searchFilterActive, searchResults, data]);

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

      setEditingProject(project);
    } catch (err) {
      console.error("Failed to create project:", err);
    } finally {
      setCreatingAt(null);
    }
  }, [creatingAt]);

  const handleCancelCreate = useCallback(() => {
    setCreatingAt(null);
  }, []);

  // Fetch chunks for visible keywords (needed for keyword hover debug)
  const { contentsByKeyword } = useContentLoading({
    visibleKeywordIds: useMemo(() => {
      if (!data) return new Set();
      return new Set(data.nodes.map(n => n.id));
    }, [data]),
    enabled: true,
    nodeType: settings.nodeType,
  });

  // Handle chunk hover (for debug info)
  const handleContentHover = useCallback((chunkId: string | null, content: string | null) => {
    setHoveredContentId(chunkId);
    setHoveredContentContent(content);
  }, []);

  // Handle keyword hover (for debug info) - build debug string showing chunks
  useEffect(() => {
    if (!hoveredKeywordId) {
      setKeywordChunksDebug("");
      return;
    }

    const chunks = contentsByKeyword.get(hoveredKeywordId) || [];
    const keywordNode = data?.nodes.find(n => n.id === hoveredKeywordId);
    const keywordLabel = keywordNode?.label || hoveredKeywordId;

    const debugLines: string[] = [];
    debugLines.push(`Keyword: ${keywordLabel} (${hoveredKeywordId})`);
    debugLines.push(`  Chunks: ${chunks.length}`);

    chunks.forEach((chunk, i) => {
      const preview = chunk.content.slice(0, 50).replace(/\n/g, ' ');
      debugLines.push(`  ${i + 1}. ${chunk.id} - "${preview}${chunk.content.length > 50 ? '...' : ''}"`);
    });

    if (chunks.length === 0) {
      debugLines.push("  (no chunks loaded)");
    }

    setKeywordChunksDebug(debugLines.join('\n'));
  }, [hoveredKeywordId, contentsByKeyword, data?.nodes]);

  // Ref for contentsByKeyword so handleKeywordHover stays stable
  const contentsByKeywordRef = useRef(contentsByKeyword);
  contentsByKeywordRef.current = contentsByKeyword;

  // Handle keyword hover callback (stable — reads contentsByKeyword via ref)
  const handleKeywordHover = useCallback((keywordId: string | null) => {
    console.log('[page] handleKeywordHover called with:', keywordId);
    const cbk = contentsByKeywordRef.current;
    console.log('[page] contentsByKeyword has', cbk.size, 'keywords');
    if (keywordId) {
      const chunks = cbk.get(keywordId);
      console.log('[page] Chunks for', keywordId, ':', chunks?.length ?? 0, chunks);
    }
    setHoveredKeywordId(keywordId);
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

  const handleCloseSidebar = useCallback(() => {
    setEditingProject(null);
  }, []);

  // Handle project node click (open sidebar)
  const handleProjectClick = useCallback(async (projectId: string) => {
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
    const id = projectId.startsWith("proj:") ? projectId.slice(5) : projectId;

    setGraphProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, position_x: position.x, position_y: position.y } : p
      )
    );

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

  // Handle search filter button click - locks current results as filter
  const handleSearchFilter = useCallback(() => {
    if (searchQuery.trim() && searchResults.length > 0) {
      setSearchFilterActive(true);
    }
  }, [searchQuery, searchResults]);

  // Handle clear search filter - resets all search state
  const handleClearSearchFilter = useCallback(() => {
    setSearchFilterActive(false);
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  // Handle search callback from SearchBar
  const handleSearch = useCallback((query: string, results: SearchResult[]) => {
    setSearchQuery(query);
    setSearchResults(results);
  }, []);

  // Fetch data with localStorage cache fallback
  useEffect(() => {
    const CACHE_KEY = "topics-data-cache";

    fetch("/api/cluster-labels/warm").catch(() => {});

    async function fetchData() {
      setLoading(true);
      setIsStale(false);

      try {
        const [topicsRes, projectsRes, clustersRes] = await Promise.all([
          fetch(`/api/topics?nodeType=${settings.nodeType}`),
          fetch("/api/projects"),
          fetch("/api/precomputed-clusters", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              resolution: debouncedClusterResolution,
              nodeType: settings.nodeType,
            }),
          }),
        ]);

        const topicsData = await topicsRes.json();
        const projectsData = await projectsRes.json();
        const clustersData = clustersRes.ok ? await clustersRes.json() : null;

        if (topicsData.error) {
          throw new Error(topicsData.error);
        }

        localStorage.setItem(CACHE_KEY, JSON.stringify(topicsData));
        setData(topicsData);
        setInitialClusters(clustersData);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.nodeType]); // debouncedClusterResolution intentionally excluded - only need initial value

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

  if (!started) {
    return (
      <StartOverlay onStart={() => {
        // Restore saved playing state if it was true
        try {
          const saved = JSON.parse(localStorage.getItem("music-player") || "{}");
          if (saved.playing) {
            document.dispatchEvent(new CustomEvent("music:start"));
          }
        } catch {}
        setStarted(true);
      }} />
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <ErrorBanner message={notificationError} onDismiss={clearError} />
      <header className="flex-shrink-0 border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="px-3 py-1.5 flex items-center gap-3">
          {/* Search Bar with Stats */}
          <div className="flex-1 flex items-center justify-center gap-3">
            <div className="flex-1 max-w-xl">
              <SearchBar
                displayMode="inline"
                placeholder="Search topics..."
                nodeType={settings.nodeType}
                onSearch={handleSearch}
                showFilterButton={true}
                onFilter={handleSearchFilter}
                filterActive={searchFilterActive}
              />
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-500 whitespace-nowrap">
              {data.nodes.length} keywords
              {isStale && <span className="ml-2 text-amber-600 dark:text-amber-400">(offline)</span>}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <GranularityToggle
              value={settings.nodeType}
              onChange={(value) => update('nodeType', value)}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden bg-white dark:bg-zinc-900 flex">
        <ControlSidebar
          settings={settings}
          update={update}
          updateZoomPhaseConfig={updateZoomPhaseConfig}
          toggleSection={toggleSection}
          cameraZ={currentCameraZ}
          clusterResolutionDebug={{
            zoomScale,
            effectiveResolution,
            debouncedResolution: debouncedClusterResolution,
            nodeCount,
            clusterCount,
          }}
          hoveredChunkId={hoveredContentId}
          hoveredChunkContent={hoveredContentContent}
          keywordChunksDebug={keywordChunksDebug}
          searchFilterKeywords={searchFilterKeywords}
          onClearSearchFilter={handleClearSearchFilter}
          semanticFilter={semanticFilterData?.semanticFilter ?? null}
          filterHistory={semanticFilterData?.filterHistory ?? []}
          keywordNodes={semanticFilterData?.keywordNodes ?? []}
          clearSemanticFilter={semanticFilterData?.clearSemanticFilter}
          goBackInHistory={semanticFilterData?.goBackInHistory}
          goToHistoryIndex={semanticFilterData?.goToHistoryIndex}
        />
        <div className="flex-1 relative min-w-0 overflow-hidden">
          <TopicsView
            nodes={data.nodes}
            edges={data.edges}
            projectNodes={graphProjects}
            nodeType={settings.nodeType}
            knnStrength={settings.knnStrength}
            contrast={settings.contrast}
            clusterResolution={debouncedClusterResolution}
            colorMixRatio={settings.colorMixRatio}
            colorDesaturation={settings.colorDesaturation}
            onClusterCountChange={setClusterCount}
            hoverConfig={{
              similarityThreshold: settings.hoverSimilarity,
              baseDim: settings.baseDim,
            }}
            onKeywordClick={(keyword) => {
              console.log("Clicked keyword:", keyword);
            }}
            onProjectClick={handleProjectClick}
            onZoomChange={(scale) => {
              setZoomScale(scale);
              if (scale > 0) {
                setCurrentCameraZ(CAMERA_Z_SCALE_BASE / scale);
              }
            }}
            rendererType={settings.rendererType}
            externalFilter={null}
            searchFilter={searchFilter}
            onCreateProject={handleCreateProject}
            onProjectDrag={handleProjectDrag}
            onError={notifyError}
            zoomPhaseConfig={settings.zoomPhaseConfig}
            blurEnabled={settings.blurEnabled}
            showKNNEdges={settings.showKNNEdges}
            contentZDepth={contentZDepth}
            contentTextDepthScale={settings.contentTextDepthScale}
            keywordSizeMultiplier={settings.keywordSizeMultiplier}
            scaleNodesByDegree={settings.scaleNodesByDegree}
            degreeSizeMin={settings.degreeSizeMin}
            degreeSizeMax={settings.degreeSizeMax}
            contentSizeMultiplier={settings.contentSizeMultiplier}
            contentTextContrast={settings.contentTextContrast}
            contentSpringStrength={settings.contentSpringStrength}
            chargeStrength={settings.chargeStrength}
            unifiedSimulation={settings.unifiedSimulation}
            panelRoughness={settings.panelRoughness}
            panelTransmission={settings.panelTransmission}
            panelAnisotropicBlur={settings.panelAnisotropicBlur}
            panelThicknessMultiplier={settings.panelThicknessMultiplier}
            onSemanticFilterChange={setSemanticFilterData}
            initialPrecomputedData={initialClusters}
            onChunkHover={handleContentHover}
            onKeywordHover={handleKeywordHover}
            searchQuery={searchQuery}
          />

          {creatingAt && (
            <InlineTitleInput
              screenPosition={creatingAt.screenPos}
              onConfirm={handleConfirmCreate}
              onCancel={handleCancelCreate}
            />
          )}
        </div>

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
