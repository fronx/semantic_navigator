import { useEffect, useRef, useMemo, type MutableRefObject } from "react";
import * as d3 from "d3-force";
import type { UmapEdge } from "@/hooks/useUmapLayout";
import { CARD_COLLISION_RADIUS } from "@/lib/chunks-geometry";
import { createSimulationDrag, type SimulationDragHandlers } from "@/lib/simulation-drag";

interface FocusNode extends d3.SimulationNodeDatum {
  index: number;
}

interface FocusLink extends d3.SimulationLinkDatum<FocusNode> {
  source: FocusNode;
  target: FocusNode;
  distance: number;
  strength: number;
}

interface ClickFocusSimilarityLayoutOptions {
  basePositions: Float32Array;
  focusNodeSet: Set<number> | null;
  seedIndices: number[];
  neighborhoodEdges: UmapEdge[];
  /** countScale from ChunksScene — scales collision radius with the node size sliders */
  cardScale: number;
}

interface ClickFocusSimilarityLayoutResult {
  positionsRef: MutableRefObject<Map<number, { x: number; y: number }>>;
  dragHandlers: SimulationDragHandlers;
}

export function useClickFocusSimilarityLayout({
  basePositions,
  focusNodeSet,
  seedIndices: _seedIndices,
  neighborhoodEdges,
  cardScale,
}: ClickFocusSimilarityLayoutOptions): ClickFocusSimilarityLayoutResult {
  const positionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const basePositionsRef = useRef(basePositions);
  const simulationRef = useRef<d3.Simulation<FocusNode, FocusLink> | null>(null);
  const nodeMapRef = useRef<Map<number, FocusNode>>(new Map());
  const hoveredStateRef = useRef<{ index: number | null; scaleFactor: number }>({ index: null, scaleFactor: 1 });

  useEffect(() => {
    basePositionsRef.current = basePositions;
  }, [basePositions]);

  useEffect(() => {
    simulationRef.current?.stop();
    simulationRef.current = null;

    if (!focusNodeSet || focusNodeSet.size === 0) {
      positionsRef.current.clear();
      nodeMapRef.current.clear();
      return;
    }

    const indices = Array.from(focusNodeSet);
    const base = basePositionsRef.current;

    const nodes: FocusNode[] = indices.map((index) => ({
      index,
      x: base[index * 2] ?? 0,
      y: base[index * 2 + 1] ?? 0,
      vx: 0,
      vy: 0,
    }));

    const nodeMap = new Map<number, FocusNode>();
    nodes.forEach((node) => nodeMap.set(node.index, node));
    nodeMapRef.current = nodeMap;

    // Build links from UMAP neighborhood edges filtered to the focus set.
    // Higher edge weight = more similar = shorter link distance.
    const links: FocusLink[] = [];
    for (const edge of neighborhoodEdges) {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) continue;
      const distance = 40 + (1 - edge.weight) * 200;
      const strength = 0.2 + edge.weight * 0.7;
      links.push({ source: sourceNode, target: targetNode, distance, strength });
    }

    positionsRef.current.clear();
    for (const node of nodes) {
      positionsRef.current.set(node.index, { x: node.x ?? 0, y: node.y ?? 0 });
    }

    if (nodes.length === 0) return;

    const collisionRadius = CARD_COLLISION_RADIUS * cardScale;

    const simulation = d3
      .forceSimulation(nodes)
      .alpha(0.95)
      .alphaDecay(0.01)
      .velocityDecay(0.35)
      .force("link", d3.forceLink<FocusNode, FocusLink>(links).id((node) => node.index))
      .force("collision", d3.forceCollide<FocusNode>()
        .radius((node) => {
          const hs = hoveredStateRef.current;
          return node.index === hs.index ? collisionRadius * hs.scaleFactor : collisionRadius;
        })
        .strength(0.4));

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
  }, [focusNodeSet, neighborhoodEdges]);

  const dragHandlers = useMemo(
    (): SimulationDragHandlers => ({
      ...createSimulationDrag(simulationRef, (index) => nodeMapRef.current.get(index)),
      notifyHoverChange(index, scaleFactor) {
        hoveredStateRef.current = { index, scaleFactor };
        const sim = simulationRef.current;
        if (!sim) return;
        // forceCollide caches radii at init time — re-set the radius function
        // to force d3 to recompute from the updated hoveredStateRef.
        const collision = sim.force("collision") as d3.ForceCollide<FocusNode> | null;
        if (collision) collision.radius(collision.radius());
        sim.alpha(Math.max(sim.alpha(), 0.5)).restart();
      },
    }),
    [],
  );

  return { positionsRef, dragHandlers };
}
