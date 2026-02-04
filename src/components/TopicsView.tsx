"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type HoverHighlightConfig } from "@/hooks/useGraphHoverHighlight";
import { useClusterLabels } from "@/hooks/useClusterLabels";
import { useStableCallback } from "@/hooks/useStableRef";
import { useTopicsFilter } from "@/hooks/useTopicsFilter";
import { useProjectCreation } from "@/hooks/useProjectCreation";
import { useD3TopicsRenderer } from "@/hooks/useD3TopicsRenderer";
import { useThreeTopicsRenderer } from "@/hooks/useThreeTopicsRenderer";
import { useR3FTopicsRenderer } from "@/hooks/useR3FTopicsRenderer";
import { useChunkLoading } from "@/hooks/useChunkLoading";
import { R3FTopicsCanvas } from "@/components/topics-r3f/R3FTopicsCanvas";
import { createChunkNodes, applyConstrainedForces } from "@/lib/chunk-layout";
import { convertToThreeNodes } from "@/lib/topics-graph-nodes";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import { loadPCATransform, type PCATransform } from "@/lib/semantic-colors";
import type { BaseRendererOptions } from "@/lib/renderer-types";
import type { SimNode } from "@/lib/map-renderer";
import { CAMERA_Z_SCALE_BASE } from "@/lib/three/camera-controller";
import type { ZoomPhaseConfig } from "@/lib/zoom-phase-config";
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
  /** k-NN edge strength multiplier */
  knnStrength: number;
  /** Contrast exponent for similarity-based layout */
  contrast: number;
  /** Louvain resolution for client-side clustering (higher = more clusters) */
  clusterResolution: number;
  /** Color mix ratio: 0 = cluster color, 1 = node's own color */
  colorMixRatio: number;
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
  /** Callback when user presses 'N' to create a project at cursor position */
  onCreateProject?: (worldPos: { x: number; y: number }, screenPos: { x: number; y: number }) => void;
  /** Callback when a project node is dragged to a new position */
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  /** Callback when an error occurs (e.g., cluster label generation fails) */
  onError?: (message: string) => void;
  /** Zoom phase configuration for semantic transitions */
  zoomPhaseConfig?: ZoomPhaseConfig;
}

// ============================================================================
// Component
// ============================================================================

