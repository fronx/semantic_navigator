/**
 * Hull geometry computation and rendering for keyword communities.
 */

import * as d3 from "d3";
import type { SimNode } from "./map-renderer";
import { centroidToColor, type PCATransform } from "./semantic-colors";

// Legacy color scale (fallback when no PCA transform provided)
export const communityColorScale = d3.scaleOrdinal(d3.schemeTableau10);

export interface HullGeometry {
  hull: [number, number][];
  centroid: [number, number];
  expandedHull: [number, number][];
}

/**
 * Compute hull geometry from a set of points.
 * Pure function - no rendering, just geometry.
 */
export function computeHullGeometry(
  points: [number, number][],
  expansion = 1.3
): HullGeometry | null {
  if (points.length < 3) return null;

  const hull = d3.polygonHull(points);
  if (!hull) return null;

  const centroid = d3.polygonCentroid(hull);
  const expandedHull = hull.map(([x, y]) => {
    const dx = x - centroid[0];
    const dy = y - centroid[1];
    return [centroid[0] + dx * expansion, centroid[1] + dy * expansion] as [number, number];
  });

  return { hull, centroid, expandedHull };
}

/**
 * Group nodes by community ID.
 * Pure function - just data transformation.
 */
export function groupNodesByCommunity(nodes: SimNode[]): Map<number, SimNode[]> {
  const communitiesMap = new Map<number, SimNode[]>();
  for (const n of nodes) {
    if (n.type === "keyword" && n.communityId !== undefined) {
      if (!communitiesMap.has(n.communityId)) {
        communitiesMap.set(n.communityId, []);
      }
      communitiesMap.get(n.communityId)!.push(n);
    }
  }
  return communitiesMap;
}

// --- Rendering ---

export interface HullRenderer {
  /** Update hull positions (call on each tick). Optionally update opacity. Returns hull data for label rendering. */
  update: (opacity?: number) => HullData[];
  /** Update the communities map (for dynamic filtering) */
  updateCommunities: (newCommunitiesMap: Map<number, SimNode[]>) => void;
  /** The SVG group containing hulls */
  group: d3.Selection<SVGGElement, unknown, null, undefined>;
}

interface HullRendererOptions {
  parent: d3.Selection<SVGGElement, unknown, null, undefined>;
  communitiesMap: Map<number, SimNode[]>;
  visualScale: number;
  opacity: number; // 0-1, controls hull visibility
  /** PCA transform for stable semantic colors (optional, falls back to communityColorScale) */
  pcaTransform?: PCATransform;
}

export interface HullData {
  communityId: number;
  geometry: HullGeometry;
  /** Computed color for this hull (semantic or fallback) */
  color: string;
}

/**
 * Compute color for a community from member embeddings.
 * Falls back to legacy color scale if no PCA transform or embeddings.
 */
function computeHullColor(
  communityId: number,
  members: SimNode[],
  pcaTransform?: PCATransform
): string {
  if (pcaTransform) {
    const embeddings = members
      .map((m) => m.embedding)
      .filter((e): e is number[] => e !== undefined && e.length > 0);

    if (embeddings.length > 0) {
      return centroidToColor(embeddings, pcaTransform);
    }
  }
  // Fallback to legacy color scale
  return communityColorScale(String(communityId));
}

/**
 * Create a hull renderer for keyword communities.
 */
export function createHullRenderer(options: HullRendererOptions): HullRenderer {
  const { parent, visualScale, pcaTransform } = options;
  let communitiesMap = options.communitiesMap;
  let opacity = options.opacity;

  const group = parent.append("g").attr("class", "hulls");

  function update(newOpacity?: number): HullData[] {
    if (newOpacity !== undefined) opacity = newOpacity;

    // Build hull data array (also returned for label rendering)
    const hullData: HullData[] = [];

    if (opacity > 0) {
      for (const [communityId, members] of communitiesMap) {
        const points: [number, number][] = members.map((n) => [n.x!, n.y!]);
        const geometry = computeHullGeometry(points);
        if (geometry) {
          const color = computeHullColor(communityId, members, pcaTransform);
          hullData.push({ communityId, geometry, color });
        }
      }
    }

    // D3 data join for hull paths
    group
      .selectAll<SVGPathElement, HullData>("path")
      .data(hullData, (d) => String(d.communityId))
      .join(
        (enter) =>
          enter
            .append("path")
            .attr("stroke-width", 2 * visualScale),
        (update) => update,
        (exit) => exit.remove()
      )
      .attr("d", (d) => `M${d.geometry.expandedHull.join("L")}Z`)
      .attr("fill", (d) => d.color)
      .attr("fill-opacity", 0.08 * opacity)
      .attr("stroke", (d) => d.color)
      .attr("stroke-opacity", 0.3 * opacity);

    return hullData;
  }

  function updateCommunities(newCommunitiesMap: Map<number, SimNode[]>) {
    communitiesMap = newCommunitiesMap;
  }

  return { update, updateCommunities, group };
}
