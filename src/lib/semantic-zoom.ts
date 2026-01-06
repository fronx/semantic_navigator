/**
 * Semantic Zoom - Core Algorithms
 *
 * Pure functions for semantic zoom calculations. No DOM dependencies.
 * See docs/architecture/adr/008-semantic-zoom.md for design decisions.
 */

// Re-export normalize from shared utils for backward compatibility
export { normalize } from "./math-utils";

// ============================================================================
// Types
// ============================================================================

export interface SemanticZoomConfig {
  /** Controls zoom-to-threshold curve steepness (0 = linear, 1 = steep) */
  steepness: number;
  /** Threshold at minimum zoom (show all) */
  minThreshold: number;
  /** Threshold at maximum zoom (very selective) */
  maxThreshold: number;
  /** Zoom level where threshold becomes 0 (all nodes visible) */
  zoomFloor: number;
  /** Maximum zoom level */
  zoomCeiling: number;
  /** Focal radius as fraction of viewport diagonal (0.05-0.5). Smaller = tighter focus */
  focalRadius: number;
  /** Hysteresis: zoom level "dead zone" when zooming out (must zoom out by this much before refiltering) */
  hysteresis: number;
}

export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface NodeWithEmbedding {
  id: string;
  x?: number;
  y?: number;
  embedding?: number[];
}

/** Default configuration */
export const DEFAULT_CONFIG: SemanticZoomConfig = {
  steepness: 0.0,      // Linear curve for predictable filtering
  minThreshold: 0.50,  // Jump to meaningful filtering immediately
  maxThreshold: 0.80,
  zoomFloor: 0.5,      // At 1x zoom, threshold = minThreshold
  zoomCeiling: 1.75,   // Reach max threshold quickly
  focalRadius: 0.1,    // 10% of viewport diagonal (was 20%, tighter default)
  hysteresis: 1.0,     // Must zoom out by 0.5 before refiltering (dead zone)
};
// Expected: zoom 1x→0.50, 1.375x→0.55, 1.75x→0.60

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Compute cosine similarity between two unit vectors.
 * Since embeddings are normalized, this is just the dot product.
 *
 * NOTE: For non-normalized vectors, use cosineSimilarity from math-utils.ts
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Compute cosine similarity using Float32Arrays for better performance.
 */
export function cosineSimilarityF32(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  // Unroll loop for performance (256 is divisible by 4)
  const len = a.length;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    dot += a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3];
  }
  // Handle remainder
  for (; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}


/**
 * Normalize a Float32Array in place.
 */
export function normalizeF32(v: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i] * v[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) {
      v[i] /= norm;
    }
  }
  return v;
}

/**
 * Check if a point is within viewport bounds.
 */
export function isInViewport(node: NodeWithEmbedding, bounds: ViewportBounds): boolean {
  if (node.x === undefined || node.y === undefined) return false;
  return (
    node.x >= bounds.minX &&
    node.x <= bounds.maxX &&
    node.y >= bounds.minY &&
    node.y <= bounds.maxY
  );
}

/**
 * Convert D3 zoom transform to viewport bounds in graph coordinates.
 *
 * D3 zoom transform: point_screen = transform.apply(point_graph)
 * Inverse: point_graph = transform.invert(point_screen)
 */
export function getViewportBounds(
  transform: { k: number; x: number; y: number },
  viewportSize: { width: number; height: number }
): ViewportBounds {
  // Screen corners
  const topLeft = { x: 0, y: 0 };
  const bottomRight = { x: viewportSize.width, y: viewportSize.height };

  // Invert to graph coordinates: graph = (screen - translate) / scale
  return {
    minX: (topLeft.x - transform.x) / transform.k,
    minY: (topLeft.y - transform.y) / transform.k,
    maxX: (bottomRight.x - transform.x) / transform.k,
    maxY: (bottomRight.y - transform.y) / transform.k,
  };
}

/**
 * Compute semantic centroid from visible nodes, weighted by proximity to screen center.
 *
 * @param nodes All nodes (will filter to those in viewport with embeddings)
 * @param bounds Viewport bounds in graph coordinates
 * @param screenCenter Center of screen in graph coordinates
 * @returns Normalized centroid embedding, or null if no valid nodes
 * @deprecated Use computeFocalNodes instead for better semantic filtering
 */
export function computeSemanticCentroid(
  nodes: NodeWithEmbedding[],
  bounds: ViewportBounds,
  screenCenter: Point
): Float32Array | null {
  // Filter to nodes in viewport with embeddings
  const visibleNodes = nodes.filter(
    (n) => n.embedding && isInViewport(n, bounds)
  );

  if (visibleNodes.length === 0) return null;

  // Compute weights based on distance to screen center
  // Closer to center = higher weight
  const weights: number[] = visibleNodes.map((n) => {
    const dx = (n.x ?? 0) - screenCenter.x;
    const dy = (n.y ?? 0) - screenCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Smooth falloff: weight = 1 / (1 + dist/scale)
    // scale of 100 means nodes 100 units away have half the weight
    return 1 / (1 + dist / 100);
  });

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return null;

  // Weighted average of embeddings
  const dims = visibleNodes[0].embedding!.length;
  const centroid = new Float32Array(dims);

  for (let i = 0; i < visibleNodes.length; i++) {
    const emb = visibleNodes[i].embedding!;
    const w = weights[i] / totalWeight;
    for (let d = 0; d < dims; d++) {
      centroid[d] += emb[d] * w;
    }
  }

  // Normalize to unit vector
  return normalizeF32(centroid);
}

