/**
 * Shared edge color logic for all graph renderers (D3, Three.js, R3F).
 * Provides color blending for edges based on source and target node colors.
 */

import { blendColors } from "./colors";
import { getNodeColor } from "./three/node-renderer";
import type { SimNode, SimLink } from "./map-renderer";
import type { PCATransform, ClusterColorInfo } from "./semantic-colors";

/**
 * Get blended color for an edge based on source and target node colors.
 *
 * @param link - The edge link (with source/target as IDs or node objects)
 * @param nodeMap - Map of node IDs to node objects
 * @param pcaTransform - Optional PCA transform for semantic coloring
 * @param clusterColors - Optional cluster color information
 * @param colorMixRatio - Ratio for mixing cluster colors (0-1)
 * @param getNodeById - Optional callback to get node by ID (for chunk parent lookup)
 * @returns Hex color string for the edge
 */
export function getEdgeColor(
  link: SimLink,
  nodeMap: Map<string, SimNode>,
  pcaTransform?: PCATransform,
  clusterColors?: Map<number, ClusterColorInfo>,
  colorMixRatio: number = 0,
  getNodeById?: (nodeId: string) => SimNode | undefined
): string {
  const sourceId = typeof link.source === "string" ? link.source : link.source.id;
  const targetId = typeof link.target === "string" ? link.target : link.target.id;

  const sourceNode = nodeMap.get(sourceId);
  const targetNode = nodeMap.get(targetId);

  if (!sourceNode || !targetNode) {
    return "#888888";
  }

  const sourceColor = getNodeColor(sourceNode, pcaTransform, clusterColors, colorMixRatio, getNodeById);
  const targetColor = getNodeColor(targetNode, pcaTransform, clusterColors, colorMixRatio, getNodeById);

  return blendColors(sourceColor, targetColor);
}
