import type { SimNode } from "@/lib/map-renderer";
import type { ViewportZones } from "@/lib/edge-pulling";
import type { FocusState } from "@/lib/focus-mode";
import {
  computePullPosition,
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
  /** Focus state for applying fisheye compression to content whose parents are focused */
  focusState?: FocusState | null;
}

export function computeContentPullState({
  contentNodes,
  primaryKeywordIds,
  zones,
  maxPulled = MAX_PULLED_CONTENT_NODES,
  focusState,
}: ContentPullParams): Map<string, ContentPulledNode> {
  const pulledMap = new Map<string, ContentPulledNode>();
  const candidates: SimNode[] = [];

  function hasFocusedParent(parents: string[]): boolean {
    return focusState
      ? parents.some((parentId) => focusState.focusedNodeIds.has(parentId))
      : false;
  }

  for (const node of contentNodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const parents = (node as SimNode & { parentIds?: string[] }).parentIds ?? [];
    if (!parents.some((parentId) => primaryKeywordIds.has(parentId))) continue;

    const inViewport = isInViewport(x, y, zones.viewport);
    if (inViewport && isInCliffZone(x, y, zones.pullBounds)) {
      const pulled = computePullPosition(x, y, zones, hasFocusedParent(parents));
      pulledMap.set(node.id, { x: pulled.x, y: pulled.y, realX: x, realY: y });
      continue;
    }

    if (!inViewport) {
      candidates.push(node);
    }
  }

  for (const node of candidates.slice(0, maxPulled)) {
    const realX = node.x ?? 0;
    const realY = node.y ?? 0;
    const parents = (node as SimNode & { parentIds?: string[] }).parentIds ?? [];
    const pulled = computePullPosition(realX, realY, zones, hasFocusedParent(parents));
    pulledMap.set(node.id, { x: pulled.x, y: pulled.y, realX, realY });
  }

  return pulledMap;
}