/**
 * Get focal nodes near screen center for multi-centroid filtering.
 *
 * Instead of averaging embeddings into one centroid (which creates a phantom point),
 * we keep individual nodes and filter by similarity to ANY of them.
 * This preserves distinct semantic clusters that appear together on screen.
 *
 * @param nodes All nodes
 * @param bounds Viewport bounds in graph coordinates
 * @param screenCenter Center of screen in graph coordinates
 * @param focalRadius Radius (in graph units) around center to consider as "focal"
 * @returns Array of focal node embeddings, or null if none found
 */
export function computeFocalNodes(
  nodes: NodeWithEmbedding[],
  bounds: ViewportBounds,
  screenCenter: Point,
  focalRadius: number
): number[][] | null {
  // Filter to nodes in viewport with embeddings
  const visibleNodes = nodes.filter(
    (n) => n.embedding && isInViewport(n, bounds)
  );

  if (visibleNodes.length === 0) return null;

  // Find nodes within focal radius of screen center
  const focalNodes = visibleNodes.filter((n) => {
    const dx = (n.x ?? 0) - screenCenter.x;
    const dy = (n.y ?? 0) - screenCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist <= focalRadius;
  });

  // If no nodes in focal area, fall back to closest node
  if (focalNodes.length === 0) {
    let closest = visibleNodes[0];
    let closestDist = Infinity;
    for (const n of visibleNodes) {
      const dx = (n.x ?? 0) - screenCenter.x;
      const dy = (n.y ?? 0) - screenCenter.y;
      const dist = dx * dx + dy * dy;
      if (dist < closestDist) {
        closestDist = dist;
        closest = n;
      }
    }
    return closest.embedding ? [closest.embedding] : null;
  }

  return focalNodes.map((n) => n.embedding!);
}

/**
 * Compute visible set using multi-centroid approach.
 * A node is visible if it's similar enough to ANY focal node.
 */
export function computeVisibleSetMulti(
  nodes: NodeWithEmbedding[],
  focalEmbeddings: number[][],
  threshold: number
): Set<string> {
  const visible = new Set<string>();

  // If threshold is 0, all nodes are visible
  if (threshold <= 0) {
    for (const node of nodes) {
      visible.add(node.id);
    }
    return visible;
  }

  for (const node of nodes) {
    if (!node.embedding) {
      // Nodes without embeddings handled separately
      continue;
    }

    // Check similarity to each focal node - pass if similar to ANY
    let maxSimilarity = -Infinity;
    for (const focalEmb of focalEmbeddings) {
      const similarity = cosineSimilarity(node.embedding, focalEmb);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
      // Early exit if we already pass threshold
      if (similarity >= threshold) {
        visible.add(node.id);
        break;
      }
    }
  }

  return visible;
}

/**
 * Map zoom scale to similarity threshold.
 *
 * - Below zoomFloor: threshold = 0 (show all)
 * - Above zoomCeiling: threshold = maxThreshold
 * - In between: interpolate with steepness curve
 */
export function zoomToThreshold(
  zoomScale: number,
  config: SemanticZoomConfig = DEFAULT_CONFIG
): number {
  const { steepness, minThreshold, maxThreshold, zoomFloor, zoomCeiling } = config;

  // Below floor: threshold = 0
  if (zoomScale <= zoomFloor) {
    return minThreshold;
  }

  // Above ceiling: threshold = max
  if (zoomScale >= zoomCeiling) {
    return maxThreshold;
  }

  // Normalize zoom to 0-1 range within floor-ceiling
  const normalizedZoom = (zoomScale - zoomFloor) / (zoomCeiling - zoomFloor);

  // Apply steepness curve
  // steepness 0 = linear, steepness 1 = exponential (power of 3)
  const power = 1 + steepness * 2;
  const curved = Math.pow(normalizedZoom, power);

  // Map to threshold range
  return minThreshold + curved * (maxThreshold - minThreshold);
}

/**
 * Map zoom scale to edge opacity.
 *
 * Zoomed out → low opacity (less clutter)
 * Zoomed in → higher opacity (show relationships)
 */
export function zoomToEdgeOpacity(
  zoomScale: number,
  minOpacity: number = 0.1,
  maxOpacity: number = 0.8,
  zoomFloor: number = 0.5,
  zoomCeiling: number = 4.0
): number {
  if (zoomScale <= zoomFloor) return minOpacity;
  if (zoomScale >= zoomCeiling) return maxOpacity;

  const t = (zoomScale - zoomFloor) / (zoomCeiling - zoomFloor);
  return minOpacity + t * (maxOpacity - minOpacity);
}

