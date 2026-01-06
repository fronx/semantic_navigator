/**
 * D3-based renderer for the map visualization.
 * Handles node/link/hull rendering and interactions.
 */

import * as d3 from "d3";
import type { MapNode } from "@/app/api/map/route";
import { colors } from "@/lib/colors";
import { createHoverTooltip } from "@/lib/d3-utils";
import { createHullRenderer, groupNodesByCommunity, computeHullGeometry, communityColorScale } from "@/lib/hull-renderer";

export interface SimNode extends d3.SimulationNodeDatum, MapNode {}

export interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
  similarity?: number;
}

export interface RendererCallbacks {
  onNodeExpand?: (graphNodeId: string, dbNodeId: string) => void;
  onKeywordClick?: (keyword: string) => void;
  /** Called when zoom gesture ends (for semantic zoom) */
  onZoomEnd?: (transform: { k: number; x: number; y: number }, viewport: { width: number; height: number }) => void;
}

export interface MapRenderer {
  /** Update node/link positions (call on each tick) */
  tick: () => void;
  /** Update all visual attributes without relayout (reads from immediateParams ref) */
  updateVisuals: () => void;
  /** Update nodes and links dynamically (for semantic zoom filtering) */
  updateData: (newNodes: SimNode[], newLinks: SimLink[]) => void;
  /** Fit view to show all current nodes with padding */
  fitToNodes: (padding?: number, animate?: boolean) => void;
  /** Get node selection for external styling (search highlighting) */
  nodeSelection: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>;
  /** Get link selection for external styling */
  linkSelection: d3.Selection<SVGPathElement, SimLink, SVGGElement, unknown>;
  /** Get current zoom transform */
  getTransform: () => { k: number; x: number; y: number };
  /** Get viewport dimensions */
  getViewport: () => { width: number; height: number };
  /** Clean up */
  destroy: () => void;
}

/**
 * Visual parameters that can be updated without relayout.
 * Pass as a ref so updates are reflected immediately.
 */
export type CurveMethod = "outward" | "angular" | "hybrid";

export interface ImmediateParams {
  dotScale: number;
  edgeOpacity: number;
  hullOpacity: number;
  edgeCurve: number; // 0 = straight, 0.3 = max curve
  curveMethod: CurveMethod;
}

interface RendererOptions {
  svg: SVGSVGElement;
  nodes: SimNode[];
  links: SimLink[];
  immediateParams: { current: ImmediateParams };
  /** Ref to visible node IDs for semantic zoom filtering (optional) */
  visibleIdsRef?: { current: Set<string> | null };
  initialZoom?: number; // Initial zoom level (default 1.0)
  /** If true, layout fits canvas - use smaller visual elements. If false (overflow mode), use larger elements. */
  fit?: boolean;
  callbacks: RendererCallbacks;
}

// Scale article radius by content size (sqrt for good visual spread)
const sizeScale = d3.scaleSqrt().domain([400, 2000]).range([25, 80]).clamp(true);

function getNodeRadius(d: SimNode, dotScale: number): number {
  if (d.type === "keyword") return 18 * dotScale;
  if (d.type === "chunk") return sizeScale((d.size || 150) * 0.5) * dotScale;
  return sizeScale(d.size || 400) * dotScale; // article
}


/**
 * Compute blended colors for articles/chunks based on connected keyword communities.
 */
