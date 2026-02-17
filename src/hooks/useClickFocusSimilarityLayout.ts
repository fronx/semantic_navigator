import { useEffect, useRef, type MutableRefObject } from "react";
import * as d3 from "d3-force";
import { cosineSimilarityF32 } from "@/lib/semantic-zoom";

interface SimilarityNode extends d3.SimulationNodeDatum {
  index: number;
  anchorX: number;
  anchorY: number;
  isSeed: boolean;
}

interface SimilarityLink extends d3.SimulationLinkDatum<SimilarityNode> {
  source: SimilarityNode;
  target: SimilarityNode;
  distance: number;
  strength: number;
}

interface ClickFocusSimilarityLayoutOptions {
  basePositions: Float32Array;
  focusNodeSet: Set<number> | null;
  seedIndices: number[];
  normalizedEmbeddings: Float32Array[];
}

export function useClickFocusSimilarityLayout({
  basePositions,
  focusNodeSet,
  seedIndices,
  normalizedEmbeddings,
}: ClickFocusSimilarityLayoutOptions): MutableRefObject<Map<number, { x: number; y: number }>> {
  const positionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const basePositionsRef = useRef(basePositions);
  const embeddingsRef = useRef(normalizedEmbeddings);
  const simulationRef = useRef<d3.Simulation<SimilarityNode, SimilarityLink> | null>(null);

  useEffect(() => {
    basePositionsRef.current = basePositions;
  }, [basePositions]);

  useEffect(() => {
    embeddingsRef.current = normalizedEmbeddings;
  }, [normalizedEmbeddings]);

  useEffect(() => {
    simulationRef.current?.stop();
    simulationRef.current = null;

    if (!focusNodeSet || focusNodeSet.size === 0) {
      positionsRef.current.clear();
      return;
    }

    const indices = Array.from(focusNodeSet);
    const seedSet = new Set(seedIndices);
    const base = basePositionsRef.current;
    const embeddings = embeddingsRef.current;

    const nodes: SimilarityNode[] = indices.map((index) => {
      const baseX = base[index * 2] ?? 0;
      const baseY = base[index * 2 + 1] ?? 0;
      return {
        index,
        x: baseX,
        y: baseY,
        vx: 0,
        vy: 0,
        anchorX: baseX,
        anchorY: baseY,
        isSeed: seedSet.has(index),
      };
    });

    const nodeMap = new Map<number, SimilarityNode>();
    nodes.forEach((node) => nodeMap.set(node.index, node));

    const links: SimilarityLink[] = [];
    for (let a = 0; a < indices.length; a++) {
      const idxA = indices[a];
      const embA = embeddings[idxA];
      if (!embA) continue;
      for (let b = a + 1; b < indices.length; b++) {
        const idxB = indices[b];
        const embB = embeddings[idxB];
        if (!embB) continue;
        const similarity = cosineSimilarityF32(embA, embB);
        if (!Number.isFinite(similarity)) continue;
        const clamped = Math.max(0, Math.min(1, similarity));
        if (clamped <= 0.02) continue;
        const distance = 60 + (1 - clamped) * 180;
        const strength = 0.25 + clamped * 0.6;
        const sourceNode = nodeMap.get(idxA);
        const targetNode = nodeMap.get(idxB);
        if (!sourceNode || !targetNode) continue;
        links.push({
          source: sourceNode,
          target: targetNode,
          distance,
          strength,
        });
      }
    }

    positionsRef.current.clear();
    for (const node of nodes) {
      positionsRef.current.set(node.index, { x: node.x ?? 0, y: node.y ?? 0 });
    }

    if (nodes.length === 0) return;

    const chargeStrength = nodes.length > 8 ? -35 : -25;
    const collisionRadius = nodes.length > 12 ? 32 : 38;

    const simulation = d3
      .forceSimulation(nodes)
      .alpha(0.95)
      .alphaDecay(0.07)
      .velocityDecay(0.32)
      .force(
        "link",
        d3
          .forceLink<SimilarityNode, SimilarityLink>(links)
          .id((node) => node.index)
          .distance((link) => link.distance)
          .strength((link) => link.strength),
      )
      .force("charge", d3.forceManyBody<SimilarityNode>().strength(chargeStrength))
      .force(
        "x",
        d3
          .forceX<SimilarityNode>()
          .x((node) => node.anchorX)
          .strength((node) => (node.isSeed ? 0.45 : 0.25)),
      )
      .force(
        "y",
        d3
          .forceY<SimilarityNode>()
          .y((node) => node.anchorY)
          .strength((node) => (node.isSeed ? 0.45 : 0.25)),
      )
      .force("collision", d3.forceCollide<SimilarityNode>().radius(collisionRadius).strength(0.95));

    simulation.on("tick", () => {
      const mapRef = positionsRef.current;
      nodes.forEach((node) => {
        if (node.x == null || node.y == null) return;
        mapRef.set(node.index, { x: node.x, y: node.y });
      });
    });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [focusNodeSet, seedIndices, normalizedEmbeddings]);

  return positionsRef;
}

