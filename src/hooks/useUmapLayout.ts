/**
 * Hook for running UMAP dimensionality reduction in the browser with live position updates.
 * Uses umap-js step-by-step API with requestAnimationFrame for smooth animation.
 *
 * Outputs a flat Float32Array of interleaved [x0,y0,x1,y1,...] positions,
 * centered on origin for direct use in Three.js/R3F instanced mesh buffers.
 */

import { useEffect, useRef, useState } from "react";
import { UMAP } from "umap-js";
import type { SparseMatrix } from "umap-js/dist/matrix";

export interface UmapEdge {
  /** Source node index (maps to chunks array) */
  source: number;
  /** Target node index (maps to chunks array) */
  target: number;
  /** Edge weight from fuzzy simplicial set */
  weight: number;
  /** Ideal rest length derived from current embedding (null until computed) */
  restLength: number | null;
}

export interface UmapLayoutResult {
  /** Interleaved [x0,y0,x1,y1,...] positions centered on origin */
  positions: Float32Array;
  /** 0..1 progress through UMAP epochs */
  progress: number;
  /** Whether UMAP is currently running */
  isRunning: boolean;
  /** Current epoch number */
  epoch: number;
  /** Total number of epochs */
  totalEpochs: number;
  /** Neighborhood graph edges that influence the layout */
  neighborhoodEdges: UmapEdge[];
  /** Monotonic counter incremented whenever neighborhoodEdges changes */
  neighborhoodEdgesVersion: number;
}

export interface UmapLayoutOptions {
  /** Number of nearest neighbors (default: 15) */
  nNeighbors?: number;
  /** Minimum distance between points (default: 0.1) */
  minDist?: number;
  /** Target spread of points (default: 1.0) */
  spread?: number;
  /** UMAP steps to run per animation frame (default: 8) */
  stepsPerFrame?: number;
  /** How often to trigger a React re-render, in steps (default: 10) */
  renderInterval?: number;
  /** Target radius of the layout in world units (default: 500) */
  targetRadius?: number;
  /** Increment to force a UMAP restart without changing embeddings or params */
  seed?: number;
}

const EMPTY_POSITIONS = new Float32Array(0);

function extractNeighborhoodEdges(
  graph: SparseMatrix,
  cutoff: number
): UmapEdge[] {
  const deduped = new Map<string, UmapEdge>();
  const entries = graph.getAll();

  for (const entry of entries) {
    const { row, col, value } = entry;
    if (row === col) continue;
    if (value < cutoff) continue;

    const source = Math.min(row, col);
    const target = Math.max(row, col);
    const key = `${source}-${target}`;

    const existing = deduped.get(key);
    if (!existing || value > existing.weight) {
      deduped.set(key, { source, target, weight: value, restLength: null });
    }
  }

  return Array.from(deduped.values());
}

function attachRestLengths(
  edges: UmapEdge[],
  positions: Float32Array
): UmapEdge[] {
  if (positions.length < 4 || edges.length === 0) return edges;

  const result: UmapEdge[] = new Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const sourceIdx = edge.source * 2;
    const targetIdx = edge.target * 2;
    if (
      sourceIdx + 1 >= positions.length ||
      targetIdx + 1 >= positions.length
    ) {
      result[i] = { ...edge, restLength: null };
      continue;
    }

    const sx = positions[sourceIdx];
    const sy = positions[sourceIdx + 1];
    const tx = positions[targetIdx];
    const ty = positions[targetIdx + 1];
    const dx = sx - tx;
    const dy = sy - ty;
    const dist = Math.hypot(dx, dy);
    result[i] = { ...edge, restLength: dist };
  }

  return result;
}

/**
 * Normalize raw UMAP positions: center on origin and scale to targetRadius.
 * Writes directly into a Float32Array for efficient Three.js buffer transfer.
 */
function normalizePositions(
  raw: number[][],
  out: Float32Array,
  targetRadius: number
): void {
  const n = raw.length;
  if (n === 0) return;

  // Compute centroid
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += raw[i][0];
    cy += raw[i][1];
  }
  cx /= n;
  cy /= n;

  // Find max distance from centroid for scaling
  let maxDist = 0;
  for (let i = 0; i < n; i++) {
    const dx = raw[i][0] - cx;
    const dy = raw[i][1] - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) maxDist = dist;
  }

  const scale = maxDist > 0 ? targetRadius / maxDist : 1;

  // Write centered + scaled positions into flat array
  for (let i = 0; i < n; i++) {
    out[i * 2] = (raw[i][0] - cx) * scale;
    out[i * 2 + 1] = (raw[i][1] - cy) * scale;
  }
}

/**
 * Compute a stable identity key for an embeddings array.
 * Uses length + a sample of values to detect when data actually changes,
 * avoiding deep comparison on every render.
 * Includes tunable parameters so changing them invalidates the cache.
 */
function embeddingsKey(
  embeddings: number[][],
  nNeighbors: number,
  minDist: number,
  spread: number,
  seed: number
): string {
  if (embeddings.length === 0) return "empty";
  const first = embeddings[0];
  const last = embeddings[embeddings.length - 1];
  // Sample a few values for fingerprinting + include parameters
  return `${embeddings.length}:${first[0]}:${first[first.length - 1]}:${last[0]}:${last[last.length - 1]}:${nNeighbors}:${minDist}:${spread}:${seed}`;
}

