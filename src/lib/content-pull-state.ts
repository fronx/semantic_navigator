import type { SimNode } from "@/lib/map-renderer";
import type { ViewportZones } from "@/lib/edge-pulling";
import type { FocusState } from "@/lib/focus-mode";
import {
  clampToBounds,
  isInCliffZone,
  isInViewport,
  MAX_PULLED_CONTENT_NODES,
} from "@/lib/edge-pulling";
import { applyFisheyeCompression } from "@/lib/fisheye-viewport";

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

  // Calculate compression zone radii (same as keywords)
  const camX = zones.viewport.camX;
  const camY = zones.viewport.camY;
  const pullZoneDistanceRight = zones.pullBounds.right - camX;
  const pullZoneDistanceTop = zones.pullBounds.top - camY;
  const maxRadius = Math.min(pullZoneDistanceRight, pullZoneDistanceTop);
  const focusPullDistanceRight = zones.focusPullBounds.right - camX;
  const focusPullDistanceTop = zones.focusPullBounds.top - camY;
  const compressionStartRadius = Math.min(focusPullDistanceRight, focusPullDistanceTop);

  for (const node of contentNodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const contentNode = node as SimNode & { parentIds?: string[] };
    const parents = contentNode.parentIds ?? [];
    const hasVisibleParent = parents.some((parentId) => primaryKeywordIds.has(parentId));
    if (!hasVisibleParent) {
      continue;
    }

    // Check if any parent is a focused keyword
    const hasFocusedParent = focusState
      ? parents.some((parentId) => focusState.focusedNodeIds.has(parentId))
      : false;

    const inViewport = isInViewport(x, y, zones.viewport);
    if (inViewport && isInCliffZone(x, y, zones.pullBounds)) {
      let pulledX: number;
      let pulledY: number;

      if (hasFocusedParent) {
        // Apply fisheye compression for content with focused parents
        const compressed = applyFisheyeCompression(x, y, camX, camY, compressionStartRadius, maxRadius);
        // Clamp to rectangular pull bounds
        pulledX = Math.max(zones.pullBounds.left, Math.min(zones.pullBounds.right, compressed.x));
        pulledY = Math.max(zones.pullBounds.bottom, Math.min(zones.pullBounds.top, compressed.y));
      } else {
        // Regular clamping for non-focused content
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
        pulledX = clamped.x;
        pulledY = clamped.y;
      }

      pulledMap.set(node.id, {
        x: pulledX,
        y: pulledY,
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

    // Check if any parent is a focused keyword
    const contentNode = node as SimNode & { parentIds?: string[] };
    const parents = contentNode.parentIds ?? [];
    const hasFocusedParent = focusState
      ? parents.some((parentId) => focusState.focusedNodeIds.has(parentId))
      : false;

    let pulledX: number;
    let pulledY: number;

    if (hasFocusedParent) {
      // Apply fisheye compression for content with focused parents
      const compressed = applyFisheyeCompression(realX, realY, camX, camY, compressionStartRadius, maxRadius);
      // Clamp to rectangular pull bounds
      pulledX = Math.max(zones.pullBounds.left, Math.min(zones.pullBounds.right, compressed.x));
      pulledY = Math.max(zones.pullBounds.bottom, Math.min(zones.pullBounds.top, compressed.y));
    } else {
      // Regular clamping for non-focused content
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
      pulledX = clamped.x;
      pulledY = clamped.y;
    }

    pulledMap.set(node.id, {
      x: pulledX,
      y: pulledY,
      realX,
      realY,
    });
  }

  return pulledMap;
}