export function TopicsView({
  nodes: keywordNodes,
  edges,
  projectNodes = [],
  knnStrength,
  contrast,
  clusterResolution,
  colorMixRatio,
  hoverConfig,
  onKeywordClick,
  onProjectClick,
  onZoomChange,
  rendererType = "d3",
  externalFilter,
  onCreateProject,
  onProjectDrag,
  onError,
  zoomPhaseConfig,
}: TopicsViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Camera Z tracking for scale interpolation
  const [cameraZ, setCameraZ] = useState<number | undefined>(undefined);

  // Blur layer toggle for debugging
  const [blurEnabled, setBlurEnabled] = useState(true);

  // Calculate panel distance ratio automatically based on camera zoom level
  // This creates a fade effect: keywords blur out at medium distance, clear up when close
  const panelDistanceRatio = cameraZ !== undefined ? calculatePanelRatio(cameraZ) : 0.5;

  // Calculate panel material thickness (controls blur strength)
  // Thickness ramps from 0 (no blur) to 20 (full blur) as camera approaches threshold
  const panelThickness = cameraZ !== undefined ? calculatePanelThickness(cameraZ) : 0;

  // Calculate absolute panel Z position for debug display
  // panel.z = camera.z * ratio (0% = at keywords z=0, 100% = at camera)
  const panelZ = cameraZ !== undefined ? cameraZ * panelDistanceRatio : undefined;

  // UI panel collapse state
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  // Filter state management (click-to-filter, external filter, position preservation)
  const {
    activeNodes,
    activeEdges,
    capturePositions,
    getSavedPosition,
    applyFilter,
  } = useTopicsFilter({
    keywordNodes,
    edges,
    externalFilter,
  });

  // Chunk loading for visible keywords
  // Stabilize the Set to prevent unnecessary refetches
  const visibleKeywordIds = useMemo(
    () => new Set(activeNodes.map(n => n.id)),
    [activeNodes]
  );

  const { chunksByKeyword, isLoading } = useChunkLoading({
    visibleKeywordIds,
    enabled: true,
  });

  // Cursor tracking for project creation (press 'N' to create)
  const { isHoveringRef, cursorWorldPosRef, cursorScreenPosRef } = useProjectCreation({
    onCreateProject,
  });

  // Stable callbacks - won't trigger effect re-runs when parent re-renders
  const handleZoomChange = useStableCallback((zoomScale: number) => {
    if ((rendererType === "three" || rendererType === "r3f") && Number.isFinite(zoomScale) && zoomScale > 0) {
      setCameraZ(CAMERA_Z_SCALE_BASE / zoomScale);
    }
    onZoomChange?.(zoomScale);
  });
  const handleKeywordClick = useStableCallback(onKeywordClick);
  const handleProjectClick = useStableCallback(onProjectClick);
  const handleProjectDrag = useStableCallback(onProjectDrag);

  // Track if a project interaction just happened (to suppress click-to-filter)
  const projectInteractionRef = useRef(false);

  // Stable ref for projectNodes - avoids re-creating graph on position updates
  // This is shared between both renderers to avoid duplicating the ref pattern
  const projectNodesRef = useRef(projectNodes);
  projectNodesRef.current = projectNodes;

  // Client-side Louvain clustering
  const { nodeToCluster, baseClusters, labels } = useClusterLabels(
    keywordNodes,
    edges,
    clusterResolution,
    { onError }
  );

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
    onKeywordClick: handleKeywordClick,
    onProjectClick: handleProjectClick,
    onProjectDrag: handleProjectDrag,
    onZoomChange: handleZoomChange,
    onFilterClick: handleFilterClick,
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
    chunksByKeyword,
    cameraZ,
    zoomPhaseConfig,
    blurEnabled,
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
  }, [nodeToCluster, baseClusters, labels, rendererType, keywordNodes, d3RendererResult.simulationNodesRef, d3RendererResult.rendererRef, threeRendererResult.threeRendererRef]);

  // Update colors when colorMixRatio changes (without relayout) - D3 only
  useEffect(() => {
    if (!d3RendererResult.rendererRef.current || !d3RendererResult.immediateParamsRef.current) return;

    d3RendererResult.immediateParamsRef.current.current.colorMixRatio = colorMixRatio;
    d3RendererResult.rendererRef.current.updateVisuals();
  }, [colorMixRatio, d3RendererResult.rendererRef, d3RendererResult.immediateParamsRef]);

  // Create chunk nodes for R3F renderer (similar to Three.js renderer)
  const r3fChunkNodes = useMemo((): SimNode[] => {
    if (rendererType !== "r3f" || !chunksByKeyword || chunksByKeyword.size === 0) {
      return [];
    }

    // Convert keyword nodes to SimNodes (we need positions for chunk layout)
    const { mapNodes } = convertToThreeNodes({
      keywordNodes: activeNodes,
      edges: activeEdges,
      projectNodes: projectNodesRef.current,
      width: 1000,
      height: 1000,
      getSavedPosition: () => undefined,
    });

    const keywordSimNodes = mapNodes.filter(n => n.type === "keyword");
    const { chunkNodes } = createChunkNodes(keywordSimNodes, chunksByKeyword);

    // Apply constrained forces to position chunks around keywords
    const keywordMap = new Map<string, SimNode>(keywordSimNodes.map(n => [n.id, n]));
    const keywordRadius = 5;
    applyConstrainedForces(chunkNodes, keywordMap, keywordRadius);

    return chunkNodes;
  }, [rendererType, activeNodes, activeEdges, chunksByKeyword, projectNodesRef]);

  if (rendererType === "r3f") {
    return (
      <div className="w-full h-full relative">
        <R3FTopicsCanvas
          nodes={activeNodes}
          edges={activeEdges}
          projectNodes={projectNodes}
          chunkNodes={r3fChunkNodes}
          colorMixRatio={colorMixRatio}
          pcaTransform={pcaTransform}
          blurEnabled={blurEnabled}
          panelDistanceRatio={panelDistanceRatio}
          panelThickness={panelThickness}
          onKeywordClick={handleKeywordClick}
          onProjectClick={handleProjectClick}
          onProjectDrag={handleProjectDrag}
          onZoomChange={handleZoomChange}
        />
        {isLoading && (
          <div className="absolute top-4 right-4 px-3 py-2 bg-black/70 text-white text-sm rounded-md">
            Loading chunks...
          </div>
        )}
        <div className="absolute top-4 left-4 bg-white/90 dark:bg-black/70 text-black dark:text-white text-sm rounded-md shadow-lg">
          <button
            onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
            className="w-full px-3 py-2 text-left font-medium hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between"
          >
            <span>Controls</span>
            <span className="text-xs">{isPanelCollapsed ? "▼" : "▲"}</span>
          </button>
          {!isPanelCollapsed && (
            <div className="px-3 pb-2 pt-1 space-y-3 border-t border-black/10 dark:border-white/10">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={blurEnabled}
                  onChange={(e) => setBlurEnabled(e.target.checked)}
                  className="cursor-pointer"
                />
                <span>Enable blur layer</span>
              </label>
              <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-1">
                <div className="text-xs font-mono">
                  Camera Z: {cameraZ !== undefined ? cameraZ.toFixed(0) : "—"}
                </div>
                <div className="text-xs font-mono">
                  Panel ratio: {(panelDistanceRatio * 100).toFixed(0)}%
                </div>
                <div className="text-xs font-mono">
                  Panel Z: {panelZ !== undefined ? panelZ.toFixed(0) : "—"}
                </div>
                <div className="text-xs font-mono">
                  Panel thickness: {panelThickness.toFixed(1)}
                </div>
              </div>
            </div>
          )}
        </div>
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
        <div className="absolute top-4 left-4 bg-white/90 dark:bg-black/70 text-black dark:text-white text-sm rounded-md shadow-lg">
          <button
            onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
            className="w-full px-3 py-2 text-left font-medium hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between"
          >
            <span>Controls</span>
            <span className="text-xs">{isPanelCollapsed ? "▼" : "▲"}</span>
          </button>
          {!isPanelCollapsed && (
            <div className="px-3 pb-2 pt-1 border-t border-black/10 dark:border-white/10">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={blurEnabled}
                  onChange={(e) => setBlurEnabled(e.target.checked)}
                  className="cursor-pointer"
                />
                <span>Enable blur layer</span>
              </label>
            </div>
          )}
        </div>
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
