/**
 * Semantic color mapping for stable cluster coloring.
 *
 * Maps keyword embeddings to colors via PCA projection to 2D,
 * then polar coordinates to HSL (angle→hue, radius→saturation).
 */

import { normalize } from "./math-utils";

/** PCA transformation matrix: 2 rows × embedding_dim columns */
export type PCATransform = number[][];

/** Cached PCA transform (loaded once) */
let cachedTransform: PCATransform | null = null;
let loadPromise: Promise<PCATransform | null> | null = null;

/**
 * Load PCA transform from static file.
 * Returns cached value if already loaded.
 */
export async function loadPCATransform(): Promise<PCATransform | null> {
  if (cachedTransform) return cachedTransform;
  if (loadPromise) return loadPromise;

  loadPromise = fetch("/data/embedding-pca-transform.json")
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load PCA transform: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      cachedTransform = data.transform as PCATransform;
      return cachedTransform;
    })
    .catch((err) => {
      console.warn("[semantic-colors] Failed to load PCA transform:", err);
      return null;
    });

  return loadPromise;
}

/**
 * Project an embedding to 2D using pre-computed PCA transform.
 */
export function pcaProject(
  embedding: number[],
  transform: PCATransform
): [number, number] {
  const x = dotProduct(transform[0], embedding);
  const y = dotProduct(transform[1], embedding);
  return [x, y];
}

/**
 * Map 2D coordinates to HSL color string.
 * Uses polar coordinates: angle→hue, radius→saturation.
 */
export function coordinatesToHSL(x: number, y: number): string {
  // Angle to hue (0-360)
  const angle = Math.atan2(y, x);
  const hue = ((angle / Math.PI + 1) * 180) % 360;

  // Radius to saturation (50-100%)
  // Scale factor tuned for typical PCA coordinate ranges
  const radius = Math.sqrt(x * x + y * y);
  const saturation = 50 + Math.min(50, radius * 200);

  // Fixed lightness for readability
  const lightness = 45;

  return `hsl(${hue.toFixed(0)}, ${saturation.toFixed(0)}%, ${lightness}%)`;
}

/**
 * Compute cluster color from member embeddings.
 * Computes centroid, projects via PCA, maps to HSL.
 */
export function centroidToColor(
  memberEmbeddings: number[][],
  transform: PCATransform
): string {
  if (memberEmbeddings.length === 0) {
    return "hsl(0, 0%, 50%)"; // Gray fallback
  }

  const centroid = computeCentroidLocal(memberEmbeddings);
  const [x, y] = pcaProject(centroid, transform);
  return coordinatesToHSL(x, y);
}

/**
 * Get color for a single keyword from its PCA coordinates.
 */
export function pcaCoordsToColor(pcaX: number, pcaY: number): string {
  return coordinatesToHSL(pcaX, pcaY);
}

// --- Cluster-based coloring ---

/** Cluster color info for top-down coloring */
export interface ClusterColorInfo {
  /** Base hue (0-360) */
  h: number;
  /** Base saturation (0-100) */
  s: number;
  /** Base lightness (0-100) */
  l: number;
  /** Centroid in PCA space */
  pcaCentroid: [number, number];
}

/**
 * Compute cluster color info from member embeddings.
 * Returns base HSL and PCA centroid for computing node variations.
 */
export function computeClusterColorInfo(
  memberEmbeddings: number[][],
  transform: PCATransform
): ClusterColorInfo | null {
  if (memberEmbeddings.length === 0) return null;

  // Compute centroid in embedding space
  const centroid = computeCentroidLocal(memberEmbeddings);
  const [cx, cy] = pcaProject(centroid, transform);

  // Base color from centroid
  const angle = Math.atan2(cy, cx);
  const hue = ((angle / Math.PI + 1) * 180) % 360;
  const radius = Math.sqrt(cx * cx + cy * cy);
  const saturation = 50 + Math.min(50, radius * 200);
  const lightness = 45;

  return {
    h: hue,
    s: saturation,
    l: lightness,
    pcaCentroid: [cx, cy],
  };
}

/**
 * Compute node color as a blend between cluster base color and node's own color.
 *
 * @param mixRatio - 0 = pure cluster color (with small variations), 1 = pure node color
 *
 * Cluster-derived color (mixRatio=0):
 * - Direction from centroid → small hue shift (±15°)
 * - Distance from centroid → saturation adjustment (closer = more saturated)
 * - Distance from centroid → lightness adjustment (closer = slightly darker)
 *
 * Node's own color (mixRatio=1):
 * - Direct PCA projection → polar → HSL
 */
