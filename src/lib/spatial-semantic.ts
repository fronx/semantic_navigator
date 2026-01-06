/**
 * Spatial-Semantic Filtering
 *
 * Composable primitives for filtering graph nodes by combining
 * spatial proximity with semantic similarity.
 */

import { cosineSimilarity as cosineSim, normalize } from "./semantic-zoom";

// Re-export for internal use (avoid naming conflicts)
const cosineSimilarity = cosineSim;

// ============================================================================
// Types
// ============================================================================

export interface SpatialNode {
  id: string;
  x?: number;
  y?: number;
}

export interface EmbeddingLookup {
  get(id: string): number[] | undefined;
}

export interface AdjacencyLookup {
  get(id: string): Set<string> | undefined;
}

// ============================================================================
// Graph Utilities
// ============================================================================

/**
 * Build an adjacency lookup from edges.
 */
export function buildAdjacencyMap(
  edges: Array<{ source: string; target: string }>
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }
  return adjacency;
}

/**
 * Build an embedding lookup from nodes with embeddings.
 */
export function buildEmbeddingMap<T extends { id: string; embedding?: number[] }>(
  nodes: T[],
  idTransform?: (node: T) => string
): Map<string, number[]> {
  const embeddings = new Map<string, number[]>();
  for (const node of nodes) {
    if (node.embedding) {
      const id = idTransform ? idTransform(node) : node.id;
      embeddings.set(id, node.embedding);
    }
  }
  return embeddings;
}

// ============================================================================
// Spatial Queries
// ============================================================================

/**
 * Find nodes within a given radius of a point.
 */
export function findNodesInRadius<T extends SpatialNode>(
  nodes: T[],
  center: { x: number; y: number },
  radius: number
): T[] {
  return nodes.filter((n) => {
    if (n.x === undefined || n.y === undefined) return false;
    const dx = n.x - center.x;
    const dy = n.y - center.y;
    return Math.sqrt(dx * dx + dy * dy) <= radius;
  });
}

/**
 * Convert screen coordinates to graph coordinates using D3 zoom transform.
 */
export function screenToGraph(
  screenX: number,
  screenY: number,
  transform: { k: number; x: number; y: number }
): { x: number; y: number } {
  return {
    x: (screenX - transform.x) / transform.k,
    y: (screenY - transform.y) / transform.k,
  };
}

/**
 * Convert screen distance to graph distance.
 */
export function screenToGraphDistance(
  screenDistance: number,
  zoomScale: number
): number {
  return screenDistance / zoomScale;
}

// ============================================================================
// Embedding Operations
// ============================================================================

/**
 * Compute the centroid (average) of multiple embeddings.
 * Returns normalized centroid suitable for cosine similarity.
 */
export function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];

  const dims = embeddings[0].length;
  const centroid = new Array(dims).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dims; i++) {
      centroid[i] += emb[i];
    }
  }

  for (let i = 0; i < dims; i++) {
    centroid[i] /= embeddings.length;
  }

  return normalize(centroid);
}

/**
 * Collect embeddings for a set of node IDs.
 */
export function collectEmbeddings(
  nodeIds: Iterable<string>,
  embeddings: EmbeddingLookup
): number[][] {
  const result: number[][] = [];
  for (const id of nodeIds) {
    const emb = embeddings.get(id);
    if (emb) result.push(emb);
  }
  return result;
}

// ============================================================================
// Semantic Filtering
// ============================================================================

/**
 * Filter nodes by cosine similarity to a centroid embedding.
 * Returns IDs of nodes that pass the threshold.
 */
export function filterBySimilarity<T extends { id: string }>(
  nodes: T[],
  centroid: number[],
  threshold: number,
  embeddings: EmbeddingLookup
): Set<string> {
  const result = new Set<string>();

  for (const node of nodes) {
    const emb = embeddings.get(node.id);
    if (emb) {
      const similarity = cosineSimilarity(emb, centroid);
      if (similarity >= threshold) {
        result.add(node.id);
      }
    }
  }

  return result;
}

/**
 * Extend a set of IDs to include direct graph neighbors.
 * Only adds neighbors that are in the candidate set.
 */
