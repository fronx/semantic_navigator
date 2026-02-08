"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type HoverHighlightConfig } from "@/hooks/useGraphHoverHighlight";
import { useClusterLabels, type PrecomputedClusterData } from "@/hooks/useClusterLabels";
import { useStableCallback } from "@/hooks/useStableRef";
import { useTopicsFilter } from "@/hooks/useTopicsFilter";
import { useProjectCreation } from "@/hooks/useProjectCreation";
import { useD3TopicsRenderer } from "@/hooks/useD3TopicsRenderer";
import { useThreeTopicsRenderer } from "@/hooks/useThreeTopicsRenderer";
import { useR3FTopicsRenderer } from "@/hooks/useR3FTopicsRenderer";
import { useContentLoading } from "@/hooks/useContentLoading";
import { useTopicsSearch } from "@/hooks/useTopicsSearch";
import { useTopicsSearchOpacity } from "@/hooks/useTopicsSearchOpacity";
import { R3FTopicsCanvas } from "@/components/topics-r3f/R3FTopicsCanvas";
import { createContentNodes, applyConstrainedForces } from "@/lib/content-layout";
import { convertToThreeNodes } from "@/lib/topics-graph-nodes";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import { loadPCATransform, type PCATransform } from "@/lib/semantic-colors";
import type { SemanticFilter } from "@/lib/topics-filter";
import { createFocusState, type FocusState } from "@/lib/focus-mode";
import type { BaseRendererOptions } from "@/lib/renderer-types";
import type { SimNode } from "@/lib/map-renderer";
import { CAMERA_Z_SCALE_BASE } from "@/lib/three/camera-controller";
import { DEFAULT_ZOOM_PHASE_CONFIG, type ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import { calculatePanelRatio, calculatePanelThickness } from "@/lib/transmission-panel-config";

// ============================================================================
// Types
// ============================================================================

export type RendererType = "d3" | "three" | "r3f";

export type { BaseRendererOptions };

export interface TopicsViewProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  /** Project nodes to display in the graph */
  projectNodes?: ProjectNode[];
  /** Node type: 'article' or 'chunk' (determines granularity level) */
  nodeType: 'article' | 'chunk';
  /** k-NN edge strength multiplier */
  knnStrength: number;
  /** Contrast exponent for similarity-based layout */
  contrast: number;
  /** Louvain resolution for client-side clustering (higher = more clusters) */
  clusterResolution: number;
  /** Color mix ratio: 0 = cluster color, 1 = node's own color */
  colorMixRatio: number;
  /** Color desaturation: 0 = no desaturation, 1 = fully desaturated */
  colorDesaturation: number;
  /** Hover highlight configuration */
  hoverConfig: HoverHighlightConfig;
  /** Callback when a keyword is clicked */
  onKeywordClick?: (keyword: string) => void;
  /** Callback when a project node is clicked */
  onProjectClick?: (projectId: string) => void;
  /** Callback when zoom level changes */
  onZoomChange?: (zoomScale: number) => void;
  /** Which renderer to use: "d3" (SVG) or "three" (WebGL) */
  rendererType?: RendererType;
  /** External filter from project selection - keywords in this set are shown */
  externalFilter?: Set<string> | null;
  /** Search filter from semantic search - keywords in this set are shown */
  searchFilter?: Set<string> | null;
  /** Callback when user presses 'N' to create a project at cursor position */
  onCreateProject?: (worldPos: { x: number; y: number }, screenPos: { x: number; y: number }) => void;
  /** Callback when a project node is dragged to a new position */
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  /** Callback when an error occurs (e.g., cluster label generation fails) */
  onError?: (message: string) => void;
  /** Zoom phase configuration for semantic transitions */
  zoomPhaseConfig?: ZoomPhaseConfig;
  /** Whether blur layer is enabled (Three.js/R3F only) */
  blurEnabled?: boolean;
  /** Whether to show k-NN edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
  /** Z-depth offset for chunk nodes (negative = behind keywords) */
  contentZDepth?: number;
  /** Scale factor for converting panel thickness to chunk text depth offset */
  contentTextDepthScale?: number;
  /** Size multiplier for keyword nodes (default 1.0) */
  keywordSizeMultiplier?: number;
  /** Size multiplier for chunk/article nodes (default 1.5) */
  contentSizeMultiplier?: number;
  /** Text contrast for content labels: 0 = low contrast, 1 = high contrast */
  contentTextContrast?: number;
  /** Spring force strength for content node tethering (0.01-1.0, default 0.1) */
  contentSpringStrength?: number;
  /** Charge force strength for node repulsion (negative = repel, default -200) */
  chargeStrength?: number;
  /** Use unified simulation (keywords + content in single simulation) instead of separate simulations */
  unifiedSimulation?: boolean;
  /** Transmission panel roughness (0 = smooth, 1 = frosted) */
  panelRoughness?: number;
  /** Transmission panel transparency (0 = opaque, 1 = transparent) */
  panelTransmission?: number;
  /** Transmission panel anisotropic blur strength */
  panelAnisotropicBlur?: number;
  /** Transmission panel thickness multiplier (scales auto-computed value) */
  panelThicknessMultiplier?: number;
  /** Callback when cluster count changes */
  onClusterCountChange?: (count: number) => void;
  /** Callback when semantic filter state changes (for breadcrumb UI) */
  onSemanticFilterChange?: (filter: {
    semanticFilter: SemanticFilter | null;
    filterHistory: string[];
    keywordNodes: KeywordNode[];
    clearSemanticFilter: () => void;
    goBackInHistory: () => void;
    goToHistoryIndex: (index: number) => void;
  }) => void;
  /** Handler for chunk hover (passes ID and content for debug display) */
  onChunkHover?: (chunkId: string | null, content: string | null) => void;
  /** Handler for keyword hover (passes keyword ID for debug display) */
  onKeywordHover?: (keywordId: string | null) => void;
  /** Pre-fetched precomputed cluster data (avoids async fetch on first render) */
  initialPrecomputedData?: PrecomputedClusterData | null;
  /** Search query for semantic search highlighting */
  searchQuery?: string;
}

