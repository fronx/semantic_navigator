"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import {
  createRenderer,
  addDragBehavior,
  type SimNode,
  type SimLink,
} from "@/lib/map-renderer";
import { createForceSimulation, type ForceLink, type ForceNode } from "@/lib/map-layout";
import { forceBoundary } from "@/lib/d3-forces";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";

interface TopicsData {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
}

// Convert linear slider (0-100) to logarithmic scale (0.01 to 10)
// Middle (50) = 1.0, 0 = 0.01, 100 = 10
function sliderToStrength(value: number): number {
  if (value === 0) return 0;
  return Math.pow(10, (value - 50) / 50);
}

// Convert strength back to slider value
function strengthToSlider(strength: number): number {
  if (strength === 0) return 0;
  return Math.log10(strength) * 50 + 50;
}

export default function TopicsPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<ForceNode, ForceLink> | null>(null);
  const [data, setData] = useState<TopicsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [knnStrength, setKnnStrength] = useState(1.0); // 1.0 = normal strength

  // Fetch data
  useEffect(() => {
    setLoading(true);
    fetch("/api/topics")
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
  }, []);

  // Render graph
  useEffect(() => {
    if (!data || !svgRef.current) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Convert to MapNode format expected by renderer
    const mapNodes = data.nodes.map((n) => ({
      id: n.id,
      type: "keyword" as const,
      label: n.label,
      communityId: n.communityId,
    }));

    // Convert edges to include similarity and isKNN flag
    const mapEdges = data.edges.map((e) => ({
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

    // Store simulation ref for real-time updates
    simulationRef.current = simulation;

    // Reduce repulsion - keyword-only graph doesn't need as much separation
    simulation.force("charge", d3.forceManyBody().strength(-200));

    // Custom link force with k-NN strength multiplier
    const linkForce = d3
      .forceLink<d3.SimulationNodeDatum, ForceLink>(links)
      .id((d: d3.SimulationNodeDatum & { id?: string }) => d.id ?? "")
      .distance((d) => {
        const sim = (d as ForceLink).similarity ?? 0.5;
        return 40 + (1 - sim) * 100;
      })
      .strength((d) => {
        const link = d as ForceLink;
        const baseSim = link.similarity ?? 0.5;
        const baseStrength = 0.5 + baseSim * 0.5;
        // Apply k-NN multiplier for connectivity edges
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
    // We'll enable it once positions settle
    simulation.force("collision", null);

    // Visual params - simple defaults
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
      svg: svgRef.current,
      nodes: nodes as SimNode[],
      links: links as SimLink[],
      immediateParams,
      fit: false,
      callbacks: {
        onKeywordClick: (keyword) => {
          console.log("Clicked keyword:", keyword);
          // TODO: Expand to show articles
        },
      },
    });

    // Track simulation settling
    let tickCount = 0;
    let coolingDown = false;

    // Add drag behavior - resets cooling when user drags
    addDragBehavior(renderer.nodeSelection, simulation, () => {
      coolingDown = false;
      tickCount = 0;
      // Disable collision while repositioning
      simulation.force("collision", null);
    });

    // Start simulation - sustained energy until velocity settles
    simulation
      .alphaTarget(0.3)      // Sustained energy for layout
      .alphaDecay(0.01)      // Slow decay - let velocity criterion decide when to cool
      .velocityDecay(0.5)    // Higher friction - nodes slow down faster when near equilibrium
      .restart();

    simulation.on("tick", () => {
      tickCount++;

      // After settling period, check velocity to enable collision and cool down
      if (tickCount > 40 && !coolingDown) {
        const velocities = nodes
          .map((d) => Math.sqrt((d.vx ?? 0) ** 2 + (d.vy ?? 0) ** 2))
          .sort((a, b) => b - a);

        const p95Index = Math.floor(nodes.length * 0.05);
        const topVelocity = velocities[p95Index] ?? velocities[0] ?? 0;

        // When 95th percentile velocity drops below threshold, layout is stable
        if (topVelocity < 0.5) {
          coolingDown = true;
          // Enable collision now that nodes have found their approximate positions
          simulation.force("collision", d3.forceCollide<ForceNode>().radius(20));
          // Cool down and let collision adjust
          simulation.alphaTarget(0).alpha(0.3);
        }
      }

      renderer.tick();
    });

    return () => {
      simulation.stop();
      simulationRef.current = null;
      renderer.destroy();
    };
  }, [data, knnStrength]); // Re-create when knnStrength changes

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">Loading topics...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-red-500">Error: {error}</span>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-zinc-900">
        <span className="text-zinc-500">No topics found. Import some articles first.</span>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex-shrink-0 border-b bg-white dark:bg-zinc-900 dark:border-zinc-800">
        <div className="px-3 py-1.5 flex items-center gap-3">
          <h1 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Topics ({data.nodes.length} keywords, {data.edges.length} edges, {data.edges.filter(e => e.isKNN).length} k-NN)
          </h1>

          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <label className="flex items-center gap-1">
              <span>k-NN:</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={strengthToSlider(knnStrength)}
                onChange={(e) => setKnnStrength(sliderToStrength(parseFloat(e.target.value)))}
                className="w-20 h-3"
              />
              <span className="w-12 tabular-nums">{knnStrength.toFixed(2)}</span>
            </label>
          </div>

          <a
            href="/"
            className="text-xs text-blue-500 hover:text-blue-600 ml-auto"
          >
            Back to Map
          </a>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden bg-white dark:bg-zinc-900">
        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{ cursor: "grab" }}
        />
      </main>
    </div>
  );
}
