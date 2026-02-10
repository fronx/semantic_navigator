"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type HoverHighlightConfig } from "@/hooks/useGraphHoverHighlight";
import { useClusterLabels, type PrecomputedClusterData } from "@/hooks/useClusterLabels";
import { useStableCallback } from "@/hooks/useStableRef";
import { useTopicsFilter } from "@/hooks/useTopicsFilter";
import { useProjectCreation } from "@/hooks/useProjectCreation";
import { useD3TopicsRenderer } from "@/hooks/useD3TopicsRenderer";
import { useR3FTopicsRenderer } from "@/hooks/useR3FTopicsRenderer";
import { useContentLoading } from "@/hooks/useContentLoading";
import { R3FTopicsCanvas } from "@/components/topics-r3f/R3FTopicsCanvas";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import { loadPCATransform, type PCATransform } from "@/lib/semantic-colors";
import { calculateDegreeSizeMultiplier } from "@/lib/topics-graph-nodes";
import type { SemanticFilter } from "@/lib/topics-filter";
import { createFocusState, createContentAwareFocusState, createFocusStateFromSet, type FocusState } from "@/lib/focus-mode";
import { computeVisibleKeywordIds } from "@/lib/focus-mode-content-filter";
import type { BaseRendererOptions } from "@/lib/renderer-types";
import type { SimNode } from "@/lib/map-renderer";
import { CAMERA_Z_SCALE_BASE } from "@/lib/rendering-utils/camera-controller";
import { DEFAULT_ZOOM_PHASE_CONFIG, type ZoomPhaseConfig } from "@/lib/zoom-phase-config";
import { calculatePanelRatio, calculatePanelThickness } from "@/lib/transmission-panel-config";

// ============================================================================
// Types
// ============================================================================

