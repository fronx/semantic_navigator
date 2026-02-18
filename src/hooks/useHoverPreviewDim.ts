/**
 * Hover preview dim: when hovering a chunk, non-neighborhood nodes slowly dim
 * over ~3 seconds, previewing the focus effect before committing to a click.
 * On hover-out, the dim reverses.
 */

import { useRef, type MutableRefObject } from "react";

import { computeDualFocusNeighborhood } from "@/lib/chunks-lens";

interface UseHoverPreviewDimOptions {
  /** Ref to current hovered index (null = nothing hovered) */
  hoveredIndexRef: MutableRefObject<number | null>;
  /** Adjacency map from UMAP layout */
  adjacency: Map<number, number[]>;
  /** Total chunk count */
  count: number;
  /** BFS hops for preview neighborhood (default 1) */
  maxHops?: number;
  /** Whether focus is already active (skip preview when focused) */
  focusActive: boolean;
  /** Delay before dim starts in ms (default 300) */
  debounceMs?: number;
  /** Dim target opacity for non-neighborhood nodes (default 0.3) */
  dimOpacity?: number;
  /** Lerp speed per frame at 60fps. Higher = faster dim. 0.001 ~= 10s, 0.004 ~= 3s, 0.01 ~= 1s */
  lerpSpeed?: number;
}

/**
 * Returns a sparse opacity map (only contains entries < 1.0) and a tick function
 * to call each frame. Empty map = no dimming effect.
 */
export function useHoverPreviewDim({
  hoveredIndexRef,
  adjacency,
  count,
  maxHops = 1,
  focusActive,
  debounceMs = 400,
  dimOpacity = 0.15,
  lerpSpeed = 0.05,
}: UseHoverPreviewDimOptions) {
  const opacitiesRef = useRef(new Map<number, number>());
  const previewNodeSetRef = useRef<Set<number> | null>(null);
  const prevHoveredRef = useRef<number | null>(null);
  const hoverStartTimeRef = useRef<number>(0);

  const tick = (delta: number) => {
    const hovered = hoveredIndexRef.current;
    const opacities = opacitiesRef.current;

    // When focus is active, clear preview and bail
    if (focusActive) {
      opacities.clear();
      previewNodeSetRef.current = null;
      prevHoveredRef.current = null;
      return;
    }

    // Detect hover change
    if (hovered !== prevHoveredRef.current) {
      prevHoveredRef.current = hovered;
      hoverStartTimeRef.current = performance.now();
      if (hovered !== null) {
        const info = computeDualFocusNeighborhood(hovered, adjacency, maxHops);
        previewNodeSetRef.current = info.nodeSet;
      } else {
        previewNodeSetRef.current = null;
      }
    }

    const previewSet = previewNodeSetRef.current;
    const debounceElapsed = hovered !== null && (performance.now() - hoverStartTimeRef.current) >= debounceMs;

    // Frame-rate independent lerp factor
    const lerpFactor = 1 - Math.pow(1 - lerpSpeed, delta * 60);

    let anyActive = false;
    for (let i = 0; i < count; i++) {
      // Target: 1.0 if in neighborhood, debounce not elapsed, or no hover; dimOpacity otherwise
      const target = (!debounceElapsed || !previewSet || previewSet.has(i)) ? 1.0 : dimOpacity;
      const current = opacities.get(i) ?? 1.0;
      const next = current + (target - current) * lerpFactor;

      // Only snap to 1.0 and remove when fading back IN (target=1).
      // When dimming (target<1), always keep the entry even if close to 1.0.
      if (target === 1.0 && next > 0.995) {
        opacities.delete(i);
      } else {
        opacities.set(i, next);
        anyActive = true;
      }
    }

    // If nothing dimmed, ensure map is clean
    if (!anyActive) opacities.clear();
  };

  return { opacitiesRef, tick };
}
