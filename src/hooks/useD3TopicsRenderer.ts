/**
 * Hook that manages D3-based rendering for TopicsView.
 * Handles force simulation, hover highlighting, auto-fit, and event handlers.
 */

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import {
  createRenderer,
  addDragBehavior,
  type SimNode,
  type SimLink,
  type MapRenderer,
} from "@/lib/map-renderer";
import { createForceSimulation, type ForceLink, type ForceNode } from "@/lib/map-layout";
import { forceBoundary } from "@/lib/d3-forces";
import { applyContrast } from "@/lib/math-utils";
import { buildAdjacencyMap, buildEmbeddingMap } from "@/lib/spatial-semantic";
import { computeHoverHighlight } from "@/lib/hover-highlight";
import { DEFAULT_HOVER_CONFIG, type HoverHighlightConfig } from "@/hooks/useGraphHoverHighlight";
import { convertToD3Nodes } from "@/lib/topics-graph-nodes";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import type { PCATransform } from "@/lib/semantic-colors";
import {
  createConvergenceState,
  processSimulationTick,
  DEFAULT_CONVERGENCE_CONFIG,
} from "@/lib/simulation-convergence";
import {
  createAutoFitState,
  markUserInteraction,
  markInitialFitDone,
  shouldFitDuringSimulation,
  shouldFitAfterCooling,
} from "@/lib/auto-fit";

// ============================================================================
// Types
// ============================================================================

export interface UseD3TopicsRendererOptions {
  /** Whether this renderer is currently active */
  enabled: boolean;
  svgRef: React.RefObject<SVGSVGElement | null>;
  activeNodes: KeywordNode[];
  activeEdges: SimilarityEdge[];
  projectNodes: ProjectNode[];
  knnStrength: number;
  contrast: number;
  colorMixRatio: number;
  hoverConfig: HoverHighlightConfig;
  pcaTransform: PCATransform | null;
  getSavedPosition: (id: string) => { x: number; y: number } | undefined;
  // Stable callbacks
  onKeywordClick?: (keyword: string) => void;
  onProjectClick?: (projectId: string) => void;
  onProjectDrag?: (projectId: string, position: { x: number; y: number }) => void;
  onZoomChange?: (zoomScale: number) => void;
  onFilterClick: () => void;
  // Cursor tracking refs (from useProjectCreation)
  isHoveringRef: React.MutableRefObject<boolean>;
  cursorWorldPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  cursorScreenPosRef: React.MutableRefObject<{ x: number; y: number } | null>;
  // Ref for suppressing click-to-filter after project interactions
  projectInteractionRef: React.MutableRefObject<boolean>;
}

export interface UseD3TopicsRendererResult {
  /** Current simulation nodes (for cluster updates) */
  simulationNodesRef: React.MutableRefObject<SimNode[]>;
  /** Renderer instance (for cluster refresh) */
  rendererRef: React.MutableRefObject<MapRenderer | null>;
  /** ImmediateParams ref (for colorMixRatio updates) */
  immediateParamsRef: React.MutableRefObject<{ current: { colorMixRatio: number } } | null>;
  /** Highlighted IDs for click-to-filter */
  highlightedIdsRef: React.MutableRefObject<Set<string>>;
  /** Get position for a node ID */
  getNodePosition: (id: string) => { x: number; y: number } | undefined;
}

// ============================================================================
// Hook
// ============================================================================

