"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { MapData, MapNode, MapEdge } from "@/app/api/map/route";
import { colors } from "@/lib/colors";
import { createHoverTooltip } from "@/lib/d3-utils";
import { useMapSearch } from "@/hooks/useMapSearch";
import { useMapFilterOpacity } from "@/hooks/useMapFilterOpacity";

interface SimNode extends d3.SimulationNodeDatum, MapNode {}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
  similarity?: number;
}

interface ChildNode {
  id: string;
  node_type: string;
  summary: string | null;
  content: string | null;
  source_path: string;
}

interface Props {
  searchQuery: string;
  filterQuery: string | null;
  synonymThreshold: number;
  onKeywordClick?: (keyword: string) => void;
  onClearFilter?: () => void;
}

export function MapView({ searchQuery, filterQuery, synonymThreshold, onKeywordClick, onClearFilter }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeSelectionRef = useRef<d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> | null>(null);
  const linkSelectionRef = useRef<d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown> | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNeighbors, setShowNeighbors] = useState(false);
  const [expandingId, setExpandingId] = useState<string | null>(null);

  // Handle node click to expand and show children (works for articles and sections)
  const handleNodeExpand = async (graphNodeId: string, dbNodeId: string) => {
    if (!data || expandingId) return;

    setExpandingId(graphNodeId);
    try {
      const res = await fetch(`/api/nodes/${dbNodeId}`);
      const { children } = await res.json() as { children: ChildNode[] | null };

      if (!children || children.length === 0) {
        setExpandingId(null);
        return;
      }

      // Replace node with its children
      setData(prev => {
        if (!prev) return prev;

        // Remove the expanded node
        const remainingNodes = prev.nodes.filter(n => n.id !== graphNodeId);

        // Find edges connected to the expanded node
        const nodeEdges = prev.edges.filter(e => e.source === graphNodeId || e.target === graphNodeId);
        const remainingEdges = prev.edges.filter(e => e.source !== graphNodeId && e.target !== graphNodeId);

        // Get keywords connected to this node
        const connectedKeywords = nodeEdges
          .map(e => e.source === graphNodeId ? e.target : e.source)
          .filter(id => id.startsWith("kw:"));

        // Add child nodes
        const childNodes: MapNode[] = children.map(child => ({
          id: `${child.node_type}:${child.id}`,
          type: child.node_type as "section" | "paragraph",
          label: child.node_type === "section"
            ? (child.summary?.slice(0, 50) || "Section")
            : (child.content?.slice(0, 50) || child.summary?.slice(0, 50) || "..."),
          size: (child.summary?.length || child.content?.length || 100),
        }));

        // Connect children to parent's keywords (distribute evenly)
        const newEdges: MapEdge[] = [];
        childNodes.forEach((child, idx) => {
          // Each child gets some of the parent's keyword connections
          const keywordsPerChild = Math.ceil(connectedKeywords.length / childNodes.length);
          const startIdx = idx * keywordsPerChild;
          const childKeywords = connectedKeywords.slice(startIdx, startIdx + keywordsPerChild);

          childKeywords.forEach(kwId => {
            newEdges.push({ source: child.id, target: kwId });
          });
        });

        return {
          ...prev,
          nodes: [...remainingNodes, ...childNodes],
          edges: [...remainingEdges, ...newEdges],
        };
      });
    } catch (err) {
      console.error("Failed to expand node:", err);
    } finally {
      setExpandingId(null);
    }
  };

  const { articleSimilarities, keywordSimilarities } = useMapSearch(searchQuery);
  useMapFilterOpacity(nodeSelectionRef, linkSelectionRef, articleSimilarities, keywordSimilarities);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("neighbors", String(showNeighbors));
    if (filterQuery) {
      params.set("query", filterQuery);
      params.set("synonymThreshold", String(synonymThreshold));
    }
    fetch(`/api/map?${params}`)
      .then((res) => res.json())
      .then((data) => {
        setData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [showNeighbors, filterQuery, synonymThreshold]);

  useEffect(() => {
    if (!data || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    svg.selectAll("*").remove();

    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = data.edges
      .map((e) => ({
        source: nodeMap.get(e.source)!,
        target: nodeMap.get(e.target)!,
        similarity: e.similarity,
      }))
      .filter((l) => l.source && l.target);

    const g = svg.append("g");

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Scale article radius by content size (sqrt for good visual spread)
    const sizeScale = d3.scaleSqrt()
      .domain([400, 2000]) // summary length range
      .range([25, 80])
      .clamp(true);

    const getNodeRadius = (d: SimNode) => {
      if (d.type === "keyword") return 18;
      if (d.type === "section") return sizeScale((d.size || 200) * 0.6);
      if (d.type === "paragraph") return sizeScale((d.size || 100) * 0.4);
      return sizeScale(d.size || 400);
    };

    const getNodeColor = (d: SimNode) => {
      switch (d.type) {
        case "article": return colors.node.article;
        case "section": return colors.node.section;
        case "paragraph": return colors.node.paragraph;
        default: return colors.node.keyword;
      }
    };

    // Force simulation
    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          // Shorter distance for high-similarity keyword pairs
          .distance((d) => d.similarity ? 40 + (1 - d.similarity) * 100 : 120)
          // Stronger pull for high-similarity pairs
          .strength((d) => d.similarity ? 0.5 + d.similarity * 0.5 : 0.3)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius((d) => getNodeRadius(d) + 10));

    // Draw edges
    const link = g
      .append("g")
      .attr("stroke", colors.edge.default)
      .attr("stroke-opacity", 0.4)
      .selectAll<SVGLineElement, SimLink>("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 3);

    linkSelectionRef.current = link;

    // Draw nodes
    const node = g
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
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

    nodeSelectionRef.current = node;

    // Circles for nodes
    node
      .append("circle")
      .attr("r", getNodeRadius)
      .attr("fill", getNodeColor)
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5);

    // Click handler for expandable nodes (articles and sections)
    const expandableNodes = node.filter((d) => d.type === "article" || d.type === "section");
    expandableNodes
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        // Extract the UUID from the node id (format: "art:uuid" or "section:uuid")
        const dbNodeId = d.id.replace(/^(art|section):/, "");
        handleNodeExpand(d.id, dbNodeId);
      });

    // Labels for keyword nodes only (articles show on hover)
    const keywordNodes = node.filter((d) => d.type === "keyword");

    keywordNodes
      .append("text")
      .text((d) => d.label)
      .attr("x", (d) => getNodeRadius(d) + 8)
      .attr("y", 4)
      .attr("font-size", "24px")
      .attr("fill", "currentColor")
      .attr("class", "dark:fill-zinc-300 fill-zinc-700")
      .style("pointer-events", "none");

    // Click handler for keyword nodes
    if (onKeywordClick) {
      keywordNodes
        .style("cursor", "pointer")
        .on("click", (event, d) => {
          event.stopPropagation();
          onKeywordClick(d.label);
        });
    }

    // Hover tooltip for article/section/paragraph nodes (rendered last = on top)
    const tooltip = createHoverTooltip(g);
    node
      .filter((d) => d.type === "article" || d.type === "section" || d.type === "paragraph")
      .on("mouseenter", (_, d) => {
        const offset = getNodeRadius(d) * 0.7;
        tooltip.show(d.label, d.x! + offset + 8, d.y! + offset + 16);
      })
      .on("mouseleave", () => tooltip.hide());

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x!)
        .attr("y1", (d) => (d.source as SimNode).y!)
        .attr("x2", (d) => (d.target as SimNode).x!)
        .attr("y2", (d) => (d.target as SimNode).y!);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">Loading map...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-zinc-900">
        <span className="text-red-500">Error: {error}</span>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">No data to display. Import some articles first.</span>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 overflow-hidden flex flex-col h-full">
      <div className="p-2 border-b dark:border-zinc-800 flex gap-4 text-xs text-zinc-500 shrink-0 flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
          Articles ({data.nodes.filter((n) => n.type === "article").length})
        </span>
        {data.nodes.some((n) => n.type === "section") && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-violet-500 inline-block" />
            Sections ({data.nodes.filter((n) => n.type === "section").length})
          </span>
        )}
        {data.nodes.some((n) => n.type === "paragraph") && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
            Paragraphs ({data.nodes.filter((n) => n.type === "paragraph").length})
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
          Keywords ({data.nodes.filter((n) => n.type === "keyword").length})
        </span>
        {data.searchMeta && (
          <span className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <span>Context:</span>
            {data.searchMeta.premiseKeywords.slice(0, 5).map((kw, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900 rounded text-xs">
                {kw}
              </span>
            ))}
            {data.searchMeta.premiseKeywords.length > 5 && (
              <span className="text-xs">+{data.searchMeta.premiseKeywords.length - 5} more</span>
            )}
            {onClearFilter && (
              <button
                onClick={onClearFilter}
                className="px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded hover:bg-zinc-300 dark:hover:bg-zinc-600"
              >
                Clear
              </button>
            )}
          </span>
        )}
        <label className="flex items-center gap-1 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={showNeighbors}
            onChange={(e) => setShowNeighbors(e.target.checked)}
            className="w-3 h-3"
          />
          Neighbor links
        </label>
      </div>
      <svg
        ref={svgRef}
        className="w-full flex-1"
        style={{ cursor: "grab" }}
      />
    </div>
  );
}
