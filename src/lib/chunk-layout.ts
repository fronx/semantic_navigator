/**
 * Constrained force simulation for chunk node layout.
 * Spreads chunks organically around their parent keywords while avoiding overlap.
 */

import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { ChunkNode } from "@/lib/chunk-loader";
import { CHUNK_Z_DEPTH } from "@/lib/chunk-zoom-config";

/**
 * Chunk simulation node with 3D position behind keyword layer.
 * Z depth controlled by CHUNK_Z_DEPTH in chunk-zoom-config.
 */
export interface ChunkSimNode extends SimNode {
  type: "chunk";
  z: number;
  parentId: string; // Keyword ID
}

/**
 * Convert chunk data to simulation nodes positioned at parent keyword coordinates.
 *
 * @param keywords - Map of keyword ID to keyword SimNode
 * @param chunksByKeyword - Map of keyword ID to chunks
 * @returns Chunk nodes and containment edges (keyword → chunk)
 */
export function createChunkNodes(
  keywords: SimNode[],
  chunksByKeyword: Map<string, ChunkNode[]>
): { chunkNodes: ChunkSimNode[]; containmentEdges: SimLink[] } {
  const chunkNodes: ChunkSimNode[] = [];
  const containmentEdges: SimLink[] = [];

  // Build keyword ID → node lookup
  const keywordMap = new Map<string, SimNode>();
  for (const kw of keywords) {
    keywordMap.set(kw.id, kw);
  }

  for (const [keywordId, chunks] of chunksByKeyword) {
    const parent = keywordMap.get(keywordId);
    if (!parent) continue;

    for (const chunk of chunks) {
      const chunkNode: ChunkSimNode = {
        id: chunk.id,
        type: "chunk",
        label: chunk.summary || chunk.content.slice(0, 50) + "...",
        size: chunk.content.length,
        embedding: chunk.embedding,
        z: CHUNK_Z_DEPTH, // Behind keyword layer (from config)
        parentId: keywordId,
        // Initial position: parent keyword X-Y coordinates
        x: parent.x,
        y: parent.y,
        // Optional fields from SimNode
        communityId: undefined,
        communityMembers: undefined,
        hullLabel: undefined,
      };

      chunkNodes.push(chunkNode);

      // Create containment edge (keyword → chunk)
      containmentEdges.push({
        source: keywordId,
        target: chunk.id,
      });
    }
  }

  return { chunkNodes, containmentEdges };
}

/**
 * Apply constrained forces to chunk nodes to spread them around parent keywords.
 * This runs after the main keyword force simulation to organically arrange chunks
 * while avoiding overlaps.
 *
 * Forces applied:
 * - Spring force toward parent keyword (keeps chunks nearby)
 * - Repulsion between sibling chunks (avoids overlap)
 * - Distance constraint (max distance from parent)
 *
 * @param chunks - Chunk nodes to update (mutates x, y in place)
 * @param keywords - Map of keyword ID to keyword SimNode
 * @param keywordRadius - Radius of keyword nodes (for distance constraint)
 */
export function applyConstrainedForces(
  chunks: ChunkSimNode[],
  keywords: Map<string, SimNode>,
  keywordRadius: number
): void {
  const SPRING_STRENGTH = 0.1;
  const REPULSION_STRENGTH = 50;
  const MAX_DISTANCE_MULTIPLIER = 3;

  const maxDistance = keywordRadius * MAX_DISTANCE_MULTIPLIER;

  // Group chunks by parent for sibling repulsion
  const chunksByParent = new Map<string, ChunkSimNode[]>();
  for (const chunk of chunks) {
    if (!chunksByParent.has(chunk.parentId)) {
      chunksByParent.set(chunk.parentId, []);
    }
    chunksByParent.get(chunk.parentId)!.push(chunk);
  }

  // Apply forces to each chunk
  for (const chunk of chunks) {
    const parent = keywords.get(chunk.parentId);
    if (!parent || parent.x === undefined || parent.y === undefined) continue;
    if (chunk.x === undefined || chunk.y === undefined) {
      chunk.x = parent.x;
      chunk.y = parent.y;
      continue;
    }

    let fx = 0;
    let fy = 0;

    // 1. Spring force toward parent keyword
    const dx = parent.x - chunk.x;
    const dy = parent.y - chunk.y;
    fx += dx * SPRING_STRENGTH;
    fy += dy * SPRING_STRENGTH;

    // 2. Repulsion from sibling chunks (same parent)
    const siblings = chunksByParent.get(chunk.parentId) || [];
    for (const sibling of siblings) {
      if (sibling === chunk) continue;
      if (sibling.x === undefined || sibling.y === undefined) continue;

      const sdx = chunk.x - sibling.x;
      const sdy = chunk.y - sibling.y;
      const dist = Math.sqrt(sdx * sdx + sdy * sdy);
      if (dist === 0 || dist > maxDistance) continue;

      // Repulsion inversely proportional to distance
      const force = REPULSION_STRENGTH / (dist * dist);
      fx += (sdx / dist) * force;
      fy += (sdy / dist) * force;
    }

    // Apply forces with damping
    const damping = 0.5;
    chunk.x += fx * damping;
    chunk.y += fy * damping;

    // 3. Constrain max distance from parent
    const finalDx = chunk.x - parent.x;
    const finalDy = chunk.y - parent.y;
    const finalDist = Math.sqrt(finalDx * finalDx + finalDy * finalDy);

    if (finalDist > maxDistance) {
      // Pull back to max distance
      const scale = maxDistance / finalDist;
      chunk.x = parent.x + finalDx * scale;
      chunk.y = parent.y + finalDy * scale;
    }
  }
}
