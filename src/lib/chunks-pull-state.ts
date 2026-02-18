/**
 * Pull state computation for ChunksView.
 * Same 3-phase pattern as keyword-pull-state.ts, adapted for index-based chunks.
 */

import type { ViewportZones } from "@/lib/edge-pulling";
import {
  computePullPosition,
  isInCliffZone,
  isInViewport,
  MAX_PULLED_NODES,
} from "@/lib/edge-pulling";

export interface PulledChunkNode {
  x: number;
  y: number;
  realX: number;
  realY: number;
  connectedPrimaryIndices: number[];
}

export interface ChunkPullResult {
  pulledMap: Map<number, PulledChunkNode>;
  primarySet: Set<number>;
}

interface ChunkPullParams {
  positions: Float32Array;
  adjacency: Map<number, number[]>;
  zones: ViewportZones;
  /** When lens is active, only pull chunks in this set. */
  lensNodeSet?: Set<number> | null;
  maxPulled?: number;
}

export function computeChunkPullState({
  positions,
  adjacency,
  zones,
  lensNodeSet,
  maxPulled = MAX_PULLED_NODES,
}: ChunkPullParams): ChunkPullResult {
  const pulledMap = new Map<number, PulledChunkNode>();
  const primarySet = new Set<number>();
  const nodeCount = positions.length / 2;

  // Phase 1: Classify visible chunks as primary or cliff-pulled
  for (let i = 0; i < nodeCount; i++) {
    const x = positions[i * 2];
    const y = positions[i * 2 + 1];

    if (!isInViewport(x, y, zones.extendedViewport)) continue;

    // In lens mode, skip chunks outside the lens neighborhood
    if (lensNodeSet && !lensNodeSet.has(i)) continue;

    if (!isInCliffZone(x, y, zones.pullBounds)) {
      primarySet.add(i);
      continue;
    }

    // Cliff zone: clamp to pull line
    const clamped = computePullPosition(x, y, zones, false);
    pulledMap.set(i, {
      x: clamped.x, y: clamped.y, realX: x, realY: y,
      connectedPrimaryIndices: [],
    });
  }

  // Phase 2: Pull off-screen neighbors of primary chunks
  const candidates = new Map<number, { connectedPrimaryIndices: number[] }>();
  for (const primaryIdx of primarySet) {
    const neighbors = adjacency.get(primaryIdx);
    if (!neighbors) continue;

    for (const neighborIdx of neighbors) {
      if (primarySet.has(neighborIdx) || pulledMap.has(neighborIdx)) continue;
      if (lensNodeSet && !lensNodeSet.has(neighborIdx)) continue;

      const nx = positions[neighborIdx * 2];
      const ny = positions[neighborIdx * 2 + 1];
      if (isInViewport(nx, ny, zones.extendedViewport)) continue;

      const existing = candidates.get(neighborIdx);
      if (existing) {
        existing.connectedPrimaryIndices.push(primaryIdx);
      } else {
        candidates.set(neighborIdx, {
          connectedPrimaryIndices: [primaryIdx],
        });
      }
    }
  }

  const sorted = Array.from(candidates.entries())
    .sort((a, b) => b[1].connectedPrimaryIndices.length - a[1].connectedPrimaryIndices.length);

  for (const [idx, { connectedPrimaryIndices }] of sorted.slice(0, maxPulled)) {
    const realX = positions[idx * 2];
    const realY = positions[idx * 2 + 1];
    const clamped = computePullPosition(realX, realY, zones, false);
    pulledMap.set(idx, {
      x: clamped.x, y: clamped.y, realX, realY, connectedPrimaryIndices,
    });
  }

  // Phase 3: Validate anchors — remove pulled chunks with no primary connections
  for (const [idx, pulled] of pulledMap) {
    if (pulled.connectedPrimaryIndices.length > 0) continue;
    // Cliff-zone nodes: check if any neighbor is primary
    const neighbors = adjacency.get(idx);
    if (!neighbors) { pulledMap.delete(idx); continue; }
    const anchorIndices = neighbors.filter((n) => primarySet.has(n));
    if (anchorIndices.length === 0) {
      pulledMap.delete(idx);
    } else {
      pulled.connectedPrimaryIndices = anchorIndices;
    }
  }

  return { pulledMap, primarySet };
}

export interface ChunkVisibilityParams {
  pullResult: ChunkPullResult;
  lensActive: boolean;
  lensNodeSet: Set<number> | null;
  /** Only needs .has() — accepts Map or Set. */
  focusPushSet: { has(key: number): boolean };
}

/**
 * Returns true if chunk i is rendered (visible) this frame.
 * Single source of truth used by both the render loop and proximity hover scan.
 */
export function isChunkNodeVisible(i: number, p: ChunkVisibilityParams): boolean {
  const isPulled = p.pullResult.pulledMap.has(i) && !p.focusPushSet.has(i);
  const isRelevantPulled = isPulled && (!p.lensActive || !!p.lensNodeSet?.has(i));
  return isRelevantPulled || p.pullResult.primarySet.has(i);
}

/**
 * Returns the index of the nearest visible chunk to (worldX, worldY) within
 * radiusSq squared distance, or null if none qualifies.
 */
export function findNearestVisibleChunk(
  worldX: number,
  worldY: number,
  radiusSq: number,
  renderPositions: Float32Array,
  n: number,
  isVisible: (i: number) => boolean,
): number | null {
  let bestDist = radiusSq;
  let bestIdx: number | null = null;
  for (let i = 0; i < n; i++) {
    if (!isVisible(i)) continue;
    const px = renderPositions[i * 2];
    const py = renderPositions[i * 2 + 1];
    const dx = px - worldX;
    const dy = py - worldY;
    const dSq = dx * dx + dy * dy;
    if (dSq < bestDist) { bestDist = dSq; bestIdx = i; }
  }
  return bestIdx;
}
