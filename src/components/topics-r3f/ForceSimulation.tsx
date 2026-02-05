/**
 * D3 force simulation driver for R3F renderer.
 * Runs simulation for KEYWORDS ONLY.
 * Chunks are handled separately in R3FTopicsScene via useChunkSimulation.
 */

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";
import type { SimNode } from "@/lib/map-renderer";

export interface ForceSimulationProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  /** Callback to get keyword simulation nodes (keywords only, no chunks) */
  onSimulationReady?: (keywordNodes: SimNode[]) => void;
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
    const keywordSimNodes: SimNode[] = nodes.map((n) => ({
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

    simNodesRef.current = keywordSimNodes;

    // Notify parent about keyword simulation nodes
    onSimulationReady?.(keywordSimNodes);

    // Convert edges to links (similarity edges between keywords only)
    const links = edges.map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
    }));

    // Create force simulation for keywords only
    const simulation = d3
      .forceSimulation(keywordSimNodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: any) => d.id)
          .distance((d: any) => {
            // Distance varies by semantic similarity
            const sim = d.similarity ?? 0.5;
            return 40 + (1 - sim) * 150;
          })
          .strength((d: any) => {
            // Strength varies by semantic similarity
            const sim = d.similarity ?? 0.5;
            return 0.2 + sim * 0.8;
          })
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(0, 0))
      .alphaDecay(0.01)
      .velocityDecay(0.5);

    // Safety timeout: force stop after 20 seconds
    const stopTimeout = setTimeout(() => {
      simulation.stop();
    }, 20000);

    simulationRef.current = simulation;

    return () => {
      clearTimeout(stopTimeout);
      simulation.stop();
      simulationRef.current = null;
    };
  }, [nodes, edges, onSimulationReady]);

  // No visual output - this just drives the simulation
  return null;
}
