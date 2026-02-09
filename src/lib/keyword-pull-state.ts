import type { SimNode } from "@/lib/map-renderer";
import type { ViewportZones } from "@/lib/edge-pulling";
import {
  clampToBounds,
  isInCliffZone,
  isInViewport,
  MAX_PULLED_NODES,
} from "@/lib/edge-pulling";

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
  /** Keywords that should be pulled because their content cards are visible in the viewport.
   *  These get priority over adjacency-based candidates and skip anchor validation. */
  contentDrivenKeywordIds?: Set<string>;
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
  contentDrivenKeywordIds,
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
    // Reserve slots for content-driven candidates (they get priority)
    const contentDrivenCount = contentDrivenKeywordIds
      ? [...contentDrivenKeywordIds].filter((id) => !primarySet.has(id) && !pulledMap.has(id) && nodeById.has(id)).length
      : 0;
    const adjacencySlots = Math.max(0, maxPulled - contentDrivenCount);
    const pulledNeighbors = sorted.slice(0, adjacencySlots);
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

  // Mark content-driven keywords that are already in pulledMap (e.g. cliff zone)
  // so they skip anchor validation. Also add any that aren't in the map yet.
  const contentDrivenPulledIds = new Set<string>();
  if (contentDrivenKeywordIds && contentDrivenKeywordIds.size > 0) {
    for (const kwId of contentDrivenKeywordIds) {
      if (primarySet.has(kwId)) continue;
      const node = nodeById.get(kwId);
      if (!node) continue;
      // Already in pulledMap (from cliff zone) — just mark it as content-driven
      if (pulledMap.has(kwId)) {
        contentDrivenPulledIds.add(kwId);
        continue;
      }
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
      pulledMap.set(kwId, {
        x: clamped.x,
        y: clamped.y,
        realX,
        realY,
        connectedPrimaryIds: [], // Anchored by content, not keywords
      });
      contentDrivenPulledIds.add(kwId);
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
    if (contentDrivenPulledIds.has(nodeId)) continue; // Anchored by content cards
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
