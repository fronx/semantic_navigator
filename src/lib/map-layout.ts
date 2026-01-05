/**
 * Layout utilities for the map view.
 * Handles UMAP and force-directed layout computations.
 *
 * Both layouts can run headlessly (no DOM) for testing and analysis.
 */

import { umapLayout, type KnnGraphObject } from "umapper";
import * as d3 from "d3";
import type { MapNode, MapEdge } from "@/app/api/map/route";

export type LayoutMode = "force" | "umap";

export interface LayoutPosition {
  id: string;
  x: number;
  y: number;
}

export interface LayoutProgress {
  progress: number;
  epoch: number;
  positions: LayoutPosition[];
}

/**
 * Build a k-NN graph from map edges for UMAP layout.
 * Converts similarity scores to distances.
 */
export function buildKnnFromEdges(
  nodes: MapNode[],
  edges: MapEdge[]
): KnnGraphObject {
  const knn: KnnGraphObject = {};

  // Initialize all nodes with empty neighbor lists
  for (const n of nodes) {
    knn[n.id] = [];
  }

  // Add edges as neighbors (convert similarity to distance)
  // Use power transform to spread distances - high similarities (0.9+) would otherwise
  // create tiny distances (0.1-), causing UMAP to pack everything tightly.
  // Power 0.5 transforms: sim 0.95→0.22, sim 0.90→0.32, sim 0.80→0.45
  for (const edge of edges) {
    const rawDist = edge.similarity !== undefined ? 1 - edge.similarity : 0.5;
    const distance = Math.pow(rawDist, 0.5);

    if (knn[edge.source]) {
      knn[edge.source].push({ id: edge.target, distance });
    }
    if (knn[edge.target]) {
      knn[edge.target].push({ id: edge.source, distance });
    }
  }

  // Sort neighbors by distance for each node
  for (const id in knn) {
    knn[id].sort((a, b) => a.distance - b.distance);
  }

  return knn;
}

/**
 * Scale raw positions to fit within canvas dimensions.
 * Used by test scripts for normalized comparisons.
 */
export function scalePositions(
  positions: { id: string; x: number; y: number }[],
  width: number,
  height: number,
  padding = 100
): LayoutPosition[] {
  if (positions.length === 0) return [];

  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const scale = Math.min(
    (width - 2 * padding) / (maxX - minX || 1),
    (height - 2 * padding) / (maxY - minY || 1)
  );

  return positions.map((p) => ({
    id: p.id,
    x: padding + (p.x - minX) * scale,
    y: padding + (p.y - minY) * scale,
  }));
}

/**
 * Center positions on canvas without scaling.
 * This produces layouts that overflow the canvas like Force layout does,
 * requiring zoom out to see everything (consistent behavior between modes).
 */
export function centerPositions(
  positions: { id: string; x: number; y: number }[],
  width: number,
  height: number
): LayoutPosition[] {
  if (positions.length === 0) return [];

  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);

  // Find centroid of positions
  const centroidX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const centroidY = ys.reduce((a, b) => a + b, 0) / ys.length;

  // Translate so centroid is at canvas center
  const offsetX = width / 2 - centroidX;
  const offsetY = height / 2 - centroidY;

  return positions.map((p) => ({
    id: p.id,
    x: p.x + offsetX,
    y: p.y + offsetY,
  }));
}

export interface UmapLayoutOptions {
  /** If true, scale positions to fit canvas. If false, center without scaling (overflow). */
  fit?: boolean;
  /** Attraction strength multiplier (default: 1.0). Higher values pull connected nodes together more strongly. */
  attractionStrength?: number;
  /** Repulsion strength multiplier (default: spread value, so 200). Lower values reduce drift. */
  repulsionStrength?: number;
  /** Scale for minimum attractive distance (default: 50). With minDist=20, this creates 1003px exclusion zone! Use ~1 for tighter attraction. */
  minAttractiveScale?: number;
  onProgress?: (progress: LayoutProgress) => void | boolean;
}