export function useUmapLayout(
  embeddings: number[][],
  options: UmapLayoutOptions = {}
): UmapLayoutResult {
  const {
    nNeighbors = 15,
    minDist = 0.1,
    spread = 1.0,
    stepsPerFrame = 8,
    renderInterval = 10,
    targetRadius = 500,
    seed = 0,
  } = options;

  // Mutable state (no re-renders)
  const umapRef = useRef<UMAP | null>(null);
  const rafIdRef = useRef<number>(0);
  const positionsRef = useRef<Float32Array>(EMPTY_POSITIONS);
  const epochRef = useRef(0);
  const totalEpochsRef = useRef(0);
  const stepsSinceRenderRef = useRef(0);
  const isRunningRef = useRef(false);
  const neighborhoodEdgesRef = useRef<UmapEdge[]>([]);
  const neighborhoodEdgesVersionRef = useRef(0);

  const updateNeighborhoodEdges = (edges: UmapEdge[]) => {
    neighborhoodEdgesRef.current = edges;
    neighborhoodEdgesVersionRef.current += 1;
  };

  // React state (triggers re-renders on periodic updates)
  const [result, setResult] = useState<UmapLayoutResult>({
    positions: EMPTY_POSITIONS,
    progress: 0,
    isRunning: false,
    epoch: 0,
    totalEpochs: 0,
    neighborhoodEdges: [],
    neighborhoodEdgesVersion: 0,
  });

  // Track embeddings identity to avoid re-running on referential changes
  const prevKeyRef = useRef("");

  useEffect(() => {
    const key = embeddingsKey(embeddings, nNeighbors, minDist, spread, seed);
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    function snapshotResult(running: boolean): UmapLayoutResult {
      const edgesWithRestLengths = attachRestLengths(
        neighborhoodEdgesRef.current,
        positionsRef.current
      );

      return {
        positions: positionsRef.current,
        progress:
          totalEpochsRef.current > 0
            ? epochRef.current / totalEpochsRef.current
            : 0,
        isRunning: running,
        epoch: epochRef.current,
        totalEpochs: totalEpochsRef.current,
        neighborhoodEdges: edgesWithRestLengths,
        neighborhoodEdgesVersion: neighborhoodEdgesVersionRef.current,
      };
    }

    // Cancel any in-progress run
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }

    // Need at least 2 points for UMAP
    if (embeddings.length < 2) {
      positionsRef.current = EMPTY_POSITIONS;
      epochRef.current = 0;
      totalEpochsRef.current = 0;
      updateNeighborhoodEdges([]);
      isRunningRef.current = false;
      setResult(snapshotResult(false));
      return;
    }

    // Initialize UMAP
    const umap = new UMAP({
      nComponents: 2,
      nNeighbors: Math.min(nNeighbors, embeddings.length - 1),
      minDist,
      spread,
    });

    const nEpochs = umap.initializeFit(embeddings);
    umapRef.current = umap;
    totalEpochsRef.current = nEpochs;
    epochRef.current = 0;
    stepsSinceRenderRef.current = 0;
    isRunningRef.current = true;

    // Extract neighborhood graph edges that will influence optimization
    const graphContainer = umap as unknown as { graph?: SparseMatrix };
    const graph = graphContainer.graph;
    if (graph) {
      const values = graph.getValues();
      if (values.length > 0) {
        const graphMax = Math.max(...values);
        const safeEpochs = Math.max(nEpochs, 1);
        const cutoff = graphMax / safeEpochs;
        const edges = extractNeighborhoodEdges(graph, cutoff);
        updateNeighborhoodEdges(edges);
      } else {
        updateNeighborhoodEdges([]);
      }
    } else {
      updateNeighborhoodEdges([]);
    }

    // Allocate output buffer
    positionsRef.current = new Float32Array(embeddings.length * 2);

    // Write initial positions
    const initialEmbedding = umap.getEmbedding();
    normalizePositions(
      initialEmbedding,
      positionsRef.current,
      targetRadius
    );
    setResult(snapshotResult(true));

    // rAF loop
    function tick() {
      const u = umapRef.current;
      if (!u || !isRunningRef.current) return;

      const total = totalEpochsRef.current;
      let stepped = 0;

      while (stepped < stepsPerFrame && epochRef.current < total) {
        u.step();
        epochRef.current++;
        stepped++;
      }

      // Update positions buffer
      const embedding = u.getEmbedding();
      normalizePositions(embedding, positionsRef.current, targetRadius);

      stepsSinceRenderRef.current += stepped;

      // Check if done
      if (epochRef.current >= total) {
        isRunningRef.current = false;
        setResult(snapshotResult(false));
        return;
      }

      // Periodic React re-render
      if (stepsSinceRenderRef.current >= renderInterval) {
        stepsSinceRenderRef.current = 0;
        setResult(snapshotResult(true));
      }

      rafIdRef.current = requestAnimationFrame(tick);
    }

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      isRunningRef.current = false;
      umapRef.current = null;
      // Reset key so strict mode's second run can re-initialize
      prevKeyRef.current = "";
    };
  }, [
    embeddings,
    nNeighbors,
    minDist,
    spread,
    stepsPerFrame,
    renderInterval,
    targetRadius,
  ]);

  return result;
}
