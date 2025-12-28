"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type { MapData, MapNode, MapEdge } from "@/app/api/map/route";

interface SimNode extends d3.SimulationNodeDatum, MapNode {}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: SimNode | string;
  target: SimNode | string;
  similarity?: number;
}

export function MapView() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/map")
      .then((res) => res.json())
      .then((data) => {
        setData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

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
      return sizeScale(d.size || 400);
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
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.4)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", 3);

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

    // Circles for nodes
    node
      .append("circle")
      .attr("r", getNodeRadius)
      .attr("fill", (d) => (d.type === "article" ? "#3b82f6" : "#10b981"))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5);

    // Labels
    node
      .append("text")
      .text((d) => d.label)
      .attr("x", (d) => getNodeRadius(d) + 8)
      .attr("y", 8)
      .attr("font-size", "24px")
      .attr("fill", "currentColor")
      .attr("class", "dark:fill-zinc-300 fill-zinc-700");

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
      <div className="flex items-center justify-center h-[calc(100vh-7rem)] bg-white dark:bg-zinc-900 rounded-lg border dark:border-zinc-800">
        <span className="text-zinc-500">Loading map...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-7rem)] bg-white dark:bg-zinc-900 rounded-lg border dark:border-zinc-800">
        <span className="text-red-500">Error: {error}</span>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-7rem)] bg-white dark:bg-zinc-900 rounded-lg border dark:border-zinc-800">
        <span className="text-zinc-500">No data to display. Import some articles first.</span>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border dark:border-zinc-800 overflow-hidden flex flex-col h-[calc(100vh-7rem)]">
      <div className="p-2 border-b dark:border-zinc-800 flex gap-4 text-xs text-zinc-500 shrink-0">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
          Articles ({data.nodes.filter((n) => n.type === "article").length})
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
          Keywords ({data.nodes.filter((n) => n.type === "keyword").length})
        </span>
      </div>
      <svg
        ref={svgRef}
        className="w-full flex-1"
        style={{ cursor: "grab" }}
      />
    </div>
  );
}
