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
}

export interface MapRenderer {
  /** Update node/link positions (call on each tick) */
  tick: () => void;
  /** Update circle sizes without relayout (reads from dotScaleRef) */
  updateCircleSizes: () => void;
  /** Get node selection for external styling (search highlighting) */
  nodeSelection: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>;
  /** Get link selection for external styling */
  linkSelection: d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown>;
  /** Clean up */
  destroy: () => void;
}

interface RendererOptions {
  svg: SVGSVGElement;
  nodes: SimNode[];
  links: SimLink[];
  showEdges: boolean;
  dotScaleRef: { current: number };
  initialZoom?: number; // Initial zoom level (default 1.0)
  /** If true, layout fits canvas - use smaller visual elements. If false (overflow mode), use larger elements. */
  fit?: boolean;
  /** Hull opacity 0-1 (default 0 = hidden) */
  hullOpacity?: number;
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
 * Create the map renderer.
 * Sets up D3 selections and returns tick function for position updates.
 */
export function createRenderer(options: RendererOptions): MapRenderer {
  const { svg: svgElement, nodes, links, showEdges, dotScaleRef, initialZoom = 1, fit = false, hullOpacity = 0, callbacks } = options;

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
    .on("zoom", (event) => g.attr("transform", event.transform));
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

  // Group keyword nodes by community for hulls
  const communitiesMap = groupNodesByCommunity(nodes);

  // Draw layers (order matters: hulls -> labels -> edges -> nodes)
  const hullRenderer = createHullRenderer({ parent: g, communitiesMap, visualScale, opacity: hullOpacity });
  const hullLabelGroup = g.append("g").attr("class", "hull-labels");

  const linkGroup = g.append("g")
    .attr("stroke", colors.edge.default)
    .attr("stroke-opacity", showEdges ? 0.4 : 0);

  const linkSelection = linkGroup
    .selectAll<SVGLineElement, SimLink>("line")
    .data(links)
    .join("line")
    .attr("stroke-width", 3 * visualScale);

  const nodeSelection = g
    .append("g")
    .selectAll<SVGGElement, SimNode>("g")
    .data(nodes)
    .join("g");

  // Draw node circles
  nodeSelection
    .append("circle")
    .attr("r", (d) => getNodeRadius(d, dotScaleRef.current) * visualScale)
    .attr("fill", (d) => getNodeColor(d, blendedColors))
    .attr("stroke", "#fff")
    .attr("stroke-width", 1.5 * visualScale);

  // Hover tooltips
  const tooltip = createHoverTooltip(g);

  nodeSelection
    .filter((d) => d.type === "article" || d.type === "chunk")
    .on("mouseenter", (_, d) => {
      const offset = getNodeRadius(d, dotScaleRef.current) * visualScale * 0.7;
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
      const offset = getNodeRadius(d, dotScaleRef.current) * visualScale * 0.7;
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

  // Tick function to update positions
  function tick() {
    // Update link positions
    linkSelection
      .attr("x1", (d) => (d.source as SimNode).x!)
      .attr("y1", (d) => (d.source as SimNode).y!)
      .attr("x2", (d) => (d.target as SimNode).x!)
      .attr("y2", (d) => (d.target as SimNode).y!);

    // Update node positions
    nodeSelection.attr("transform", (d) => `translate(${d.x},${d.y})`);

    // Update cluster hulls
    hullRenderer.update();

    // Update hull labels
    hullLabelGroup.selectAll("text").remove();

    for (const [communityId, members] of communitiesMap) {
      const points: [number, number][] = members.map((n) => [n.x!, n.y!]);
      const geometry = computeHullGeometry(points);

      if (geometry) {
        const centroid = geometry.centroid;

        // Hull label (scaled with dot size and visual mode)
        const hub = members.find((m) => m.communityMembers && m.communityMembers.length > 0);
        const label = hub?.label || members[0].label;
        const words = label.split(/\s+/);
        const fontSize = 60 * dotScaleRef.current * visualScale;
        const lineHeight = fontSize;

        const textEl = hullLabelGroup
          .append("text")
          .attr("x", centroid[0])
          .attr("y", centroid[1] - ((words.length - 1) * lineHeight) / 2)
          .attr("text-anchor", "middle")
          .attr("font-size", `${fontSize}px`)
          .attr("font-weight", "600")
          .attr("fill", communityColorScale(String(communityId)))
          .attr("fill-opacity", 0.7)
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

  function updateCircleSizes() {
    nodeSelection
      .select("circle")
      .attr("r", (d) => getNodeRadius(d, dotScaleRef.current) * visualScale);
  }

  return {
    tick,
    updateCircleSizes,
    nodeSelection,
    linkSelection,
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
