/**
 * D3 force simulation driver for R3F renderer.
 * Runs simulation and mutates node positions imperatively.
 */

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";
import type { SimNode } from "@/lib/map-renderer";

export interface ForceSimulationProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  /** Callback to get simulation nodes (for KeywordNodes component) */
  onSimulationReady?: (simNodes: SimNode[]) => void;
}

export function ForceSimulation({
  nodes,
  edges,
  onSimulationReady,
}: ForceSimulationProps) {
  const simulationRef = useRef<d3.Simulation<SimNode, undefined> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);

  useEffect(() => {
    // Convert keyword nodes to simulation nodes
    // At z=10500 with FOV 10°, visible height ≈ 1837 units
    // Use moderate initial spread - simulation will tighten it
    const simNodes: SimNode[] = nodes.map((n) => ({
      id: n.id,
      type: "keyword" as const,
      label: n.label,
      communityId: n.communityId,
      embedding: n.embedding,
      communityMembers: undefined,
      hullLabel: undefined,
      // Initialize with random positions if not set
      x: Math.random() * 1000 - 500,
      y: Math.random() * 1000 - 500,
    }));

    simNodesRef.current = simNodes;

    // Notify parent about simulation nodes
    onSimulationReady?.(simNodes);

    // Convert edges to links (d3-force expects source/target to be node references or IDs)
    const links = edges.map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
    }));

    // Create force simulation
    const simulation = d3
      .forceSimulation(simNodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: any) => d.id)
          .distance((d: any) => {
            const sim = d.similarity ?? 0.5;
            return 40 + (1 - sim) * 150;
          })
          .strength((d: any) => {
            const sim = d.similarity ?? 0.5;
            return 0.2 + sim * 0.8;
          })
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(0, 0))
      .alphaTarget(0.3)
      .alphaDecay(0.01)
      .velocityDecay(0.5);

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [nodes, edges, onSimulationReady]);

  // No visual output - this just drives the simulation
  return null;
}
