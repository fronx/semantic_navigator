/**
 * Lens mode logic for chunks visualization.
 * Implements fisheye-like focus on selected chunk and its neighborhood.
 */

import * as THREE from "three";

export const LENS_MAX_HOPS = 2;
export const LENS_CENTER_SCALE = 1.3;
export const LENS_EDGE_SCALE = 0.75;
export const LENS_EDGE_LIMIT_RATIO = 0.65;
export const LENS_EDGE_MAX_SCALE = 1.0;

export const HIGHLIGHT_COLOR = new THREE.Color(1, 1, 1);

export interface LensInfo {
  focusIndex: number;
  nodeSet: Set<number>;
  depthMap: Map<number, number>;
}

/**
 * BFS from focusIndex up to maxHops, returning the reachable set and depth map.
 */
export function computeBfsNeighborhood(
  focusIndex: number,
  adjacency: Map<number, number[]>,
  maxHops: number,
): LensInfo {
  const nodeSet = new Set<number>([focusIndex]);
  const depthMap = new Map<number, number>([[focusIndex, 0]]);
  const queue: Array<{ index: number; depth: number }> = [{ index: focusIndex, depth: 0 }];

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

  return { focusIndex, nodeSet, depthMap };
}

/**
 * Compute per-node scale for a lens-focused node based on its radial
 * distance from camera center and its BFS depth from the focus node.
 */
export function computeLensNodeScale(
  x: number,
  y: number,
  camX: number,
  camY: number,
  depth: number | undefined,
  compressionStartRadius: number,
  maxRadius: number,
): number {
  if (maxRadius <= compressionStartRadius) return LENS_CENTER_SCALE;

  const dx = x - camX;
  const dy = y - camY;
  const radialDistance = Math.sqrt(dx * dx + dy * dy);
  const radialWeight = 1 - THREE.MathUtils.smoothstep(radialDistance, compressionStartRadius, maxRadius);

  const depthWeight = depth == null
    ? 0
    : 1 - Math.min(depth, LENS_MAX_HOPS) / Math.max(1, LENS_MAX_HOPS);

  const blendedWeight = THREE.MathUtils.clamp(radialWeight * 0.7 + depthWeight * 0.3, 0, 1);
  let scale = THREE.MathUtils.lerp(LENS_EDGE_SCALE, LENS_CENTER_SCALE, blendedWeight);

  // Clamp scale down at the outer edge zone to prevent overshoot
  const edgeZoneStart = compressionStartRadius + (maxRadius - compressionStartRadius) * LENS_EDGE_LIMIT_RATIO;
  if (maxRadius > edgeZoneStart) {
    const limitT = THREE.MathUtils.clamp(
      (radialDistance - edgeZoneStart) / (maxRadius - edgeZoneStart),
      0,
      1,
    );
    if (limitT > 0) {
      scale = Math.min(scale, THREE.MathUtils.lerp(LENS_EDGE_MAX_SCALE, LENS_EDGE_SCALE, limitT));
    }
  }

  return scale;
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
