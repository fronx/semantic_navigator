/**
 * Hook for running UMAP dimensionality reduction in the browser with live position updates.
 * Uses umap-js step-by-step API with requestAnimationFrame for smooth animation.
 *
 * Outputs a flat Float32Array of interleaved [x0,y0,x1,y1,...] positions,
 * centered on origin for direct use in Three.js/R3F instanced mesh buffers.
 */

import { useEffect, useRef, useState } from "react";
import { UMAP } from "umap-js";

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
}

const EMPTY_POSITIONS = new Float32Array(0);

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
 */
function embeddingsKey(embeddings: number[][]): string {
  if (embeddings.length === 0) return "empty";
  const first = embeddings[0];
  const last = embeddings[embeddings.length - 1];
  // Sample a few values for fingerprinting
  return `${embeddings.length}:${first[0]}:${first[first.length - 1]}:${last[0]}:${last[last.length - 1]}`;
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
  } = options;

  // Mutable state (no re-renders)
  const umapRef = useRef<UMAP | null>(null);
  const rafIdRef = useRef<number>(0);
  const positionsRef = useRef<Float32Array>(EMPTY_POSITIONS);
  const epochRef = useRef(0);
  const totalEpochsRef = useRef(0);
  const stepsSinceRenderRef = useRef(0);
  const isRunningRef = useRef(false);

  // React state (triggers re-renders on periodic updates)
  const [result, setResult] = useState<UmapLayoutResult>({
    positions: EMPTY_POSITIONS,
    progress: 0,
    isRunning: false,
    epoch: 0,
    totalEpochs: 0,
  });

  // Track embeddings identity to avoid re-running on referential changes
  const prevKeyRef = useRef("");

  useEffect(() => {
    const key = embeddingsKey(embeddings);
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    function snapshotResult(running: boolean): UmapLayoutResult {
      return {
        positions: positionsRef.current,
        progress:
          totalEpochsRef.current > 0
            ? epochRef.current / totalEpochsRef.current
            : 0,
        isRunning: running,
        epoch: epochRef.current,
        totalEpochs: totalEpochsRef.current,
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
