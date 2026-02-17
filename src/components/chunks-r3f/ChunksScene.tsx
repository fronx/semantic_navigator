/**
 * Scene component for chunks UMAP visualization.
 * Renders chunk cards as an instancedMesh with rounded rectangle geometry,
 * colored by source article. Constant world-space scale: dots when far, cards when close.
 */

import { useRef, useMemo, useState, useEffect, useCallback, type MutableRefObject } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import { CameraController } from "@/components/topics-r3f/CameraController";
import type { CameraTransformEvent } from "@/components/topics-r3f/CameraController";
import { useChunkForceLayout } from "@/hooks/useChunkForceLayout";
import { useClickFocusSimilarityLayout } from "@/hooks/useClickFocusSimilarityLayout";
import { useInstancedMeshDrag } from "@/hooks/useInstancedMeshDrag";
import { useInstancedMeshMaterial } from "@/hooks/useInstancedMeshMaterial";
import { useStableInstanceCount } from "@/hooks/useStableInstanceCount";
import { useFadingScale } from "@/hooks/useFadingScale";
import { useFocusZoomExit } from "@/hooks/useFocusZoomExit";
import { useFocusManifoldLayout } from "@/hooks/useFocusManifoldLayout";
import type { UmapEdge } from "@/hooks/useUmapLayout";
import { CARD_WIDTH, CARD_HEIGHT, createCardGeometry } from "@/lib/chunks-geometry";
import {
  LENS_MAX_HOPS,
  type LensInfo,
  computeBfsNeighborhood,
  computeLensNodeScale,
  applyLensColorEmphasis,
} from "@/lib/chunks-lens";
import { hashToHue } from "@/lib/chunks-utils";
import { loadPCATransform, centroidToColor, pcaProject, coordinatesToHSL, type PCATransform } from "@/lib/semantic-colors";
import { calculateZoomDesaturation } from "@/lib/zoom-phase-config";
import { computeViewportZones } from "@/lib/edge-pulling";
import {
  applyDirectionalRangeCompression,
  applyFisheyeCompression,
  computeCompressionExtents,
  createDirectionalRangeCompressionConfig,
  DEFAULT_LP_NORM_P,
} from "@/lib/fisheye-viewport";
import { projectCardToScreenRect, type ScreenRect } from "@/lib/screen-rect-projection";
import { normalizeF32 } from "@/lib/semantic-zoom";
import { ChunkEdges } from "./ChunkEdges";
import { ChunkTextLabels } from "./ChunkTextLabels";

// --- Constants ---

/** Constant world-space scale. At z=6000 cards are ~10px dots, at z=300 ~200px readable cards. */
const CARD_SCALE = 0.3;
/** Camera Z reference points for zoom-based desaturation. */
const DESAT_FAR_Z = 6000;   // Fully saturated when zoomed out (cards are dots)
const DESAT_MID_Z = 2000;   // 30% desaturation at mid zoom
const DESAT_NEAR_Z = 400;   // 65% desaturation when zoomed in to read cards
/**
 * Total z-depth budget across all cards (world units).
 * Card 0 is at z=0 (farthest from camera); card N-1 is at z=CARD_Z_RANGE (closest).
 * Text for card i sits at z = i*step + step/2 — always in front of its own card,
 * always behind the next card forward. step = CARD_Z_RANGE / count.
 */
const CARD_Z_RANGE = 20;
const EDGE_FADE_DURATION_MS = 500;
const MAX_FOVEA_SEEDS = 3;
const FOVEA_ANCHOR_RADIUS_PX = 180;
const PAN_SAMPLE_DISTANCE_PX = 200;
const PERIPHERY_MARGIN_PX = 90;
const PERIPHERY_RELEASE_THRESHOLD = 0.85;

type FoveaSeedOrigin = "zoom" | "pan" | "manual";

