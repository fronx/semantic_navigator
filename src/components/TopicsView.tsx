"use client";

import { useEffect, useRef, useState } from "react";
import { type HoverHighlightConfig } from "@/hooks/useGraphHoverHighlight";
import { useClusterLabels } from "@/hooks/useClusterLabels";
import { useStableCallback } from "@/hooks/useStableRef";
import { useTopicsFilter } from "@/hooks/useTopicsFilter";
import { useProjectCreation } from "@/hooks/useProjectCreation";
import { useD3TopicsRenderer } from "@/hooks/useD3TopicsRenderer";
import { useThreeTopicsRenderer } from "@/hooks/useThreeTopicsRenderer";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import { loadPCATransform, type PCATransform } from "@/lib/semantic-colors";
import type { BaseRendererOptions } from "@/lib/renderer-types";

// ============================================================================
// Types
// ============================================================================

export type RendererType = "d3" | "three";

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
}: TopicsViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Cursor tracking for project creation (press 'N' to create)
  const { isHoveringRef, cursorWorldPosRef, cursorScreenPosRef } = useProjectCreation({
    onCreateProject,
  });

  // Stable callbacks - won't trigger effect re-runs when parent re-renders
  const handleZoomChange = useStableCallback(onZoomChange);
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
  const { nodeToCluster, baseClusters, labels } = useClusterLabels(keywordNodes, edges, clusterResolution);

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
    const getPosition = rendererType === "d3" ? d3GetPosition.current : threeGetPosition.current;
    const highlightedIds = rendererType === "d3"
      ? d3RendererResult.highlightedIdsRef.current
      : threeRendererResult.highlightedIdsRef.current;

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
  });

  // Update position getter refs
  d3GetPosition.current = d3RendererResult.getNodePosition;
  threeGetPosition.current = threeRendererResult.getNodePosition;

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

  if (rendererType === "three") {
    return (
      <div
        ref={containerRef}
        className="w-full h-full cursor-grab"
      />
    );
  }

  return (
    <svg
      ref={svgRef}
      className="w-full h-full cursor-grab"
    />
  );
}
