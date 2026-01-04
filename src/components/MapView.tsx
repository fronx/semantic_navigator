"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import * as d3 from "d3";
import type { MapData, MapNode, MapEdge } from "@/app/api/map/route";
import {
  type LayoutMode,
  computeUmapLayout,
  createForceSimulation,
} from "@/lib/map-layout";
import {
  createRenderer,
  addDragBehavior,
  type SimNode,
  type SimLink,
  type MapRenderer,
  type ImmediateParams,
} from "@/lib/map-renderer";
import { useMapSearch } from "@/hooks/useMapSearch";
import { useMapFilterOpacity } from "@/hooks/useMapFilterOpacity";
import { MapSidebar, type CurveMethod } from "./MapSidebar";

/** Hook to get a stable ref that always holds the latest value */
function useLatestRef<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
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
  const linkSelectionRef = useRef<d3.Selection<SVGPathElement, SimLink, SVGGElement, unknown> | null>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [edgeOpacity, setEdgeOpacity] = useState(0.4);
  const [hullOpacity, setHullOpacity] = useState(0.1);
  const [edgeCurve, setEdgeCurve] = useState(0.25); // 0-0.7, using circular arcs
  const [curveMethod, setCurveMethod] = useState<CurveMethod>("hybrid");
  const [clustered, setClustered] = useState(false); // Default to clustered view
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [umapProgress, setUmapProgress] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // URL-persisted settings
  const maxEdges = parseInt(searchParams.get("density") || "10", 10);
  const [pendingMaxEdges, setPendingMaxEdges] = useState(maxEdges);

  const level = parseInt(searchParams.get("level") || "7", 10);
  const [pendingLevel, setPendingLevel] = useState(level);

  const layoutMode = (searchParams.get("layout") || "force") as LayoutMode;

  // Dot size uses log scale: slider value -1 to 1 maps to 0.1x to 10x
  // Default: -0.2 = 0.63x
  const dotSlider = parseFloat(searchParams.get("dotSize") || "-0.2");
  const dotSize = Math.pow(10, dotSlider); // Convert log slider to linear scale

  // Immediate params: visual settings that update without relayout
  const immediateParams = useLatestRef<ImmediateParams>({
    dotScale: dotSize,
    edgeOpacity,
    hullOpacity,
    edgeCurve,
    curveMethod,
  });

  // Fit mode: if true, layout fits within canvas with smaller elements
  // If false (overflow), layout extends beyond canvas, need to zoom out
  const fitMode = searchParams.get("fit") === "true"; // Default to false (overflow mode)

  // UMAP force balance tuning (for debugging layout convergence)
  // Experiments show repulsion=100 gives balanced article/keyword distribution (ratio ~1.03)
  // See lab/graph-layout/README.md for details
  const attractionStrength = searchParams.get("attraction")
    ? parseFloat(searchParams.get("attraction")!)
    : undefined; // undefined = library default (1.0)
  const repulsionStrength = parseFloat(searchParams.get("repulsion") || "100");
  const minAttractiveScale = searchParams.get("minAttrScale")
    ? parseFloat(searchParams.get("minAttrScale")!)
    : undefined; // undefined = default (50). With minDist=20, creates 1003px exclusion zone!

  const setMaxEdges = (value: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("density", String(value));
    router.replace(`?${params}`, { scroll: false });
  };

  const setLevel = (value: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("level", String(value));
    router.replace(`?${params}`, { scroll: false });
  };

  const setLayoutMode = (value: LayoutMode) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("layout", value);
    router.replace(`?${params}`, { scroll: false });
  };

  const setDotSize = (value: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("dotSize", String(value));
    router.replace(`?${params}`, { scroll: false });
  };

  const setFitMode = (value: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("fit", String(value));
    router.replace(`?${params}`, { scroll: false });
  };

  // Sync pending values when URL params change
  useEffect(() => {
    setPendingMaxEdges(maxEdges);
  }, [maxEdges]);

  useEffect(() => {
    setPendingLevel(level);
  }, [level]);


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
    params.set("level", String(level));
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
  }, [showNeighbors, maxEdges, clustered, level, filterQuery, synonymThreshold]);

  useEffect(() => {
    if (!data || !svgRef.current) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    let cancelled = false;

    if (layoutMode === "umap") {
      // UMAP mode: build local nodes/links, update via UMAP progress
      const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const links: SimLink[] = data.edges
        .map((e) => ({
          source: nodeMap.get(e.source)!,
          target: nodeMap.get(e.target)!,
          similarity: e.similarity,
        }))
        .filter((l) => l.source && l.target);

      const renderer = createRenderer({
        svg: svgRef.current,
        nodes,
        links,
        immediateParams,
        fit: fitMode,
        callbacks: {
          onNodeExpand: handleNodeExpand,
          onKeywordClick,
        },
      });

      rendererRef.current = renderer;
      nodeSelectionRef.current = renderer.nodeSelection;
      linkSelectionRef.current = renderer.linkSelection;

      computeUmapLayout(data.nodes, data.edges, width, height, {
        fit: fitMode,
        attractionStrength,
        repulsionStrength,
        minAttractiveScale,
        onProgress: ({ progress, positions }) => {
          if (cancelled) return false;
          setUmapProgress(progress);
          for (const p of positions) {
            const node = nodeMap.get(p.id);
            if (node) {
              node.x = p.x;
              node.y = p.y;
            }
          }
          renderer.tick();
        },
      }).then(() => {
        if (!cancelled) setUmapProgress(null);
      });

      return () => {
        cancelled = true;
        renderer.destroy();
      };
    }

    // Force simulation mode - use shared configuration
    const { simulation, nodes, links } = createForceSimulation(
      data.nodes,
      data.edges,
      width,
      height,
      { fit: fitMode }
    );

    const renderer = createRenderer({
      svg: svgRef.current,
      nodes: nodes as SimNode[],
      links: links as SimLink[],
      immediateParams,
      fit: fitMode,
      callbacks: {
        onNodeExpand: handleNodeExpand,
        onKeywordClick,
      },
    });

    rendererRef.current = renderer;
    nodeSelectionRef.current = renderer.nodeSelection;
    linkSelectionRef.current = renderer.linkSelection;

    // Configure and start animated simulation (shared function returns stopped)
    simulation.alphaTarget(0.2).alphaDecay(0.02).restart();

    // Track simulation settling
    let coolingDown = false;
    let tickCount = 0;
    const maxTicks = 2000;
    const velocityThreshold = 0.5;

    // Add drag behavior for force mode
    addDragBehavior(renderer.nodeSelection, simulation, () => {
      coolingDown = false;
      tickCount = 0;
    });

    simulation.on("tick", () => {
      tickCount++;

      if (tickCount > 50) {
        const velocities = nodes
          .map((d) => Math.sqrt((d.vx ?? 0) ** 2 + (d.vy ?? 0) ** 2))
          .sort((a, b) => b - a);

        const p95Index = Math.floor(nodes.length * 0.05);
        const topVelocity = velocities[p95Index] ?? velocities[0] ?? 0;

        if (topVelocity < velocityThreshold && !coolingDown) {
          coolingDown = true;
          simulation.alphaTarget(0);
        }

        if (coolingDown && simulation.alpha() < 0.05 && topVelocity < velocityThreshold) {
          simulation.stop();
        }

        if (tickCount >= maxTicks) {
          simulation.stop();
        }
      }

      // In fit mode, scale positions to fit within canvas
      if (fitMode && nodes.length > 0) {
        const padding = 100;
        const xs = nodes.map((n) => n.x ?? 0);
        const ys = nodes.map((n) => n.y ?? 0);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const scale = Math.min(
          (width - 2 * padding) / rangeX,
          (height - 2 * padding) / rangeY,
          1 // Don't scale up if already fits
        );
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        for (const node of nodes) {
          node.x = width / 2 + ((node.x ?? 0) - cx) * scale;
          node.y = height / 2 + ((node.y ?? 0) - cy) * scale;
        }
      }

      renderer.tick();
    });

    return () => {
      simulation.stop();
      renderer.destroy();
    };
  }, [data, layoutMode, fitMode]);

  // Update visuals without relayout when immediate params change
  useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.updateVisuals();
    rendererRef.current.tick(); // Re-render hull labels with new font size
  }, [dotSize, edgeOpacity, hullOpacity, edgeCurve, curveMethod]);

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

  const articleCount = data.nodes.filter((n) => n.type === "article").length;
  const chunkCount = data.nodes.filter((n) => n.type === "chunk").length;
  const keywordCount = data.nodes.filter((n) => n.type === "keyword").length;

  return (
    <div className="bg-white dark:bg-zinc-900 overflow-hidden flex h-full relative">
      <MapSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        articleCount={articleCount}
        chunkCount={chunkCount}
        keywordCount={keywordCount}
        filterKeywords={data.searchMeta?.premiseKeywords}
        onClearFilter={onClearFilter}
        level={pendingLevel}
        onLevelChange={setPendingLevel}
        onLevelCommit={() => setLevel(pendingLevel)}
        density={pendingMaxEdges}
        onDensityChange={setPendingMaxEdges}
        onDensityCommit={() => setMaxEdges(pendingMaxEdges)}
        clustered={clustered}
        onClusteredChange={setClustered}
        showNeighbors={showNeighbors}
        onShowNeighborsChange={setShowNeighbors}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        umapProgress={umapProgress}
        fitMode={fitMode}
        onFitModeChange={setFitMode}
        dotSize={dotSize}
        dotSlider={dotSlider}
        onDotSizeChange={setDotSize}
        edgeOpacity={edgeOpacity}
        onEdgeOpacityChange={setEdgeOpacity}
        edgeCurve={edgeCurve}
        onEdgeCurveChange={setEdgeCurve}
        curveMethod={curveMethod}
        onCurveMethodChange={setCurveMethod}
        hullOpacity={hullOpacity}
        onHullOpacityChange={setHullOpacity}
      />

      {/* Map */}
      <svg
        ref={svgRef}
        className="flex-1 h-full"
        style={{ cursor: "grab" }}
      />
    </div>
  );
}
