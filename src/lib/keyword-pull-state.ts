import type { SimNode } from "@/lib/map-renderer";
import type { ViewportZones } from "@/lib/edge-pulling";
import type { FocusState } from "@/lib/focus-mode";
import {
  computePullPosition,
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
  /** Focus state for click-to-focus interaction. When provided, focused keywords use inner pull zone. */
  focusState?: FocusState | null;
}

/**
 * Pure helper that encapsulates keyword cliff + off-screen neighbor logic.
 * Extracted to simplify testing and keep KeywordNodes lean.
 *
 * In focus mode, focused keywords use fisheye compression to keep them visible:
 * - Near center: stay at natural positions
 * - Farther out: smoothly compressed into an inner ring
 * - Creates continuous gradient instead of discrete clamping
 */
export function computeKeywordPullState({
  simNodes,
  adjacencyMap,
  zones,
  maxPulled = MAX_PULLED_NODES,
  contentDrivenKeywordIds,
  focusState,
}: KeywordPullParams): KeywordPullStateResult {
  const pulledMap = new Map<string, KeywordPulledNode>();
  const primarySet = new Set<string>();
  const nodeById = new Map<string, SimNode>();
  for (const node of simNodes) nodeById.set(node.id, node);

  function isFocused(nodeId: string): boolean {
    return focusState?.focusedNodeIds.has(nodeId) ?? false;
  }

  // --- Phase 1: Classify visible nodes as primary or pulled ---
  for (const node of simNodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const focused = isFocused(node.id);

    // Focused keywords skip viewport check -- apply compression to ALL of them
    if (!focused && !isInViewport(x, y, zones.extendedViewport)) continue;

    if (focused) {
      const pulled = computePullPosition(x, y, zones, true);
      const positionChanged = pulled.x !== x || pulled.y !== y;

      if (positionChanged) {
        pulledMap.set(node.id, {
          x: pulled.x, y: pulled.y, realX: x, realY: y, connectedPrimaryIds: [],
        });
      } else {
        primarySet.add(node.id);
      }
    } else {
      if (!isInCliffZone(x, y, zones.pullBounds)) {
        primarySet.add(node.id);
        continue;
      }
      const clamped = computePullPosition(x, y, zones, false);
      pulledMap.set(node.id, {
        x: clamped.x, y: clamped.y, realX: x, realY: y, connectedPrimaryIds: [],
      });
    }
  }

  // --- Phase 2: Pull in off-screen neighbors of primary nodes ---
  if (adjacencyMap && adjacencyMap.size > 0) {
    const candidates = new Map<string, { node: SimNode; bestSimilarity: number; connectedPrimaryIds: string[] }>();
    for (const primaryId of primarySet) {
      const neighbors = adjacencyMap.get(primaryId);
      if (!neighbors) continue;

      for (const { id: neighborId, similarity } of neighbors) {
        if (primarySet.has(neighborId) || pulledMap.has(neighborId)) continue;

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
    for (const { node, connectedPrimaryIds } of sorted.slice(0, adjacencySlots)) {
      const realX = node.x ?? 0;
      const realY = node.y ?? 0;
      const pulled = computePullPosition(realX, realY, zones, isFocused(node.id));
      pulledMap.set(node.id, {
        x: pulled.x, y: pulled.y, realX, realY, connectedPrimaryIds,
      });
    }
  }

  // --- Phase 3: Add content-driven keywords ---
  const contentDrivenPulledIds = new Set<string>();
  if (contentDrivenKeywordIds && contentDrivenKeywordIds.size > 0) {
    for (const kwId of contentDrivenKeywordIds) {
      if (primarySet.has(kwId)) continue;
      const node = nodeById.get(kwId);
      if (!node) continue;
      // Already in pulledMap (from cliff zone) -- just mark as content-driven
      if (pulledMap.has(kwId)) {
        contentDrivenPulledIds.add(kwId);
        continue;
      }
      const realX = node.x ?? 0;
      const realY = node.y ?? 0;
      const pulled = computePullPosition(realX, realY, zones, isFocused(kwId));
      pulledMap.set(kwId, {
        x: pulled.x, y: pulled.y, realX, realY,
        connectedPrimaryIds: [], // Anchored by content, not keywords
      });
      contentDrivenPulledIds.add(kwId);
    }
  }

  // --- Phase 4: Validate anchors ---
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
    if (isFocused(nodeId)) continue; // Focused keywords stay visible without anchors

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
