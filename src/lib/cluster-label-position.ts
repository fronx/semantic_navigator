/**
 * Cluster label positioning utilities.
 * Computes optimal label positions for clusters, especially elongated ones.
 */

import type { SimNode } from "./map-renderer";

/**
 * Compute the graph center (mean position of all nodes).
 * Used for label positioning to determine cluster spread direction.
 *
 * @param nodes - All nodes in the graph
 * @returns Graph center coordinates, or [0, 0] if no nodes
 */
export function computeGraphCenter(nodes: SimNode[] | Iterable<SimNode[]>): [number, number] {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  // Handle both array of nodes and iterable of node arrays (Map.values())
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      sumX += node.x ?? 0;
      sumY += node.y ?? 0;
      count++;
    }
  } else {
    for (const nodeArray of nodes) {
      for (const node of nodeArray) {
        sumX += node.x ?? 0;
        sumY += node.y ?? 0;
        count++;
      }
    }
  }

  return count > 0 ? [sumX / count, sumY / count] : [0, 0];
}

/**
 * Compute label position for a cluster.
 *
 * For elongated clusters, positions the label toward the cluster's spread
 * rather than at the geometric center. This avoids labeling "shoulder joints"
 * when we should label "arms" - labels appear in the body of the cluster.
 *
 * Algorithm:
 * 1. Find direction from graph center to cluster centroid
 * 2. Find the hull point furthest in that direction
 * 3. Position label between centroid and furthest point
 *
 * @param hull - Convex hull points defining the cluster boundary
 * @param centroid - Geometric center of the hull
 * @param graphCenter - Overall graph center (mean of all node positions)
 * @param offsetFactor - How far toward edge to position (0=centroid, 1=edge). Default 0.6
 * @returns Label position coordinates
 */
export function computeLabelPosition(
  hull: [number, number][],
  centroid: [number, number],
  graphCenter?: [number, number],
  offsetFactor = 0.6
): [number, number] {
  // Without graph center, just use centroid
  if (!graphCenter) {
    return centroid;
  }

  // Find direction from graph center to cluster centroid
  const dirX = centroid[0] - graphCenter[0];
  const dirY = centroid[1] - graphCenter[1];
  const dirLength = Math.sqrt(dirX * dirX + dirY * dirY);

  // If cluster is at graph center, use centroid
  if (dirLength === 0) {
    return centroid;
  }

  // Normalize direction vector
  const normDirX = dirX / dirLength;
  const normDirY = dirY / dirLength;

  // Find the hull point that's furthest in this direction
  let maxProjection = -Infinity;
  let furthestPoint = centroid;

  for (const [x, y] of hull) {
    // Project point onto direction vector (relative to centroid)
    const dx = x - centroid[0];
    const dy = y - centroid[1];
    const projection = dx * normDirX + dy * normDirY;

    if (projection > maxProjection) {
      maxProjection = projection;
      furthestPoint = [x, y];
    }
  }

  // Position label between centroid and furthest point
  return [
    centroid[0] + (furthestPoint[0] - centroid[0]) * offsetFactor,
    centroid[1] + (furthestPoint[1] - centroid[1]) * offsetFactor,
  ];
}
