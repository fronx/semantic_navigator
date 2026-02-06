/**
 * Constrained force simulation for content node layout.
 * Spreads content nodes organically around their parent keywords while avoiding overlap.
 */

import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { ContentNode } from "@/lib/content-loader";
import { CONTENT_Z_DEPTH } from "@/lib/content-zoom-config";

/**
 * Content simulation node with 3D position behind keyword layer.
 * Z depth controlled by CONTENT_Z_DEPTH in content-zoom-config.
 */
export interface ContentSimNode extends SimNode {
  type: "chunk"; // DB node type, not visual layer name
  z: number;
  parentId: string; // Keyword ID
  content: string;
}

/**
 * Convert chunk data to simulation nodes positioned at parent keyword coordinates.
 *
 * @param keywords - Map of keyword ID to keyword SimNode
 * @param contentsByKeyword - Map of keyword ID to content nodes
 * @returns Content nodes and containment edges (keyword → content node)
 */
export function createContentNodes(
  keywords: SimNode[],
  contentsByKeyword: Map<string, ContentNode[]>
): { contentNodes: ContentSimNode[]; containmentEdges: SimLink[] } {
  const contentNodes: ContentSimNode[] = [];
  const containmentEdges: SimLink[] = [];

  // Build keyword ID → node lookup
  const keywordMap = new Map<string, SimNode>();
  for (const kw of keywords) {
    keywordMap.set(kw.id, kw);
  }

  for (const [keywordId, chunks] of contentsByKeyword) {
    const parent = keywordMap.get(keywordId);
    if (!parent) continue;

    for (const chunk of chunks) {
      const contentNode: ContentSimNode = {
        id: chunk.id,
        type: "chunk", // DB node type, not visual layer name
        label: chunk.summary || chunk.content.slice(0, 50) + "...",
        size: chunk.content.length,
        embedding: chunk.embedding,
        z: CONTENT_Z_DEPTH, // Behind keyword layer (from config)
        parentId: keywordId,
        content: chunk.content,
        // Initial position: parent keyword X-Y coordinates
        x: parent.x,
        y: parent.y,
        // Optional fields from SimNode
        communityId: undefined,
        communityMembers: undefined,
        hullLabel: undefined,
      };

      contentNodes.push(contentNode);

      // Create containment edge (keyword → content node)
      containmentEdges.push({
        source: keywordId,
        target: chunk.id,
      });
    }
  }

  return { contentNodes, containmentEdges };
}

/**
 * Apply constrained forces to content nodes to spread them around parent keywords.
 * This runs after the main keyword force simulation to organically arrange content nodes
 * while avoiding overlaps.
 *
 * Forces applied:
 * - Spring force toward parent keyword (keeps content nodes nearby)
 * - Repulsion between sibling content nodes (avoids overlap)
 * - Distance constraint (max distance from parent)
 *
 * @param contentNodes - Content nodes to update (mutates x, y in place)
 * @param keywords - Map of keyword ID to keyword SimNode
 * @param keywordRadius - Radius of keyword nodes (for distance constraint)
 */
export function applyConstrainedForces(
  contentNodes: ContentSimNode[],
  keywords: Map<string, SimNode>,
  keywordRadius: number
): void {
  const SPRING_STRENGTH = 0.1;
  const REPULSION_STRENGTH = 50;
  const MAX_DISTANCE_MULTIPLIER = 3;

  const maxDistance = keywordRadius * MAX_DISTANCE_MULTIPLIER;

  // Group content nodes by parent for sibling repulsion
  const contentsByParent = new Map<string, ContentSimNode[]>();
  for (const node of contentNodes) {
    if (!contentsByParent.has(node.parentId)) {
      contentsByParent.set(node.parentId, []);
    }
    contentsByParent.get(node.parentId)!.push(node);
  }

  // Apply forces to each content node
  for (const node of contentNodes) {
    const parent = keywords.get(node.parentId);
    if (!parent || parent.x === undefined || parent.y === undefined) continue;
    if (node.x === undefined || node.y === undefined) {
      node.x = parent.x;
      node.y = parent.y;
      continue;
    }

    let fx = 0;
    let fy = 0;

    // 1. Spring force toward parent keyword
    const dx = parent.x - node.x;
    const dy = parent.y - node.y;
    fx += dx * SPRING_STRENGTH;
    fy += dy * SPRING_STRENGTH;

    // 2. Repulsion from sibling content nodes (same parent)
    const siblings = contentsByParent.get(node.parentId) || [];
    for (const sibling of siblings) {
      if (sibling === node) continue;
      if (sibling.x === undefined || sibling.y === undefined) continue;

      const sdx = node.x - sibling.x;
      const sdy = node.y - sibling.y;
      const dist = Math.sqrt(sdx * sdx + sdy * sdy);
      if (dist === 0 || dist > maxDistance) continue;

      // Repulsion inversely proportional to distance
      const force = REPULSION_STRENGTH / (dist * dist);
      fx += (sdx / dist) * force;
      fy += (sdy / dist) * force;
    }

    // Apply forces with damping
    const damping = 0.5;
    node.x += fx * damping;
    node.y += fy * damping;

    // 3. Constrain max distance from parent
    const finalDx = node.x - parent.x;
    const finalDy = node.y - parent.y;
    const finalDist = Math.sqrt(finalDx * finalDx + finalDy * finalDy);

    if (finalDist > maxDistance) {
      // Pull back to max distance
      const scale = maxDistance / finalDist;
      node.x = parent.x + finalDx * scale;
      node.y = parent.y + finalDy * scale;
    }
  }
}