export function extendToNeighbors(
  ids: Set<string>,
  candidates: Set<string>,
  adjacency: AdjacencyLookup
): Set<string> {
  const extended = new Set(ids);

  for (const candidateId of candidates) {
    if (extended.has(candidateId)) continue;

    const neighbors = adjacency.get(candidateId);
    if (neighbors) {
      for (const neighborId of neighbors) {
        if (extended.has(neighborId)) {
          // candidateId is connected to an already-included node
          extended.add(candidateId);
          break;
        }
      }
    }
  }

  return extended;
}

// ============================================================================
// Combined Operations
// ============================================================================

export interface SpatialSemanticFilterOptions {
  /** All nodes in the graph */
  nodes: SpatialNode[];
  /** Center point in screen coordinates */
  screenCenter: { x: number; y: number };
  /** Screen radius in pixels */
  screenRadius: number;
  /** D3 zoom transform for coordinate conversion */
  transform: { k: number; x: number; y: number };
  /** Cosine similarity threshold (0-1) */
  similarityThreshold: number;
  /** Embedding lookup by node ID */
  embeddings: EmbeddingLookup;
  /** Adjacency lookup for neighbor re-inclusion */
  adjacency: AdjacencyLookup;
}

export interface SpatialSemanticFilterResult {
  /** IDs of highlighted nodes */
  highlightedIds: Set<string>;
  /** IDs of nodes in the spatial circle */
  spatialIds: Set<string>;
  /** The computed centroid (if any) */
  centroid: number[] | null;
  /** Debug info */
  debug?: {
    spatialCount: number;
    similarityPassCount: number;
    neighborAddCount: number;
    minSimilarity: number;
    maxSimilarity: number;
  };
}

/**
 * Combined spatial-semantic filter:
 * 1. Find nodes within spatial radius
 * 2. Compute centroid of their embeddings
 * 3. Filter ALL nodes by similarity to centroid
 * 4. Re-add spatial nodes that are direct neighbors of highlighted nodes
 */
export function spatialSemanticFilter(
  options: SpatialSemanticFilterOptions
): SpatialSemanticFilterResult {
  const { nodes, screenCenter, screenRadius, transform, similarityThreshold, embeddings, adjacency } = options;

  // Convert screen coordinates to graph coordinates
  const center = screenToGraph(screenCenter.x, screenCenter.y, transform);
  const radius = screenToGraphDistance(screenRadius, transform.k);

  // Step 1: Find nodes in spatial radius
  const spatialNodes = findNodesInRadius(nodes, center, radius);
  const spatialIds = new Set(spatialNodes.map((n) => n.id));

  if (spatialNodes.length === 0) {
    return { highlightedIds: new Set(), spatialIds, centroid: null };
  }

  // Step 2: Collect embeddings and compute centroid
  const spatialEmbeddings = collectEmbeddings(spatialIds, embeddings);

  if (spatialEmbeddings.length === 0) {
    // No embeddings available - just return spatial nodes
    return { highlightedIds: spatialIds, spatialIds, centroid: null };
  }

  const centroid = computeCentroid(spatialEmbeddings);

  // Step 3: Filter all nodes by similarity to centroid (with stats)
  let minSim = Infinity;
  let maxSim = -Infinity;
  const similarityPassIds = new Set<string>();

  for (const node of nodes) {
    const emb = embeddings.get(node.id);
    if (emb) {
      const similarity = cosineSimilarity(emb, centroid);
      minSim = Math.min(minSim, similarity);
      maxSim = Math.max(maxSim, similarity);
      if (similarity >= similarityThreshold) {
        similarityPassIds.add(node.id);
      }
    }
  }

  // Step 4: Re-add spatial nodes that are direct neighbors of highlighted nodes
  let highlightedIds = extendToNeighbors(similarityPassIds, spatialIds, adjacency);
  const neighborAddCount = highlightedIds.size - similarityPassIds.size;

  // Fallback: if no nodes pass similarity, highlight just the spatial nodes
  if (highlightedIds.size === 0) {
    highlightedIds = spatialIds;
  }

  return {
    highlightedIds,
    spatialIds,
    centroid,
    debug: {
      spatialCount: spatialNodes.length,
      similarityPassCount: similarityPassIds.size,
      neighborAddCount,
      minSimilarity: minSim === Infinity ? 0 : minSim,
      maxSimilarity: maxSim === -Infinity ? 0 : maxSim,
    },
  };
}
