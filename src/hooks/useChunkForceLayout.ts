import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3-force";
import type { UmapEdge } from "@/hooks/useUmapLayout";

interface ChunkNode extends d3.SimulationNodeDatum {
  index: number;
  x: number;
  y: number;
}

interface ChunkForceEdge extends d3.SimulationLinkDatum<ChunkNode> {
  source: number;
  target: number;
  weight: number;
  restLength: number | null;
}

interface ChunkForceLayoutOptions {
  basePositions: Float32Array;
  edges: UmapEdge[];
  edgesVersion: number;
  isRunning: boolean;
}

interface ChunkForceLayout {
  positions: Float32Array;
  startDrag: (index: number) => void;
  drag: (index: number, x: number, y: number) => void;
  endDrag: (index: number) => void;
}

const EMPTY_POSITIONS = new Float32Array(0);

function clonePositions(source: Float32Array): Float32Array {
  const out = new Float32Array(source.length);
  out.set(source);
  return out;
}

export function useChunkForceLayout({
  basePositions,
  edges,
  edgesVersion,
  isRunning,
}: ChunkForceLayoutOptions): ChunkForceLayout {
  const nodesRef = useRef<ChunkNode[]>([]);
  const simulationRef = useRef<d3.Simulation<ChunkNode, ChunkForceEdge> | null>(null);
  const positionsRef = useRef<Float32Array>(EMPTY_POSITIONS);

  const defaultRestLength = useMemo(() => {
    // Rough heuristic: derive from bounding radius (approx 500) but keep non-zero.
    return Math.max(basePositions.length > 0 ? 500 / 6 : 50, 25);
  }, [basePositions.length]);

  const syncPositions = () => {
    const nodes = nodesRef.current;
    const arr = positionsRef.current;
    if (arr.length !== nodes.length * 2) {
      positionsRef.current = new Float32Array(nodes.length * 2);
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      positionsRef.current[i * 2] = node.x ?? 0;
      positionsRef.current[i * 2 + 1] = node.y ?? 0;
    }
  };

  const stopSimulation = () => {
    if (simulationRef.current) {
      simulationRef.current.stop();
      simulationRef.current = null;
    }
  };

  useEffect(() => {
    const nodeCount = Math.floor(basePositions.length / 2);

    if (nodeCount === 0) {
      stopSimulation();
      positionsRef.current = EMPTY_POSITIONS;
      nodesRef.current = [];
      return;
    }

    if (isRunning || edges.length === 0) {
      stopSimulation();
      positionsRef.current = clonePositions(basePositions);
      nodesRef.current = Array.from({ length: nodeCount }, (_, i) => ({
        index: i,
        x: basePositions[i * 2],
        y: basePositions[i * 2 + 1],
        vx: 0,
        vy: 0,
      }));
      return;
    }

    const nodes: ChunkNode[] = Array.from({ length: nodeCount }, (_, i) => ({
      index: i,
      x: basePositions[i * 2] ?? (Math.random() - 0.5) * 10,
      y: basePositions[i * 2 + 1] ?? (Math.random() - 0.5) * 10,
      vx: 0,
      vy: 0,
    }));

    nodesRef.current = nodes;
    positionsRef.current = clonePositions(basePositions);

    const forceEdges: ChunkForceEdge[] = edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: edge.weight,
      restLength: edge.restLength,
    }));

    const maxWeight = forceEdges.reduce((max, edge) => (edge.weight > max ? edge.weight : max), 0) || 1;

    const simulation = d3
      .forceSimulation(nodes)
      .alpha(0.8)
      .alphaDecay(0.005)
      .velocityDecay(0.4)
      .force(
        "link",
        d3
          .forceLink<ChunkNode, ChunkForceEdge>(forceEdges)
          .id((node) => node.index)
          .distance((edge) => edge.restLength ?? defaultRestLength)
          .strength((edge) => Math.min(edge.weight / maxWeight, 1) * 0.5)
      )
      .force(
        "charge",
        d3.forceManyBody<ChunkNode>().strength(-5)
      )
      .force(
        "center",
        d3.forceCenter<ChunkNode>(0, 0)
      )
      .on("tick", syncPositions);

    simulationRef.current = simulation;

    return () => {
      stopSimulation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePositions.length, edgesVersion, isRunning, defaultRestLength, edges]);

  const startDrag = (index: number) => {
    const node = nodesRef.current[index];
    if (!node) return;
    node.fx = node.x;
    node.fy = node.y;
    simulationRef.current?.alphaTarget(0.3).restart();
  };

  const drag = (index: number, x: number, y: number) => {
    const node = nodesRef.current[index];
    if (!node) return;
    node.fx = x;
    node.fy = y;
  };

  const endDrag = (index: number) => {
    const node = nodesRef.current[index];
    if (!node) return;
    node.fx = null;
    node.fy = null;
    simulationRef.current?.alphaTarget(0);
  };

  return {
    positions: positionsRef.current,
    startDrag,
    drag,
    endDrag,
  };
}