function computeBlendedColors(
  nodes: SimNode[],
  links: SimLink[]
): Map<string, string> {
  // Build adjacency: article/chunk -> connected keywords
  const nodeKeywords = new Map<string, SimNode[]>();
  for (const link of links) {
    const source = link.source as SimNode;
    const target = link.target as SimNode;
    if ((source.type === "article" || source.type === "chunk") && target.type === "keyword") {
      if (!nodeKeywords.has(source.id)) nodeKeywords.set(source.id, []);
      nodeKeywords.get(source.id)!.push(target);
    } else if ((target.type === "article" || target.type === "chunk") && source.type === "keyword") {
      if (!nodeKeywords.has(target.id)) nodeKeywords.set(target.id, []);
      nodeKeywords.get(target.id)!.push(source);
    }
  }

  // Blend colors
  const blended = new Map<string, string>();
  for (const [nodeId, keywords] of nodeKeywords) {
    const communityColors = keywords
      .filter((kw) => kw.communityId !== undefined)
      .map((kw) => d3.color(communityColorScale(String(kw.communityId)))!);

    if (communityColors.length > 0) {
      const avgR = communityColors.reduce((sum, c) => sum + c.rgb().r, 0) / communityColors.length;
      const avgG = communityColors.reduce((sum, c) => sum + c.rgb().g, 0) / communityColors.length;
      const avgB = communityColors.reduce((sum, c) => sum + c.rgb().b, 0) / communityColors.length;
      blended.set(nodeId, d3.rgb(avgR, avgG, avgB).formatHex());
    }
  }
  return blended;
}

function getNodeColor(d: SimNode, blendedColors: Map<string, string>): string {
  if (d.type === "article" || d.type === "chunk") {
    return blendedColors.get(d.id) || (d.type === "article" ? colors.node.article : colors.node.chunk);
  }
  if (d.communityId !== undefined) {
    return communityColorScale(String(d.communityId));
  }
  return "#9ca3af"; // grey-400 for unclustered keywords
}

/**
 * Compute curve directions for edges based on selected method.
 *
 * Methods:
 * - "outward": All edges curve away from global centroid (convex appearance)
 * - "angular": Alternating directions around each node (angular resolution)
 * - "hybrid": Angular resolution with outward fallback for conflicts
 *
 * Returns a Map from link to direction (-1 or 1).
 */
function computeEdgeCurveDirections(
  nodes: SimNode[],
  links: SimLink[],
  method: CurveMethod
): Map<SimLink, number> {
  // Compute global centroid
  let globalCx = 0, globalCy = 0;
  for (const node of nodes) {
    globalCx += node.x ?? 0;
    globalCy += node.y ?? 0;
  }
  globalCx /= nodes.length;
  globalCy /= nodes.length;

  // Helper: compute outward direction for a single link
  function getOutwardDir(link: SimLink): number {
    const source = link.source as SimNode;
    const target = link.target as SimNode;
    const mx = ((source.x ?? 0) + (target.x ?? 0)) / 2;
    const my = ((source.y ?? 0) + (target.y ?? 0)) / 2;
    const outwardX = mx - globalCx;
    const outwardY = my - globalCy;
    const dx = (target.x ?? 0) - (source.x ?? 0);
    const dy = (target.y ?? 0) - (source.y ?? 0);
    const dot = outwardX * (-dy) + outwardY * dx;
    return dot >= 0 ? 1 : -1;
  }

  const directions = new Map<SimLink, number>();

  if (method === "outward") {
    // Simple: all edges curve away from centroid
    for (const link of links) {
      directions.set(link, getOutwardDir(link));
    }
    return directions;
  }

  // For angular and hybrid: build adjacency and compute angular votes
  const adjacency = new Map<string, Array<{ link: SimLink; other: SimNode }>>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const link of links) {
    const source = link.source as SimNode;
    const target = link.target as SimNode;
    adjacency.get(source.id)?.push({ link, other: target });
    adjacency.get(target.id)?.push({ link, other: source });
  }

  // Track direction votes per edge
  const edgeVotes = new Map<SimLink, { votes: number[]; degrees: number[] }>();
  for (const link of links) {
    edgeVotes.set(link, { votes: [], degrees: [] });
  }

  // For each node, sort edges by angle and assign alternating directions
  for (const node of nodes) {
    const edges = adjacency.get(node.id)!;
    if (edges.length === 0) continue;

    edges.sort((a, b) => {
      const angleA = Math.atan2((a.other.y ?? 0) - (node.y ?? 0), (a.other.x ?? 0) - (node.x ?? 0));
      const angleB = Math.atan2((b.other.y ?? 0) - (node.y ?? 0), (b.other.x ?? 0) - (node.x ?? 0));
      return angleA - angleB;
    });

    edges.forEach(({ link }, i) => {
      const vote = edgeVotes.get(link)!;
      vote.votes.push((i % 2 === 0) ? 1 : -1);
      vote.degrees.push(edges.length);
    });
  }

  // Resolve votes based on method
  const DEGREE_RATIO_THRESHOLD = 2;

  for (const [link, { votes, degrees }] of edgeVotes) {
    if (votes.length === 0) {
      directions.set(link, method === "hybrid" ? getOutwardDir(link) : 1);
    } else if (votes.length === 1) {
      directions.set(link, votes[0]);
    } else if (votes[0] === votes[1]) {
      directions.set(link, votes[0]);
    } else if (method === "angular") {
      // Angular: higher-degree node wins
      directions.set(link, degrees[0] >= degrees[1] ? votes[0] : votes[1]);
    } else {
      // Hybrid: check if one is a clear hub
      const ratio = Math.max(degrees[0], degrees[1]) / Math.min(degrees[0], degrees[1]);
      if (ratio >= DEGREE_RATIO_THRESHOLD) {
        directions.set(link, degrees[0] >= degrees[1] ? votes[0] : votes[1]);
      } else {
        directions.set(link, getOutwardDir(link));
      }
    }
  }

  return directions;
}

