"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import * as d3 from "d3";
import type { MapData, MapNode, MapEdge } from "@/app/api/map/route";
import { colors } from "@/lib/colors";
import { createHoverTooltip } from "@/lib/d3-utils";
import { useMapSearch } from "@/hooks/useMapSearch";
import { useMapFilterOpacity } from "@/hooks/useMapFilterOpacity";

interface SimNode extends d3.SimulationNodeDatum, MapNode { }

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
  similarity?: number;
}

interface SimilarKeyword {
  keyword: string;
  similarity: number;
}

interface ChildNode {
  id: string;
  node_type: string;
  summary: string | null;
  content: string | null;
  source_path: string;
  keywords: string[];
  similarKeywords: SimilarKeyword[];
}

interface Props {
  searchQuery: string;
  filterQuery: string | null;
  synonymThreshold: number;
  onKeywordClick?: (keyword: string) => void;
  onClearFilter?: () => void;
}

export function MapView({ searchQuery, filterQuery, synonymThreshold, onKeywordClick, onClearFilter }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeSelectionRef = useRef<d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> | null>(null);
  const linkSelectionRef = useRef<d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown> | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNeighbors, setShowNeighbors] = useState(false);
  const [showEdges, setShowEdges] = useState(false); // Hidden by default
  const [clustered, setClustered] = useState(false); // Default to clustered view
  const [expandingId, setExpandingId] = useState<string | null>(null);

  const maxEdges = parseInt(searchParams.get("density") || "6", 10);
  const [pendingMaxEdges, setPendingMaxEdges] = useState(maxEdges);

  const setMaxEdges = (value: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("density", String(value));
    router.replace(`?${params}`, { scroll: false });
  };

  // Sync pending value when URL param changes
  useEffect(() => {
    setPendingMaxEdges(maxEdges);
  }, [maxEdges]);

  // Handle node click to expand and show children (articles expand to chunks)
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
        const remainingEdges = prev.edges.filter(e => e.source !== graphNodeId && e.target !== graphNodeId);

        // Keywords already in the graph (these are valid connections)
        const existingKeywords = new Set(
          prev.nodes.filter(n => n.type === "keyword").map(n => n.label)
        );

        // Collect all keywords per chunk: owned keywords + similar keywords
        // Similar keywords are article-level (from RPC) so they're valid connections
        const allKeywordsPerChunk = children.map(child => {
          const keywords = new Set(child.keywords);
          for (const sk of child.similarKeywords) {
            keywords.add(sk.keyword);
          }
          return keywords;
        });

        // Similar keywords are guaranteed to be article-level keywords (valid connections)
        const articleLevelKeywords = new Set<string>();
        for (const child of children) {
          for (const sk of child.similarKeywords) {
            articleLevelKeywords.add(sk.keyword);
          }
        }

        // Count how many chunks each keyword appears in
        const keywordChunkCount = new Map<string, number>();
        for (const keywords of allKeywordsPerChunk) {
          for (const kw of keywords) {
            keywordChunkCount.set(kw, (keywordChunkCount.get(kw) || 0) + 1);
          }
        }

        // A keyword is valid if it either:
        // 1. Already exists in the graph (connects to other articles/chunks), OR
        // 2. Appears in 2+ chunks (connects chunks within this expansion), OR
        // 3. Is an article-level keyword (from similarKeywords - exists at article level, can connect to other articles)
        const validKeywords = new Set<string>();
        for (const [kw, count] of keywordChunkCount) {
          if (existingKeywords.has(kw) || count >= 2 || articleLevelKeywords.has(kw)) {
            validKeywords.add(kw);
          }
        }

        // Add child nodes
        const childNodes: MapNode[] = children.map(child => ({
          id: `chunk:${child.id}`,
          type: "chunk" as const,
          label: child.content?.slice(0, 50) || child.summary?.slice(0, 50) || "...",
          size: (child.content?.length || child.summary?.length || 100),
        }));

        // Connect each chunk to valid keywords (owned + similar)
        const newEdges: MapEdge[] = [];
        const newKeywordNodes: MapNode[] = [];
        const addedKeywords = new Set<string>();

        children.forEach((_, idx) => {
          const chunkId = childNodes[idx].id;
          const chunkKeywords = allKeywordsPerChunk[idx];

          for (const kw of chunkKeywords) {
            if (!validKeywords.has(kw)) continue; // Skip dangling keywords

            const kwNodeId = `kw:${kw}`;
            // Add keyword node if not already in graph
            if (!existingKeywords.has(kw) && !addedKeywords.has(kw)) {
              addedKeywords.add(kw);
              newKeywordNodes.push({ id: kwNodeId, type: "keyword", label: kw });
            }
            newEdges.push({ source: chunkId, target: kwNodeId });
          }
        });

        return {
          ...prev,
          nodes: [...remainingNodes, ...childNodes, ...newKeywordNodes],
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
    params.set("maxEdges", String(maxEdges));
    params.set("clustered", String(clustered));
    if (filterQuery) {
      params.set("query", filterQuery);
      params.set("synonymThreshold", String(synonymThreshold));
    }
    fetch(`/api/map?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setData(null);
        } else {
          setData(data);
          setError(null);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [showNeighbors, maxEdges, clustered, filterQuery, synonymThreshold]);

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
      if (d.type === "chunk") return sizeScale((d.size || 150) * 0.5);
      return sizeScale(d.size || 400); // article
    };

    // Color scale for keyword communities (37 communities, use extended palette)
    const communityColorScale = d3.scaleOrdinal(d3.schemeTableau10);

    const getNodeColor = (d: SimNode) => {
      switch (d.type) {
        case "article": return colors.node.article;
        case "chunk": return colors.node.chunk;
        default:
          // Color keywords by community, grey if no community
          if (d.communityId !== undefined) {
            return communityColorScale(String(d.communityId));
          }
          return "#9ca3af"; // grey-400 for unclustered
      }
    };

    // Helper to check if a node is a hub (has collapsed community members)
    const isHubNode = (node: SimNode | string) => {
      if (typeof node === "string") return false;
      return node.communityMembers && node.communityMembers.length > 0;
    };

    // Force simulation
    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          // Shorter distance for high-similarity keyword pairs, longer for hub connections
          .distance((d) => {
            const hubConnected = isHubNode(d.source) || isHubNode(d.target);
            const baseDistance = d.similarity ? 40 + (1 - d.similarity) * 100 : 120;
            return hubConnected ? baseDistance * 2 : baseDistance;
          })
          // Weaker pull for hub connections to prevent hairballing
          .strength((d) => {
            const hubConnected = isHubNode(d.source) || isHubNode(d.target);
            const baseStrength = d.similarity ? 0.5 + d.similarity * 0.5 : 0.3;
            return hubConnected ? baseStrength * 0.3 : baseStrength;
          })
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<SimNode>().radius((d) => getNodeRadius(d) + 10))
      // Keep simulation energized until positions settle
      .alphaTarget(0.2)
      .alphaDecay(0.02);

    // Track simulation settling state
    let coolingDown = false;
    let tickCount = 0;
    const maxTicks = 2000; // Safety limit
    const velocityThreshold = 0.5; // pixels per tick

    // Draw cluster hulls (before edges and nodes so they're in background)
    const hullGroup = g.append("g").attr("class", "hulls");
    const hullLabelGroup = g.append("g").attr("class", "hull-labels");

    // Group keyword nodes by community
    const communitiesMap = new Map<number, SimNode[]>();
    for (const n of nodes) {
      if (n.type === "keyword" && n.communityId !== undefined) {
        if (!communitiesMap.has(n.communityId)) {
          communitiesMap.set(n.communityId, []);
        }
        communitiesMap.get(n.communityId)!.push(n);
      }
    }

    // Draw edges (hidden by default)
    const linkGroup = g.append("g")
      .attr("stroke", colors.edge.default)
      .attr("stroke-opacity", showEdges ? 0.4 : 0);

    const link = linkGroup
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
            if (!event.active) {
              coolingDown = false; // Reset so simulation can settle again
              tickCount = 0;
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

    nodeSelectionRef.current = node;

    // Circles for nodes
    node
      .append("circle")
      .attr("r", getNodeRadius)
      .attr("fill", getNodeColor)
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5);

    // Double-click handler for expandable nodes (articles only - chunks are leaf nodes)
    const expandableNodes = node.filter((d) => d.type === "article");
    expandableNodes
      .style("cursor", "pointer")
      .on("dblclick", (event, d) => {
        event.stopPropagation();
        // Extract the UUID from the node id (format: "art:uuid")
        const dbNodeId = d.id.replace(/^art:/, "");
        handleNodeExpand(d.id, dbNodeId);
      });

    // Keyword nodes - no permanent labels, show on hover
    const keywordNodes = node.filter((d) => d.type === "keyword");

    // Click handler for keyword nodes
    if (onKeywordClick) {
      keywordNodes
        .style("cursor", "pointer")
        .on("click", (event, d) => {
          event.stopPropagation();
          onKeywordClick(d.label);
        });
    }

    // Hover tooltip for all non-article nodes
    const tooltip = createHoverTooltip(g);

    // Article/chunk nodes show label on hover
    node
      .filter((d) => d.type === "article" || d.type === "chunk")
      .on("mouseenter", (_, d) => {
        const offset = getNodeRadius(d) * 0.7;
        tooltip.show(d.label, d.x! + offset + 8, d.y! + offset + 16);
      })
      .on("mouseleave", () => tooltip.hide());

    // Keyword nodes show label on hover (with community members if hub)
    keywordNodes
      .on("mouseenter", (_, d) => {
        const memberCount = d.communityMembers?.length || 0;
        const label = memberCount > 0
          ? `${d.label} (+${memberCount}: ${d.communityMembers!.slice(0, 3).join(", ")}${memberCount > 3 ? "..." : ""})`
          : d.label;
        const offset = getNodeRadius(d) * 0.7;
        tooltip.show(label, d.x! + offset + 8, d.y! + offset + 16);
      })
      .on("mouseleave", () => tooltip.hide());

    simulation.on("tick", () => {
      tickCount++;

      // Check if top movers have settled (after initial warm-up)
      if (tickCount > 50) {
        const velocities = nodes
          .map(d => Math.sqrt((d.vx ?? 0) ** 2 + (d.vy ?? 0) ** 2))
          .sort((a, b) => b - a); // Descending order

        // Check the 95th percentile (top 5% of movers)
        const p95Index = Math.floor(nodes.length * 0.05);
        const topVelocity = velocities[p95Index] ?? velocities[0] ?? 0;

        if (topVelocity < velocityThreshold && !coolingDown) {
          // Positions settled - let simulation cool down
          coolingDown = true;
          simulation.alphaTarget(0);
        }

        // Stop once cooled down and velocities are low
        if (coolingDown && simulation.alpha() < 0.05 && topVelocity < velocityThreshold) {
          simulation.stop();
        }

        if (tickCount >= maxTicks) {
          simulation.stop();
        }
      }

      link
        .attr("x1", (d) => (d.source as SimNode).x!)
        .attr("y1", (d) => (d.source as SimNode).y!)
        .attr("x2", (d) => (d.target as SimNode).x!)
        .attr("y2", (d) => (d.target as SimNode).y!);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);

      // Update cluster hulls
      hullGroup.selectAll("path").remove();
      hullLabelGroup.selectAll("text").remove();

      for (const [communityId, members] of communitiesMap) {
        if (members.length < 3) continue; // Need at least 3 points for hull

        const points: [number, number][] = members.map(n => [n.x!, n.y!]);
        const hull = d3.polygonHull(points);

        if (hull) {
          // Expand hull slightly for padding
          const centroid = d3.polygonCentroid(hull);
          const expandedHull = hull.map(([x, y]) => {
            const dx = x - centroid[0];
            const dy = y - centroid[1];
            const scale = 1.3; // 30% padding
            return [centroid[0] + dx * scale, centroid[1] + dy * scale] as [number, number];
          });

          // Draw hull
          hullGroup
            .append("path")
            .attr("d", `M${expandedHull.join("L")}Z`)
            .attr("fill", communityColorScale(String(communityId)))
            .attr("fill-opacity", 0.08)
            .attr("stroke", communityColorScale(String(communityId)))
            .attr("stroke-opacity", 0.3)
            .attr("stroke-width", 2);

          // Find hub label for this community
          const hub = members.find(m => m.communityMembers && m.communityMembers.length > 0);
          const label = hub?.label || members[0].label;

          // Draw label at centroid
          hullLabelGroup
            .append("text")
            .attr("x", centroid[0])
            .attr("y", centroid[1])
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-size", "16px")
            .attr("font-weight", "600")
            .attr("fill", communityColorScale(String(communityId)))
            .attr("fill-opacity", 0.7)
            .style("pointer-events", "none")
            .text(label);
        }
      }
    });

    return () => {
      simulation.stop();
    };
  }, [data, showEdges]);

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

  if (!data || !data.nodes || data.nodes.length === 0) {
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
        {data.nodes.some((n) => n.type === "chunk") && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-violet-500 inline-block" />
            Chunks ({data.nodes.filter((n) => n.type === "chunk").length})
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
        <label className="flex items-center gap-2 ml-auto">
          <span>Density:</span>
          <input
            type="range"
            min="1"
            max="10"
            value={pendingMaxEdges}
            onChange={(e) => setPendingMaxEdges(parseInt(e.target.value, 10))}
            onPointerUp={() => setMaxEdges(pendingMaxEdges)}
            className="w-20 h-1"
          />
          <span className="w-4 text-center">{pendingMaxEdges}</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={clustered}
            onChange={(e) => setClustered(e.target.checked)}
            className="w-3 h-3"
          />
          Cluster synonyms
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={showEdges}
            onChange={(e) => setShowEdges(e.target.checked)}
            className="w-3 h-3"
          />
          Show edges
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
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
