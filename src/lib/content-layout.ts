/**
 * Constrained force simulation for content node layout.
 * Spreads content nodes organically around their parent keywords while avoiding overlap.
 */

import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { ContentNode } from "@/lib/content-loader";

/**
 * Content simulation node positioned behind keyword layer.
 * Z depth is controlled by the rendering component (ContentNodes), not stored on the node.
 */
export interface ContentSimNode extends SimNode {
  type: "chunk"; // DB node type, not visual layer name
  parentIds: string[]; // Multiple keyword IDs (chunk can belong to multiple keywords)
  content: string;
}

/**
 * Convert chunk data to simulation nodes positioned at centroid of parent keywords.
 * Each unique chunk appears once, connected to all keywords that reference it.
 *
 * @param keywords - Map of keyword ID to keyword SimNode
 * @param contentsByKeyword - Map of keyword ID to content nodes
 * @returns Deduplicated content nodes and containment edges (keyword → content node)
 */
export function createContentNodes(
  keywords: SimNode[],
  contentsByKeyword: Map<string, ContentNode[]>
): { contentNodes: ContentSimNode[]; containmentEdges: SimLink[] } {
  const containmentEdges: SimLink[] = [];

  // Build keyword ID → node lookup
  const keywordMap = new Map<string, SimNode>();
  for (const kw of keywords) {
    keywordMap.set(kw.id, kw);
  }

  // First pass: collect all keywords for each unique chunk ID
  const chunkToKeywords = new Map<string, Set<string>>();
  const chunkData = new Map<string, ContentNode>();

  for (const [keywordId, chunks] of contentsByKeyword) {
    for (const chunk of chunks) {
      // Store chunk data (same for all occurrences)
      if (!chunkData.has(chunk.id)) {
        chunkData.set(chunk.id, chunk);
      }

      // Collect parent keywords
      if (!chunkToKeywords.has(chunk.id)) {
        chunkToKeywords.set(chunk.id, new Set());
      }
      chunkToKeywords.get(chunk.id)!.add(keywordId);

      // Create containment edge (keyword → content node)
      containmentEdges.push({
        source: keywordId,
        target: chunk.id,
      });
    }
  }

  // Second pass: create deduplicated content nodes
  const contentNodes: ContentSimNode[] = [];
  for (const [chunkId, parentKeywordIds] of chunkToKeywords) {
    const chunk = chunkData.get(chunkId)!;
    const parentIdsArray = Array.from(parentKeywordIds);

    // Calculate initial position as centroid of parent keywords
    let centerX = 0;
    let centerY = 0;
    let validParents = 0;

    for (const parentId of parentIdsArray) {
      const parent = keywordMap.get(parentId);
      if (parent && parent.x !== undefined && parent.y !== undefined) {
        centerX += parent.x;
        centerY += parent.y;
        validParents++;
      }
    }

    if (validParents === 0) continue; // Skip if no valid parent positions

    centerX /= validParents;
    centerY /= validParents;

    const contentNode: ContentSimNode = {
      id: chunkId,
      type: "chunk", // DB node type, not visual layer name
      label: chunk.summary || chunk.content.slice(0, 50) + "...",
      size: chunk.content.length,
      embedding: chunk.embedding,
      parentIds: parentIdsArray, // All parent keywords
      content: chunk.content,
      // Initial position: centroid of parent keywords
      x: centerX,
      y: centerY,
      // Optional fields from SimNode
      communityId: undefined,
      communityMembers: undefined,
      hullLabel: undefined,
    };

    contentNodes.push(contentNode);
  }

  return { contentNodes, containmentEdges };
}

/**
 * Apply constrained forces to content nodes to spread them around parent keywords.
 * This runs after the main keyword force simulation to organically arrange content nodes
 * while avoiding overlaps.
 *
 * Forces applied:
 * - Spring force toward ALL parent keywords (combined force)
 * - Repulsion between all content nodes (global collision avoidance)
 * - Distance constraint (max distance from closest parent)
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

  // Apply forces to each content node
  for (const node of contentNodes) {
    if (!node.parentIds || node.parentIds.length === 0) continue;

    if (node.x === undefined || node.y === undefined) {
      // Initialize at centroid of parent keywords
      let centerX = 0;
      let centerY = 0;
      let validCount = 0;
      for (const parentId of node.parentIds) {
        const parent = keywords.get(parentId);
        if (parent && parent.x !== undefined && parent.y !== undefined) {
          centerX += parent.x;
          centerY += parent.y;
          validCount++;
        }
      }
      if (validCount > 0) {
        node.x = centerX / validCount;
        node.y = centerY / validCount;
      }
      continue;
    }

    let fx = 0;
    let fy = 0;
    let closestDist = Infinity;
    let closestParent: SimNode | null = null;

    // 1. Spring force toward ALL parent keywords (sum of forces)
    for (const parentId of node.parentIds) {
      const parent = keywords.get(parentId);
      if (!parent || parent.x === undefined || parent.y === undefined) continue;

      const dx = parent.x - node.x;
      const dy = parent.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Track closest parent for distance constraint
      if (dist < closestDist) {
        closestDist = dist;
        closestParent = parent;
      }

      fx += dx * SPRING_STRENGTH;
      fy += dy * SPRING_STRENGTH;
    }

    // 2. Repulsion from all other content nodes (global collision)
    for (const other of contentNodes) {
      if (other === node) continue;
      if (other.x === undefined || other.y === undefined) continue;

      const sdx = node.x - other.x;
      const sdy = node.y - other.y;
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

    // 3. Constrain max distance from closest parent
    if (closestParent && closestParent.x !== undefined && closestParent.y !== undefined) {
      const finalDx = node.x - closestParent.x;
      const finalDy = node.y - closestParent.y;
      const finalDist = Math.sqrt(finalDx * finalDx + finalDy * finalDy);

      if (finalDist > maxDistance) {
        // Pull back to max distance
        const scale = maxDistance / finalDist;
        node.x = closestParent.x + finalDx * scale;
        node.y = closestParent.y + finalDy * scale;
      }
    }
  }
}
