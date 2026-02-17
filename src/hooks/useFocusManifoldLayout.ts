import { useEffect, useRef, useCallback, useMemo, type MutableRefObject } from "react";
import * as d3 from "d3-force";
import { createSimulationDrag, type SimulationDragHandlers } from "@/lib/simulation-drag";

interface FocusNode extends d3.SimulationNodeDatum {
  index: number;
  anchorX: number;
  anchorY: number;
  isSeed: boolean;
}

interface FocusLink extends d3.SimulationLinkDatum<FocusNode> {
  source: FocusNode;
  target: FocusNode;
  priority: number;
}

export interface FocusBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface FocusManifoldLayoutOptions {
  basePositions: Float32Array;
  focusNodeSet: Set<number> | null;
  seedIndices: number[];
  adjacency: Map<number, number[]>;
  compressionStrength: number;
}

interface FocusManifoldLayoutResult {
  positionsRef: MutableRefObject<Map<number, { x: number; y: number }>>;
  updateBounds: (bounds: FocusBounds | null) => void;
  dragHandlers: SimulationDragHandlers;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function useFocusManifoldLayout({
  basePositions,
  focusNodeSet,
  seedIndices,
  adjacency,
  compressionStrength,
}: FocusManifoldLayoutOptions): FocusManifoldLayoutResult {
  const positionsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const boundsRef = useRef<FocusBounds | null>(null);
  const basePositionsRef = useRef(basePositions);
  const simulationRef = useRef<d3.Simulation<FocusNode, FocusLink> | null>(null);
  const nodeMapRef = useRef<Map<number, FocusNode>>(new Map());
  const hoveredStateRef = useRef<{ index: number | null; scaleFactor: number }>({ index: null, scaleFactor: 1 });

  useEffect(() => {
    basePositionsRef.current = basePositions;
  }, [basePositions]);

  const updateBounds = useCallback((bounds: FocusBounds | null) => {
    boundsRef.current = bounds;
  }, []);

  useEffect(() => {
    simulationRef.current?.stop();
    simulationRef.current = null;

    const nodeIndices = focusNodeSet ? Array.from(focusNodeSet) : [];
    if (nodeIndices.length === 0) {
      positionsRef.current.clear();
      nodeMapRef.current.clear();
      return;
    }

    const base = basePositionsRef.current;
    const existing = positionsRef.current;
    const seedSet = new Set(seedIndices);

    const nodes: FocusNode[] = nodeIndices.map((index) => {
      const prev = existing.get(index);
      const baseX = base[index * 2] ?? 0;
      const baseY = base[index * 2 + 1] ?? 0;
      return {
        index,
        x: prev?.x ?? baseX,
        y: prev?.y ?? baseY,
        vx: 0,
        vy: 0,
        anchorX: prev?.x ?? baseX,
        anchorY: prev?.y ?? baseY,
        isSeed: seedSet.has(index),
      };
    });

    const nodeSet = new Set(nodeIndices);
    const nodeMap = new Map<number, FocusNode>();
    nodes.forEach((node) => nodeMap.set(node.index, node));
    nodeMapRef.current = nodeMap;
    const links: FocusLink[] = [];
    for (const index of nodeIndices) {
      const neighbors = adjacency.get(index) ?? [];
      for (const neighbor of neighbors) {
        if (!nodeSet.has(neighbor) || neighbor <= index) continue;
        const sourceNode = nodeMap.get(index);
        const targetNode = nodeMap.get(neighbor);
        if (!sourceNode || !targetNode) continue;
        links.push({
          source: sourceNode,
          target: targetNode,
          priority: seedSet.has(index) || seedSet.has(neighbor) ? 1 : 0,
        });
      }
    }

    // Seed initial positions map for synchronous consumers
    const map = positionsRef.current;
    map.clear();
    nodes.forEach((node) => {
      map.set(node.index, { x: node.x ?? 0, y: node.y ?? 0 });
    });

    const normalizedCompression = clamp(compressionStrength, 0.5, 3);
    const anchorStrength = clamp(normalizedCompression / 4, 0.15, 0.55);
    const seedAnchorStrength = clamp(anchorStrength * 1.5, 0.3, 0.75);
    const chargeStrength = -80 * normalizedCompression;
    const linkDistanceBase = 120 / normalizedCompression;

    const simulation = d3
      .forceSimulation<FocusNode>(nodes)
      .alpha(0.9)
      .alphaDecay(0.08)
      .velocityDecay(0.35)
      .force(
        "link",
        d3
          .forceLink<FocusNode, FocusLink>(links)
          .id((node) => node.index)
          .distance((link) => (link.priority ? linkDistanceBase * 0.7 : linkDistanceBase))
          .strength((link) => (link.priority ? 0.8 : 0.45)),
      )
      .force(
        "charge",
        d3.forceManyBody<FocusNode>().strength(chargeStrength),
      )
      .force(
        "x",
        d3.forceX<FocusNode>().x((node) => node.anchorX).strength((node) => (node.isSeed ? seedAnchorStrength : anchorStrength)),
      )
      .force(
        "y",
        d3.forceY<FocusNode>().y((node) => node.anchorY).strength((node) => (node.isSeed ? seedAnchorStrength : anchorStrength)),
      )
      .force(
        "collision",
        d3.forceCollide<FocusNode>()
          .radius((node) => {
            const hs = hoveredStateRef.current;
            return node.index === hs.index ? 50 * hs.scaleFactor : 50;
          })
          .strength(0.9),
      );

    simulation.on("tick", () => {
      const bounds = boundsRef.current;
      const mapRef = positionsRef.current;
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;
        if (bounds) {
          node.x = Math.min(Math.max(node.x, bounds.left), bounds.right);
          node.y = Math.min(Math.max(node.y, bounds.bottom), bounds.top);
        }
        mapRef.set(node.index, { x: node.x, y: node.y });
      }
    });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [focusNodeSet, seedIndices, adjacency, compressionStrength]);

  const dragHandlers = useMemo(
    (): SimulationDragHandlers => ({
      ...createSimulationDrag(simulationRef, (index) => nodeMapRef.current.get(index)),
      notifyHoverChange(index, scaleFactor) {
        hoveredStateRef.current = { index, scaleFactor };
        const sim = simulationRef.current;
        if (!sim) return;
        sim.alpha(Math.max(sim.alpha(), 0.5)).restart();
      },
    }),
    [],
  );

  return {
    positionsRef,
    updateBounds,
    dragHandlers,
  };
}
