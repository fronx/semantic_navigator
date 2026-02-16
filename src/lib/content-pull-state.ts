import type { SimNode } from "@/lib/map-renderer";
import type { ViewportZones } from "@/lib/edge-pulling";
import type { FocusState } from "@/lib/focus-mode";
import {
  clampToBounds,
  isInCliffZone,
  isInViewport,
  MAX_PULLED_CONTENT_NODES,
} from "@/lib/edge-pulling";
import { applyFisheyeCompression, computeCompressionExtents } from "@/lib/fisheye-viewport";

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

  const { camX, camY } = zones.viewport;
  const extents = computeCompressionExtents(zones);

  /** Compute pulled position: fisheye compression if focused, regular clamping otherwise. */
  function pullPosition(x: number, y: number, isFocused: boolean): { x: number; y: number } {
    if (isFocused) {
      const compressed = applyFisheyeCompression(
        x, y, camX, camY,
        extents.compressionStartHalfWidth, extents.compressionStartHalfHeight,
        extents.horizonHalfWidth, extents.horizonHalfHeight
      );
      return {
        x: Math.max(zones.pullBounds.left, Math.min(zones.pullBounds.right, compressed.x)),
        y: Math.max(zones.pullBounds.bottom, Math.min(zones.pullBounds.top, compressed.y)),
      };
    }
    return clampToBounds(
      x, y, camX, camY,
      zones.pullBounds.left, zones.pullBounds.right,
      zones.pullBounds.bottom, zones.pullBounds.top
    );
  }

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
      const pulled = pullPosition(x, y, hasFocusedParent(parents));
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
    const pulled = pullPosition(realX, realY, hasFocusedParent(parents));
    pulledMap.set(node.id, { x: pulled.x, y: pulled.y, realX, realY });
  }

  return pulledMap;
}
