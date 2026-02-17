/**
 * Lens mode logic for chunks visualization.
 * Implements fisheye-like focus on selected chunk and its neighborhood.
 */

import * as THREE from "three";
import { computeCompressionRatio } from "./hyperbolic-compression";

export const LENS_MAX_HOPS = 1;
export const DEFAULT_LENS_CENTER_SCALE = 3.0;
export const DEFAULT_LENS_EDGE_SCALE = 0.3;
export const DEFAULT_LENS_COMPRESSION_STRENGTH = 1.5;

export const HIGHLIGHT_COLOR = new THREE.Color(1, 1, 1);

export interface LensInfo {
  /** Ordered list of focus seed indices (typically 1-3 seeds). */
  focusIndices: number[];
  nodeSet: Set<number>;
  depthMap: Map<number, number>;
}

/**
 * BFS from one or more focus indices up to maxHops, returning the reachable set and depth map.
 */
export function computeBfsNeighborhood(
  focusIndices: number | number[],
  adjacency: Map<number, number[]>,
  maxHops: number,
): LensInfo {
  const seeds = (Array.isArray(focusIndices) ? focusIndices : [focusIndices])
    .filter((index) => index >= 0);

  if (seeds.length === 0) {
    return { focusIndices: [], nodeSet: new Set(), depthMap: new Map() };
  }

  const nodeSet = new Set<number>();
  const depthMap = new Map<number, number>();
  const queue: Array<{ index: number; depth: number }> = [];

  for (const index of seeds) {
    if (nodeSet.has(index)) continue;
    nodeSet.add(index);
    depthMap.set(index, 0);
    queue.push({ index, depth: 0 });
  }

  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= maxHops) continue;
    for (const neighbor of adjacency.get(current.index) ?? []) {
      if (nodeSet.has(neighbor)) continue;
      nodeSet.add(neighbor);
      depthMap.set(neighbor, current.depth + 1);
      queue.push({ index: neighbor, depth: current.depth + 1 });
    }
  }

  return { focusIndices: seeds, nodeSet, depthMap };
}

/**
 * Compute per-node scale based on radial distance from camera center
 * blended with BFS depth from the focus node (70% radial, 30% topology).
 */
export function computeLensNodeScale(
  x: number,
  y: number,
  camX: number,
  camY: number,
  depth: number | undefined,
  compressionStartRadius: number,
  maxRadius: number,
  compressionStrength: number = DEFAULT_LENS_COMPRESSION_STRENGTH,
  centerScale: number = DEFAULT_LENS_CENTER_SCALE,
  edgeScale: number = DEFAULT_LENS_EDGE_SCALE,
): number {
  if (maxRadius <= compressionStartRadius) return centerScale;

  const dx = x - camX;
  const dy = y - camY;
  const radialWeight = computeCompressionRatio(
    Math.sqrt(dx * dx + dy * dy), compressionStartRadius, maxRadius, compressionStrength,
  );

  const depthWeight = depth == null
    ? 0
    : 1 - Math.min(depth, LENS_MAX_HOPS) / Math.max(1, LENS_MAX_HOPS);

  const blendedWeight = THREE.MathUtils.clamp(radialWeight * 0.7 + depthWeight * 0.3, 0, 1);
  return THREE.MathUtils.lerp(edgeScale, centerScale, blendedWeight);
}

/**
 * BFS shortest path between two nodes. Returns path (including endpoints) or null if unreachable.
 */
export function bfsShortestPath(
  start: number,
  end: number,
  adjacency: Map<number, number[]>,
): number[] | null {
  if (start === end) return [start];
  const visited = new Set<number>([start]);
  const parent = new Map<number, number>();
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      parent.set(neighbor, current);
      if (neighbor === end) {
        const path: number[] = [end];
        let node = end;
        while (node !== start) {
          node = parent.get(node)!;
          path.push(node);
        }
        return path.reverse();
      }
      queue.push(neighbor);
    }
  }
  return null;
}

/**
 * Dual-focus neighborhood: union of BFS neighborhoods + shortest path between 2 seeds.
 * Path nodes get interpolated depth (0 at seeds, up to 0.5 at midpoint).
 * With 1 or 3+ seeds, returns plain BFS result.
 */
export function computeDualFocusNeighborhood(
  focusIndices: number | number[],
  adjacency: Map<number, number[]>,
  maxHops: number,
): LensInfo {
  const base = computeBfsNeighborhood(focusIndices, adjacency, maxHops);
  const seeds = base.focusIndices;
  if (seeds.length !== 2) return base;

  const path = bfsShortestPath(seeds[0], seeds[1], adjacency);
  if (!path || path.length <= 2) return base;

  const pathLength = path.length - 1;
  for (let i = 1; i < path.length - 1; i++) {
    const node = path[i];
    base.nodeSet.add(node);
    const distToNearest = Math.min(i, pathLength - i);
    const interpolatedDepth = distToNearest / pathLength;
    const existing = base.depthMap.get(node);
    if (existing === undefined || interpolatedDepth < existing) {
      base.depthMap.set(node, interpolatedDepth);
    }
  }

  return base;
}

/**
 * Apply lens-mode color emphasis: lerp toward white and brighten based on BFS depth.
 */
export function applyLensColorEmphasis(color: THREE.Color, depth: number): void {
  const emphasis = depth === 0 ? 1.35 : depth === 1 ? 1.15 : 1.05;
  color.lerp(HIGHLIGHT_COLOR, 0.15 * (LENS_MAX_HOPS - depth) / LENS_MAX_HOPS);
  color.multiplyScalar(emphasis);
  color.r = THREE.MathUtils.clamp(color.r, 0, 1);
  color.g = THREE.MathUtils.clamp(color.g, 0, 1);
  color.b = THREE.MathUtils.clamp(color.b, 0, 1);
}