export function nodeColorFromCluster(
  nodeEmbedding: number[],
  clusterInfo: ClusterColorInfo,
  transform: PCATransform,
  mixRatio: number = 0
): string {
  const [nx, ny] = pcaProject(nodeEmbedding, transform);
  const [cx, cy] = clusterInfo.pcaCentroid;

  // === Cluster-derived color (with small variations) ===
  const dx = nx - cx;
  const dy = ny - cy;
  const offsetDist = Math.sqrt(dx * dx + dy * dy);

  // Direction of offset → hue shift (±15°)
  const offsetAngle = Math.atan2(dy, dx);
  const hueShift = (offsetAngle / Math.PI) * 15;

  // Distance → saturation and lightness adjustments
  const satAdjust = Math.max(-15, 10 - offsetDist * 80);
  const lightAdjust = Math.min(10, offsetDist * 30);

  const clusterH = (clusterInfo.h + hueShift + 360) % 360;
  const clusterS = Math.max(30, Math.min(100, clusterInfo.s + satAdjust));
  const clusterL = Math.max(30, Math.min(60, clusterInfo.l + lightAdjust));

  // === Node's own color (from its embedding directly) ===
  const nodeAngle = Math.atan2(ny, nx);
  const nodeH = ((nodeAngle / Math.PI + 1) * 180) % 360;
  const nodeRadius = Math.sqrt(nx * nx + ny * ny);
  const nodeS = 50 + Math.min(50, nodeRadius * 200);
  const nodeL = 45;

  // === Blend based on mixRatio ===
  // For hue, we need to handle the circular nature (0-360)
  let h: number;
  const hueDiff = nodeH - clusterH;
  // Take the shortest path around the hue circle
  if (Math.abs(hueDiff) <= 180) {
    h = clusterH + hueDiff * mixRatio;
  } else if (hueDiff > 0) {
    h = clusterH + (hueDiff - 360) * mixRatio;
  } else {
    h = clusterH + (hueDiff + 360) * mixRatio;
  }
  h = (h + 360) % 360;

  const s = clusterS + (nodeS - clusterS) * mixRatio;
  const l = clusterL + (nodeL - clusterL) * mixRatio;

  return `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
}

// --- Shared cluster color utilities ---

/**
 * Convert ClusterColorInfo to CSS HSL string.
 * Used by both D3 and Three.js renderers for consistent label coloring.
 */
export function clusterColorToCSS(info: ClusterColorInfo): string {
  return `hsl(${info.h.toFixed(0)}, ${info.s.toFixed(0)}%, ${info.l.toFixed(0)}%)`;
}

/** Node with embedding */
interface NodeWithEmbedding {
  id: string;
  embedding?: number[];
}

/**
 * Compute cluster color info from a pre-grouped communities map.
 * Computes centroid of each cluster's embeddings and returns HSL color info.
 *
 * Used by both D3 and Three.js renderers.
 *
 * @param communitiesMap - Map from communityId to array of nodes in that community
 * @param pcaTransform - PCA transform for projecting embeddings to 2D
 */
export function computeClusterColors<T extends NodeWithEmbedding>(
  communitiesMap: Map<number, T[]>,
  pcaTransform: PCATransform | undefined
): Map<number, ClusterColorInfo> {
  const clusterColors = new Map<number, ClusterColorInfo>();
  if (!pcaTransform) return clusterColors;

  for (const [communityId, members] of communitiesMap) {
    const embeddings = members
      .map((m) => m.embedding)
      .filter((e): e is number[] => e !== undefined && e.length > 0);

    if (embeddings.length > 0) {
      const info = computeClusterColorInfo(embeddings, pcaTransform);
      if (info) {
        clusterColors.set(communityId, info);
      }
    }
  }
  return clusterColors;
}

// --- Neighbor-averaged coloring ---

interface NodeWithEmbedding {
  id: string;
  embedding?: number[];
}

interface Edge {
  source: string;
  target: string;
}

/**
 * Compute colors for nodes by averaging each node's PCA position with its neighbors.
 * This creates stable, semantically meaningful colors with local coherence.
 *
 * Algorithm:
 * 1. Project each node's embedding to 2D via PCA
 * 2. For each node, average its 2D position with neighbors' positions
 * 3. Convert the averaged position to HSL color
 *
 * @returns Map from node ID to HSL color string
 */
export function computeNeighborAveragedColors(
  nodes: NodeWithEmbedding[],
  edges: Edge[],
  transform: PCATransform
): Map<string, string> {
  const colorMap = new Map<string, string>();

  // Build adjacency map for fast neighbor lookup
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  // Compute PCA positions for all nodes
  const pcaPositions = new Map<string, [number, number]>();
  for (const node of nodes) {
    if (node.embedding) {
      pcaPositions.set(node.id, pcaProject(node.embedding, transform));
    }
  }

  // Compute neighbor-averaged colors
  for (const node of nodes) {
    const nodePos = pcaPositions.get(node.id);
    if (!nodePos) {
      colorMap.set(node.id, "hsl(0, 0%, 50%)"); // Gray fallback
      continue;
    }

    // Collect positions: node + neighbors
    const positions: [number, number][] = [nodePos];
    const neighbors = adjacency.get(node.id);
    if (neighbors) {
      for (const neighborId of neighbors) {
        const neighborPos = pcaPositions.get(neighborId);
        if (neighborPos) {
          positions.push(neighborPos);
        }
      }
    }

    // Average positions
    let avgX = 0;
    let avgY = 0;
    for (const [x, y] of positions) {
      avgX += x;
      avgY += y;
    }
    avgX /= positions.length;
    avgY /= positions.length;

    // Convert to color
    colorMap.set(node.id, coordinatesToHSL(avgX, avgY));
  }

  return colorMap;
}

// --- Internal helpers ---

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Compute normalized centroid (local copy to avoid circular import).
 */
function computeCentroidLocal(embeddings: number[][]): number[] {
  const dim = embeddings[0].length;
  const sum = new Array(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      sum[i] += emb[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    sum[i] /= embeddings.length;
  }

  return normalize(sum);
}
