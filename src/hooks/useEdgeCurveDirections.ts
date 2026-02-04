import { useMemo } from "react";
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
 * @returns Map from edge key ("sourceId->targetId") to curve direction (1 or -1)
 */
export function useEdgeCurveDirections(
  simNodes: SimNode[],
  edges: SimLink[]
): Map<string, number> {
  return useMemo(() => {
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

    return directionsByKey;
  }, [simNodes, edges]);
}
