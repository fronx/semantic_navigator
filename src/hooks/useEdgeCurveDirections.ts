import { useMemo, useRef } from "react";
import type { SimNode, SimLink } from "@/lib/map-renderer";
import { computeEdgeCurveDirections, type NodePosition } from "@/lib/edge-curves";

/** Extract source/target IDs from a SimLink (handles both string and object forms) */
function getLinkIds(edge: SimLink): { sourceId: string; targetId: string } {
  return {
    sourceId: typeof edge.source === "string" ? edge.source : edge.source.id,
    targetId: typeof edge.target === "string" ? edge.target : edge.target.id,
  };
}

/**
 * Computes edge curve directions for rendering curved edges.
 *
 * Uses the "outward" curve method to ensure edges bow away from the graph
 * centroid for a convex, Lombardi-style appearance.
 *
 * IMPORTANT: Directions are computed once when nodes have valid positions
 * and cached forever. This ensures deterministic, stable curve directions
 * regardless of simulation state or UI toggles.
 *
 * @returns Map from edge key ("sourceId->targetId") to curve direction (1 or -1)
 */
export function useEdgeCurveDirections(
  simNodes: SimNode[],
  edges: SimLink[]
): Map<string, number> {
  // Cache directions permanently once computed
  const cachedDirections = useRef<Map<string, number> | null>(null);
  const cachedEdgeCount = useRef<number>(0);

  return useMemo(() => {
    // Return cached result if we have one with the same edge count
    // (edge count changing means the graph structure changed, so recompute)
    if (cachedDirections.current && cachedEdgeCount.current === edges.length) {
      return cachedDirections.current;
    }

    // Don't compute if nodes don't have positions yet
    const hasPositions = simNodes.some(n => n.x !== undefined && n.x !== 0);
    if (!hasPositions || simNodes.length === 0) {
      return cachedDirections.current ?? new Map<string, number>();
    }

    const nodePositions: NodePosition[] = simNodes.map((node) => ({
      id: node.id,
      x: node.x ?? 0,
      y: node.y ?? 0,
    }));

    const edgeRefs = edges.map((edge) => {
      const { sourceId, targetId } = getLinkIds(edge);
      return { source: sourceId, target: targetId };
    });

    const { directions } = computeEdgeCurveDirections(nodePositions, edgeRefs, {});

    const directionsByKey = new Map<string, number>();
    edges.forEach((edge, index) => {
      const { sourceId, targetId } = getLinkIds(edge);
      directionsByKey.set(`${sourceId}->${targetId}`, directions.get(index) ?? 1);
    });

    // Cache for future renders
    cachedDirections.current = directionsByKey;
    cachedEdgeCount.current = edges.length;

    return directionsByKey;
  }, [simNodes, edges]);
}
