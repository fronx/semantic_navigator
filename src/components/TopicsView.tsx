"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import {
  createRenderer,
  addDragBehavior,
  type SimNode,
  type SimLink,
} from "@/lib/map-renderer";
import { createThreeRenderer, type ThreeRenderer } from "@/lib/three-renderer";
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
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";
import { loadPCATransform, computeNeighborAveragedColors, type PCATransform } from "@/lib/semantic-colors";
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

export type RendererType = "d3" | "three";

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
  const threeRendererRef = useRef<ThreeRenderer | null>(null);

  // State for click-to-filter: when set, only show nodes in this set
  const [filteredNodeIds, setFilteredNodeIds] = useState<Set<string> | null>(null);

  // Position map for preserving node positions across filter transitions
  const positionMapRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Cursor tracking for project creation
  const isHoveringRef = useRef(false);
  const cursorWorldPosRef = useRef<{ x: number; y: number } | null>(null);
  const cursorScreenPosRef = useRef<{ x: number; y: number } | null>(null);

  // Stable callbacks - won't trigger effect re-runs when parent re-renders
  const handleZoomChange = useStableCallback(onZoomChange);
  const handleKeywordClick = useStableCallback(onKeywordClick);
  const handleProjectClick = useStableCallback(onProjectClick);
  const handleCreateProject = useStableCallback(onCreateProject);
  const handleProjectDrag = useStableCallback(onProjectDrag);

  // Stable refs for values accessed in event handlers without triggering re-renders
  const hoverConfigRef = useLatest(hoverConfig);

  // Track current highlighted IDs for click-to-filter
  const highlightedIdsRef = useRef<Set<string>>(new Set());

  // Track if a project interaction just happened (to suppress click-to-filter)
  const projectInteractionRef = useRef(false);

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

  // Stable project identity - only changes when projects are added/removed, not when positions change
  // This prevents re-renders when dragging project nodes
  const projectIds = useMemo(
    () => projectNodes.map((p) => p.id).sort().join(","),
    [projectNodes]
  );

  // Store projectNodes in a ref for position updates without triggering effect
  const projectNodesRef = useLatest(projectNodes);

  // PCA transform for stable semantic colors
  const [pcaTransform, setPcaTransform] = useState<PCATransform | null>(null);

  // Load PCA transform once on mount
  useEffect(() => {
    loadPCATransform().then(setPcaTransform);
  }, []);

  // Keyboard handler for project creation (press 'N' to create at cursor)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger on 'N' key when hovering and not typing in an input
      if (e.key !== "n" && e.key !== "N") return;
      if (!isHoveringRef.current) return;
      if (!cursorWorldPosRef.current || !cursorScreenPosRef.current) return;

      // Don't trigger if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      e.preventDefault();
      handleCreateProject(cursorWorldPosRef.current, cursorScreenPosRef.current);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCreateProject]);

  // Combine external filter (from project selection) with internal filter (from click-to-drill-down)
  const effectiveFilter = useMemo(() => {
    if (!externalFilter && !filteredNodeIds) return null;
    if (!externalFilter) return filteredNodeIds;
    if (!filteredNodeIds) return externalFilter;
    // Intersection: show only nodes in both filters
    return new Set([...filteredNodeIds].filter((id) => externalFilter.has(id)));
  }, [externalFilter, filteredNodeIds]);

  // Compute active nodes/edges based on filter state (memoized to prevent effect loops)
  const activeNodes = useMemo(
    () => effectiveFilter
      ? keywordNodes.filter((n) => effectiveFilter.has(n.id))
      : keywordNodes,
    [keywordNodes, effectiveFilter]
  );

  const activeEdges = useMemo(
    () => effectiveFilter
      ? edges.filter((e) => effectiveFilter.has(e.source) && effectiveFilter.has(e.target))
      : edges,
    [edges, effectiveFilter]
  );

  // Click handler for drill-down filtering (shared logic for both renderers)
  const handleFilterClick = useStableCallback(() => {
    const highlighted = highlightedIdsRef.current;
    if (highlighted.size === 0) {
      // No highlighted nodes - reset filter if one exists
      if (filteredNodeIds !== null) {
        setFilteredNodeIds(null);
      }
      return;
    }

    // Capture current positions before filter (for both D3 and Three.js)
    const newPositionMap = new Map<string, { x: number; y: number }>();

    if (rendererType === "d3" && simulationNodesRef.current.length > 0) {
      for (const node of simulationNodesRef.current) {
        const simNode = node as SimNode;
        if (simNode.x !== undefined && simNode.y !== undefined) {
          newPositionMap.set(node.id, { x: simNode.x, y: simNode.y });
        }
      }
    } else if (rendererType === "three" && threeRendererRef.current) {
      for (const node of threeRendererRef.current.getNodes()) {
        if (node.x !== undefined && node.y !== undefined) {
          newPositionMap.set(node.id, { x: node.x, y: node.y });
        }
      }
    }

    positionMapRef.current = newPositionMap;

    // Apply filter - IDs are already in "kw:label" format for both renderers
    setFilteredNodeIds(highlighted);
  });

  // Main D3 rendering effect
  useEffect(() => {
    if (rendererType !== "d3") return;
    if (!svgRef.current) return;

    const svg = svgRef.current;
    const width = svg.clientWidth;
    const height = svg.clientHeight;

    // Convert to format expected by renderer
    // Cluster data is added via refs (not dependencies) to avoid relayout
    // Actual cluster assignments are applied by the cluster update effect
    // Use activeNodes/activeEdges for filtered view
    const keywordMapNodes = activeNodes.map((n) => {
      // Apply preserved positions if available (for smooth filter transitions)
      const savedPos = positionMapRef.current.get(n.id);
      return {
        id: n.id,
        type: "keyword" as const,
        label: n.label,
        communityId: undefined as number | undefined,
        embedding: n.embedding,
        communityMembers: undefined as string[] | undefined,
        hullLabel: undefined as string | undefined,
        // Set initial position from saved positions
        x: savedPos?.x,
        y: savedPos?.y,
      };
    });

    // Add project nodes with their persisted positions
    // Use ref to avoid re-renders when only positions change
    const projectMapNodes = projectNodesRef.current.map((p) => ({
      id: `proj:${p.id}`,
      type: "project" as const,
      label: p.title,
      communityId: undefined as number | undefined,
      embedding: p.embedding,
      communityMembers: undefined as string[] | undefined,
      hullLabel: undefined as string | undefined,
      // Use database position, or center of viewport if none
      x: p.position_x ?? width / 2,
      y: p.position_y ?? height / 2,
    }));

    const mapNodes = [...keywordMapNodes, ...projectMapNodes];

    const mapEdges = activeEdges.map((e) => ({
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

    // Fix project nodes in place (exclude from force simulation)
    // Setting fx/fy anchors the node at that position
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
        curveType: "arc" as const, // D3 always uses arcs
        colorMixRatio, // 0 = cluster color, 1 = node color
      },
    };

    // Store for live updates
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
        onKeywordClick: handleKeywordClick,
        onProjectClick: handleProjectClick,
        onProjectDrag: handleProjectDrag,
        onZoomEnd: (transform) => {
          handleZoomChange(transform.k);
        },
        onProjectInteractionStart: handleProjectInteractionStart,
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

    // Track simulation settling using shared convergence logic
    const convergenceState = createConvergenceState();
    const autoFitState = createAutoFitState();

    // Track user interaction (pan/zoom) to stop auto-fitting
    let userPanning = false;
    d3.select(svg)
      .on("mousedown.autofit", () => {
        userPanning = true;
      })
      .on("mouseup.autofit", () => {
        if (userPanning) {
          markUserInteraction(autoFitState);
        }
        userPanning = false;
      })
      .on("wheel.autofit", () => {
        markUserInteraction(autoFitState);
      });

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
      handleProjectDrag,
      handleProjectInteractionStart
    );

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
      .on("mouseenter.project", () => {
        isHoveringRef.current = true;
      })
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
        // Use renderer's hover tracking (set by mouseenter/mouseleave on project nodes)
        if (renderer.isHoveringProject()) {
          // Don't highlight anything when over a project node
          highlightedIdsRef.current = new Set();
          applyHighlight(new Set());
          return;
        }

        const result = spatialSemanticFilter({
          nodes,
          screenCenter: { x: screenX, y: screenY },
          screenRadius: height * screenRadiusFraction,
          transform,
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

        // Exclude project nodes from hover highlighting
        const keywordHighlightedIds = new Set(
          [...highlightedIds].filter((id) => !id.startsWith("proj:"))
        );

        if (spatialIds.size === 0) {
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
        // Skip click-to-filter if a project interaction just happened
        if (projectInteractionRef.current) {
          projectInteractionRef.current = false;
          return;
        }
        handleFilterClick();
      });

    // Start simulation
    simulation
      .alphaTarget(0.3)
      .alphaDecay(0.01)
      .velocityDecay(0.5)
      .restart();

    simulation.on("tick", () => {
      // Process tick with shared convergence logic (clamps velocities, checks for convergence)
      const { coolingJustStarted } = processSimulationTick(
        nodes,
        convergenceState,
        DEFAULT_CONVERGENCE_CONFIG
      );

      if (coolingJustStarted) {
        // Add collision force for refinement phase
        simulation.force("collision", d3.forceCollide<ForceNode>().radius(20));
        // Let simulation naturally decay
        simulation.alphaTarget(0).alpha(0.3);
      }

      // Periodic fit as graph grows during simulation
      if (shouldFitDuringSimulation(autoFitState, convergenceState)) {
        renderer.fitToNodes(0.25, true);
      }

      // Additional fit when cooling starts (for refinement)
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
    // Stable callbacks (handleZoomChange, handleKeywordClick) and refs (hoverConfigRef)
    // don't need to be in deps - they never change identity
  // Note: projectIds (not projectNodes) is used to only re-render when projects are added/removed,
  // not when positions change (e.g., during drag). projectNodesRef.current is used inside for positions.
  }, [activeNodes, activeEdges, projectIds, knnStrength, contrast, hoverConfig.screenRadiusFraction, pcaTransform, rendererType, effectiveFilter]);

  // Three.js rendering effect
  // Note: nodeToCluster is NOT in deps - cluster updates are handled separately
  useEffect(() => {
    if (rendererType !== "three") return;
    if (!containerRef.current) return;

    const container = containerRef.current;
    let cancelled = false;

    // Convert to format expected by renderer
    // Don't set communityId here - it's updated by the cluster effect
    // Use activeNodes/activeEdges for filtered view
    const keywordMapNodes: SimNode[] = activeNodes.map((n) => {
      // Apply preserved positions if available (for smooth filter transitions)
      const savedPos = positionMapRef.current.get(`kw:${n.label}`);
      return {
        id: `kw:${n.label}`,
        type: "keyword" as const,
        label: n.label,
        communityId: undefined,
        embedding: n.embedding,
        // Set initial position from saved positions
        x: savedPos?.x,
        y: savedPos?.y,
      };
    });

    // Add project nodes with their persisted positions
    // Use ref to avoid re-renders when only positions change
    const width = container.clientWidth;
    const height = container.clientHeight;
    const projectMapNodes: SimNode[] = projectNodesRef.current.map((p) => ({
      id: `proj:${p.id}`,
      type: "project" as const,
      label: p.title,
      communityId: undefined,
      embedding: p.embedding,
      // Use database position, or center of viewport if none
      x: p.position_x ?? width / 2,
      y: p.position_y ?? height / 2,
    }));

    const mapNodes: SimNode[] = [...keywordMapNodes, ...projectMapNodes];

    const mapLinks: SimLink[] = activeEdges.map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
    }));

    const immediateParams = {
      current: {
        dotScale: 1,
        edgeOpacity: 0.6,
        hullOpacity: 0.1,
        edgeCurve: 0.25,
        curveMethod: "hybrid" as const,
        curveType: "arc" as const, // Use circular arcs (matches D3 renderer)
        colorMixRatio, // 0 = cluster color, 1 = node color
      },
    };

    // Build lookups for hover highlighting (same as D3 renderer)
    const screenRadiusFraction = hoverConfig.screenRadiusFraction ?? DEFAULT_HOVER_CONFIG.screenRadiusFraction!;
    const adjacency = buildAdjacencyMap(activeEdges);
    const embeddings = buildEmbeddingMap(activeNodes, (n) => `kw:${n.label}`);

    // Event handlers (stored for cleanup)
    let handleMouseEnter: (() => void) | null = null;
    let handleMouseMove: ((event: MouseEvent) => void) | null = null;
    let handleMouseLeave: (() => void) | null = null;
    let handleClick: (() => void) | null = null;

    // Defer initialization to next frame to ensure container is fully laid out
    const frameId = requestAnimationFrame(() => {
      if (cancelled) return;

      (async () => {
        // Compute embedding-based colors with neighbor averaging
        const nodeColors = pcaTransform
          ? computeNeighborAveragedColors(activeNodes, activeEdges, pcaTransform)
          : undefined;

        const threeRenderer = await createThreeRenderer({
          container,
          nodes: mapNodes,
          links: mapLinks,
          immediateParams,
          nodeColors,
          callbacks: {
            onKeywordClick: handleKeywordClick,
            onProjectClick: handleProjectClick,
            onProjectDrag: handleProjectDrag,
            onZoomEnd: (transform) => {
              handleZoomChange(transform.k);
            },
            onProjectInteractionStart: () => {
              projectInteractionRef.current = true;
            },
          },
        });

        if (cancelled) {
          threeRenderer.destroy();
          return;
        }

        threeRendererRef.current = threeRenderer;

        // Set up hover highlighting and cursor tracking
        const height = container.clientHeight;

        // Track hover state for project creation
        handleMouseEnter = () => {
          isHoveringRef.current = true;
        };

        const handleMouseLeaveProject = () => {
          isHoveringRef.current = false;
          cursorWorldPosRef.current = null;
          cursorScreenPosRef.current = null;
        };

        handleMouseMove = (event: MouseEvent) => {
          const rect = container.getBoundingClientRect();
          const screenX = event.clientX - rect.left;
          const screenY = event.clientY - rect.top;
          const { similarityThreshold, baseDim } = hoverConfigRef.current;

          // Track cursor position for project creation
          cursorScreenPosRef.current = { x: screenX, y: screenY };
          const worldPos = threeRenderer.screenToWorld({ x: screenX, y: screenY });
          cursorWorldPosRef.current = worldPos;

          // Check if cursor is over a project node - skip hover highlighting if so
          // Use renderer's built-in hover detection (matches tooltip behavior)
          if (threeRenderer.isHoveringProject()) {
            // Don't highlight anything when over a project node
            highlightedIdsRef.current = new Set();
            threeRenderer.applyHighlight(new Set(), baseDim);
            return;
          }

          const rendererNodes = threeRenderer.getNodes();
          const result = spatialSemanticFilter({
            nodes: rendererNodes,
            screenCenter: { x: screenX, y: screenY },
            screenRadius: height * screenRadiusFraction,
            transform: threeRenderer.getTransform(),
            similarityThreshold,
            embeddings,
            adjacency,
            screenToWorld: (screen) => threeRenderer.screenToWorld(screen),
          });

          // Exclude project nodes from hover highlighting
          const keywordHighlightedIds = new Set(
            [...result.highlightedIds].filter((id) => !id.startsWith("proj:"))
          );

          if (result.spatialIds.size === 0) {
            highlightedIdsRef.current = new Set();
            threeRenderer.applyHighlight(null, baseDim);
          } else {
            highlightedIdsRef.current = keywordHighlightedIds;
            threeRenderer.applyHighlight(keywordHighlightedIds, baseDim);
          }
        };

        handleMouseLeave = () => {
          highlightedIdsRef.current = new Set();
          const { baseDim } = hoverConfigRef.current;
          threeRenderer.applyHighlight(new Set(), baseDim);
          // Also clear project creation state
          handleMouseLeaveProject();
        };

        handleClick = () => {
          // Skip click-to-filter if a project interaction just happened
          if (projectInteractionRef.current) {
            projectInteractionRef.current = false;
            return;
          }
          handleFilterClick();
        };

        container.addEventListener("mouseenter", handleMouseEnter);
        container.addEventListener("mousemove", handleMouseMove);
        container.addEventListener("mouseleave", handleMouseLeave);
        container.addEventListener("click", handleClick);
      })();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      if (handleMouseEnter) container.removeEventListener("mouseenter", handleMouseEnter);
      if (handleMouseMove) container.removeEventListener("mousemove", handleMouseMove);
      if (handleMouseLeave) container.removeEventListener("mouseleave", handleMouseLeave);
      if (handleClick) container.removeEventListener("click", handleClick);
      if (threeRendererRef.current) {
        threeRendererRef.current.destroy();
        threeRendererRef.current = null;
      }
    };
  // Note: projectIds (not projectNodes) is used to only re-render when projects are added/removed,
  // not when positions change (e.g., during drag). projectNodesRef.current is used inside for positions.
  }, [activeNodes, activeEdges, projectIds, rendererType, handleKeywordClick, handleZoomChange, colorMixRatio, hoverConfig.screenRadiusFraction, effectiveFilter, pcaTransform]);

  // Update cluster assignments when clustering changes (without restarting simulation)
  // This runs when nodeToCluster, baseClusters, or labels change
  useEffect(() => {
    // Handle D3 renderer
    if (rendererType === "d3" && simulationNodesRef.current.length > 0 && rendererRef.current) {
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
    }

    // Handle Three.js renderer
    if (rendererType === "three" && threeRendererRef.current) {
      // Build a map from "kw:label" to cluster ID
      const threeNodeToCluster = new Map<string, number>();
      for (const node of keywordNodes) {
        const clusterId = nodeToCluster.get(node.id);
        if (clusterId !== undefined) {
          threeNodeToCluster.set(`kw:${node.label}`, clusterId);
        }
      }
      threeRendererRef.current.updateClusters(threeNodeToCluster);
    }
  }, [nodeToCluster, baseClusters, labels, rendererType, keywordNodes]);

  // Update colors when colorMixRatio changes (without relayout)
  // Must be before conditional return to satisfy Rules of Hooks
  useEffect(() => {
    if (!rendererRef.current || !immediateParamsRef.current) return;

    immediateParamsRef.current.current.colorMixRatio = colorMixRatio;
    rendererRef.current.updateVisuals();
  }, [colorMixRatio]);

  if (rendererType === "three") {
    return (
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ cursor: "grab" }}
      />
    );
  }

  return (
    <svg
      ref={svgRef}
      className="w-full h-full"
      style={{ cursor: "grab" }}
    />
  );
}
