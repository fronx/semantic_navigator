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
import { ClusterLabels3D } from "@/components/topics-r3f/ClusterLabels3D";
import type { LabelFadeConfig } from "@/components/ChunksControlSidebar";
import { computeLabelFade } from "@/lib/label-fade-coordinator";
import type { SimNode } from "@/lib/map-renderer";
import { useChunkForceLayout } from "@/hooks/useChunkForceLayout";
import { useFocusPushAnimation } from "@/hooks/useFocusPushAnimation";
import { useHoverPreviewDim } from "@/hooks/useHoverPreviewDim";
import { useInstancedMeshDrag } from "@/hooks/useInstancedMeshDrag";
import { useInstancedMeshMaterial } from "@/hooks/useInstancedMeshMaterial";
import { useStableInstanceCount } from "@/hooks/useStableInstanceCount";
import { useFadingScale } from "@/hooks/useFadingScale";
import { useFocusZoomExit } from "@/hooks/useFocusZoomExit";
import type { UmapEdge } from "@/hooks/useUmapLayout";
import { CARD_WIDTH, CARD_HEIGHT, CARD_SCALE, CARD_V_MARGIN_RATIO, createCardPlaneGeometry, computeHeightRatio, heightRatioFromGeomHeight } from "@/lib/chunks-geometry";
import {
  LENS_MAX_HOPS,
  type LensInfo,
  computeDualFocusNeighborhood,
} from "@/lib/chunks-lens";
import { hashToHue } from "@/lib/chunks-utils";
import { setChunkColors } from "@/lib/chunk-color-registry";
import { loadPCATransform, centroidToColor, pcaProject, coordinatesToHSL, computeClusterColors, type PCATransform, type ClusterColorInfo } from "@/lib/semantic-colors";
import { calculateZoomDesaturation, normalizeZoom } from "@/lib/zoom-phase-config";
import { computeChunkPullState, type PulledChunkNode } from "@/lib/chunks-pull-state";
import { computeViewportZones, PULLED_SCALE_FACTOR, PULLED_COLOR_FACTOR } from "@/lib/edge-pulling";
import { applyFocusGlow, initGlowTarget } from "@/lib/node-color-effects";
import { projectCardToScreenRect, type ScreenRect } from "@/lib/screen-rect-projection";
import { isDarkMode } from "@/lib/theme";
import { ChunkEdges } from "./ChunkEdges";
import { CardTextLabels, type CardTextItem } from "@/components/r3f-shared/CardTextLabels";

// --- Constants ---

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
const CARD_Z_RANGE = 2;
const HOVER_SCALE_MULTIPLIER = 2;
const EDGE_FADE_DURATION_MS = 500;
const MAX_FOCUS_SEEDS = 2;
/** Pulled ghost nodes at viewport edges are small navigation hints — shrink more than PULLED_SCALE_FACTOR. */
const CHUNK_PULL_ZONE_SCALE = PULLED_SCALE_FACTOR * 0.5;
/** Max fraction of viewport height any card may occupy on screen (prevents unbounded growth when zoomed in). */
const MAX_CARD_SCREEN_FRACTION = 0.6;
/** Pulled ghost nodes are tiny navigation hints — cap much smaller. */
const MAX_PULLED_SCREEN_FRACTION = 0.1;
/** Focus-set pulled nodes must be at least this large so they're clearly clickable. */
const MIN_FOCUS_PULLED_SCREEN_FRACTION = 0.07;
const glowTarget = new THREE.Color();

interface FocusSeed {
  index: number;
  addedAt: number;
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
  minSaturation: number;
  chunkColorMix: number;
  edgeThickness: number;
  edgeMidpoint: number;
  edgeCountPivot: number;
  edgeCountFloor: number;
  nodeSizeMin: number;
  nodeSizeMax: number;
  nodeSizePivot: number;
  shapeMorphNear: number;
  shapeMorphFar: number;
  backgroundClickRef?: MutableRefObject<(() => void) | null>;
  onLayoutSettled?: (positions: Float32Array) => void;
  coarseClusters: Record<number, number> | null;
  fineClusters: Record<number, number> | null;
  coarseLabels: Record<number, string> | null;
  fineLabels: Record<number, string> | null;
  labelFades: LabelFadeConfig;
  onCameraZChange?: (z: number) => void;
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
  minSaturation,
  chunkColorMix,
  edgeThickness,
  edgeMidpoint,
  edgeCountPivot,
  edgeCountFloor,
  nodeSizeMin,
  nodeSizeMax,
  nodeSizePivot,
  shapeMorphNear,
  shapeMorphFar,
  backgroundClickRef,
  onLayoutSettled,
  coarseClusters,
  fineClusters,
  coarseLabels,
  fineLabels,
  labelFades,
  onCameraZChange,
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
  const { meshRef, materialRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);
  const { camera, size, gl } = useThree();