// ============================================================================
// Component
// ============================================================================

export function TopicsView({
  nodes: keywordNodes,
  edges,
  projectNodes = [],
  nodeType,
  knnStrength,
  contrast,
  clusterResolution,
  colorMixRatio,
  colorDesaturation,
  hoverConfig,
  onKeywordClick,
  onProjectClick,
  onZoomChange,
  rendererType = "d3",
  externalFilter,
  searchFilter,
  onCreateProject,
  onProjectDrag,
  onError,
  zoomPhaseConfig,
  blurEnabled = true,
  showKNNEdges = false,
  contentZDepth = -150,
  contentTextDepthScale = -15.0,
  keywordSizeMultiplier = 1.0,
  contentSizeMultiplier = 1.5,
  contentTextContrast = 0.7,
  contentSpringStrength = 0.1,
  chargeStrength = -200,
  unifiedSimulation = false,
  panelRoughness = 1.0,
  panelTransmission = 0.97,
  panelAnisotropicBlur = 5.0,
  panelThicknessMultiplier = 1.0,
  onClusterCountChange,
  onSemanticFilterChange,
  onChunkHover,
  onKeywordHover,
  initialPrecomputedData,
  searchQuery = "",
}: TopicsViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Camera Z tracking for scale interpolation
  const [cameraZ, setCameraZ] = useState<number | undefined>(undefined);

  // Focus mode state (click-to-focus pushes non-neighbors to margins)
  const [focusState, setFocusState] = useState<FocusState | null>(null);
  const focusEntryZRef = useRef<number | null>(null);

  // Calculate panel distance ratio automatically based on camera zoom level
  // This creates a fade effect: keywords blur out at medium distance, clear up when close
  const panelDistanceRatio = cameraZ !== undefined ? calculatePanelRatio(cameraZ) : 0.5;

  // Calculate panel material thickness (controls blur strength)
  // Thickness ramps from 0 (no blur) to 20 (full blur) as camera approaches threshold
  const panelThickness = (cameraZ !== undefined ? calculatePanelThickness(cameraZ) : 0) * panelThicknessMultiplier;

  // Client-side Leiden clustering (must come before useTopicsFilter)
  const { nodeToCluster, baseClusters, labels } = useClusterLabels(
    keywordNodes,
    edges,
    clusterResolution,
    { onError, nodeType, initialPrecomputedData }
  );

  // Report cluster count changes
  useEffect(() => {
    if (onClusterCountChange) {
      onClusterCountChange(baseClusters.size);
    }
  }, [baseClusters.size, onClusterCountChange]);

  // Filter state management (click-to-filter, external filter, position preservation)
  const {
    activeNodes,
    activeEdges,
    capturePositions,
    getSavedPosition,
    applyFilter,
    semanticFilter,
    keywordTiers,
    chunkKeywordIds,
    filterHistory,
    applySemanticFilter,
    applyClusterFilter,
    clearSemanticFilter,
    goBackInHistory,
    goToHistoryIndex,
  } = useTopicsFilter({
    keywordNodes,
    edges,
    externalFilter,
    searchFilter,
    clusters: baseClusters,
  });

  // Notify parent component when semantic filter state changes (for ControlSidebar)
  useEffect(() => {
    onSemanticFilterChange?.({
      semanticFilter,
      filterHistory,
      keywordNodes,
      clearSemanticFilter,
      goBackInHistory,
      goToHistoryIndex,
    });
  }, [semanticFilter, filterHistory, keywordNodes, clearSemanticFilter, goBackInHistory, goToHistoryIndex, onSemanticFilterChange]);

  // Search functionality
  const { keywordSimilarities, loading: searchLoading } = useTopicsSearch(searchQuery, nodeType);
  const { nodeOpacities } = useTopicsSearchOpacity({
    keywordNodes: activeNodes,
    keywordSimilarities,
    enabled: true,
  });

  // Chunk loading for visible keywords
  // If semantic filter active, only load chunks for selected + 1-hop
  // Stabilize the Set to prevent unnecessary refetches
  const visibleKeywordIds = useMemo(() => {
    if (chunkKeywordIds) {
      return chunkKeywordIds;
    }
    return new Set(activeNodes.map(n => n.id));
  }, [activeNodes, chunkKeywordIds]);

  const { contentsByKeyword, isLoading } = useContentLoading({
    visibleKeywordIds,
    enabled: true,
    nodeType, // Load articles in article mode, chunks in chunk mode
  });

  // Cursor tracking for project creation (press 'N' to create)
  const { isHoveringRef, cursorWorldPosRef, cursorScreenPosRef } = useProjectCreation({
    onCreateProject,
  });

  // Stable callbacks - won't trigger effect re-runs when parent re-renders
  const handleZoomChange = useStableCallback((zoomScale: number) => {
    if ((rendererType === "three" || rendererType === "r3f") && Number.isFinite(zoomScale) && zoomScale > 0) {
      const newCameraZ = CAMERA_Z_SCALE_BASE / zoomScale;
      setCameraZ(newCameraZ);

      // Exit focus when both rules agree:
      // 1) Absolute: past where keyword labels are fully faded (with margin)
      // 2) Relative: zoomed out >5% beyond where focus was entered
      if (focusState) {
        const absoluteLimit = (zoomPhaseConfig ?? DEFAULT_ZOOM_PHASE_CONFIG).keywordLabels.start * 1.3;
        const relativeLimit = (focusEntryZRef.current ?? 0) * 1.05;
        if (newCameraZ > absoluteLimit && newCameraZ > relativeLimit) {
          setFocusState(null);
          focusEntryZRef.current = null;
        }
      }
    }
    onZoomChange?.(zoomScale);
  });
  // Handle keyword click - apply semantic filter
  const handleKeywordClickInternal = useStableCallback((keyword: string) => {
    // Find keyword node by label
    const keywordNode = activeNodes.find(n => n.label === keyword);
    if (keywordNode) {
      // Save positions before applying filter
      // For R3F renderer, we'll need to access node positions
      // For now, create a simple position getter from activeNodes
      const getPosition = (id: string) => {
        const node = activeNodes.find(n => n.id === id);
        return node ? { x: 0, y: 0 } : undefined; // Positions will be captured from simulation
      };
      capturePositions(getPosition);

      // Apply semantic filter
      applySemanticFilter(keywordNode.id);
    }

    // Also call external handler if provided
    onKeywordClick?.(keyword);
  });

  // Handle keyword label click (same as node click)
  const handleKeywordLabelClick = useStableCallback((keywordId: string) => {
    // Find keyword by ID
    const keywordNode = activeNodes.find(n => n.id === keywordId);
    if (keywordNode) {
      handleKeywordClickInternal(keywordNode.label);
    }
  });

  // Handle cluster label click - apply cluster filter
  const handleClusterLabelClick = useStableCallback((clusterId: number) => {
    // Save positions before applying filter
    const getPosition = (id: string) => {
      const node = activeNodes.find(n => n.id === id);
      return node ? { x: 0, y: 0 } : undefined;
    };
    capturePositions(getPosition);

    // Apply cluster filter
    applyClusterFilter(clusterId);
  });

  // Handle focus click (R3F only) — toggle focus mode instead of filtering
  const handleFocusClick = useStableCallback((keywordId: string) => {
    // Toggle: clicking the already-focused keyword clears focus
    if (focusState?.focusedKeywordId === keywordId) {
      setFocusState(null);
      focusEntryZRef.current = null;
      return;
    }

    const newState = createFocusState(
      keywordId,
      activeNodes.map(n => n.id),
      activeEdges,
    );
    setFocusState(newState);
    focusEntryZRef.current = cameraZ ?? null;

    // Also call external handler with keyword label
    const node = activeNodes.find(n => n.id === keywordId);
    if (node) {
      onKeywordClick?.(node.label);
    }
  });

  // Background click clears focus mode
  const handleBackgroundClick = useStableCallback(() => {
    if (focusState) {
      setFocusState(null);
      focusEntryZRef.current = null;
    }
  });

  const handleProjectClick = useStableCallback(onProjectClick);
  const handleProjectDrag = useStableCallback(onProjectDrag);

  // Track if a project interaction just happened (to suppress click-to-filter)
  const projectInteractionRef = useRef(false);

  // Stable ref for projectNodes - avoids re-creating graph on position updates
  // This is shared between both renderers to avoid duplicating the ref pattern
  const projectNodesRef = useRef(projectNodes);
  projectNodesRef.current = projectNodes;

  // PCA transform for stable semantic colors
  const [pcaTransform, setPcaTransform] = useState<PCATransform | null>(null);

  // Load PCA transform once on mount
  useEffect(() => {
    loadPCATransform().then(setPcaTransform);
  }, []);

  // Click handler for drill-down filtering - needs refs from the active renderer
  const d3GetPosition = useRef<(id: string) => { x: number; y: number } | undefined>(() => undefined);
  const threeGetPosition = useRef<(id: string) => { x: number; y: number } | undefined>(() => undefined);

  const handleFilterClick = useStableCallback(() => {
    const getPosition =
      rendererType === "d3" ? d3GetPosition.current :
      rendererType === "three" ? threeGetPosition.current :
      r3fGetPosition.current;
    const highlightedIds =
      rendererType === "d3" ? d3RendererResult.highlightedIdsRef.current :
      rendererType === "three" ? threeRendererResult.highlightedIdsRef.current :
      r3fRendererResult.highlightedIdsRef.current;

    capturePositions(getPosition);
    applyFilter(highlightedIds);
  });

  // Shared renderer options
  const baseRendererOptions: BaseRendererOptions = {
    enabled: false, // overridden per-renderer
    activeNodes,
    activeEdges,
    projectNodesRef,
    colorMixRatio,
    hoverConfig,
    pcaTransform,
    getSavedPosition,
    contentZDepth,
    searchOpacities: nodeOpacities,
    onKeywordClick: handleKeywordClickInternal,
    onProjectClick: handleProjectClick,
    onProjectDrag: handleProjectDrag,
    onZoomChange: handleZoomChange,
    onFilterClick: handleFilterClick,
    onKeywordHover,
    isHoveringRef,
    cursorWorldPosRef,
    cursorScreenPosRef,
    projectInteractionRef,
  };

  // D3 renderer hook
  const d3RendererResult = useD3TopicsRenderer({
    ...baseRendererOptions,
    enabled: rendererType === "d3",
    svgRef,
    knnStrength,
    contrast,
  });

  // Three.js renderer hook
  const threeRendererResult = useThreeTopicsRenderer({
    ...baseRendererOptions,
    enabled: rendererType === "three",
    containerRef,
    chunksByKeyword: contentsByKeyword,
    cameraZ,
    zoomPhaseConfig,
  });

  // R3F renderer hook
  const r3fRendererResult = useR3FTopicsRenderer({
    ...baseRendererOptions,
    enabled: rendererType === "r3f",
    containerRef,
  });

  // Update position getter refs
  d3GetPosition.current = d3RendererResult.getNodePosition;
  threeGetPosition.current = threeRendererResult.getNodePosition;
  const r3fGetPosition = useRef<(id: string) => { x: number; y: number } | undefined>(() => undefined);
  r3fGetPosition.current = r3fRendererResult.getNodePosition;

  // Update cluster assignments when clustering changes (without restarting simulation)
  useEffect(() => {
    // Handle D3 renderer
    if (rendererType === "d3" && d3RendererResult.simulationNodesRef.current.length > 0 && d3RendererResult.rendererRef.current) {
      const hubToCluster = new Map<string, { clusterId: number; hub: string }>();
      for (const [clusterId, cluster] of baseClusters) {
        hubToCluster.set(cluster.hub, { clusterId, hub: cluster.hub });
      }

      for (const node of d3RendererResult.simulationNodesRef.current) {
        node.communityId = nodeToCluster.get(node.id);

        const clusterInfo = hubToCluster.get(node.label);
        if (clusterInfo) {
          const cluster = baseClusters.get(clusterInfo.clusterId);
          node.communityMembers = cluster ? [node.label] : undefined;
          node.hullLabel = labels[clusterInfo.clusterId] || clusterInfo.hub;
        } else {
          node.communityMembers = undefined;
          node.hullLabel = undefined;
        }
      }

      d3RendererResult.rendererRef.current.refreshClusters();
      d3RendererResult.rendererRef.current.tick();
    }

    // Handle Three.js renderer
    if (rendererType === "three" && threeRendererResult.threeRendererRef.current) {
      const hubToCluster = new Map<string, { clusterId: number; hub: string }>();
      for (const [clusterId, cluster] of baseClusters) {
        hubToCluster.set(cluster.hub, { clusterId, hub: cluster.hub });
      }

      const threeNodeToCluster = new Map<string, number>();
      for (const node of keywordNodes) {
        const clusterId = nodeToCluster.get(node.id);
        if (clusterId !== undefined) {
          threeNodeToCluster.set(`kw:${node.label}`, clusterId);
        }
      }
      threeRendererResult.threeRendererRef.current.updateClusters(threeNodeToCluster);

      // Update hullLabel and communityMembers on Three.js nodes (for label rendering)
      const threeNodes = threeRendererResult.threeRendererRef.current.getNodes();
      for (const node of threeNodes) {
        if (node.type !== "keyword") continue;
        const clusterInfo = hubToCluster.get(node.label);
        if (clusterInfo) {
          const cluster = baseClusters.get(clusterInfo.clusterId);
          node.communityMembers = cluster ? [node.label] : undefined;
          node.hullLabel = labels[clusterInfo.clusterId] || clusterInfo.hub;
        } else {
          node.communityMembers = undefined;
          node.hullLabel = undefined;
        }
      }

      // Update cluster labels after setting hullLabel
      threeRendererResult.threeRendererRef.current.updateClusterLabels();
    }

    // Handle R3F renderer
    if (rendererType === "r3f" && r3fRendererResult.labelsRef.current) {
      const hubToCluster = new Map<string, { clusterId: number; hub: string }>();
      for (const [clusterId, cluster] of baseClusters) {
        hubToCluster.set(cluster.hub, { clusterId, hub: cluster.hub });
      }

      // Update communityId, hullLabel and communityMembers on R3F nodes (for label rendering)
      const r3fNodes = r3fRendererResult.labelsRef.current.getNodes();
      for (const node of r3fNodes) {
        if (node.type !== "keyword") continue;

        // Update communityId from nodeToCluster map
        node.communityId = nodeToCluster.get(node.id);

        const clusterInfo = hubToCluster.get(node.label);
        if (clusterInfo) {
          const cluster = baseClusters.get(clusterInfo.clusterId);
          node.communityMembers = cluster ? [node.label] : undefined;
          node.hullLabel = labels[clusterInfo.clusterId] || clusterInfo.hub;
        } else {
          node.communityMembers = undefined;
          node.hullLabel = undefined;
        }
      }

    }
  }, [nodeToCluster, baseClusters, labels, rendererType, keywordNodes, d3RendererResult.simulationNodesRef, d3RendererResult.rendererRef, threeRendererResult.threeRendererRef, r3fRendererResult.labelsRef]);

  // Update colors when colorMixRatio changes (without relayout) - D3 only
  useEffect(() => {
    if (!d3RendererResult.rendererRef.current || !d3RendererResult.immediateParamsRef.current) return;

    d3RendererResult.immediateParamsRef.current.current.colorMixRatio = colorMixRatio;
    d3RendererResult.rendererRef.current.updateVisuals();
  }, [colorMixRatio, d3RendererResult.rendererRef, d3RendererResult.immediateParamsRef]);

  if (rendererType === "r3f") {
    return (
      <div className="w-full h-full relative">
        <R3FTopicsCanvas
          ref={r3fRendererResult.labelsRef}
          nodes={activeNodes}
          totalKeywordCount={keywordNodes.length}
          edges={activeEdges}
          projectNodes={projectNodes}
          contentsByKeyword={contentsByKeyword}
          colorMixRatio={colorMixRatio}
          colorDesaturation={colorDesaturation}
          pcaTransform={pcaTransform}
          blurEnabled={blurEnabled}
          showKNNEdges={showKNNEdges}
          panelDistanceRatio={panelDistanceRatio}
          panelThickness={panelThickness}
          zoomPhaseConfig={zoomPhaseConfig ?? DEFAULT_ZOOM_PHASE_CONFIG}
          contentZDepth={contentZDepth}
          contentTextDepthScale={contentTextDepthScale}
          keywordSizeMultiplier={keywordSizeMultiplier}
          contentSizeMultiplier={contentSizeMultiplier}
          contentTextContrast={contentTextContrast}
          contentSpringStrength={contentSpringStrength}
          chargeStrength={chargeStrength}
          unifiedSimulation={unifiedSimulation}
          panelRoughness={panelRoughness}
          panelTransmission={panelTransmission}
          panelAnisotropicBlur={panelAnisotropicBlur}
          keywordTiers={focusState ? focusState.keywordTiers : keywordTiers}
          focusState={focusState}
          nodeToCluster={nodeToCluster}
          searchOpacities={nodeOpacities}
          cameraZ={cameraZ}
          onKeywordClick={handleFocusClick}
          onKeywordLabelClick={handleFocusClick}
          onClusterLabelClick={handleClusterLabelClick}
          onBackgroundClick={handleBackgroundClick}
          onProjectClick={handleProjectClick}
          onProjectDrag={handleProjectDrag}
          onZoomChange={handleZoomChange}
          onChunkHover={onChunkHover}
          onKeywordHover={onKeywordHover ?? (() => {})}
        />
        {isLoading && (
          <div className="absolute top-4 right-4 px-3 py-2 bg-black/70 text-white text-sm rounded-md">
            Loading chunks...
          </div>
        )}
      </div>
    );
  }

  if (rendererType === "three") {
    return (
      <div className="w-full h-full relative">
        <div
          ref={containerRef}
          className="w-full h-full cursor-grab"
        />
        {isLoading && (
          <div className="absolute top-4 right-4 px-3 py-2 bg-black/70 text-white text-sm rounded-md">
            Loading chunks...
          </div>
        )}
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      className="w-full h-full cursor-grab"
    />
  );
}
