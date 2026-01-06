"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import {
  createRenderer,
  addDragBehavior,
  type SimNode,
  type SimLink,
} from "@/lib/map-renderer";
import { createForceSimulation, type ForceLink, type ForceNode } from "@/lib/map-layout";
import { forceBoundary } from "@/lib/d3-forces";
import { applyContrast } from "@/lib/math-utils";
import {
  spatialSemanticFilter,
  buildAdjacencyMap,
  buildEmbeddingMap,
} from "@/lib/spatial-semantic";
import {
  DEFAULT_HOVER_CONFIG,
  type HoverHighlightConfig,
} from "@/hooks/useGraphHoverHighlight";
import { useClusterLabels } from "@/hooks/useClusterLabels";
import { useLatest, useStableCallback } from "@/hooks/useStableRef";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";
import { loadPCATransform, type PCATransform } from "@/lib/semantic-colors";

// ============================================================================
// Types
// ============================================================================

export interface TopicsViewProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
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
  /** Callback when zoom level changes */
  onZoomChange?: (zoomScale: number) => void;
}

// ============================================================================
// Component
// ============================================================================

export function TopicsView({
  nodes: keywordNodes,
  edges,
  knnStrength,
  contrast,
  clusterResolution,
  colorMixRatio,
  hoverConfig,
  onKeywordClick,
  onZoomChange,
}: TopicsViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Stable callbacks - won't trigger effect re-runs when parent re-renders
  const handleZoomChange = useStableCallback(onZoomChange);
  const handleKeywordClick = useStableCallback(onKeywordClick);

  // Stable refs for values accessed in event handlers without triggering re-renders
  const hoverConfigRef = useLatest(hoverConfig);

  // Client-side Louvain clustering
  // baseClusters is stable (only changes when nodes/edges/resolution change)
  // labels changes when semantic labels arrive from Haiku
  const { nodeToCluster, baseClusters, labels } = useClusterLabels(keywordNodes, edges, clusterResolution);

  // Store simulation nodes for cluster updates without restarting simulation
  const simulationNodesRef = useRef<Array<{ id: string; hullLabel?: string; label: string; communityId?: number; communityMembers?: string[] }>>([]);

  // Store renderer for cluster update effect
  const rendererRef = useRef<ReturnType<typeof createRenderer> | null>(null);

  // Store immediateParams for live updates without relayout
  const immediateParamsRef = useRef<{ current: { colorMixRatio: number } } | null>(null);

  // PCA transform for stable semantic colors
  const [pcaTransform, setPcaTransform] = useState<PCATransform | null>(null);

  // Load PCA transform once on mount
  useEffect(() => {
    loadPCATransform().then(setPcaTransform);
  }, []);

  // Main rendering effect
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = svgRef.current;
    const width = svg.clientWidth;
    const height = svg.clientHeight;

    // Convert to format expected by renderer
    // Cluster data is added via refs (not dependencies) to avoid relayout
    // Actual cluster assignments are applied by the cluster update effect
    const mapNodes = keywordNodes.map((n) => ({
      id: n.id,
      type: "keyword" as const,
      label: n.label,
      communityId: undefined as number | undefined,
      embedding: n.embedding,
      communityMembers: undefined as string[] | undefined,
      hullLabel: undefined as string | undefined,
    }));

    const mapEdges = edges.map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
      isKNN: e.isKNN,
    }));

    // Create force simulation (note: this creates COPIES of nodes)
    const { simulation, nodes, links } = createForceSimulation(
      mapNodes,
      mapEdges,
      width,
      height
    );

    // Store the simulation's nodes (not mapNodes) for cluster updates
    // The simulation creates copies, so we need to reference those copies
    simulationNodesRef.current = nodes as Array<{ id: string; hullLabel?: string; label: string; communityId?: number; communityMembers?: string[] }>;

    // Reduce repulsion - keyword-only graph doesn't need as much separation
    simulation.force("charge", d3.forceManyBody().strength(-200));

    // Custom link force with contrast exaggeration and k-NN strength
    const linkForce = d3
      .forceLink<d3.SimulationNodeDatum, ForceLink>(links)
      .id((d: d3.SimulationNodeDatum & { id?: string }) => d.id ?? "")
      .distance((d) => {
        const sim = (d as ForceLink).similarity ?? 0.5;
        const adjustedSim = applyContrast(sim, contrast);
        return 40 + (1 - adjustedSim) * 150;
      })
      .strength((d) => {
        const link = d as ForceLink;
        const baseSim = link.similarity ?? 0.5;
        const adjustedSim = applyContrast(baseSim, contrast);
        const baseStrength = 0.2 + adjustedSim * 0.8;
        return link.isKNN ? baseStrength * knnStrength : baseStrength;
      });
    simulation.force("link", linkForce);

    // Boundary force - prevents disconnected components from drifting off
    simulation.force("boundary", forceBoundary(nodes, {
      width,
      height,
      radiusFactor: 2,
    }));

    // Disable collision initially - let nodes glide through each other
    simulation.force("collision", null);

    // Visual params
    const immediateParams = {
      current: {
        dotScale: 1,
        edgeOpacity: 0.6,
        hullOpacity: 0.1,
        edgeCurve: 0.25,
        curveMethod: "hybrid" as const,
        colorMixRatio, // 0 = cluster color, 1 = node color
      },
    };

    // Store for live updates
    immediateParamsRef.current = immediateParams;

    const renderer = createRenderer({
      svg,
      nodes: nodes as SimNode[],
      links: links as SimLink[],
      immediateParams,
      fit: false,
      callbacks: {
        onKeywordClick: handleKeywordClick,
        onZoomEnd: (transform) => {
          handleZoomChange(transform.k);
        },
      },
      pcaTransform: pcaTransform ?? undefined,
    });

    // Store renderer for cluster update effect
    rendererRef.current = renderer;

    // Compute edge opacity based on contrast
    const computeEdgeOpacity = (d: SimLink) => {
      const sim = d.similarity ?? 0.5;
      const adjusted = applyContrast(sim, contrast);
      return 0.1 + adjusted * 0.7;
    };

    // Apply per-edge opacity based on similarity with contrast
    renderer.linkSelection.attr("stroke-opacity", computeEdgeOpacity);

    // Track simulation settling
    let tickCount = 0;
    let coolingDown = false;

    // Add drag behavior - resets cooling when user drags
    addDragBehavior(renderer.nodeSelection, simulation, () => {
      coolingDown = false;
      tickCount = 0;
      simulation.force("collision", null);
    });

    // ========================================================================
    // Hover highlighting
    // ========================================================================
    const screenRadiusFraction = hoverConfig.screenRadiusFraction ?? DEFAULT_HOVER_CONFIG.screenRadiusFraction!;
    const adjacency = buildAdjacencyMap(mapEdges);
    const embeddings = buildEmbeddingMap(keywordNodes, (n) => `kw:${n.label}`);

    function applyHighlight(highlightedIds: Set<string> | null) {
      const { baseDim } = hoverConfigRef.current;

      if (highlightedIds === null) {
        // Dim everything slightly (nothing nearby)
        const dim = 1 - baseDim;
        renderer.nodeSelection.select("circle").attr("opacity", dim);
        renderer.linkSelection.attr("stroke-opacity", (d) => computeEdgeOpacity(d) * dim);
      } else if (highlightedIds.size === 0) {
        // Restore full opacity (hover ended)
        renderer.nodeSelection.select("circle").attr("opacity", 1);
        renderer.linkSelection.attr("stroke-opacity", computeEdgeOpacity);
      } else {
        // Highlight selected, dim others
        renderer.nodeSelection.select("circle").attr("opacity", (d) =>
          highlightedIds.has(d.id) ? 1 : 0.15
        );
        renderer.linkSelection.attr("stroke-opacity", (d) => {
          const sourceId = typeof d.source === "string" ? d.source : d.source.id;
          const targetId = typeof d.target === "string" ? d.target : d.target.id;
          const bothHighlighted = highlightedIds.has(sourceId) && highlightedIds.has(targetId);
          return bothHighlighted ? computeEdgeOpacity(d) : 0.05;
        });
      }
    }

    d3.select(svg)
      .on("mousemove.hover", (event: MouseEvent) => {
        const [screenX, screenY] = d3.pointer(event, svg);
        const { similarityThreshold } = hoverConfigRef.current;

        const result = spatialSemanticFilter({
          nodes,
          screenCenter: { x: screenX, y: screenY },
          screenRadius: height * screenRadiusFraction,
          transform: renderer.getTransform(),
          similarityThreshold,
          embeddings,
          adjacency,
        });
        const { highlightedIds, spatialIds, debug } = result;

        // Log debug info occasionally
        if (debug && Math.random() < 0.02) {
          console.log("[hover]", {
            spatial: debug.spatialCount,
            simPass: debug.similarityPassCount,
            neighbors: debug.neighborAddCount,
            total: highlightedIds.size,
            simRange: `${debug.minSimilarity.toFixed(2)}-${debug.maxSimilarity.toFixed(2)}`,
            threshold: similarityThreshold,
          });
        }

        if (spatialIds.size === 0) {
          applyHighlight(null);
        } else {
          applyHighlight(highlightedIds);
        }
      })
      .on("mouseleave.hover", () => {
        applyHighlight(new Set());
      });

    // Start simulation
    simulation
      .alphaTarget(0.3)
      .alphaDecay(0.01)
      .velocityDecay(0.5)
      .restart();

    simulation.on("tick", () => {
      tickCount++;

      if (tickCount > 40 && !coolingDown) {
        const velocities = nodes
          .map((d) => Math.sqrt((d.vx ?? 0) ** 2 + (d.vy ?? 0) ** 2))
          .sort((a, b) => b - a);

        const p95Index = Math.floor(nodes.length * 0.05);
        const topVelocity = velocities[p95Index] ?? velocities[0] ?? 0;

        if (topVelocity < 0.5) {
          coolingDown = true;
          simulation.force("collision", d3.forceCollide<ForceNode>().radius(20));
          simulation.alphaTarget(0).alpha(0.3);
        }
      }

      renderer.tick();
    });

    return () => {
      simulation.stop();
      d3.select(svg)
        .on("mousemove.hover", null)
        .on("mouseleave.hover", null);
      renderer.destroy();
      rendererRef.current = null;
    };
    // Stable callbacks (handleZoomChange, handleKeywordClick) and refs (hoverConfigRef)
    // don't need to be in deps - they never change identity
  }, [keywordNodes, edges, knnStrength, contrast, hoverConfig.screenRadiusFraction, pcaTransform]);

  // Update cluster assignments when clustering changes (without restarting simulation)
  // This runs when nodeToCluster, baseClusters, or labels change
  useEffect(() => {
    if (simulationNodesRef.current.length === 0 || !rendererRef.current) return;

    // Build hub lookup: hub keyword -> cluster info
    const hubToCluster = new Map<string, { clusterId: number; hub: string }>();
    for (const [clusterId, cluster] of baseClusters) {
      hubToCluster.set(cluster.hub, { clusterId, hub: cluster.hub });
    }

    // Update all nodes with their cluster assignments
    for (const node of simulationNodesRef.current) {
      // Update communityId (affects dot color)
      node.communityId = nodeToCluster.get(node.id);

      // Check if this node is a hub
      const clusterInfo = hubToCluster.get(node.label);
      if (clusterInfo) {
        // This is a hub node - set hullLabel and communityMembers
        const cluster = baseClusters.get(clusterInfo.clusterId);
        node.communityMembers = cluster ? [node.label] : undefined;
        node.hullLabel = labels[clusterInfo.clusterId] || clusterInfo.hub;
      } else {
        // Not a hub - clear hull properties
        node.communityMembers = undefined;
        node.hullLabel = undefined;
      }
    }

    // Recompute colors and communities, then redraw
    rendererRef.current.refreshClusters();
    rendererRef.current.tick();
  }, [nodeToCluster, baseClusters, labels]);

  // Update colors when colorMixRatio changes (without relayout)
  useEffect(() => {
    if (!rendererRef.current || !immediateParamsRef.current) return;

    immediateParamsRef.current.current.colorMixRatio = colorMixRatio;
    rendererRef.current.updateVisuals();
  }, [colorMixRatio]);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full"
      style={{ cursor: "grab" }}
    />
  );
}
