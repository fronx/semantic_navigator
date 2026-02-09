import type { SimNode } from "@/lib/map-renderer";
import type { ViewportZones } from "@/lib/edge-pulling";
import {
  clampToBounds,
  isInCliffZone,
  isInViewport,
  MAX_PULLED_CONTENT_NODES,
} from "@/lib/edge-pulling";

export interface ContentPulledNode {
  x: number;
  y: number;
  realX: number;
  realY: number;
}

interface ContentPullParams {
  contentNodes: SimNode[];
  primaryKeywordIds: Set<string>;
  zones: ViewportZones;
  maxPulled?: number;
}

export function computeContentPullState({
  contentNodes,
  primaryKeywordIds,
  zones,
  maxPulled = MAX_PULLED_CONTENT_NODES,
}: ContentPullParams): Map<string, ContentPulledNode> {
  const pulledMap = new Map<string, ContentPulledNode>();
  const candidates: SimNode[] = [];

  for (const node of contentNodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const contentNode = node as SimNode & { parentIds?: string[] };
    const parents = contentNode.parentIds ?? [];
    const hasVisibleParent = parents.some((parentId) => primaryKeywordIds.has(parentId));
    if (!hasVisibleParent) {
      continue;
    }

    const inViewport = isInViewport(x, y, zones.viewport);
    if (inViewport && isInCliffZone(x, y, zones.pullBounds)) {
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
      });
      continue;
    }

    if (!inViewport) {
      candidates.push(node);
    }
  }

  const pulledCandidates = candidates.slice(0, maxPulled);
  for (const node of pulledCandidates) {
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
    });
  }

  return pulledMap;
}
