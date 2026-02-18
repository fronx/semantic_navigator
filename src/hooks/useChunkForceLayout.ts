import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3-force";
import type { UmapEdge } from "@/hooks/useUmapLayout";
import { createSimulationDrag, type SimulationDragHandlers } from "@/lib/simulation-drag";
import { CARD_COLLISION_RADIUS } from "@/lib/chunks-geometry";
import { calculateSimulationAlpha, calculateVelocityDecay } from "@/lib/simulation-zoom-config";

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
  cameraZ?: number;
}

interface ChunkForceLayout {
  positions: Float32Array;
  dragHandlers: SimulationDragHandlers;
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
  cameraZ,
}: ChunkForceLayoutOptions): ChunkForceLayout {
  const nodesRef = useRef<ChunkNode[]>([]);
  const simulationRef = useRef<d3.Simulation<ChunkNode, ChunkForceEdge> | null>(null);
  const positionsRef = useRef<Float32Array>(EMPTY_POSITIONS);
  const hoveredStateRef = useRef<{ index: number | null; scaleFactor: number }>({ index: null, scaleFactor: 1 });

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
      .force(
        "collision",
        d3.forceCollide<ChunkNode>()
          .radius((node) => {
            const hs = hoveredStateRef.current;
            return node.index === hs.index
              ? CARD_COLLISION_RADIUS * hs.scaleFactor
              : CARD_COLLISION_RADIUS;
          })
          .strength(0.8),
      )
      .on("tick", syncPositions);

    simulationRef.current = simulation;

    return () => {
      stopSimulation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePositions.length, edgesVersion, isRunning, defaultRestLength, edges]);

  // Zoom-dependent energy injection: inject alpha on zoom-out so nodes
  // break free from pulled-position arrangements ("rice field" effect).
  const prevCameraZRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const simulation = simulationRef.current;
    if (!simulation || cameraZ === undefined) return;

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

  const dragHandlers = useMemo(
    (): SimulationDragHandlers => ({
      ...createSimulationDrag(simulationRef, (index) => nodesRef.current[index]),
      notifyHoverChange(index, scaleFactor) {
        const indexChanged = hoveredStateRef.current.index !== index;
        hoveredStateRef.current = { index, scaleFactor };
        const sim = simulationRef.current;
        if (!sim) return;
        // forceCollide caches radii at init time — re-set the radius function
        // to force d3 to recompute from the updated hoveredStateRef.
        const collision = sim.force("collision") as d3.ForceCollide<ChunkNode> | null;
        if (collision) collision.radius(collision.radius());
        if (indexChanged) {
          // Inject energy on hover start/end so nodes react
          sim.alpha(Math.max(sim.alpha(), 0.1)).restart();
        } else if (scaleFactor > 1) {
          // During hover animation: keep sim alive for collision, don't re-inject energy
          sim.alpha(Math.max(sim.alpha(), 0.05)).restart();
        }
      },
    }),
    [],
  );

  return {
    positions: positionsRef.current,
    dragHandlers,
  };
}
