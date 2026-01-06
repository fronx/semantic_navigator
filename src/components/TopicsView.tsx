"use client";

import { useEffect, useRef } from "react";
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
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";

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
  /** Hover highlight configuration */
  hoverConfig: HoverHighlightConfig;
  /** Callback when a keyword is clicked */
  onKeywordClick?: (keyword: string) => void;
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
  hoverConfig,
  onKeywordClick,
}: TopicsViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Client-side Louvain clustering
  const { nodeToCluster, clusters } = useClusterLabels(keywordNodes, edges, clusterResolution);

  // Refs for hover config (accessed in event handlers without triggering re-renders)
  const hoverConfigRef = useRef(hoverConfig);
  hoverConfigRef.current = hoverConfig;

  // Main rendering effect
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = svgRef.current;
    const width = svg.clientWidth;
    const height = svg.clientHeight;

    // Build hub lookup: hub keyword -> cluster (for semantic labels)
    const hubToCluster = new Map<string, { hub: string; label: string }>();
    for (const cluster of clusters.values()) {
      hubToCluster.set(cluster.hub, { hub: cluster.hub, label: cluster.label });
    }

    // Convert to format expected by renderer
    // Use client-side computed cluster IDs instead of pre-computed communityId
    // Mark hub nodes with communityMembers so hull labels render correctly
    const mapNodes = keywordNodes.map((n) => {
      const clusterInfo = hubToCluster.get(n.label);
      return {
        id: n.id,
        type: "keyword" as const,
        label: n.label,
        communityId: nodeToCluster.get(n.id),
        embedding: n.embedding,
        // Mark hub nodes - renderer uses communityMembers presence to identify hubs
        communityMembers: clusterInfo ? [n.label] : undefined,
        // Semantic label from Haiku (or hub keyword if not yet loaded)
        hullLabel: clusterInfo?.label,
      };
    });

    const mapEdges = edges.map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
      isKNN: e.isKNN,
    }));

    // Create force simulation
    const { simulation, nodes, links } = createForceSimulation(
      mapNodes,
      mapEdges,
      width,
      height
    );

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
      },
    };

    const renderer = createRenderer({
      svg,
      nodes: nodes as SimNode[],
      links: links as SimLink[],
      immediateParams,
      fit: false,
      callbacks: {
        onKeywordClick: (keyword) => {
          onKeywordClick?.(keyword);
        },
      },
    });

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
    };
  }, [keywordNodes, edges, knnStrength, contrast, nodeToCluster, clusters, hoverConfig.screenRadiusFraction, onKeywordClick]);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full"
      style={{ cursor: "grab" }}
    />
  );
}
