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
  const { svg: svgElement, nodes, links, immediateParams, visibleIdsRef, initialZoom = 1, fit = false, callbacks } = options;

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

  // Precompute blended colors
  const blendedColors = computeBlendedColors(nodes, links);

  // Precompute edge curve directions for angular resolution
  // (will be recomputed on first tick when positions are more stable)
  let edgeCurveDirections: Map<SimLink, number> | null = null;

  // Group keyword nodes by community for hulls
  const communitiesMap = groupNodesByCommunity(nodes);

  // Draw layers (order matters: hulls -> labels -> edges -> nodes)
  const hullRenderer = createHullRenderer({ parent: g, communitiesMap, visualScale, opacity: immediateParams.current.hullOpacity });
  const hullLabelGroup = g.append("g").attr("class", "hull-labels");

  const linkGroup = g.append("g")
    .attr("stroke", colors.edge.default)
    .attr("stroke-opacity", immediateParams.current.edgeOpacity * 0.4);

  const linkSelection = linkGroup
    .selectAll<SVGPathElement, SimLink>("path")
    .data(links)
    .join("path")
    .attr("fill", "none")
    .attr("stroke-width", 3 * visualScale);

  const nodeSelection = g
    .append("g")
    .selectAll<SVGGElement, SimNode>("g")
    .data(nodes)
    .join("g");

  // Draw node circles
  nodeSelection
    .append("circle")
    .attr("r", (d) => getNodeRadius(d, immediateParams.current.dotScale) * visualScale)
    .attr("fill", (d) => getNodeColor(d, blendedColors))
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5 * visualScale);

  // Hover tooltips
  const tooltip = createHoverTooltip(g);

  nodeSelection
    .filter((d) => d.type === "article" || d.type === "chunk")
    .on("mouseenter", (_, d) => {
      const offset = getNodeRadius(d, immediateParams.current.dotScale) * visualScale * 0.7;
      tooltip.show(d.label, d.x! + offset + 8, d.y! + offset + 16);
    })
    .on("mouseleave", () => tooltip.hide());

  nodeSelection
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
    nodeSelection
      .filter((d) => d.type === "article")
      .style("cursor", "pointer")
      .on("dblclick", (event, d) => {
        event.stopPropagation();
        const dbNodeId = d.id.replace(/^art:/, "");
        callbacks.onNodeExpand!(d.id, dbNodeId);
      });
  }

  if (callbacks.onKeywordClick) {
    nodeSelection
      .filter((d) => d.type === "keyword")
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        callbacks.onKeywordClick!(d.label);
      });
  }

  // Track current curve method to detect changes
  let currentCurveMethod: CurveMethod | null = null;

  // Tick function to update positions
  function tick() {
    // Compute edge curve directions on first tick or when method changes
    const method = immediateParams.current.curveMethod;
    if (!edgeCurveDirections || currentCurveMethod !== method) {
      edgeCurveDirections = computeEdgeCurveDirections(nodes, links, method);
      currentCurveMethod = method;
    }

    // Update link positions (curved paths)
    linkSelection.attr("d", (d) => computeCurvedPath(d, immediateParams.current.edgeCurve, edgeCurveDirections!.get(d) ?? 1));

    // Update node positions
    nodeSelection.attr("transform", (d) => `translate(${d.x},${d.y})`);

    // Update cluster hulls
    hullRenderer.update();

    // Update hull labels
    hullLabelGroup.selectAll("text").remove();

    // Get current visible IDs (if semantic zoom is active)
    const visibleIds = visibleIdsRef?.current;

    for (const [communityId, members] of communitiesMap) {
      // Filter members to only visible ones (if semantic zoom active)
      const visibleMembers = visibleIds
        ? members.filter((m) => visibleIds.has(m.id))
        : members;

      // Skip communities with no visible members
      if (visibleMembers.length === 0) continue;

      const points: [number, number][] = visibleMembers.map((n) => [n.x!, n.y!]);
      const geometry = computeHullGeometry(points);

      if (geometry) {
        const centroid = geometry.centroid;

        // Hull label (scaled with dot size and visual mode)
        const hub = visibleMembers.find((m) => m.communityMembers && m.communityMembers.length > 0);
        const label = hub?.label || visibleMembers[0].label;
        const words = label.split(/\s+/);
        const fontSize = 60 * immediateParams.current.dotScale * visualScale;
        const lineHeight = fontSize;

        // Compute opacity based on how many members are visible vs total
        const visibilityRatio = visibleMembers.length / members.length;
        const labelOpacity = visibleIds ? Math.max(0.2, visibilityRatio) * 0.7 : 0.7;

        const textEl = hullLabelGroup
          .append("text")
          .attr("x", centroid[0])
          .attr("y", centroid[1] - ((words.length - 1) * lineHeight) / 2)
          .attr("text-anchor", "middle")
          .attr("font-size", `${fontSize}px`)
          .attr("font-weight", "600")
          .attr("fill", communityColorScale(String(communityId)))
          .attr("fill-opacity", labelOpacity)
          .style("pointer-events", "none");

        words.forEach((word, i) => {
          textEl
            .append("tspan")
            .attr("x", centroid[0])
            .attr("dy", i === 0 ? 0 : lineHeight)
            .text(word);
        });
      }
    }
  }

  /** Update all visual attributes without relayout (reads from immediateParams ref) */
  function updateVisuals() {
    const params = immediateParams.current;

    // Recompute curve directions if method changed
    if (currentCurveMethod !== params.curveMethod) {
      edgeCurveDirections = computeEdgeCurveDirections(nodes, links, params.curveMethod);
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

  return {
    tick,
    updateVisuals,
    nodeSelection,
    linkSelection,
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
