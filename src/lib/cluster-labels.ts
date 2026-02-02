/**
 * Shared utilities for computing cluster label data.
 * Used by both D3 and Three.js renderers.
 */

import type { SimNode } from "./map-renderer";
import { groupNodesByCommunity, computeHullGeometry } from "./hull-renderer";
import { computeGraphCenter } from "./cluster-label-position";

export interface ClusterLabelData {
  communityId: number;
  centroid: [number, number];
  label: string;
  /** Ratio of visible members (for opacity) */
  visibilityRatio: number;
  /** Color for the label (from hull or color scale) */
  color: string;
}

export interface ComputeClusterLabelsOptions {
  nodes: SimNode[];
  /** Set of visible node IDs (for filtering, or null/undefined for all visible) */
  visibleIds?: Set<string> | null;
  /** Function to get color for a community */
  getColor: (communityId: number) => string;
}

/**
 * Compute cluster label data from nodes.
 * Returns label position (centroid), text, and visibility info for each cluster.
 */
export function computeClusterLabels(options: ComputeClusterLabelsOptions): ClusterLabelData[] {
  const { nodes, visibleIds, getColor } = options;

  const communitiesMap = groupNodesByCommunity(nodes);
  const labelData: ClusterLabelData[] = [];

  // Compute graph center (mean of all node positions) for label positioning
  const graphCenter = computeGraphCenter(nodes);

  for (const [communityId, members] of communitiesMap) {
    // Get positions for hull computation
    const points: [number, number][] = members.map((n) => [n.x!, n.y!]);
    const geometry = computeHullGeometry(points, 1.3, graphCenter);
    if (!geometry) continue;

    // Filter to visible members if visibleIds is provided
    const visibleMembers = visibleIds
      ? members.filter((m) => visibleIds.has(m.id))
      : members;

    // Find the hub (node with communityMembers set)
    const hub = visibleMembers.find((m) => m.communityMembers && m.communityMembers.length > 0);

    // Label priority: semantic label > keyword label > first visible member
    const label = hub?.hullLabel || hub?.label || visibleMembers[0]?.label || "";

    const visibilityRatio = visibleMembers.length / members.length;

    labelData.push({
      communityId,
      centroid: geometry.labelPosition,
      label,
      visibilityRatio,
      color: getColor(communityId),
    });
  }

  return labelData;
}
