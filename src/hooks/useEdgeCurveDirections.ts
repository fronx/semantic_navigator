import { useMemo } from "react";
import type { SimNode, SimLink } from "@/lib/map-renderer";
import {
  computeEdgeCurveDirections,
  type NodePosition,
  type EdgeRef,
} from "@/lib/edge-curves";

/**
 * Custom hook that computes edge curve directions for rendering curved edges.
 *
 * Uses the "outward" curve method from edge-curves.ts to ensure edges bow away
 * from the graph centroid for a convex, Lombardi-style appearance.
 *
 * @param simNodes - Array of simulation nodes with positions
 * @param edges - Array of edges between nodes
 * @returns Map from edge key ("sourceId->targetId") to curve direction (1 or -1)
 *
 * @example
 * ```tsx
 * const curveDirections = useEdgeCurveDirections(simNodes, edges);
 * const direction = curveDirections.get(`${sourceId}->${targetId}`) ?? 1;
 * ```
 */
export function useEdgeCurveDirections(
  simNodes: SimNode[],
  edges: SimLink[]
): Map<string, number> {
  return useMemo(() => {
    // Convert SimNode to NodePosition format expected by edge-curves
    const nodePositions: NodePosition[] = simNodes.map((node) => ({
      id: node.id,
      x: node.x ?? 0,
      y: node.y ?? 0,
    }));

    // Convert SimLink to EdgeRef format
    const edgeRefs: EdgeRef[] = edges.map((edge) => {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
      return { source: sourceId, target: targetId };
    });

    // Compute curve directions using "outward" method
    const { directions } = computeEdgeCurveDirections(nodePositions, edgeRefs, {});

    // Convert from Map<number, number> (edge index) to Map<string, number> (edge key)
    const directionsByKey = new Map<string, number>();
    edges.forEach((edge, index) => {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
      const key = `${sourceId}->${targetId}`;
      const direction = directions.get(index) ?? 1;
      directionsByKey.set(key, direction);
    });

    return directionsByKey;
  }, [simNodes, edges]);
}