/**
 * Compute UMAP layout positions for nodes.
 *
 * @param fit - If true, scales positions to fit within canvas (like scalePositions).
 *              If false, centers positions without scaling (overflows like Force).
 */
export async function computeUmapLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  width: number,
  height: number,
  options?: UmapLayoutOptions | ((progress: LayoutProgress) => void | boolean)
): Promise<LayoutPosition[]> {
  // Support both old callback-only signature and new options object
  const opts: UmapLayoutOptions = typeof options === "function"
    ? { onProgress: options, fit: false }
    : options ?? {};
  const { fit = false, attractionStrength, repulsionStrength, minAttractiveScale, onProgress } = opts;

  const transform = fit
    ? (pos: LayoutPosition[]) => scalePositions(pos, width, height)
    : (pos: LayoutPosition[]) => centerPositions(pos, width, height);

  const knn = buildKnnFromEdges(nodes, edges);

  console.log("[UMAP] Layout params:", { attractionStrength, repulsionStrength, minAttractiveScale });

  const finalPositions = await umapLayout(knn, {
    minDist: 20.0,
    spread: 200.0,
    epochs: 1000,
    attractionStrength,
    repulsionStrength,
    minAttractiveScale,
    // Progress callback settings for live rendering
    progressInterval: 0,      // Report as often as possible
    skipInitialUpdates: 0,    // Don't skip any updates
    renderSampleRate: 1,      // Render every update
    onProgress: onProgress
      ? ({ progress, epoch, nodes: rawPositions }) => {
          const transformed = transform(rawPositions);
          return onProgress({ progress, epoch, positions: transformed });
        }
      : undefined,
  });

  return transform(finalPositions);
}

/**
 * Headless UMAP layout - returns raw positions without scaling.
 * Use for testing and analysis.
 */
export async function computeUmapLayoutRaw(
  nodes: MapNode[],
  edges: MapEdge[],
  options: {
    minDist?: number;
    spread?: number;
    epochs?: number;
    attractionStrength?: number;
    repulsionStrength?: number;
    onProgress?: (progress: { epoch: number; progress: number }) => void | boolean;
  } = {}
): Promise<LayoutPosition[]> {
  const knn = buildKnnFromEdges(nodes, edges);

  const positions = await umapLayout(knn, {
    minDist: options.minDist ?? 20.0,
    spread: options.spread ?? 200.0,
    epochs: options.epochs ?? 500,
    attractionStrength: options.attractionStrength,
    repulsionStrength: options.repulsionStrength,
    progressInterval: 100,
    onProgress: options.onProgress
      ? ({ progress, epoch }) => options.onProgress!({ epoch, progress })
      : undefined,
  });

  return positions;
}

/**
 * Simulation node for force layout (extends MapNode with D3 simulation fields).
 */
export interface ForceNode extends MapNode, d3.SimulationNodeDatum {}

export interface ForceLink extends d3.SimulationLinkDatum<ForceNode> {
  source: ForceNode;
  target: ForceNode;
  similarity?: number;
  isKNN?: boolean;
}

export interface ForceSimulationResult {
  simulation: d3.Simulation<ForceNode, ForceLink>;
  nodes: ForceNode[];
  links: ForceLink[];
}

/**
 * Create a configured force simulation.
 * Shared between live MapView and headless testing.
 *
 * @param fit - If true, use tighter forces (positions will be scaled to fit canvas)
 */