  const geometry = useMemo(createCardPlaneGeometry, []);

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

  // Populate shared color registry so Reader can look up chunk colors
  useEffect(() => {
    setChunkColors(chunks.map((chunk, i) => [chunk.id, "#" + chunkColors[i].getHexString()]));
  }, [chunks, chunkColors]);

  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const hoveredIndexRef = useRef<number | null>(null);
  const prevHoveredRef = useRef<number | null>(null);
  // Animated hover progress per card: 0=normal scale, 1=full hover scale.
  const hoverProgressRef = useRef<Map<number, number>>(new Map());

  const [focusSeeds, setFocusSeeds] = useState<FocusSeed[]>([]);
  const focusSeedsRef = useRef<FocusSeed[]>(focusSeeds);
  useEffect(() => {
    focusSeedsRef.current = focusSeeds;
  }, [focusSeeds]);

  const clearFocus = useCallback(() => {
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

  // Focus zoom exit hook - exits lens mode when zooming out
  const { handleZoomChange, captureEntryZoom, cameraZ } = useFocusZoomExit({
    isFocused: focusSeeds.length > 0,
    onExitFocus: () => { clearFocus(); },
    absoluteThreshold: 8000, // 80% of maxDistance=10000
    relativeMultiplier: 1.05,
  });
  useEffect(() => {
    if (cameraZ != null && onCameraZChange) onCameraZChange(cameraZ);
  }, [cameraZ, onCameraZChange]);

  // Cluster label desaturation: white when zoomed out, colored when zoomed in (mirrors TopicsView)
  const z = cameraZ ?? 10000;
  const coarseDesaturation = Math.max(0, Math.min(1,
    (z - labelFades.coarseFadeOut.full) / (labelFades.coarseFadeIn.start - labelFades.coarseFadeOut.full)
  ));
  const fineDesaturation = Math.max(0, Math.min(1,
    (z - labelFades.fineFadeOut.full) / (labelFades.fineFadeIn.start - labelFades.fineFadeOut.full)
  ));

  const prevFocusActiveRef = useRef(false);
  useEffect(() => {
    const isActive = focusSeeds.length > 0;
    if (isActive && !prevFocusActiveRef.current) {
      captureEntryZoom();
    }
    prevFocusActiveRef.current = isActive;
  }, [focusSeeds.length, captureEntryZoom]);

  const {
    positions: layoutPositions,
    dragHandlers: baseDragHandlers,
  } = useChunkForceLayout({
    basePositions: umapPositions,
    edges: neighborhoodEdges,
    edgesVersion: neighborhoodEdgesVersion,
    isRunning,
    onSettled: onLayoutSettled,
    cameraZ,
  });

  const layoutPositionsRef = useRef(layoutPositions);
  useEffect(() => {
    layoutPositionsRef.current = layoutPositions;
  }, [layoutPositions]);

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
    () => focusSeedIndices.length === 0 ? null : computeDualFocusNeighborhood(focusSeedIndices, adjacency, LENS_MAX_HOPS),
    [focusSeedIndices, adjacency],
  );

  const lensActive = !!lensInfo && focusSeedIndices.length > 0 && !isRunning;
  const lensInfoRef = useRef(lensInfo);
  lensInfoRef.current = lensInfo;
  const lensActiveRef = useRef(lensActive);
  lensActiveRef.current = lensActive;
  const lensNodeSet = lensInfo?.nodeSet ?? null;
  const countScale = nodeSizeMin + (nodeSizeMax - nodeSizeMin) * (nodeSizePivot / (nodeSizePivot + count));

  // Hover preview dim: slowly dims non-neighborhood nodes when hovering
  const { opacitiesRef: previewDimRef, tick: tickPreviewDim } = useHoverPreviewDim({
    hoveredIndexRef,
    adjacency,
    count,
    focusActive: lensActive
  });

  const focusEdges = useMemo(() => {
    if (!lensActive || !lensInfo) return neighborhoodEdges;
    const set = lensInfo.nodeSet;
    return neighborhoodEdges.filter(
      (edge) => set.has(edge.source) && set.has(edge.target),
    );
  }, [lensActive, lensInfo, neighborhoodEdges]);

  const addFocusSeeds = useCallback((indices: number[]) => {
    if (indices.length === 0) return;
    const positions = layoutPositionsRef.current;
    setFocusSeeds((prev) => {
      const now = performance.now();
      let next = [...prev];
      for (const idx of indices) {
        if (idx < 0 || idx * 2 + 1 >= positions.length) continue;
        if (next.some((seed) => seed.index === idx)) continue;
        next.push({ index: idx, addedAt: now });
      }
      if (next.length > MAX_FOCUS_SEEDS) {
        next = next.slice(-MAX_FOCUS_SEEDS);
      }
      return next;
    });
  }, []);

  const focusEdgesVersion = lensActive
    ? neighborhoodEdgesVersion * 31 + (lensInfo?.nodeSet.size ?? 0)
    : neighborhoodEdgesVersion;

  // --- Focus push animation ---
  const { positionsRef: focusPushRef, tick: tickFocusPush } = useFocusPushAnimation<number>();

  const marginIds = useMemo<Set<number> | null>(() => {
    if (!lensNodeSet) return null;
    const m = new Set<number>();
    for (let i = 0; i < chunks.length; i++) {
      if (!lensNodeSet.has(i)) m.add(i);
    }
    return m;
  }, [lensNodeSet, chunks.length]);

  const displayPositionsRef = useRef<Float32Array>(new Float32Array(0));
  const pulledChunkMapRef = useRef<Map<number, PulledChunkNode>>(new Map());
  const flyToRef = useRef<((x: number, y: number) => void) | null>(null);

  // Stable ref for focus-mode card text label filtering
  const lensVisibleIdsRef = useRef<Set<string | number>>(new Set());
  lensVisibleIdsRef.current = (lensNodeSet as Set<string | number> | null) ?? new Set();

  // Persistent z-order: each click/drag pushes a card to the top without disturbing
  // the relative order of all other cards (including previously elevated cards).
  // zOrderRef[rank] = card index (rank 0 = farthest back, rank n-1 = front).
  // zRankRef maps card index -> rank for O(1) lookup in useFrame.
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
    hoverProgressRef.current.clear();
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
  const chunkScreenRectsRef = useRef<Map<string | number, ScreenRect>>(new Map());

  // Start with character-count predictions; CardTextLabels corrects each entry once
  // actual text geometry is built (onItemGeomHeight callback below).
  const predictedHeightRatios = useMemo(() => chunks.map((c) => computeHeightRatio(c.content)), [chunks]);
  const heightRatiosRef = useRef<number[]>(predictedHeightRatios);
  useEffect(() => { heightRatiosRef.current = [...predictedHeightRatios]; }, [predictedHeightRatios]);

  const onItemGeomHeight = useCallback((index: number, textGeomHeight: number) => {
    heightRatiosRef.current[index] = heightRatioFromGeomHeight(textGeomHeight, CARD_V_MARGIN_RATIO);
  }, []);

  const contentItems = useMemo<CardTextItem[]>(
    () => chunks.map((chunk, i) => ({ id: i, content: chunk.content })),
    [chunks]
  );
  const getPositionRef = useRef((i: number) => ({
    x: displayPositionsRef.current[i * 2] ?? 0,
    y: displayPositionsRef.current[i * 2 + 1] ?? 0,
  }));

  // Track when colors need repainting
  const colorChunksRef = useRef<THREE.Color[] | null>(null);
  const searchOpacitiesRef = useRef(searchOpacities);
  const colorDirtyRef = useRef(false);
  const prevDesaturationRef = useRef(-1);
  const prevMinSaturationRef = useRef(-1);
  const colorSaturationRef = useRef(colorSaturation);
  colorSaturationRef.current = colorSaturation;
  const minSaturationRef = useRef(minSaturation);
  minSaturationRef.current = minSaturation;
  // Reusable object for getHSL/setHSL (avoids allocation per frame)
  const hslTemp = useRef({ h: 0, s: 0, l: 0 });
  if (searchOpacitiesRef.current !== searchOpacities) {
    searchOpacitiesRef.current = searchOpacities;
    colorDirtyRef.current = true;
  }

  // Track which node is being dragged so useFrame can skip overrides for it.
  const draggedIndexRef = useRef<number | null>(null);

  const pickInstance = useCallback(
    (event: ThreeEvent<PointerEvent>): number | null => {
      // Among all intersected instances, pick the one with the highest z-rank
      // (the card rendered on top wins over cards underneath it).
      let bestId: number | null = null;
      let bestRank = -1;
      for (const hit of event.intersections) {
        if (hit.object !== meshRef.current) continue;
        const id = (hit as typeof hit & { instanceId?: number }).instanceId;
        if (id == null || id < 0 || id >= chunks.length) continue;
        const rank = zRankRef.current.get(id) ?? id;
        if (rank > bestRank) { bestRank = rank; bestId = id; }
      }
      return bestId;
    },
    [chunks.length, meshRef],
  );

  const dragHandlers = useInstancedMeshDrag({
    pickInstance,
    onDragStart: (index) => {
      bringToFront(index);
      draggedIndexRef.current = index;
      baseDragHandlers.startDrag(index);
    },
    onDrag: (index, x, y) => baseDragHandlers.drag(index, x, y),
    onDragEnd: (index) => {
      draggedIndexRef.current = null;
      baseDragHandlers.endDrag(index);
    },
    enabled: !isRunning,
    onDragStateChange: setIsDraggingNode,
    onClick: (index) => {
      bringToFront(index);

      // If this is a pulled ghost, fly camera to its real position
      const pulled = pulledChunkMapRef.current.get(index);
      if (pulled && flyToRef.current) {
        flyToRef.current(pulled.realX, pulled.realY);
      }

      onSelectChunk(chunks[index].id);
      addFocusSeeds([index]);
    },
  });

  // Hover: track which instance the pointer is over (read in useFrame, no React state).
  // Pick the highest z-rank instance so the visually front card wins over cards underneath.
  const handleHoverMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      if (isDraggingNode) return;
      let bestId: number | null = null;
      let bestRank = -1;
      for (const hit of event.intersections) {
        if (hit.object !== meshRef.current) continue;
        const id = (hit as typeof hit & { instanceId?: number }).instanceId;
        if (id == null || id < 0 || id >= chunks.length) continue;
        const rank = zRankRef.current.get(id) ?? id;
        if (rank > bestRank) { bestRank = rank; bestId = id; }
      }
      hoveredIndexRef.current = bestId;
    },
    [chunks.length, isDraggingNode, meshRef],
  );
  const handleHoverLeave = useCallback(() => {
    hoveredIndexRef.current = null;
  }, []);

  // Cluster label fade state — updated from useFrame only when value changes significantly
  const [coarseFadeInT, setCoarseFadeInT] = useState(1);
  const [coarseFadeOutT, setCoarseFadeOutT] = useState(0);
  const [fineFadeInT, setFineFadeInT] = useState(0);
  const [fineFadeOutT, setFineFadeOutT] = useState(0);
  const coarseFadeInRef = useRef(1);
  const coarseFadeOutRef = useRef(0);
  const fineFadeInRef = useRef(0);
  const fineFadeOutRef = useRef(0);

  // Proxy SimNode arrays for ClusterLabels3D — positions read live from displayPositionsRef
  const { coarseLabelNodes, coarseNodeToCluster, fineLabelNodes, fineNodeToCluster } = useMemo(() => {
    const makeProxyNode = (chunk: ChunkEmbeddingData, i: number): SimNode => {
      const node: Record<string, unknown> = {
        id: chunk.id,
        label: chunk.content?.slice(0, 20) ?? "",
        hullLabel: undefined as string | undefined,
        communityMembers: undefined as string[] | undefined,
      };
      Object.defineProperty(node, "x", {
        get: () => displayPositionsRef.current[i * 2] ?? 0,
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(node, "y", {
        get: () => displayPositionsRef.current[i * 2 + 1] ?? 0,
        enumerable: true,
        configurable: true,
      });
      return node as unknown as SimNode;
    };

    const coarseNodes = chunks.map(makeProxyNode);
    const fineNodes = chunks.map(makeProxyNode);
    const coarseMap = new Map<string, number>();
    const fineMap = new Map<string, number>();
    const coarseHubAssigned = new Set<number>();
    const fineHubAssigned = new Set<number>();

    for (let i = 0; i < chunks.length; i++) {
      const inLens = !lensNodeSet || lensNodeSet.has(i);
      if (coarseClusters) {
        const cid = coarseClusters[i];
        if (cid !== undefined) {
          if (inLens) coarseMap.set(chunks[i].id, cid);
          if (inLens && !coarseHubAssigned.has(cid) && coarseLabels?.[cid]) {
            coarseNodes[i].hullLabel = coarseLabels[cid];
            (coarseNodes[i] as SimNode & { communityMembers: string[] }).communityMembers = [chunks[i].id];
            coarseHubAssigned.add(cid);
          }
        }
      }
      if (fineClusters) {
        const cid = fineClusters[i];
        if (cid !== undefined) {
          if (inLens) fineMap.set(chunks[i].id, cid);
          if (inLens && !fineHubAssigned.has(cid) && fineLabels?.[cid]) {
            fineNodes[i].hullLabel = fineLabels[cid];
            (fineNodes[i] as SimNode & { communityMembers: string[] }).communityMembers = [chunks[i].id];
            fineHubAssigned.add(cid);
          }
        }
      }
    }

    return {
      coarseLabelNodes: coarseNodes,
      coarseNodeToCluster: coarseMap,
      fineLabelNodes: fineNodes,
      fineNodeToCluster: fineMap,
    };
  }, [chunks, coarseClusters, fineClusters, coarseLabels, fineLabels, lensNodeSet]);

  // Semantic colors for cluster labels (centroid of chunk embeddings per cluster → PCA → HSL)
  const { coarseClusterColors, fineClusterColors } = useMemo(() => {
    if (!pcaTransform) return { coarseClusterColors: undefined, fineClusterColors: undefined };

    const colorsFor = (clusters: Record<number, number>) => {
      const grouped = new Map<number, ChunkEmbeddingData[]>();
      for (let i = 0; i < chunks.length; i++) {
        const cid = clusters[i];
        if (cid === undefined) continue;
        let arr = grouped.get(cid);
        if (!arr) { arr = []; grouped.set(cid, arr); }
        arr.push(chunks[i]);
      }
      return computeClusterColors(grouped, pcaTransform);
    };

    return {
      coarseClusterColors: coarseClusters ? colorsFor(coarseClusters) : undefined,
      fineClusterColors: fineClusters ? colorsFor(fineClusters) : undefined,
    };
  }, [chunks, coarseClusters, fineClusters, pcaTransform]);

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

  const HOVER_DURATION = 0.25; // seconds
  useFrame((_state, delta) => {
    const mesh = meshRef.current;
    if (!mesh || layoutPositions.length === 0) return;

    const n = Math.min(count, layoutPositions.length / 2);

    const zones = computeViewportZones(camera as THREE.PerspectiveCamera, size.width, size.height);

    // -- Focus push animation --
    tickPreviewDim(delta);
    tickFocusPush(lensActive && marginIds ? {
      marginIds,
      getPosition: (i) => ({
        x: layoutPositions[i * 2] ?? 0,
        y: layoutPositions[i * 2 + 1] ?? 0,
      }),
      pullBounds: zones.pullBounds,
      camX: zones.viewport.camX,
      camY: zones.viewport.camY,
    } : null);

    // Edge pulling: classify chunks and compute pulled positions
    const pullResult = computeChunkPullState({
      positions: layoutPositions,
      adjacency,
      zones,
      lensNodeSet: lensActive ? lensNodeSet : null,
    });
    pulledChunkMapRef.current = pullResult.pulledMap;

    // Merge push overrides into render positions
    let renderPositions = layoutPositions;
    if (focusPushRef.current.size > 0) {
      if (displayPositionsRef.current.length !== layoutPositions.length) {
        displayPositionsRef.current = new Float32Array(layoutPositions.length);
      }
      displayPositionsRef.current.set(layoutPositions);
      for (const [idx, o] of focusPushRef.current) {
        displayPositionsRef.current[idx * 2] = o.x;
        displayPositionsRef.current[idx * 2 + 1] = o.y;
      }
      renderPositions = displayPositionsRef.current;
    }

    // Merge pulled positions into render positions (focus push takes priority)
    if (pullResult.pulledMap.size > 0) {
      if (displayPositionsRef.current === layoutPositions || displayPositionsRef.current.length !== layoutPositions.length) {
        displayPositionsRef.current = new Float32Array(layoutPositions.length);
        displayPositionsRef.current.set(layoutPositions);
      }
      for (const [idx, pulled] of pullResult.pulledMap) {
        if (focusPushRef.current.has(idx)) continue;
        displayPositionsRef.current[idx * 2] = pulled.x;
        displayPositionsRef.current[idx * 2 + 1] = pulled.y;
      }
      renderPositions = displayPositionsRef.current;
    }

    // All nodes visible (margins are small dots, not hidden)
    visibleNodeIndicesRef.current.clear();
    for (let i = 0; i < n; i++) visibleNodeIndicesRef.current.add(i);

    // Bring hovered card to front and notify the active simulation (once per hover change).
    const hovered = hoveredIndexRef.current;
    if (hovered !== prevHoveredRef.current) {
      if (hovered !== null) bringToFront(hovered);
      baseDragHandlers.notifyHoverChange?.(hovered, HOVER_SCALE_MULTIPLIER);
    }
    prevHoveredRef.current = hovered;

    // Animate hover scale: progress 0->1 on hover-in, 1->0 on hover-out, over HOVER_DURATION.
    const hoverProgress = hoverProgressRef.current;
    if (hovered !== null && !hoverProgress.has(hovered)) hoverProgress.set(hovered, 0);
    const step = delta / HOVER_DURATION;
    const toDelete: number[] = [];
    for (const [idx, progress] of hoverProgress) {
      const newProgress = idx === hovered
        ? Math.min(1, progress + step)
        : Math.max(0, progress - step);
      if (newProgress <= 0) toDelete.push(idx);
      else hoverProgress.set(idx, newProgress);
    }
    for (const idx of toDelete) hoverProgress.delete(idx);

    chunkScreenRectsRef.current.clear();
    const cardZStep = n > 1 ? CARD_Z_RANGE / n : CARD_Z_RANGE;

    // Compute world-units-per-pixel once per frame (cards are near z=0, camera looks down z-axis).
    const camZ = camera.position.z;
    const fovRad = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov);

    // Shape morph: circle when far, rectangle when near enough to read text
    if (materialRef.current) {
      const t = normalizeZoom(camZ, { near: shapeMorphNear, far: shapeMorphFar }); // 0=near(rect), 1=far(circle)
      materialRef.current.uniforms.u_cornerRatio.value = 0.08 + t * (1.0 - 0.08);
    }

    // Cluster label fades — update React state only when changed by >1%
    const newCoarseFadeIn = computeLabelFade(camZ, labelFades.coarseFadeIn);
    const newCoarseFadeOut = computeLabelFade(camZ, labelFades.coarseFadeOut);
    const newFineFadeIn = computeLabelFade(camZ, labelFades.fineFadeIn);
    const newFineFadeOut = computeLabelFade(camZ, labelFades.fineFadeOut);
    if (Math.abs(newCoarseFadeIn - coarseFadeInRef.current) > 0.01) { coarseFadeInRef.current = newCoarseFadeIn; setCoarseFadeInT(newCoarseFadeIn); }
    if (Math.abs(newCoarseFadeOut - coarseFadeOutRef.current) > 0.01) { coarseFadeOutRef.current = newCoarseFadeOut; setCoarseFadeOutT(newCoarseFadeOut); }
    if (Math.abs(newFineFadeIn - fineFadeInRef.current) > 0.01) { fineFadeInRef.current = newFineFadeIn; setFineFadeInT(newFineFadeIn); }
    if (Math.abs(newFineFadeOut - fineFadeOutRef.current) > 0.01) { fineFadeOutRef.current = newFineFadeOut; setFineFadeOutT(newFineFadeOut); }
    const unitsPerPixel = (2 * Math.tan(fovRad / 2) * Math.max(camZ, 1e-3)) / (size.height / gl.getPixelRatio());

    for (let i = 0; i < n; i++) {
      const animatedScale = nodeScalesRef.current.get(i) ?? 0;

      if (animatedScale < 0.005) {
        scaleVec.current.setScalar(0);
        matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
        mesh.setMatrixAt(i, matrixRef.current);
        continue;
      }

      // Edge pulling: detect pulled ghost nodes (focus push takes priority)
      const pulledData = focusPushRef.current.has(i) ? undefined : pullResult.pulledMap.get(i);
      const isPulled = !!pulledData;

      const x = pulledData?.x ?? renderPositions[i * 2];
      const y = pulledData?.y ?? renderPositions[i * 2 + 1];

      // In lens mode, pulled nodes outside the focus set are irrelevant — hide them.
      const isRelevantPulled = isPulled && (!lensActive || !!lensNodeSet?.has(i));
      // Only primary viewport nodes and relevant pulled edge indicators are visible.
      // Focus-pushed margin nodes (tiny dots animating to edge) are intentionally hidden.
      if (!isRelevantPulled && !pullResult.primarySet.has(i)) {
        scaleVec.current.setScalar(0);
        matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
        mesh.setMatrixAt(i, matrixRef.current);
        continue;
      }

      // Push-based scale: margin nodes shrink as they animate to viewport edge
      const pushOverride = focusPushRef.current.get(i);
      const pushScale = pushOverride ? (1 - pushOverride.progress * 0.85) : 1;

      const rawProgress = hoverProgressRef.current.get(i) ?? 0;
      // smoothstep easing: slow at start and end, fast in the middle
      const t = rawProgress * rawProgress * (3 - 2 * rawProgress);
      const hoverScale = 1 + (HOVER_SCALE_MULTIPLIER - 1) * t;
      const baseScale = CARD_SCALE * countScale * pushScale * animatedScale;
      // Pulled ghosts are navigation hints — keep compact regardless of content length.
      const heightRatio = isPulled ? 1 : (heightRatiosRef.current[i] ?? 1);
      // Cap hover growth so the card never exceeds 50% of viewport height.
      const maxHoverForVP = Math.max(1, (size.height / gl.getPixelRatio() * 0.5 * unitsPerPixel) / (CARD_HEIGHT * baseScale * heightRatio));
      const pulledScale = isPulled ? CHUNK_PULL_ZONE_SCALE : 1;
      const screenFraction = isPulled ? MAX_PULLED_SCREEN_FRACTION : MAX_CARD_SCREEN_FRACTION;
      const vpHeight = size.height / gl.getPixelRatio();
      const maxFinalScale = (vpHeight * screenFraction * unitsPerPixel) / (CARD_HEIGHT * heightRatio);
      const isFocusPulled = isPulled && !!lensNodeSet?.has(i);
      const minFinalScale = isFocusPulled ? Math.min((vpHeight * MIN_FOCUS_PULLED_SCREEN_FRACTION * unitsPerPixel) / (CARD_HEIGHT * heightRatio), baseScale) : 0;
      const finalScale = Math.max(Math.min(baseScale * Math.min(hoverScale, maxHoverForVP) * pulledScale, maxFinalScale), minFinalScale);
      const finalScaleY = finalScale * heightRatio;
      const rank = zRankRef.current.get(i) ?? i;
      const cardZ = rank * cardZStep;
      const textZForCard = cardZ + cardZStep / 2;

      posVec.current.set(x, y, cardZ);
      scaleVec.current.set(finalScale, finalScaleY, finalScale);
      matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
      mesh.setMatrixAt(i, matrixRef.current);

      if (!isPulled) {
        chunkScreenRectsRef.current.set(
          i,
          projectCardToScreenRect(
            x,
            y,
            textZForCard,
            (CARD_WIDTH / 2) * finalScale,
            (CARD_HEIGHT / 2) * finalScaleY,
            camera,
            size,
            centerVec.current,
            edgeVecX.current,
            edgeVecY.current,
          ),
        );
      }
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
    const desatChanged = Math.abs(effectiveDesaturation - prevDesaturationRef.current) > 0.005
      || minSaturationRef.current !== prevMinSaturationRef.current;

    const previewActive = previewDimRef.current.size > 0;
    if (colorChunksRef.current !== chunkColors || colorDirtyRef.current || desatChanged || previewActive || pullResult.pulledMap.size > 0 || lensActiveRef.current || !mesh.instanceColor) {
      const searchActive = searchOpacitiesRef.current.size > 0;
      initGlowTarget(glowTarget, isDarkMode());
      const opacityAttr = mesh.geometry.getAttribute('instanceOpacity') as THREE.BufferAttribute | null;
      for (let i = 0; i < Math.min(n, chunkColors.length); i++) {
        // Apply desaturation to base color via HSL (fast, no chroma.js needed)
        chunkColors[i].getHSL(hslTemp.current);
        hslTemp.current.s = Math.max(minSaturationRef.current, hslTemp.current.s * (1 - effectiveDesaturation));
        tempColor.current.setHSL(hslTemp.current.h, hslTemp.current.s, hslTemp.current.l);
        // Dim factors go to per-instance opacity (fade to transparent, not black)
        const searchOpacity = searchActive ? (searchOpacitiesRef.current.get(chunks[i].id) ?? 1.0) : 1.0;
        const previewDim = previewDimRef.current.get(i) ?? 1.0;
        const pulledDataForColor = pullResult.pulledMap.get(i);
        const pulledDim = pulledDataForColor ? PULLED_COLOR_FACTOR : 1.0;
        if (opacityAttr) (opacityAttr.array as Float32Array)[i] = searchOpacity * previewDim * pulledDim;
        const isFocusSeed = lensInfoRef.current?.depthMap.get(i) === 0;
        const isHovered = hoveredIndexRef.current === i;
        applyFocusGlow(tempColor.current, glowTarget, isFocusSeed, isHovered);
        mesh.setColorAt(i, tempColor.current);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (opacityAttr) opacityAttr.needsUpdate = true;
      colorChunksRef.current = chunkColors;
      colorDirtyRef.current = false;
      prevDesaturationRef.current = effectiveDesaturation;
      prevMinSaturationRef.current = minSaturationRef.current;
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.boundingSphere = null;
  });

  const shouldRenderEdges = !isRunning && focusEdges.length > 0 && edgeOpacity > 0;

  // Display positions: use overridden if available (focus push or edge pulling), else layout
  const hasOverrides = (focusPushRef.current.size > 0 || pulledChunkMapRef.current.size > 0)
    && displayPositionsRef.current.length === layoutPositions.length;
  const displayPositions = hasOverrides
    ? displayPositionsRef.current
    : layoutPositions;
  // Keep ref in sync for getPositionRef closure
  displayPositionsRef.current = displayPositions;

  return (
    <>
      {shouldRenderEdges && (
        <ChunkEdges
          edges={focusEdges}
          edgesVersion={focusEdgesVersion}
          positions={displayPositions}
          opacity={edgeOpacity * 0.35}
          edgeThickness={edgeThickness * countScale}
          edgeMidpoint={edgeMidpoint}
          edgeCountPivot={edgeCountPivot}
          edgeCountFloor={edgeCountFloor}
          nodeColors={chunkColors}
          previewDimRef={previewDimRef}
          pulledPositionsRef={pulledChunkMapRef}
        />
      )}
      <CameraController
        maxDistance={10000}
        enableDragPan={!isDraggingNode}
        onZoomChange={handleZoomChange}
        flyToRef={flyToRef}
      />
      <instancedMesh
        key={meshKey}
        ref={handleMeshRef}
        args={[geometry, undefined, stableCount]}
        frustumCulled={false}
        {...dragHandlers}
        onPointerMove={handleHoverMove}
        onPointerLeave={handleHoverLeave}
      />
      {!isRunning && (
        <CardTextLabels
          items={contentItems}
          getPosition={getPositionRef}
          screenRectsRef={chunkScreenRectsRef}
          textMaxWidth={CARD_WIDTH * 0.76}
          showAllBlocks
          maxVisible={lensActive ? undefined : 50}
          visibleIdsRef={lensActive ? lensVisibleIdsRef : undefined}
          onItemGeomHeight={onItemGeomHeight}
        />
      )}
      {coarseLabels && coarseNodeToCluster.size > 0 && !isRunning && (
        <ClusterLabels3D
          nodes={coarseLabelNodes}
          nodeToCluster={coarseNodeToCluster}
          clusterColors={coarseClusterColors}
          fadeInT={coarseFadeInT}
          labelFadeT={coarseFadeOutT}
          labelZ={CARD_Z_RANGE + 0.5}
          baseFontSize={10}
          useSemanticFonts={false}
          colorDesaturation={coarseDesaturation}
        />
      )}
      {fineLabels && fineNodeToCluster.size > 0 && !isRunning && (
        <ClusterLabels3D
          nodes={fineLabelNodes}
          nodeToCluster={fineNodeToCluster}
          clusterColors={fineClusterColors}
          fadeInT={fineFadeInT}
          labelFadeT={fineFadeOutT}
          labelZ={CARD_Z_RANGE + 0.3}
          baseFontSize={7}
          useSemanticFonts={false}
          colorDesaturation={fineDesaturation}
        />
      )}
    </>
  );
}