/**
 * Compute the set of visible node IDs based on semantic distance from centroid.
 *
 * @param nodes All nodes with embeddings
 * @param centroid The semantic focus point
 * @param threshold Minimum similarity to be visible (0 = show all, 1 = exact match only)
 * @returns Set of node IDs that pass the threshold
 */
export function computeVisibleSet(
  nodes: NodeWithEmbedding[],
  centroid: Float32Array,
  threshold: number
): Set<string> {
  const visible = new Set<string>();

  // If threshold is 0, all nodes are visible
  if (threshold <= 0) {
    for (const node of nodes) {
      visible.add(node.id);
    }
    return visible;
  }

  for (const node of nodes) {
    if (!node.embedding) {
      // Nodes without embeddings: will handle separately (include if connected to visible)
      continue;
    }

    const similarity = cosineSimilarity(node.embedding, Array.from(centroid));
    if (similarity >= threshold) {
      visible.add(node.id);
    }
  }

  return visible;
}

/**
 * Extend visible set to include ALL direct neighbors of visible nodes.
 *
 * This ensures that if a keyword passes the semantic filter, all its
 * connected articles/chunks are also visible (and vice versa).
 *
 * @param visibleIds Current visible node IDs
 * @param allNodes All nodes (unused but kept for API compatibility)
 * @param edges All edges (source/target are node IDs)
 * @returns Extended set including all neighbors of visible nodes
 */
export function extendVisibleToConnected(
  visibleIds: Set<string>,
  _allNodes: NodeWithEmbedding[],
  edges: Array<{ source: string; target: string }>
): Set<string> {
  const extended = new Set(visibleIds);

  // Build adjacency for quick lookup
  const neighbors = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, new Set());
    if (!neighbors.has(edge.target)) neighbors.set(edge.target, new Set());
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }

  // Add ALL neighbors of visible nodes
  for (const visibleId of visibleIds) {
    const nodeNeighbors = neighbors.get(visibleId);
    if (nodeNeighbors) {
      for (const neighborId of nodeNeighbors) {
        extended.add(neighborId);
      }
    }
  }

  return extended;
}

/**
 * Compute position for a node being restored (zoom out).
 *
 * Priority:
 * 1. Stored position (if node was visible before)
 * 2. Interpolate from visible neighbors
 * 3. Place near centroid with jitter
 */
export function computeRestoredPosition(
  nodeId: string,
  storedPositions: Map<string, Point>,
  visibleNodes: NodeWithEmbedding[],
  edges: Array<{ source: string; target: string }>,
  graphCentroid: Point
): Point {
  // 1. Check stored position
  const stored = storedPositions.get(nodeId);
  if (stored) return stored;

  // 2. Find visible neighbors and interpolate
  const neighborIds = new Set<string>();
  for (const edge of edges) {
    if (edge.source === nodeId) neighborIds.add(edge.target);
    if (edge.target === nodeId) neighborIds.add(edge.source);
  }

  const visibleNeighbors = visibleNodes.filter((n) => neighborIds.has(n.id));
  if (visibleNeighbors.length > 0) {
    const avgX =
      visibleNeighbors.reduce((sum, n) => sum + (n.x ?? 0), 0) /
      visibleNeighbors.length;
    const avgY =
      visibleNeighbors.reduce((sum, n) => sum + (n.y ?? 0), 0) /
      visibleNeighbors.length;
    // Add small jitter to avoid stacking
    return {
      x: avgX + (Math.random() - 0.5) * 50,
      y: avgY + (Math.random() - 0.5) * 50,
    };
  }

  // 3. Fallback: place near graph centroid with larger jitter
  return {
    x: graphCentroid.x + (Math.random() - 0.5) * 200,
    y: graphCentroid.y + (Math.random() - 0.5) * 200,
  };
}

// ============================================================================
// Benchmarking Utilities
// ============================================================================

export interface SemanticZoomMetrics {
  centroidComputeMs: number;
  filterComputeMs: number;
  totalMs: number;
  visibleBefore: number;
  visibleAfter: number;
}

/**
 * Measure performance of semantic zoom operations.
 */
export function measureSemanticZoom(
  nodes: NodeWithEmbedding[],
  bounds: ViewportBounds,
  screenCenter: Point,
  threshold: number
): SemanticZoomMetrics {
  const startTotal = performance.now();

  const startCentroid = performance.now();
  const centroid = computeSemanticCentroid(nodes, bounds, screenCenter);
  const centroidMs = performance.now() - startCentroid;

  let filterMs = 0;
  let visibleAfter = nodes.length;

  if (centroid && threshold > 0) {
    const startFilter = performance.now();
    const visible = computeVisibleSet(nodes, centroid, threshold);
    filterMs = performance.now() - startFilter;
    visibleAfter = visible.size;
  }

  return {
    centroidComputeMs: centroidMs,
    filterComputeMs: filterMs,
    totalMs: performance.now() - startTotal,
    visibleBefore: nodes.length,
    visibleAfter,
  };
}
