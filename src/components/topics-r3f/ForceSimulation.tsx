/**
 * D3 force simulation driver for R3F renderer.
 * Runs simulation for KEYWORDS ONLY.
 * Chunks are handled separately in R3FTopicsScene via useChunkSimulation.
 */

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";
import type { SimNode } from "@/lib/map-renderer";
import {
  calculateSimulationAlpha,
  calculateVelocityDecay,
} from "@/lib/simulation-zoom-config";

export interface ForceSimulationProps {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
  /** Callback to get keyword simulation nodes (keywords only, no chunks) */
  onSimulationReady?: (keywordNodes: SimNode[]) => void;
  /** Current camera Z position for zoom-dependent simulation energy */
  cameraZ?: number;
}

/** Base D3 defaults for initial layout (full energy) */
const INITIAL_ALPHA = 0.3;
const INITIAL_VELOCITY_DECAY = 0.5;
const SAFETY_TIMEOUT_MS = 20000;

export function ForceSimulation({
  nodes,
  edges,
  onSimulationReady,
  cameraZ,
}: ForceSimulationProps) {
  const simulationRef = useRef<d3.Simulation<SimNode, undefined> | null>(null);
  const prevCameraZRef = useRef<number | undefined>(undefined);

  // Create / recreate simulation when nodes or edges change
  useEffect(() => {
    prevCameraZRef.current = undefined;

    const keywordSimNodes: SimNode[] = nodes.map((n) => ({
      id: n.id,
      type: "keyword" as const,
      label: n.label,
      communityId: n.communityId,
      embedding: n.embedding,
      communityMembers: undefined,
      hullLabel: undefined,
      x: Math.random() * 1000 - 500,
      y: Math.random() * 1000 - 500,
    }));

    onSimulationReady?.(keywordSimNodes);

    const links = edges.map((e) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
    }));

    const simulation = d3
      .forceSimulation(keywordSimNodes)
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
      .alphaDecay(0.01)
      .velocityDecay(INITIAL_VELOCITY_DECAY)
      .alpha(INITIAL_ALPHA);

    const stopTimeout = setTimeout(() => simulation.stop(), SAFETY_TIMEOUT_MS);
    simulationRef.current = simulation;

    return () => {
      clearTimeout(stopTimeout);
      simulation.stop();
      simulationRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // cameraZ intentionally excluded -- handled by the zoom effect below
  }, [nodes, edges, onSimulationReady]);

  // Adjust simulation energy when zoom changes
  useEffect(() => {
    const simulation = simulationRef.current;
    if (!simulation || cameraZ === undefined) return;

    // Skip first render -- let simulation start with full energy
    if (prevCameraZRef.current === undefined) {
      prevCameraZRef.current = cameraZ;
      return;
    }

    simulation.velocityDecay(calculateVelocityDecay(cameraZ));

    const targetAlpha = calculateSimulationAlpha(cameraZ);
    if (Math.abs(targetAlpha - simulation.alpha()) > 0.01) {
      simulation.alpha(targetAlpha);
    }

    prevCameraZRef.current = cameraZ;
  }, [cameraZ]);

  return null;
}
