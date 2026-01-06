/**
 * Hull geometry computation and rendering for keyword communities.
 */

import * as d3 from "d3";
import type { SimNode } from "./map-renderer";

// Color scale for keyword communities (shared with map-renderer)
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
}

export interface HullData {
  communityId: number;
  geometry: HullGeometry;
}

/**
 * Create a hull renderer for keyword communities.
 */
export function createHullRenderer(options: HullRendererOptions): HullRenderer {
  const { parent, visualScale } = options;
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
          hullData.push({ communityId, geometry });
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
      .attr("fill", (d) => communityColorScale(String(d.communityId)))
      .attr("fill-opacity", 0.08 * opacity)
      .attr("stroke", (d) => communityColorScale(String(d.communityId)))
      .attr("stroke-opacity", 0.3 * opacity);

    return hullData;
  }

  function updateCommunities(newCommunitiesMap: Map<number, SimNode[]>) {
    communitiesMap = newCommunitiesMap;
  }

  return { update, updateCommunities, group };
}