export function createForceSimulation(
  nodes: MapNode[],
  edges: MapEdge[],
  width: number,
  height: number,
  options: { fit?: boolean } = {}
): ForceSimulationResult {
  const { fit = false } = options;

  // Create simulation nodes
  const simNodes: ForceNode[] = nodes.map((n) => ({ ...n }));
  const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

  // Create simulation links
  const simLinks: ForceLink[] = edges
    .map((e) => ({
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      similarity: e.similarity,
      isKNN: e.isKNN,
    }))
    .filter((l) => l.source && l.target);

  // Check if node is a hub (has community members)
  const isHubNode = (node: ForceNode | string) => {
    if (typeof node === "string") return false;
    return node.communityMembers && node.communityMembers.length > 0;
  };

  // Create simulation with fit-aware parameters
  const simulation = d3
    .forceSimulation<ForceNode>(simNodes)
    .force(
      "link",
      d3
        .forceLink<ForceNode, ForceLink>(simLinks)
        .id((d) => d.id)
        .distance((d) => {
          const hubConnected = isHubNode(d.source) || isHubNode(d.target);
          const baseDistance = d.similarity ? 40 + (1 - d.similarity) * 100 : 120;
          return hubConnected ? baseDistance * 2 : baseDistance;
        })
        .strength((d) => {
          const hubConnected = isHubNode(d.source) || isHubNode(d.target);
          const baseStrength = d.similarity ? 0.5 + d.similarity * 0.5 : 0.3;
          return hubConnected ? baseStrength * 0.3 : baseStrength;
        })
    )
    // Weaker charge in fit mode since we scale positions to fit anyway
    .force("charge", d3.forceManyBody().strength(fit ? -50 : -300))
    .force("center", d3.forceCenter(width / 2, height / 2))
    // Disable collision in fit mode - position scaling handles overlap
    .force("collision", fit ? null : d3.forceCollide<ForceNode>().radius(30))
    .stop();

  return { simulation, nodes: simNodes, links: simLinks };
}

/**
 * Headless force-directed layout using D3.
 * Runs simulation to completion and returns final positions.
 */
export function computeForceLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  options: {
    width?: number;
    height?: number;
    maxTicks?: number;
    fit?: boolean;
  } = {}
): LayoutPosition[] {
  const width = options.width ?? 1000;
  const height = options.height ?? 1000;
  const maxTicks = options.maxTicks ?? 300;
  const fit = options.fit ?? false;

  const { simulation, nodes: simNodes } = createForceSimulation(
    nodes,
    edges,
    width,
    height,
    { fit }
  );

  // Run simulation synchronously
  for (let i = 0; i < maxTicks; i++) {
    simulation.tick();
  }

  // In fit mode, scale positions to fit within canvas
  if (fit) {
    return scalePositions(
      simNodes.map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 })),
      width,
      height
    );
  }

  return simNodes.map((n) => ({
    id: n.id,
    x: n.x ?? 0,
    y: n.y ?? 0,
  }));
}

/**
 * Compute statistics about position distribution.
 */
export function computePositionStats(positions: LayoutPosition[]): {
  count: number;
  xRange: { min: number; max: number; spread: number };
  yRange: { min: number; max: number; spread: number };
  centroid: { x: number; y: number };
  avgDistFromCentroid: number;
  medianDistFromCentroid: number;
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
} {
  if (positions.length === 0) {
    return {
      count: 0,
      xRange: { min: 0, max: 0, spread: 0 },
      yRange: { min: 0, max: 0, spread: 0 },
      centroid: { x: 0, y: 0 },
      avgDistFromCentroid: 0,
      medianDistFromCentroid: 0,
      percentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
    };
  }

  const xs = positions.map((p) => p.x);
  const ys = positions.map((p) => p.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const centroidX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const centroidY = ys.reduce((a, b) => a + b, 0) / ys.length;

  const distances = positions.map((p) =>
    Math.sqrt((p.x - centroidX) ** 2 + (p.y - centroidY) ** 2)
  );
  distances.sort((a, b) => a - b);

  const avgDist = distances.reduce((a, b) => a + b, 0) / distances.length;
  const medianDist = distances[Math.floor(distances.length / 2)];

  const percentile = (arr: number[], p: number) => arr[Math.floor(arr.length * p / 100)];

  return {
    count: positions.length,
    xRange: { min: minX, max: maxX, spread: maxX - minX },
    yRange: { min: minY, max: maxY, spread: maxY - minY },
    centroid: { x: centroidX, y: centroidY },
    avgDistFromCentroid: avgDist,
    medianDistFromCentroid: medianDist,
    percentiles: {
      p5: percentile(distances, 5),
      p25: percentile(distances, 25),
      p50: percentile(distances, 50),
      p75: percentile(distances, 75),
      p95: percentile(distances, 95),
    },
  };
}