interface FoveaSeed {
  index: number;
  anchorX: number;
  anchorY: number;
  addedAt: number;
  origin: FoveaSeedOrigin;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function lpDistance(dx: number, dy: number, p: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return Infinity;
  if (p === Infinity) return Math.max(Math.abs(dx), Math.abs(dy));
  if (Math.abs(p - 2) < 1e-3) return Math.hypot(dx, dy);
  const exponent = Math.max(0.5, Math.min(12, p));
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  return Math.pow(Math.pow(absX, exponent) + Math.pow(absY, exponent), 1 / exponent);
}

// --- Props ---

interface ChunksSceneProps {
  chunks: ChunkEmbeddingData[];
  umapPositions: Float32Array;
  searchOpacities: Map<string, number>;
  neighborhoodEdges: UmapEdge[];
  neighborhoodEdgesVersion: number;
  isRunning: boolean;
  onSelectChunk: (chunkId: string | null) => void;
  colorSaturation: number;
  chunkColorMix: number;
  edgeThickness: number;
  edgeContrast: number;
  edgeMidpoint: number;
  lensCompressionStrength: number;
  lensCenterScale: number;
  lensEdgeScale: number;
  lpNormP: number;
  focusMode: "manifold" | "click";
  backgroundClickRef?: MutableRefObject<(() => void) | null>;
}

// --- Component ---

export function ChunksScene({
  chunks,
  umapPositions,
  searchOpacities,
  neighborhoodEdges,
  neighborhoodEdgesVersion,
  isRunning,
  onSelectChunk,
  colorSaturation,
  chunkColorMix,
  edgeThickness,
  edgeContrast,
  edgeMidpoint,
  lensCompressionStrength,
  lensCenterScale,
  lensEdgeScale,
  lpNormP,
  focusMode,
  backgroundClickRef,
}: ChunksSceneProps) {
  const count = chunks.length;
  const [pcaTransform, setPcaTransform] = useState<PCATransform | null>(null);
  useEffect(() => {
    loadPCATransform().then((t) => {
      if (t) {
        console.log("[ChunksScene] PCA transform loaded, switching to embedding-based colors");
        setPcaTransform(t);
      } else {
        console.warn("[ChunksScene] PCA transform unavailable, using fallback hash colors (sat=0.7, l=0.55)");
      }
    });
  }, []);

  const { stableCount, meshKey } = useStableInstanceCount(count);
  const { meshRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);
  const { camera, size } = useThree();
  const isManifoldFocus = focusMode === "manifold";
  const seedCapacity = isManifoldFocus ? MAX_FOVEA_SEEDS : 1;

  const geometry = useMemo(createCardGeometry, []);

  const normalizedEmbeddings = useMemo(
    () => chunks.map((chunk) => normalizeF32(Float32Array.from(chunk.embedding))),
    [chunks],
  );

  // Base colors at full saturation — desaturation is applied per-frame in useFrame
  // so zoom level can continuously modulate it without triggering useMemo.
  const chunkColors = useMemo(() => {
    if (!pcaTransform) {
      console.log("[ChunksScene] chunkColors: using fallback hash-HSL colors (PCA not yet loaded)");
      return chunks.map((chunk) => new THREE.Color().setHSL(hashToHue(chunk.sourcePath), 0.7, 0.55));
    }
    const articleEmbeddings = new Map<string, number[][]>();
    for (const chunk of chunks) {
      if (!articleEmbeddings.has(chunk.sourcePath)) articleEmbeddings.set(chunk.sourcePath, []);
      articleEmbeddings.get(chunk.sourcePath)!.push(chunk.embedding);
    }
    const articleColors = new Map<string, THREE.Color>();
    for (const [sourcePath, embeddings] of articleEmbeddings) {
      articleColors.set(sourcePath, new THREE.Color(centroidToColor(embeddings, pcaTransform)));
    }
    return chunks.map((chunk) => {
      const articleColor = articleColors.get(chunk.sourcePath) ?? new THREE.Color(0.6, 0.6, 0.6);
      if (chunkColorMix === 0) return articleColor;
      const [x, y] = pcaProject(chunk.embedding, pcaTransform);
      const chunkColor = new THREE.Color(coordinatesToHSL(x, y));
      return articleColor.clone().lerp(chunkColor, chunkColorMix);
    });
  }, [chunks, pcaTransform, chunkColorMix]);

  const [isDraggingNode, setIsDraggingNode] = useState(false);

  const {
    positions: layoutPositions,
    startDrag,
    drag,
    endDrag,
  } = useChunkForceLayout({
    basePositions: umapPositions,
    edges: neighborhoodEdges,
    edgesVersion: neighborhoodEdgesVersion,
    isRunning,
  });

  const layoutPositionsRef = useRef(layoutPositions);
  useEffect(() => {
    layoutPositionsRef.current = layoutPositions;
  }, [layoutPositions]);

  const [focusSeeds, setFocusSeeds] = useState<FoveaSeed[]>([]);
  const focusSeedsRef = useRef<FoveaSeed[]>(focusSeeds);
  useEffect(() => {
    focusSeedsRef.current = focusSeeds;
  }, [focusSeeds]);

  const peripheryScoresRef = useRef<Map<number, number>>(new Map());
  const worldPerPxRef = useRef(1);
  const lastPanAnchorRef = useRef<{ x: number; y: number } | null>(null);

  const clearFocus = useCallback(() => {
    peripheryScoresRef.current.clear();
    lastPanAnchorRef.current = null;
    setFocusSeeds([]);
  }, []);

  useEffect(() => {
    if (!backgroundClickRef) return;
    const handler = () => {
      if (focusSeedsRef.current.length > 0) {
        clearFocus();
      }
    };
    backgroundClickRef.current = handler;
    return () => {
      if (backgroundClickRef.current === handler) {
        backgroundClickRef.current = null;
      }
    };
  }, [backgroundClickRef, clearFocus]);

  useEffect(() => {
    lastPanAnchorRef.current = null;
    if (!isManifoldFocus && focusSeedsRef.current.length > seedCapacity) {
      setFocusSeeds((prev) => {
        if (prev.length <= seedCapacity) return prev;
        const next = prev.slice(-seedCapacity);
        return next;
      });
    }
  }, [isManifoldFocus, seedCapacity]);

  // Focus zoom exit hook - exits lens mode when zooming out
  const { handleZoomChange, captureEntryZoom } = useFocusZoomExit({
    isFocused: focusSeeds.length > 0,
    onExitFocus: clearFocus,
    absoluteThreshold: 8000, // 80% of maxDistance=10000
    relativeMultiplier: 1.05,
  });
  const prevFocusActiveRef = useRef(false);
  useEffect(() => {
    const isActive = focusSeeds.length > 0;
    if (isActive && !prevFocusActiveRef.current) {
      captureEntryZoom();
    }
    prevFocusActiveRef.current = isActive;
  }, [focusSeeds.length, captureEntryZoom]);

  const focusSeedIndices = useMemo(() => focusSeeds.map((seed) => seed.index), [focusSeeds]);

  const adjacency = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const edge of neighborhoodEdges) {
      if (!map.has(edge.source)) map.set(edge.source, []);
      if (!map.has(edge.target)) map.set(edge.target, []);
      map.get(edge.source)!.push(edge.target);
      map.get(edge.target)!.push(edge.source);
    }
    return map;
  }, [neighborhoodEdges]);

  const lensInfo = useMemo<LensInfo | null>(
    () => focusSeedIndices.length === 0 ? null : computeBfsNeighborhood(focusSeedIndices, adjacency, LENS_MAX_HOPS),
    [focusSeedIndices, adjacency],
  );

  const lensActive = !!lensInfo && focusSeedIndices.length > 0 && !isRunning;
  const lensNodeSet = lensInfo?.nodeSet ?? null;
  const lensDepthMap = lensInfo?.depthMap;
  const focusNodeSetRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    focusNodeSetRef.current = lensNodeSet ?? new Set();
  }, [lensNodeSet]);
  const {
    positionsRef: focusPositionsRef,
    updateBounds: updateFocusBounds,
  } = useFocusManifoldLayout({
    basePositions: layoutPositions,
    focusNodeSet: isManifoldFocus ? lensNodeSet ?? null : null,
    seedIndices: isManifoldFocus ? (lensInfo?.focusIndices ?? []) : [],
    adjacency,
    compressionStrength: lensCompressionStrength,
  });

  const clickFocusPositionsRef = useClickFocusSimilarityLayout({
    basePositions: layoutPositions,
    focusNodeSet: !isManifoldFocus ? lensNodeSet ?? null : null,
    seedIndices: focusSeedIndices,
    normalizedEmbeddings,
  });

  const trimSeeds = useCallback((seeds: FoveaSeed[], countToTrim: number) => {
    let next = [...seeds];
    const peripheryScores = peripheryScoresRef.current;
    for (let i = 0; i < countToTrim && next.length > 1; i++) {
      let dropIndex = -1;
      let bestScore = -1;
      next.forEach((seed, idx) => {
        const score = peripheryScores.get(seed.index) ?? 0;
        if (score > bestScore) {
          bestScore = score;
          dropIndex = idx;
        }
      });
      if (dropIndex >= 0 && bestScore > 0.3) {
        next.splice(dropIndex, 1);
        continue;
      }
      let oldestIdx = 0;
      let oldestTime = next[0]?.addedAt ?? 0;
      for (let j = 1; j < next.length; j++) {
        if (next[j].addedAt < oldestTime) {
          oldestIdx = j;
          oldestTime = next[j].addedAt;
        }
      }
      next.splice(oldestIdx, 1);
    }
    return next;
  }, []);

  const removeSeed = useCallback((index: number) => {
    setFocusSeeds((prev) => prev.filter((seed) => seed.index !== index));
  }, []);

  const addFocusSeeds = useCallback((indices: number[], origin: FoveaSeedOrigin) => {
    if (indices.length === 0) return;
    const positions = layoutPositionsRef.current;
    setFocusSeeds((prev) => {
      const now = performance.now();
      let next = [...prev];
      for (const idx of indices) {
        if (idx < 0 || idx * 2 + 1 >= positions.length) continue;
        if (next.some((seed) => seed.index === idx)) continue;
        next.push({
          index: idx,
          anchorX: positions[idx * 2] ?? 0,
          anchorY: positions[idx * 2 + 1] ?? 0,
          addedAt: now,
          origin,
        });
      }
      if (next.length > seedCapacity) {
        next = trimSeeds(next, next.length - seedCapacity);
      }
      return next;
    });
  }, [trimSeeds]);

  const queueAnchorSelection = useCallback((anchor: { x: number; y: number }, options?: {
    radiusWorld?: number;
    maxAdd?: number;
    reason?: FoveaSeedOrigin;
  }) => {
    if (!isManifoldFocus) return;
    const positions = layoutPositionsRef.current;
    const n = Math.min(count, positions.length / 2);
    if (n === 0) return;

    const radiusWorld = options?.radiusWorld ?? worldPerPxRef.current * FOVEA_ANCHOR_RADIUS_PX;
    const radiusLimit = radiusWorld > 0 ? radiusWorld : Infinity;
    const existingSet = new Set(focusSeedsRef.current.map((seed) => seed.index));
    const focusSet = focusNodeSetRef.current;
    const lp = lpNormP || DEFAULT_LP_NORM_P;

    const candidates: Array<{ index: number; score: number }> = [];
    for (let i = 0; i < n; i++) {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const dist = lpDistance(x - anchor.x, y - anchor.y, lp);
      if (radiusLimit !== Infinity && dist > radiusLimit) continue;
      const neighbors = adjacency.get(i) ?? [];
      const touchesExisting = neighbors.some((neighbor) => existingSet.has(neighbor));
      const touchesFocus = focusSet.size === 0 ? false : focusSet.has(i);
      const bias = touchesExisting || touchesFocus ? 0.6 : 1.0;
      candidates.push({ index: i, score: dist * bias });
    }

    if (candidates.length === 0 && n > 0) {
      let bestIdx = 0;
      let bestScore = Infinity;
      for (let i = 0; i < n; i++) {
        const x = positions[i * 2];
        const y = positions[i * 2 + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const distSq = (x - anchor.x) * (x - anchor.x) + (y - anchor.y) * (y - anchor.y);
        if (distSq < bestScore) {
          bestScore = distSq;
          bestIdx = i;
        }
      }
      candidates.push({ index: bestIdx, score: Math.sqrt(bestScore) });
    }

    candidates.sort((a, b) => a.score - b.score);
    const maxAdd = options?.maxAdd ?? Math.max(1, seedCapacity - focusSeedsRef.current.length);
    const toAdd: number[] = [];
    for (const candidate of candidates) {
      if (toAdd.length >= maxAdd) break;
      if (existingSet.has(candidate.index)) continue;
      toAdd.push(candidate.index);
    }

    if (toAdd.length > 0) {
      addFocusSeeds(toAdd, options?.reason ?? "zoom");
    }
  }, [adjacency, addFocusSeeds, count, lpNormP, isManifoldFocus, seedCapacity]);

  const handleCameraTransform = useCallback((event: CameraTransformEvent) => {
    if (!isManifoldFocus) return;
    if (event.type === "zoom") {
      if (event.direction === "in") {
        const radiusWorld = event.viewport.worldPerPx * FOVEA_ANCHOR_RADIUS_PX * Math.max(0.6, (lpNormP || DEFAULT_LP_NORM_P) / DEFAULT_LP_NORM_P);
        queueAnchorSelection(event.anchor, { reason: "zoom", radiusWorld, maxAdd: 2 });
      }
      lastPanAnchorRef.current = { x: event.cameraX, y: event.cameraY };
    } else if (event.type === "pan" && focusSeedsRef.current.length > 0) {
      const last = lastPanAnchorRef.current;
      if (!last) {
        lastPanAnchorRef.current = { x: event.cameraX, y: event.cameraY };
        return;
      }
      const dx = event.cameraX - last.x;
      const dy = event.cameraY - last.y;
      const moved = Math.hypot(dx, dy);
      if (moved >= event.viewport.worldPerPx * PAN_SAMPLE_DISTANCE_PX) {
        lastPanAnchorRef.current = { x: event.cameraX, y: event.cameraY };
        queueAnchorSelection(
          { x: event.cameraX, y: event.cameraY },
          { reason: "pan", radiusWorld: event.viewport.worldPerPx * (FOVEA_ANCHOR_RADIUS_PX * 0.75), maxAdd: 1 },
        );
      }
    }
  }, [queueAnchorSelection, lpNormP, isManifoldFocus]);

  const focusEdges = useMemo(() => {
    if (!lensActive || !lensInfo) return neighborhoodEdges;
    const set = lensInfo.nodeSet;
    return neighborhoodEdges.filter(
      (edge) => set.has(edge.source) && set.has(edge.target),
    );
  }, [lensActive, lensInfo, neighborhoodEdges]);

  const focusEdgesVersion = lensActive
    ? neighborhoodEdgesVersion * 31 + (lensInfo?.nodeSet.size ?? 0)
    : neighborhoodEdgesVersion;

  // Persistent z-order: each click/drag pushes a card to the top without disturbing
  // the relative order of all other cards (including previously elevated cards).
  // zOrderRef[rank] = card index (rank 0 = farthest back, rank n-1 = front).
  // zRankRef maps card index → rank for O(1) lookup in useFrame.
  const zOrderRef = useRef<number[]>([]);
  const zRankRef = useRef<Map<number, number>>(new Map());

  // Initialize / reinitialize when chunks change (default order = array index).
  useEffect(() => {
    const n = chunks.length;
    const order = Array.from({ length: n }, (_, i) => i);
    zOrderRef.current = order;
    const ranks = new Map<number, number>();
    for (let i = 0; i < n; i++) ranks.set(i, i);
    zRankRef.current = ranks;
  }, [chunks]);

  // Promote card to rank n-1 (front). All cards previously above it shift down by 1.
  const bringToFront = useCallback((cardIndex: number) => {
    const order = zOrderRef.current;
    const ranks = zRankRef.current;
    const n = order.length;
    const oldRank = ranks.get(cardIndex);
    if (oldRank === undefined || oldRank === n - 1) return; // already at front or not found
    for (let rank = oldRank + 1; rank < n; rank++) {
      const idx = order[rank];
      order[rank - 1] = idx;
      ranks.set(idx, rank - 1);
    }
    order[n - 1] = cardIndex;
    ranks.set(cardIndex, n - 1);
  }, []);

  // --- Animated visibility for focus mode ---
  const visibleNodeIndicesRef = useRef(new Set<number>());
  const nodeScalesRef = useFadingScale(visibleNodeIndicesRef, {
    lerpSpeed: 0.1,  // Slightly faster than default for responsive feel
  });

  // --- Reusable objects for useFrame (avoid GC pressure) ---
  const matrixRef = useRef(new THREE.Matrix4());
  const posVec = useRef(new THREE.Vector3());
  const quat = useRef(new THREE.Quaternion());
  const scaleVec = useRef(new THREE.Vector3(1, 1, 1));
  const tempColor = useRef(new THREE.Color());
  // Screen rect computation (same pattern as ContentNodes.tsx)
  const centerVec = useRef(new THREE.Vector3());
  const edgeVecX = useRef(new THREE.Vector3());
  const edgeVecY = useRef(new THREE.Vector3());
  const chunkScreenRectsRef = useRef(new Map<number, ScreenRect>());

  // Track when colors need repainting
  const colorChunksRef = useRef<THREE.Color[] | null>(null);
  const searchOpacitiesRef = useRef(searchOpacities);
  const colorDirtyRef = useRef(false);
  const prevDesaturationRef = useRef(-1);
  const colorSaturationRef = useRef(colorSaturation);
  colorSaturationRef.current = colorSaturation;
  // Reusable object for getHSL/setHSL (avoids allocation per frame)
  const hslTemp = useRef({ h: 0, s: 0, l: 0 });
  if (searchOpacitiesRef.current !== searchOpacities) {
    searchOpacitiesRef.current = searchOpacities;
    colorDirtyRef.current = true;
  }

  // Buffer for focus-adjusted positions (overrides applied on top of layout positions)
  const focusAdjustedPositionsRef = useRef<Float32Array>(new Float32Array(0));
  const compressedPositionsRef = useRef<Float32Array>(new Float32Array(0));

  const pickInstance = useCallback(
    (event: ThreeEvent<PointerEvent>): number | null => {
      const instanceId = event.instanceId;
      if (instanceId == null || instanceId < 0 || instanceId >= chunks.length) return null;
      return instanceId;
    },
    [chunks.length],
  );

  const dragHandlers = useInstancedMeshDrag({
    pickInstance,
    onDragStart: (index) => {
      bringToFront(index);
      startDrag(index);
    },
    onDrag: drag,
    onDragEnd: endDrag,
    enabled: !isRunning,
    onDragStateChange: setIsDraggingNode,
    onClick: (index) => {
      bringToFront(index);
      onSelectChunk(chunks[index].id);
      if (isManifoldFocus) {
        addFocusSeeds([index], "manual");
        const x = layoutPositionsRef.current[index * 2] ?? 0;
        const y = layoutPositionsRef.current[index * 2 + 1] ?? 0;
        lastPanAnchorRef.current = { x, y };
      } else {
        setFocusSeeds((prev) => {
          const alreadyFocused = prev.length === 1 && prev[0].index === index;
          if (alreadyFocused) return [];
          const x = layoutPositionsRef.current[index * 2] ?? 0;
          const y = layoutPositionsRef.current[index * 2 + 1] ?? 0;
          const now = performance.now();
          return [{
            index,
            anchorX: x,
            anchorY: y,
            addedAt: now,
            origin: "manual",
          }];
        });
      }
    },
  });

  // Edge opacity fade-in over EDGE_FADE_DURATION_MS when simulation stops.
  // Uses a bounded rAF loop (not useFrame) so React re-renders propagate opacity to ChunkEdges.
  const [edgeOpacity, setEdgeOpacity] = useState(0);

  useEffect(() => {
    if (isRunning) {
      setEdgeOpacity(0);
      return;
    }
    let raf: number | null = null;
    const start = performance.now();
    const tick = () => {
      const progress = Math.min((performance.now() - start) / EDGE_FADE_DURATION_MS, 1);
      setEdgeOpacity(progress);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [isRunning]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || layoutPositions.length === 0) return;

    const n = Math.min(count, layoutPositions.length / 2);

    const zones = lensActive
      ? computeViewportZones(camera as THREE.PerspectiveCamera, size.width, size.height)
      : null;
    const extents = zones ? computeCompressionExtents(zones) : null;
    const rangeCompressionConfig = !isManifoldFocus && lensActive && extents != null
      ? createDirectionalRangeCompressionConfig(lensCompressionStrength, extents)
      : null;

    if (lensActive && zones) {
      worldPerPxRef.current = zones.worldPerPx;
    }
    if (lensActive && zones && isManifoldFocus) {
      updateFocusBounds(zones.focusPullBounds);
    } else {
      updateFocusBounds(null);
    }

    visibleNodeIndicesRef.current.clear();
    const visibleSet = lensActive ? lensNodeSet! : null;
    for (let i = 0; i < n; i++) {
      if (!visibleSet || visibleSet.has(i)) visibleNodeIndicesRef.current.add(i);
    }

    let positionsWithOverrides = layoutPositions;
    if (lensActive) {
      const focusOverrides = (isManifoldFocus ? focusPositionsRef.current : clickFocusPositionsRef.current);
      if (focusOverrides.size > 0) {
        if (focusAdjustedPositionsRef.current.length !== layoutPositions.length) {
          focusAdjustedPositionsRef.current = new Float32Array(layoutPositions.length);
        }
        focusAdjustedPositionsRef.current.set(layoutPositions);
        focusOverrides.forEach((pos, index) => {
          const target = index * 2;
          if (target + 1 >= focusAdjustedPositionsRef.current.length) return;
          focusAdjustedPositionsRef.current[target] = pos.x;
          focusAdjustedPositionsRef.current[target + 1] = pos.y;
        });
        positionsWithOverrides = focusAdjustedPositionsRef.current;
      }
    }

    let renderPositions = positionsWithOverrides;
    if (lensActive && zones && extents) {
      if (compressedPositionsRef.current.length !== positionsWithOverrides.length) {
        compressedPositionsRef.current = new Float32Array(positionsWithOverrides.length);
      }
      for (let i = 0; i < n; i++) {
        let x = positionsWithOverrides[i * 2];
        let y = positionsWithOverrides[i * 2 + 1];
      if (lensNodeSet?.has(i)) {
        const compressed = applyFisheyeCompression(
          x,
          y,
          zones.viewport.camX,
          zones.viewport.camY,
          extents.compressionStartHalfWidth,
          extents.compressionStartHalfHeight,
          extents.horizonHalfWidth,
          extents.horizonHalfHeight,
          lensCompressionStrength,
          lpNormP,
        );
        x = THREE.MathUtils.clamp(compressed.x, zones.pullBounds.left, zones.pullBounds.right);
        y = THREE.MathUtils.clamp(compressed.y, zones.pullBounds.bottom, zones.pullBounds.top);

        if (rangeCompressionConfig) {
          const remapped = applyDirectionalRangeCompression(
            x,
            y,
            zones.viewport.camX,
            zones.viewport.camY,
            extents.horizonHalfWidth,
            extents.horizonHalfHeight,
            rangeCompressionConfig,
          );
          x = remapped.x;
          y = remapped.y;
        }
      }
        compressedPositionsRef.current[i * 2] = x;
        compressedPositionsRef.current[i * 2 + 1] = y;
      }
      renderPositions = compressedPositionsRef.current;
    }

    chunkScreenRectsRef.current.clear();
    const cardZStep = n > 1 ? CARD_Z_RANGE / n : CARD_Z_RANGE;

    for (let i = 0; i < n; i++) {
      const animatedScale = nodeScalesRef.current.get(i) ?? 0;

      if (animatedScale < 0.005) {
        scaleVec.current.setScalar(0);
        matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
        mesh.setMatrixAt(i, matrixRef.current);
        continue;
      }

      const x = renderPositions[i * 2];
      const y = renderPositions[i * 2 + 1];

      let lensScale = 1;
      if (lensActive && lensNodeSet?.has(i) && zones && extents) {
        const maxRadius = Math.min(extents.horizonHalfWidth, extents.horizonHalfHeight);
        const startRadius = Math.min(extents.compressionStartHalfWidth, extents.compressionStartHalfHeight);
        lensScale = computeLensNodeScale(
          x,
          y,
          zones.viewport.camX,
          zones.viewport.camY,
          lensDepthMap?.get(i),
          startRadius,
          maxRadius,
          lensCompressionStrength,
          lensCenterScale,
          lensEdgeScale,
        );
      }

      const finalScale = CARD_SCALE * lensScale * animatedScale;
      const rank = zRankRef.current.get(i) ?? i;
      const cardZ = rank * cardZStep;
      const textZForCard = cardZ + cardZStep / 2;

      posVec.current.set(x, y, cardZ);
      scaleVec.current.setScalar(finalScale);
      matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
      mesh.setMatrixAt(i, matrixRef.current);

      chunkScreenRectsRef.current.set(
        i,
        projectCardToScreenRect(
          x,
          y,
          textZForCard,
          (CARD_WIDTH / 2) * finalScale,
          (CARD_HEIGHT / 2) * finalScale,
          camera,
          size,
          centerVec.current,
          edgeVecX.current,
          edgeVecY.current,
        ),
      );
    }

    for (let i = n; i < stableCount; i++) {
      scaleVec.current.setScalar(0);
      matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
      mesh.setMatrixAt(i, matrixRef.current);
    }

    // Zoom + slider desaturation: additive, clamped to [0, 1]
    const zoomDesat = calculateZoomDesaturation(
      (camera as THREE.PerspectiveCamera).position.z,
      DESAT_FAR_Z,
      DESAT_MID_Z,
      DESAT_NEAR_Z,
    );
    const effectiveDesaturation = Math.min(1, zoomDesat + (1 - colorSaturationRef.current));
    const desatChanged = Math.abs(effectiveDesaturation - prevDesaturationRef.current) > 0.005;

    if (colorChunksRef.current !== chunkColors || colorDirtyRef.current || desatChanged || !mesh.instanceColor) {
      const searchActive = searchOpacitiesRef.current.size > 0;
      for (let i = 0; i < Math.min(n, chunkColors.length); i++) {
        // Apply desaturation to base color via HSL (fast, no chroma.js needed)
        chunkColors[i].getHSL(hslTemp.current);
        hslTemp.current.s *= (1 - effectiveDesaturation);
        tempColor.current.setHSL(hslTemp.current.h, hslTemp.current.s, hslTemp.current.l);
        if (searchActive) {
          const opacity = searchOpacitiesRef.current.get(chunks[i].id) ?? 1.0;
          tempColor.current.multiplyScalar(opacity);
        }
        if (lensActive && lensNodeSet?.has(i)) {
          applyLensColorEmphasis(tempColor.current, lensDepthMap?.get(i) ?? 0);
        }
        mesh.setColorAt(i, tempColor.current);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      colorChunksRef.current = chunkColors;
      colorDirtyRef.current = false;
      prevDesaturationRef.current = effectiveDesaturation;
    }

    if (isManifoldFocus && lensActive && focusSeedsRef.current.length > 0) {
      const peripheryScores = peripheryScoresRef.current;
      const seedsSnapshot = [...focusSeedsRef.current];
      let removedThisFrame = false;
      for (const seed of seedsSnapshot) {
        const rect = chunkScreenRectsRef.current.get(seed.index);
        if (!rect) {
          peripheryScores.set(seed.index, 0);
          continue;
        }
        const distToEdgeX = Math.min(rect.x, size.width - rect.x);
        const distToEdgeY = Math.min(rect.y, size.height - rect.y);
        const distToEdge = Math.min(distToEdgeX, distToEdgeY);
        const closeness = distToEdge <= PERIPHERY_MARGIN_PX
          ? 1 - distToEdge / PERIPHERY_MARGIN_PX
          : 0;
        peripheryScores.set(seed.index, clamp01(closeness));
        if (!removedThisFrame && closeness >= PERIPHERY_RELEASE_THRESHOLD && focusSeedsRef.current.length > 1) {
          removeSeed(seed.index);
          removedThisFrame = true;
        }
      }
    } else if (peripheryScoresRef.current.size > 0) {
      peripheryScoresRef.current.clear();
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.boundingSphere = null;
  });

  const shouldRenderEdges = !isRunning && focusEdges.length > 0 && edgeOpacity > 0;

  const activeFocusOverrides = isManifoldFocus ? focusPositionsRef.current : clickFocusPositionsRef.current;

  const hasFocusOverrides = lensActive
    && activeFocusOverrides.size > 0
    && focusAdjustedPositionsRef.current.length === layoutPositions.length
    && focusAdjustedPositionsRef.current.length > 0;
  const hasCompressedPositions = lensActive
    && compressedPositionsRef.current.length === layoutPositions.length
    && compressedPositionsRef.current.length > 0;
  const displayPositions = hasCompressedPositions
    ? compressedPositionsRef.current
    : hasFocusOverrides
      ? focusAdjustedPositionsRef.current
      : layoutPositions;

  return (
    <>
      {shouldRenderEdges && (
        <ChunkEdges
          edges={focusEdges}
          edgesVersion={focusEdgesVersion}
          positions={displayPositions}
          opacity={edgeOpacity * 0.35}
          edgeThickness={edgeThickness}
          edgeContrast={edgeContrast}
          edgeMidpoint={edgeMidpoint}
          nodeColors={chunkColors}
        />
      )}
      <CameraController
        maxDistance={10000}
        enableDragPan={!isDraggingNode}
        onZoomChange={handleZoomChange}
        onTransform={handleCameraTransform}
      />
      <instancedMesh
        key={meshKey}
        ref={handleMeshRef}
        args={[geometry, undefined, stableCount]}
        frustumCulled={false}
        {...dragHandlers}
      />
      <ChunkTextLabels
        chunks={chunks}
        positions={displayPositions}
        cardWidth={CARD_WIDTH}
        cardHeight={CARD_HEIGHT}
        screenRectsRef={chunkScreenRectsRef}
      />
    </>
  );
}