export function useD3TopicsRenderer(
  options: UseD3TopicsRendererOptions
): UseD3TopicsRendererResult {
  const {
    enabled,
    svgRef,
    activeNodes,
    activeEdges,
    projectNodes,
    knnStrength,
    contrast,
    colorMixRatio,
    hoverConfig,
    pcaTransform,
    getSavedPosition,
    onKeywordClick,
    onProjectClick,
    onProjectDrag,
    onZoomChange,
    onFilterClick,
    isHoveringRef,
    cursorWorldPosRef,
    cursorScreenPosRef,
    projectInteractionRef,
  } = options;

  // Refs to expose to parent
  const simulationNodesRef = useRef<SimNode[]>([]);
  const rendererRef = useRef<MapRenderer | null>(null);
  const immediateParamsRef = useRef<{ current: { colorMixRatio: number } } | null>(null);
  const highlightedIdsRef = useRef<Set<string>>(new Set());

  // Stable ref for hoverConfig (accessed in event handlers without triggering re-renders)
  const hoverConfigRef = useRef(hoverConfig);
  hoverConfigRef.current = hoverConfig;

  // Main D3 rendering effect
  useEffect(() => {
    if (!enabled) return;
    if (!svgRef.current) return;

    const svg = svgRef.current;
    const width = svg.clientWidth;
    const height = svg.clientHeight;

    // Convert nodes using shared utility
    const { mapNodes } = convertToD3Nodes({
      keywordNodes: activeNodes,
      edges: activeEdges,
      projectNodes,
      width,
      height,
      getSavedPosition,
    });

    // Create force simulation (note: this creates COPIES of nodes)
    // Pass activeEdges directly - createForceSimulation expects MapEdge[] (plain objects)
    const { simulation, nodes, links } = createForceSimulation(
      mapNodes,
      activeEdges,
      width,
      height
    );

    // Store the simulation's nodes (not mapNodes) for cluster updates
    simulationNodesRef.current = nodes as SimNode[];

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
    simulation.force("boundary", forceBoundary(nodes, { width, height, radiusFactor: 2 }));

    // Disable collision initially - let nodes glide through each other
    simulation.force("collision", null);

    // Fix project nodes in place (exclude from force simulation)
    for (const node of nodes) {
      if ((node as SimNode).type === "project") {
        node.fx = node.x;
        node.fy = node.y;
      }
    }

    // Visual params
    const immediateParams = {
      current: {
        dotScale: 1,
        edgeOpacity: 0.6,
        hullOpacity: 0.1,
        edgeCurve: 0.25,
        curveMethod: "hybrid" as const,
        curveType: "arc" as const,
        colorMixRatio,
      },
    };
    immediateParamsRef.current = immediateParams;

    // Callback to suppress click-to-filter after project interactions
    const handleProjectInteractionStart = () => {
      projectInteractionRef.current = true;
    };

    const renderer = createRenderer({
      svg,
      nodes: nodes as SimNode[],
      links: links as SimLink[],
      immediateParams,
      fit: false,
      callbacks: {
        onKeywordClick,
        onProjectClick,
        onProjectDrag,
        onZoomEnd: (transform) => onZoomChange?.(transform.k),
        onProjectInteractionStart: handleProjectInteractionStart,
      },
      pcaTransform: pcaTransform ?? undefined,
    });
    rendererRef.current = renderer;

    // Compute edge opacity based on contrast
    const computeEdgeOpacity = (d: SimLink) => {
      const sim = d.similarity ?? 0.5;
      const adjusted = applyContrast(sim, contrast);
      return 0.1 + adjusted * 0.7;
    };

    // Apply per-edge opacity based on similarity with contrast
    renderer.linkSelection.attr("stroke-opacity", computeEdgeOpacity);

    // Track simulation settling using shared convergence logic
    const convergenceState = createConvergenceState();
    const autoFitState = createAutoFitState();

    // Track user interaction (pan/zoom) to stop auto-fitting
    let userPanning = false;
    d3.select(svg)
      .on("mousedown.autofit", () => { userPanning = true; })
      .on("mouseup.autofit", () => {
        if (userPanning) markUserInteraction(autoFitState);
        userPanning = false;
      })
      .on("wheel.autofit", () => { markUserInteraction(autoFitState); });

    // Auto-fit after 1.5 seconds (give simulation time to settle)
    const autoFitTimeout = setTimeout(() => {
      if (!autoFitState.hasFittedInitially) {
        markInitialFitDone(autoFitState);
        renderer.fitToNodes(0.25, true);
      }
    }, 1500);

    // Add drag behavior - resets cooling when user drags
    addDragBehavior(
      renderer.nodeSelection,
      simulation,
      () => {
        convergenceState.coolingDown = false;
        convergenceState.tickCount = 0;
        simulation.force("collision", null);
      },
      onProjectDrag,
      handleProjectInteractionStart
    );

    // ========================================================================
    // Hover highlighting
    // ========================================================================
    const screenRadiusFraction = hoverConfig.screenRadiusFraction ?? DEFAULT_HOVER_CONFIG.screenRadiusFraction!;
    const adjacency = buildAdjacencyMap(activeEdges);
    const embeddings = buildEmbeddingMap(activeNodes, (n) => `kw:${n.label}`);

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
      .on("mouseenter.project", () => { isHoveringRef.current = true; })
      .on("mouseleave.project", () => {
        isHoveringRef.current = false;
        cursorWorldPosRef.current = null;
        cursorScreenPosRef.current = null;
      })
      .on("mousemove.hover", (event: MouseEvent) => {
        const [screenX, screenY] = d3.pointer(event, svg);
        const { similarityThreshold } = hoverConfigRef.current;

        // Track cursor position for project creation
        const transform = renderer.getTransform();
        cursorScreenPosRef.current = { x: screenX, y: screenY };
        const worldX = (screenX - transform.x) / transform.k;
        const worldY = (screenY - transform.y) / transform.k;
        cursorWorldPosRef.current = { x: worldX, y: worldY };

        // Check if cursor is over a project node - skip hover highlighting if so
        if (renderer.isHoveringProject()) {
          highlightedIdsRef.current = new Set();
          applyHighlight(new Set());
          return;
        }

        const { keywordHighlightedIds, isEmptySpace, debug } = computeHoverHighlight({
          nodes,
          screenCenter: { x: screenX, y: screenY },
          screenRadius: height * screenRadiusFraction,
          transform,
          similarityThreshold,
          embeddings,
          adjacency,
        });

        // Log debug info occasionally
        if (debug && Math.random() < 0.02) {
          console.log("[hover]", {
            spatial: debug.spatialCount,
            simPass: debug.similarityPassCount,
            neighbors: debug.neighborAddCount,
            total: keywordHighlightedIds.size,
            simRange: `${debug.minSimilarity.toFixed(2)}-${debug.maxSimilarity.toFixed(2)}`,
            threshold: similarityThreshold,
          });
        }

        if (isEmptySpace) {
          highlightedIdsRef.current = new Set();
          applyHighlight(null);
        } else {
          highlightedIdsRef.current = keywordHighlightedIds;
          applyHighlight(keywordHighlightedIds);
        }
      })
      .on("mouseleave.hover", () => {
        highlightedIdsRef.current = new Set();
        applyHighlight(new Set());
      })
      .on("click.filter", () => {
        if (projectInteractionRef.current) {
          projectInteractionRef.current = false;
          return;
        }
        onFilterClick();
      });

    // Start simulation
    simulation
      .alphaTarget(0.3)
      .alphaDecay(0.01)
      .velocityDecay(0.5)
      .restart();

    simulation.on("tick", () => {
      const { coolingJustStarted } = processSimulationTick(
        nodes,
        convergenceState,
        DEFAULT_CONVERGENCE_CONFIG
      );

      if (coolingJustStarted) {
        simulation.force("collision", d3.forceCollide<ForceNode>().radius(20));
        simulation.alphaTarget(0).alpha(0.3);
      }

      if (shouldFitDuringSimulation(autoFitState, convergenceState)) {
        renderer.fitToNodes(0.25, true);
      }

      if (shouldFitAfterCooling(autoFitState, convergenceState)) {
        markInitialFitDone(autoFitState);
        renderer.fitToNodes(0.25, true);
      }

      renderer.tick();
    });

    return () => {
      clearTimeout(autoFitTimeout);
      simulation.stop();
      d3.select(svg)
        .on("mouseenter.project", null)
        .on("mouseleave.project", null)
        .on("mousemove.hover", null)
        .on("mouseleave.hover", null)
        .on("click.filter", null)
        .on("mousedown.autofit", null)
        .on("mouseup.autofit", null)
        .on("wheel.autofit", null);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [enabled, activeNodes, activeEdges, projectNodes, knnStrength, contrast, colorMixRatio, hoverConfig.screenRadiusFraction, pcaTransform, getSavedPosition, onKeywordClick, onProjectClick, onProjectDrag, onZoomChange, onFilterClick, isHoveringRef, cursorWorldPosRef, cursorScreenPosRef, projectInteractionRef, svgRef]);

  // Get position for a node ID (for click-to-filter position capture)
  const getNodePosition = (id: string): { x: number; y: number } | undefined => {
    const node = simulationNodesRef.current.find((n) => n.id === id);
    if (node?.x !== undefined && node?.y !== undefined) {
      return { x: node.x, y: node.y };
    }
    return undefined;
  };

  return {
    simulationNodesRef,
    rendererRef,
    immediateParamsRef,
    highlightedIdsRef,
    getNodePosition,
  };
}
