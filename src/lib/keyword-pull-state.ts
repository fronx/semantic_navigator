import type { SimNode } from "@/lib/map-renderer";
import type { ViewportZones } from "@/lib/viewport-edge-magnets";
import {
  clampToBounds,
  isInCliffZone,
  isInViewport,
  MAX_PULLED_NODES,
} from "@/lib/viewport-edge-magnets";

export interface KeywordPulledNode {
  x: number;
  y: number;
  realX: number;
  realY: number;
  connectedPrimaryIds: string[];
}

export interface KeywordPullStateResult {
  pulledMap: Map<string, KeywordPulledNode>;
  primarySet: Set<string>;
}

interface KeywordPullParams {
  simNodes: SimNode[];
  adjacencyMap?: Map<string, Array<{ id: string; similarity: number }>>;
  zones: ViewportZones;
  maxPulled?: number;
}

/**
 * Pure helper that encapsulates keyword cliff + off-screen neighbor logic.
 * Extracted to simplify testing and keep KeywordNodes lean.
 */
export function computeKeywordPullState({
  simNodes,
  adjacencyMap,
  zones,
  maxPulled = MAX_PULLED_NODES,
}: KeywordPullParams): KeywordPullStateResult {
  const pulledMap = new Map<string, KeywordPulledNode>();
  const primarySet = new Set<string>();
  const nodeById = new Map<string, SimNode>();
  for (const node of simNodes) nodeById.set(node.id, node);

  for (const node of simNodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    if (!isInViewport(x, y, zones.extendedViewport)) continue;

    const inCliff = isInCliffZone(x, y, zones.pullBounds);
    if (!inCliff) {
      primarySet.add(node.id);
      continue;
    }

    const clamped = clampToBounds(
      x,
      y,
      zones.viewport.camX,
      zones.viewport.camY,
      zones.pullBounds.left,
      zones.pullBounds.right,
      zones.pullBounds.bottom,
      zones.pullBounds.top
    );
    pulledMap.set(node.id, {
      x: clamped.x,
      y: clamped.y,
      realX: x,
      realY: y,
      connectedPrimaryIds: [],
    });
  }

  if (adjacencyMap && adjacencyMap.size > 0) {
    const candidates = new Map<string, { node: SimNode; bestSimilarity: number; connectedPrimaryIds: string[] }>();
    for (const primaryId of primarySet) {
      const neighbors = adjacencyMap.get(primaryId);
      if (!neighbors) continue;

      for (const { id: neighborId, similarity } of neighbors) {
        if (primarySet.has(neighborId)) continue;
        if (pulledMap.has(neighborId)) continue;

        const neighborNode = nodeById.get(neighborId);
        if (!neighborNode) continue;
        const neighborX = neighborNode.x ?? 0;
        const neighborY = neighborNode.y ?? 0;
        if (isInViewport(neighborX, neighborY, zones.extendedViewport)) continue;

        const existing = candidates.get(neighborId);
        if (existing) {
          existing.connectedPrimaryIds.push(primaryId);
          existing.bestSimilarity = Math.max(existing.bestSimilarity, similarity);
        } else {
          candidates.set(neighborId, {
            node: neighborNode,
            bestSimilarity: similarity,
            connectedPrimaryIds: [primaryId],
          });
        }
      }
    }

    const sorted = Array.from(candidates.values()).sort((a, b) => b.bestSimilarity - a.bestSimilarity);
    const pulledNeighbors = sorted.slice(0, maxPulled);
    for (const { node, connectedPrimaryIds } of pulledNeighbors) {
      const realX = node.x ?? 0;
      const realY = node.y ?? 0;
      const clamped = clampToBounds(
        realX,
        realY,
        zones.viewport.camX,
        zones.viewport.camY,
        zones.pullBounds.left,
        zones.pullBounds.right,
        zones.pullBounds.bottom,
        zones.pullBounds.top
      );
      pulledMap.set(node.id, {
        x: clamped.x,
        y: clamped.y,
        realX,
        realY,
        connectedPrimaryIds,
      });
    }
  }

  const getAnchorsForNode = (nodeId: string): string[] => {
    if (!adjacencyMap || adjacencyMap.size === 0) return [];
    const neighbors = adjacencyMap.get(nodeId);
    if (!neighbors) return [];
    return neighbors
      .map(({ id }) => id)
      .filter((neighborId) => primarySet.has(neighborId));
  };

  for (const [nodeId, pulled] of pulledMap) {
    if (pulled.connectedPrimaryIds.length === 0) {
      const anchorIds = getAnchorsForNode(nodeId);
      if (anchorIds.length === 0) {
        pulledMap.delete(nodeId);
      } else {
        pulled.connectedPrimaryIds = anchorIds;
      }
    }
  }

  return { pulledMap, primarySet };
}
