/**
 * D3 force simulation driver for R3F renderer.
 * Runs simulation and mutates node positions imperatively.
 */

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";
import type { SimNode } from "@/lib/map-renderer";
import type { ChunkNode } from "@/lib/chunk-loader";
import type { ChunkSimNode } from "@/lib/chunk-layout";
import { CHUNK_Z_DEPTH } from "@/lib/chunk-zoom-config";

export interface ForceSimulationProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  /** Chunk data organized by keyword ID */
  chunksByKeyword?: Map<string, ChunkNode[]>;
  /** Callback to get simulation nodes (keywords + chunks) */
  onSimulationReady?: (simNodes: SimNode[]) => void;
}

export function ForceSimulation({
  nodes,
  edges,
  chunksByKeyword,
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

    // Build keyword map for chunk parent lookup
    const keywordMap = new Map<string, SimNode>(keywordSimNodes.map((n) => [n.id, n]));

    // Create chunk simulation nodes
    const chunkSimNodes: ChunkSimNode[] = [];
    const containmentLinks: Array<{ source: string; target: string }> = [];

    if (chunksByKeyword) {
      for (const [keywordId, chunks] of chunksByKeyword) {
        const parent = keywordMap.get(keywordId);
        if (!parent) continue;

        for (const chunk of chunks) {
          const chunkNode: ChunkSimNode = {
            id: chunk.id,
            type: "chunk",
            label: chunk.summary || chunk.content.slice(0, 50) + "...",
            size: chunk.content.length,
            embedding: chunk.embedding,
            z: CHUNK_Z_DEPTH,
            parentId: keywordId,
            content: chunk.content,
            communityId: undefined,
            communityMembers: undefined,
            hullLabel: undefined,
            // Start at parent position (simulation will spread them)
            x: parent.x,
            y: parent.y,
          };

          chunkSimNodes.push(chunkNode);

          // Create containment edge (keyword → chunk)
          containmentLinks.push({
            source: keywordId,
            target: chunk.id,
          });
        }
      }
    }

    // Combine all simulation nodes
    const simNodes: SimNode[] = [...keywordSimNodes, ...chunkSimNodes];
    simNodesRef.current = simNodes;

    // Notify parent about simulation nodes
    onSimulationReady?.(simNodes);

    // Convert edges to links (similarity edges between keywords)
    const similarityLinks = edges.map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
      type: "similarity" as const,
    }));

    // Combine similarity and containment links
    const links = [
      ...similarityLinks,
      ...containmentLinks.map((e) => ({
        ...e,
        type: "containment" as const,
      })),
    ];

    // Create force simulation
    const simulation = d3
      .forceSimulation(simNodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: any) => d.id)
          .distance((d: any) => {
            // Containment edges are short (keep chunks close to keywords)
            if (d.type === "containment") {
              return 15;
            }
            // Similarity edges vary by semantic similarity
            const sim = d.similarity ?? 0.5;
            return 40 + (1 - sim) * 150;
          })
          .strength((d: any) => {
            // Containment edges are strong springs
            if (d.type === "containment") {
              return 0.8;
            }
            // Similarity edges vary by semantic similarity
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
  }, [nodes, edges, chunksByKeyword, onSimulationReady]);

  // No visual output - this just drives the simulation
  return null;
}
