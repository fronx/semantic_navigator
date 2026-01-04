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
  /** Update hull positions (call on each tick). Optionally update opacity. */
  update: (opacity?: number) => void;
  /** The SVG group containing hulls */
  group: d3.Selection<SVGGElement, unknown, null, undefined>;
}

interface HullRendererOptions {
  parent: d3.Selection<SVGGElement, unknown, null, undefined>;
  communitiesMap: Map<number, SimNode[]>;
  visualScale: number;
  opacity: number; // 0-1, controls hull visibility
}

/**
 * Create a hull renderer for keyword communities.
 */
export function createHullRenderer(options: HullRendererOptions): HullRenderer {
  const { parent, communitiesMap, visualScale } = options;
  let opacity = options.opacity;

  const group = parent.append("g").attr("class", "hulls");

  function update(newOpacity?: number) {
    if (newOpacity !== undefined) opacity = newOpacity;

    group.selectAll("path").remove();
    if (opacity === 0) return;

    for (const [communityId, members] of communitiesMap) {
      const points: [number, number][] = members.map((n) => [n.x!, n.y!]);
      const geometry = computeHullGeometry(points);

      if (geometry) {
        group
          .append("path")
          .attr("d", `M${geometry.expandedHull.join("L")}Z`)
          .attr("fill", communityColorScale(String(communityId)))
          .attr("fill-opacity", 0.08 * opacity)
          .attr("stroke", communityColorScale(String(communityId)))
          .attr("stroke-opacity", 0.3 * opacity)
          .attr("stroke-width", 2 * visualScale);
      }
    }
  }

  return { update, group };
}