/**
 * Compute a curved SVG path for an edge using a true circular arc.
 * Uses the sagitta (arc height) to compute radius, then draws with SVG A command.
 *
 * @param direction - Curve direction: 1 or -1, determines which side the arc bows toward
 */
function computeCurvedPath(link: SimLink, curveIntensity: number, direction: number): string {
  const source = link.source as SimNode;
  const target = link.target as SimNode;
  const x1 = source.x!, y1 = source.y!;
  const x2 = target.x!, y2 = target.y!;

  if (curveIntensity === 0) {
    return `M ${x1},${y1} L ${x2},${y2}`;
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const chordLength = Math.sqrt(dx * dx + dy * dy);
  if (chordLength === 0) return `M ${x1},${y1} L ${x2},${y2}`;

  // Sagitta (arc height) - perpendicular distance from chord midpoint to arc apex
  const sagitta = chordLength * curveIntensity * direction;
  const absSagitta = Math.abs(sagitta);

  // For very small curves, use a straight line to avoid numerical issues
  if (absSagitta < 0.1) {
    return `M ${x1},${y1} L ${x2},${y2}`;
  }

  // Radius from chord length L and sagitta h: r = (L²/4 + h²) / (2h)
  const radius = (chordLength * chordLength / 4 + absSagitta * absSagitta) / (2 * absSagitta);

  // Sweep flag: 1 = clockwise, 0 = counter-clockwise
  // When sagitta > 0, arc bulges "left" of the P1→P2 direction (counter-clockwise)
  // When sagitta < 0, arc bulges "right" (clockwise)
  const sweepFlag = sagitta < 0 ? 1 : 0;

  // Large arc flag: 0 = minor arc (< 180°), 1 = major arc (> 180°)
  // We always want the minor arc
  const largeArcFlag = 0;

  return `M ${x1},${y1} A ${radius},${radius} 0 ${largeArcFlag},${sweepFlag} ${x2},${y2}`;
}

/**
 * Create the map renderer.
 * Sets up D3 selections and returns tick function for position updates.
 */
export function createRenderer(options: RendererOptions): MapRenderer {
  const { svg: svgElement, nodes: initialNodes, links: initialLinks, immediateParams, visibleIdsRef, initialZoom = 1, fit = false, callbacks } = options;

  // In fit mode, scale down visual elements since we're not zoomed out
  // Overflow mode assumes ~0.4x zoom, so fit mode uses 0.4x visual scale
  const visualScale = fit ? 0.4 : 1.0;

  const svg = d3.select(svgElement);
  const width = svgElement.clientWidth;
  const height = svgElement.clientHeight;

  svg.selectAll("*").remove();

  const g = svg.append("g");

  // Zoom behavior
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on("zoom", (event) => g.attr("transform", event.transform))
    .on("end", (event) => {
      if (callbacks.onZoomEnd) {
        const transform = event.transform;
        callbacks.onZoomEnd(
          { k: transform.k, x: transform.x, y: transform.y },
          { width, height }
        );
      }
    });
  svg.call(zoom);

  // Apply initial zoom (centered)
  if (initialZoom !== 1) {
    const initialTransform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(initialZoom)
      .translate(-width / 2, -height / 2);
    svg.call(zoom.transform, initialTransform);
  }

  // Mutable state for dynamic updates
  let currentNodes = initialNodes;
  let currentLinks = initialLinks;
  let blendedColors = computeBlendedColors(currentNodes, currentLinks);
  let edgeCurveDirections: Map<SimLink, number> | null = null;
  let communitiesMap = groupNodesByCommunity(currentNodes);

  // Draw layers (order matters: hulls -> labels -> edges -> nodes)
  const hullRenderer = createHullRenderer({ parent: g, communitiesMap, visualScale, opacity: immediateParams.current.hullOpacity });
  const hullLabelGroup = g.append("g").attr("class", "hull-labels");

  const linkGroup = g.append("g")
    .attr("stroke", colors.edge.default)
    .attr("stroke-opacity", immediateParams.current.edgeOpacity * 0.4);

  // Node group container (persists across updateData)
  const nodeGroup = g.append("g");

  // Hover tooltip (persists across updateData)
  const tooltip = createHoverTooltip(g);

  // Helper to set up node visuals and event handlers
  function setupNodeGroup(
    selection: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>,
    colors: Map<string, string>
  ) {
    // Draw circles
    selection
      .append("circle")
      .attr("r", (d) => getNodeRadius(d, immediateParams.current.dotScale) * visualScale)
      .attr("fill", (d) => getNodeColor(d, colors))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5 * visualScale);

    // Hover tooltips for articles/chunks
    selection
      .filter((d) => d.type === "article" || d.type === "chunk")
      .on("mouseenter", (_, d) => {
        const offset = getNodeRadius(d, immediateParams.current.dotScale) * visualScale * 0.7;
        tooltip.show(d.label, d.x! + offset + 8, d.y! + offset + 16);
      })
      .on("mouseleave", () => tooltip.hide());

    // Hover tooltips for keywords
    selection
      .filter((d) => d.type === "keyword")
      .on("mouseenter", (_, d) => {
        const memberCount = d.communityMembers?.length || 0;
        const label = memberCount > 0
          ? `${d.label} (+${memberCount}: ${d.communityMembers!.slice(0, 3).join(", ")}${memberCount > 3 ? "..." : ""})`
          : d.label;
        const offset = getNodeRadius(d, immediateParams.current.dotScale) * visualScale * 0.7;
        tooltip.show(label, d.x! + offset + 8, d.y! + offset + 16);
      })
      .on("mouseleave", () => tooltip.hide());

    // Click handlers
    if (callbacks.onNodeExpand) {
      selection
        .filter((d) => d.type === "article")
        .style("cursor", "pointer")
        .on("dblclick", (event, d) => {
          event.stopPropagation();
          const dbNodeId = d.id.replace(/^art:/, "");
          callbacks.onNodeExpand!(d.id, dbNodeId);
        });
    }

    if (callbacks.onKeywordClick) {
      selection
        .filter((d) => d.type === "keyword")
        .style("cursor", "pointer")
        .on("click", (event, d) => {
          event.stopPropagation();
          callbacks.onKeywordClick!(d.label);
        });
    }
  }

  // Initial link selection
  let linkSelection = linkGroup
    .selectAll<SVGPathElement, SimLink>("path")
    .data(currentLinks, (d) => {
      const sourceId = typeof d.source === "string" ? d.source : d.source.id;
      const targetId = typeof d.target === "string" ? d.target : d.target.id;
      return `${sourceId}-${targetId}`;
    })
    .join("path")
    .attr("fill", "none")
    .attr("stroke-width", 3 * visualScale);

  // Initial node selection
  let nodeSelection = nodeGroup
    .selectAll<SVGGElement, SimNode>("g")
    .data(currentNodes, (d) => d.id)
    .join("g");

  setupNodeGroup(nodeSelection, blendedColors);

  // Track current curve method to detect changes
  let currentCurveMethod: CurveMethod | null = null;

  // Tick function to update positions
  function tick() {
    // Compute edge curve directions on first tick or when method changes
    const method = immediateParams.current.curveMethod;
    if (!edgeCurveDirections || currentCurveMethod !== method) {
      edgeCurveDirections = computeEdgeCurveDirections(currentNodes, currentLinks, method);
      currentCurveMethod = method;
    }

    // Update link positions (curved paths)
    linkSelection.attr("d", (d) => computeCurvedPath(d, immediateParams.current.edgeCurve, edgeCurveDirections!.get(d) ?? 1));

    // Update node positions
    nodeSelection.attr("transform", (d) => `translate(${d.x},${d.y})`);

    // Update cluster hulls
    hullRenderer.update();

    // Update hull labels using D3 data join (avoids recreating DOM elements every tick)
    const visibleIds = visibleIdsRef?.current;
    const fontSize = 60 * immediateParams.current.dotScale * visualScale;

    // Build label data array
    interface LabelData {
      communityId: number;
      centroid: [number, number];
      label: string;
      opacity: number;
    }
    const labelData: LabelData[] = [];

    for (const [communityId, members] of communitiesMap) {
      const visibleMembers = visibleIds
        ? members.filter((m) => visibleIds.has(m.id))
        : members;

      if (visibleMembers.length === 0) continue;

      const points: [number, number][] = visibleMembers.map((n) => [n.x!, n.y!]);
      const geometry = computeHullGeometry(points);

      if (geometry) {
        const hub = visibleMembers.find((m) => m.communityMembers && m.communityMembers.length > 0);
        const label = hub?.hullLabel || hub?.label || visibleMembers[0].label;
        const visibilityRatio = visibleMembers.length / members.length;
        const opacity = visibleIds ? Math.max(0.2, visibilityRatio) * 0.7 : 0.7;

        labelData.push({ communityId, centroid: geometry.centroid, label, opacity });
      }
    }

    // D3 data join for hull labels
    const textSelection = hullLabelGroup
      .selectAll<SVGTextElement, LabelData>("text")
      .data(labelData, (d) => String(d.communityId));

    // Remove exiting labels
    textSelection.exit().remove();

    // Enter new labels
    const enterSelection = textSelection
      .enter()
      .append("text")
      .attr("text-anchor", "middle")
      .attr("font-weight", "600")
      .style("pointer-events", "none");

    // Update all labels (enter + update)
    const merged = enterSelection.merge(textSelection);

    merged.each(function (d) {
      const text = d3.select(this);
      const words = d.label.split(/\s+/);
      const lineHeight = fontSize;

      // Update position and style
      text
        .attr("x", d.centroid[0])
        .attr("y", d.centroid[1] - ((words.length - 1) * lineHeight) / 2)
        .attr("font-size", `${fontSize}px`)
        .attr("fill", communityColorScale(String(d.communityId)))
        .attr("fill-opacity", d.opacity);

      // Check if label text changed (compare current tspan content)
      const currentTspans = text.selectAll<SVGTSpanElement, unknown>("tspan");
      const currentText = currentTspans.nodes().map((n) => n.textContent ?? "").join(" ");

      if (currentText !== d.label) {
        // Label changed - rebuild tspans
        text.selectAll("tspan").remove();
        words.forEach((word, i) => {
          text
            .append("tspan")
            .attr("x", d.centroid[0])
            .attr("dy", i === 0 ? 0 : lineHeight)
            .text(word);
        });
      } else {
        // Label same - just update tspan x positions
        currentTspans.attr("x", d.centroid[0]);
      }
    });
  }

  /** Update all visual attributes without relayout (reads from immediateParams ref) */
  function updateVisuals() {
    const params = immediateParams.current;

    // Recompute curve directions if method changed
    if (currentCurveMethod !== params.curveMethod) {
      edgeCurveDirections = computeEdgeCurveDirections(currentNodes, currentLinks, params.curveMethod);
      currentCurveMethod = params.curveMethod;
    }

    // Update circle sizes
    nodeSelection
      .select("circle")
      .attr("r", (d) => getNodeRadius(d, params.dotScale) * visualScale);

    // Update edge opacity
    linkGroup.attr("stroke-opacity", params.edgeOpacity * 0.4);

    // Update edge curves
    linkSelection.attr("d", (d) => computeCurvedPath(d, params.edgeCurve, edgeCurveDirections?.get(d) ?? 1));

    // Update hull opacity
    hullRenderer.update(params.hullOpacity);
  }

  /** Update nodes and links dynamically (for semantic zoom Phase 2) */
  function updateData(newNodes: SimNode[], newLinks: SimLink[]) {
    // Update internal state
    currentNodes = newNodes;
    currentLinks = newLinks;
    blendedColors = computeBlendedColors(currentNodes, currentLinks);
    edgeCurveDirections = null; // Will recompute on next tick
    communitiesMap = groupNodesByCommunity(currentNodes);

    // Update hull renderer with new communities
    hullRenderer.updateCommunities(communitiesMap);

    // D3 data join for links (with key function)
    linkSelection = linkGroup
      .selectAll<SVGPathElement, SimLink>("path")
      .data(currentLinks, (d) => {
        const sourceId = typeof d.source === "string" ? d.source : d.source.id;
        const targetId = typeof d.target === "string" ? d.target : d.target.id;
        return `${sourceId}-${targetId}`;
      })
      .join(
        (enter) => enter.append("path")
          .attr("fill", "none")
          .attr("stroke-width", 3 * visualScale),
        (update) => update,
        (exit) => exit.remove()
      );

    // D3 data join for nodes (with key function)
    nodeSelection = nodeGroup
      .selectAll<SVGGElement, SimNode>("g")
      .data(currentNodes, (d) => d.id)
      .join(
        (enter) => {
          const g = enter.append("g");
          setupNodeGroup(g, blendedColors);
          return g;
        },
        (update) => update,
        (exit) => exit.remove()
      );
  }

  // Fit view to show all current nodes with padding
  function fitToNodes(padding = 0.2, animate = true) {
    if (currentNodes.length === 0) return;

    // Compute bounding box of current nodes
    const xs = currentNodes.map(n => n.x ?? 0);
    const ys = currentNodes.map(n => n.y ?? 0);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const graphWidth = maxX - minX || 1;
    const graphHeight = maxY - minY || 1;
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    // Calculate scale to fit with padding
    const scale = Math.min(
      width / (graphWidth * (1 + padding)),
      height / (graphHeight * (1 + padding)),
      1 // Don't zoom in past 1x
    );

    // Calculate transform to center the graph
    const newTransform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-graphCenterX, -graphCenterY);

    // Apply transform (with or without animation)
    if (animate) {
      svg.transition().duration(300).call(zoom.transform, newTransform);
    } else {
      svg.call(zoom.transform, newTransform);
    }
  }

  return {
    tick,
    updateVisuals,
    updateData,
    fitToNodes,
    // Use getters so these always return current values after updateData
    get nodeSelection() { return nodeSelection; },
    get linkSelection() { return linkSelection; },
    getTransform: () => {
      const transform = d3.zoomTransform(svgElement);
      return { k: transform.k, x: transform.x, y: transform.y };
    },
    getViewport: () => ({ width, height }),
    destroy: () => {
      svg.selectAll("*").remove();
    },
  };
}

/**
 * Add drag behavior to nodes (for force simulation mode).
 */
export function addDragBehavior(
  nodeSelection: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>,
  simulation: d3.Simulation<SimNode, SimLink>,
  onDragStart?: () => void
): void {
  nodeSelection.call(
    d3.drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) {
          onDragStart?.();
          simulation.alphaTarget(0.3).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      })
  );
}