export type RendererType = "d3" | "r3f";

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
  /** Cluster label desaturation: 0 = no desaturation, 1 = fully desaturated (inverse of keyword desaturation) */
  clusterLabelDesaturation?: number;
  /** Hover highlight configuration */
  hoverConfig: HoverHighlightConfig;
  /** Callback when a keyword is clicked */
  onKeywordClick?: (keyword: string) => void;
  /** Callback when a project node is clicked */
  onProjectClick?: (projectId: string) => void;
  /** Callback when zoom level changes */
  onZoomChange?: (zoomScale: number) => void;
  /** Which renderer to use: "d3" (SVG) or "r3f" (React Three Fiber WebGL) */
  rendererType?: RendererType;
  /** External filter from project selection - keywords in this set are shown */
  externalFilter?: Set<string> | null;
  /** External focus request: if provided, these keywords will be focused (like clicking them) */
  focusKeywordIds?: Set<string> | null;
  /** Callback when user presses 'N' to create a project at cursor position */
  onCreateProject?: (worldPos: { x: number; y: number }, screenPos: { x: number; y: number }) => void;
  /** Callback when a project node is dragged to a new position */
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  /** Callback when an error occurs (e.g., cluster label generation fails) */
  onError?: (message: string) => void;
  /** Zoom phase configuration for semantic transitions */
  zoomPhaseConfig?: ZoomPhaseConfig;
  /** Whether blur layer is enabled (R3F only) */
  blurEnabled?: boolean;
  /** Whether to show k-NN edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
  /** Z-depth offset for chunk nodes (negative = behind keywords) */
  contentZDepth?: number;
  /** Scale factor for converting panel thickness to chunk text depth offset */
  contentTextDepthScale?: number;
  /** Size multiplier for keyword nodes (default 1.0) */
  keywordSizeMultiplier?: number;
  /** Enable degree-based node sizing (default true) */
  scaleNodesByDegree?: boolean;
  /** Minimum size multiplier for degree-based sizing (default 0.5) */
  degreeSizeMin?: number;
  /** Maximum size multiplier for degree-based sizing (default 2.0) */
  degreeSizeMax?: number;
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
  /** Cluster label shadow strength (0 = no shadow, 2 = extra strong) */
  clusterLabelShadowStrength?: number;
  /** Use semantically-matched fonts for cluster labels */
  useSemanticFontsForClusters?: boolean;
  /** Use semantically-matched fonts for keyword labels */
  useSemanticFontsForKeywords?: boolean;
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
  /** Focus mode strategy: 'direct' uses keyword-keyword edges, 'content-aware' hops through content nodes */
  focusStrategy?: 'direct' | 'content-aware';
  /** Maximum number of hops in focus mode (1-3) */
  focusMaxHops?: number;
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
  clusterLabelDesaturation = 0,
  hoverConfig,
  onKeywordClick,
  onProjectClick,
  onZoomChange,
  rendererType = "d3",
  externalFilter,
  focusKeywordIds,
  onCreateProject,
  onProjectDrag,
  onError,
  zoomPhaseConfig,
  blurEnabled = true,
  showKNNEdges = false,
  contentZDepth = -150,
  contentTextDepthScale = -15.0,
  keywordSizeMultiplier = 1.0,
  scaleNodesByDegree = true,
  degreeSizeMin = 0.5,
  degreeSizeMax = 2.0,
  contentSizeMultiplier = 1.5,
  contentTextContrast = 0.7,
  contentSpringStrength = 0.1,
  chargeStrength = -200,
  unifiedSimulation = false,
  panelRoughness = 1.0,
  panelTransmission = 0.97,
  panelAnisotropicBlur = 5.0,
  panelThicknessMultiplier = 1.0,
  clusterLabelShadowStrength = 0.8,
  useSemanticFontsForClusters = true,
  useSemanticFontsForKeywords = true,
  onClusterCountChange,
  onSemanticFilterChange,
  onChunkHover,
  onKeywordHover,
  initialPrecomputedData,
  focusStrategy = 'direct',
  focusMaxHops = 3,
}: TopicsViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Camera Z tracking for scale interpolation
  const [cameraZ, setCameraZ] = useState<number | undefined>(undefined);

  // Focus mode state (click-to-focus pushes non-neighbors to margins)
  const [focusState, setFocusState] = useState<FocusState | null>(null);
  const focusEntryZRef = useRef<number | null>(null);

  // External focus trigger: when focusKeywordIds changes, update focus state
  // undefined = no change, null or empty Set = clear, non-empty Set = apply
  useEffect(() => {
    if (focusKeywordIds == null || focusKeywordIds.size === 0) {
      if (focusKeywordIds !== undefined) {
        setFocusState(null);
        focusEntryZRef.current = null;
      }
      return;
    }
    const allNodeIds = keywordNodes.map(n => n.id);
    setFocusState(createFocusStateFromSet(focusKeywordIds, allNodeIds, edges, focusMaxHops));
    // Capture camera Z only when first entering focus, not on every zoom
    // Note: cameraZ intentionally not in deps - we want to capture it at entry time only,
    // not update the entry reference on every zoom (which would break exit detection)
    focusEntryZRef.current = cameraZ ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKeywordIds, keywordNodes, edges, focusMaxHops]);

  // Calculate panel distance ratio automatically based on camera zoom level
  // This creates a fade effect: keywords blur out at medium distance, clear up when close
  const panelDistanceRatio = cameraZ !== undefined ? calculatePanelRatio(cameraZ) : 0.5;

  // Calculate panel material thickness (controls blur strength)
  // Thickness ramps from 0 (no blur) to 20 (full blur) as camera approaches threshold
  const panelThickness = (cameraZ !== undefined ? calculatePanelThickness(cameraZ) : 0) * panelThicknessMultiplier;

  // Calculate size multipliers based on node degree (number of connections)
  const nodeSizeMultipliers = useMemo(() => {
    // Only calculate if degree-based sizing is enabled
    if (!scaleNodesByDegree) return undefined;

    // Find max degree across all nodes
    const maxDegree = Math.max(...keywordNodes.map(n => n.degree ?? 0), 1);

    // Map each node to its size multiplier
    const multipliers = new Map<string, number>();
    for (const node of keywordNodes) {
      const multiplier = calculateDegreeSizeMultiplier(
        node.degree ?? 0,
        maxDegree,
        degreeSizeMin,
        degreeSizeMax
      );
      multipliers.set(node.id, multiplier);
    }
    return multipliers;
  }, [keywordNodes, scaleNodesByDegree, degreeSizeMin, degreeSizeMax]);

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

  // Chunk loading for visible keywords
  // If semantic filter active, only load chunks for selected + 1-hop
  // If focus mode active, only load chunks for focused + neighbors
  // Stabilize the Set to prevent unnecessary refetches
  const visibleKeywordIds = useMemo(() => {
    return computeVisibleKeywordIds(activeNodes, chunkKeywordIds, focusState);
  }, [activeNodes, chunkKeywordIds, focusState]);

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
    if (rendererType === "r3f" && Number.isFinite(zoomScale) && zoomScale > 0) {
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

  // Compute focus state for a given keyword using the current strategy
  function computeFocusForKeyword(keywordId: string): FocusState {
    const allNodeIds = activeNodes.map(n => n.id);
    if (focusStrategy === 'content-aware') {
      return createContentAwareFocusState(keywordId, allNodeIds, contentsByKeyword, focusMaxHops);
    }
    return createFocusState(keywordId, allNodeIds, activeEdges, focusMaxHops);
  }

  // Handle focus click (R3F only) -- toggle focus mode instead of filtering
  const handleFocusClick = useStableCallback((keywordId: string) => {
    // Toggle: clicking the already-focused keyword clears focus
    if (focusState?.focusedKeywordId === keywordId) {
      setFocusState(null);
      focusEntryZRef.current = null;
      return;
    }

    setFocusState(computeFocusForKeyword(keywordId));
    focusEntryZRef.current = cameraZ ?? null;

    const node = activeNodes.find(n => n.id === keywordId);
    if (node) onKeywordClick?.(node.label);
  });

  // Recompute focus state when strategy or max hops changes (while focus is active)
  // Note: focusState is intentionally not in deps to avoid infinite loop and
  // unnecessary recomputation when clicking keywords (which updates focusState directly)
  useEffect(() => {
    if (!focusState) return;
    setFocusState(computeFocusForKeyword(focusState.focusedKeywordId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusStrategy, focusMaxHops, activeNodes, activeEdges, contentsByKeyword]);

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
  const r3fGetPosition = useRef<(id: string) => { x: number; y: number } | undefined>(() => undefined);

  const handleFilterClick = useStableCallback(() => {
    const getPosition = rendererType === "d3" ? d3GetPosition.current : r3fGetPosition.current;
    const highlightedIds = rendererType === "d3" ? d3RendererResult.highlightedIdsRef.current : r3fRendererResult.highlightedIdsRef.current;

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
    searchOpacities: undefined,
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

  // R3F renderer hook
  const r3fRendererResult = useR3FTopicsRenderer({
    ...baseRendererOptions,
    enabled: rendererType === "r3f",
    containerRef,
  });

  // Update position getter refs
  d3GetPosition.current = d3RendererResult.getNodePosition;
  r3fGetPosition.current = r3fRendererResult.getNodePosition;

  // Update cluster assignments when clustering changes (without restarting simulation)
  useEffect(() => {
    // Build hub-to-cluster lookup (shared by both renderers)
    const hubToCluster = new Map<string, number>();
    for (const [clusterId, cluster] of baseClusters) {
      hubToCluster.set(cluster.hub, clusterId);
    }

    function assignClusterFields(node: SimNode): void {
      node.communityId = nodeToCluster.get(node.id);
      const clusterId = hubToCluster.get(node.label);
      if (clusterId !== undefined) {
        node.communityMembers = baseClusters.has(clusterId) ? [node.label] : undefined;
        node.hullLabel = labels[clusterId] || baseClusters.get(clusterId)!.hub;
      } else {
        node.communityMembers = undefined;
        node.hullLabel = undefined;
      }
    }

    // Handle D3 renderer
    if (rendererType === "d3" && d3RendererResult.simulationNodesRef.current.length > 0 && d3RendererResult.rendererRef.current) {
      for (const node of d3RendererResult.simulationNodesRef.current) {
        assignClusterFields(node);
      }
      d3RendererResult.rendererRef.current.refreshClusters();
      d3RendererResult.rendererRef.current.tick();
    }

    // Handle R3F renderer
    if (rendererType === "r3f" && r3fRendererResult.labelsRef.current) {
      for (const node of r3fRendererResult.labelsRef.current.getNodes()) {
        if (node.type !== "keyword") continue;
        assignClusterFields(node);
      }
    }
  }, [nodeToCluster, baseClusters, labels, rendererType, keywordNodes, d3RendererResult.simulationNodesRef, d3RendererResult.rendererRef, r3fRendererResult.labelsRef]);

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
          clusterLabelDesaturation={clusterLabelDesaturation}
          pcaTransform={pcaTransform}
          blurEnabled={blurEnabled}
          showKNNEdges={showKNNEdges}
          panelDistanceRatio={panelDistanceRatio}
          panelThickness={panelThickness}
          zoomPhaseConfig={zoomPhaseConfig ?? DEFAULT_ZOOM_PHASE_CONFIG}
          contentZDepth={contentZDepth}
          contentTextDepthScale={contentTextDepthScale}
          keywordSizeMultiplier={keywordSizeMultiplier}
          nodeSizeMultipliers={nodeSizeMultipliers}
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
          searchOpacities={undefined}
          cameraZ={cameraZ}
          clusterLabelShadowStrength={clusterLabelShadowStrength}
          useSemanticFontsForClusters={useSemanticFontsForClusters}
          useSemanticFontsForKeywords={useSemanticFontsForKeywords}
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

  return (
    <svg
      ref={svgRef}
      className="w-full h-full cursor-grab"
    />
  );
}
