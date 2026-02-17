/**
 * Scene component for chunks UMAP visualization.
 * Renders chunk cards as an instancedMesh with rounded rectangle geometry,
 * colored by source article. Constant world-space scale: dots when far, cards when close.
 */

import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import { CameraController } from "@/components/topics-r3f/CameraController";
import { useChunkForceLayout } from "@/hooks/useChunkForceLayout";
import { useInstancedMeshDrag } from "@/hooks/useInstancedMeshDrag";
import { useInstancedMeshMaterial } from "@/hooks/useInstancedMeshMaterial";
import { useStableInstanceCount } from "@/hooks/useStableInstanceCount";
import { useFadingScale } from "@/hooks/useFadingScale";
import { useFocusZoomExit } from "@/hooks/useFocusZoomExit";
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
import { computeViewportZones } from "@/lib/edge-pulling";
import { applyFisheyeCompression, computeCompressionExtents } from "@/lib/fisheye-viewport";
import { projectCardToScreenRect, type ScreenRect } from "@/lib/screen-rect-projection";
import { ChunkEdges } from "./ChunkEdges";
import { ChunkTextLabels } from "./ChunkTextLabels";

// --- Constants ---

/** Constant world-space scale. At z=6000 cards are ~10px dots, at z=300 ~200px readable cards. */
const CARD_SCALE = 0.3;
/**
 * Total z-depth budget across all cards (world units).
 * Card 0 is at z=0 (farthest from camera); card N-1 is at z=CARD_Z_RANGE (closest).
 * Text for card i sits at z = i*step + step/2 — always in front of its own card,
 * always behind the next card forward. step = CARD_Z_RANGE / count.
 */
const CARD_Z_RANGE = 20;
const EDGE_FADE_DURATION_MS = 500;

// --- Props ---

interface ChunksSceneProps {
  chunks: ChunkEmbeddingData[];
  umapPositions: Float32Array;
  searchOpacities: Map<string, number>;
  neighborhoodEdges: UmapEdge[];
  neighborhoodEdgesVersion: number;
  isRunning: boolean;
  selectedChunkId: string | null;
  onSelectChunk: (chunkId: string | null) => void;
  edgeThickness: number;
  edgeContrast: number;
  edgeMidpoint: number;
  lensCompressionStrength: number;
  lensCenterScale: number;
  lensEdgeScale: number;
  lpNormP: number;
}

// --- Component ---

export function ChunksScene({
  chunks,
  umapPositions,
  searchOpacities,
  neighborhoodEdges,
  neighborhoodEdgesVersion,
  isRunning,
  selectedChunkId,
  onSelectChunk,
  edgeThickness,
  edgeContrast,
  edgeMidpoint,
  lensCompressionStrength,
  lensCenterScale,
  lensEdgeScale,
  lpNormP,
}: ChunksSceneProps) {
  const count = chunks.length;
  const { stableCount, meshKey } = useStableInstanceCount(count);
  const { meshRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);
  const { camera, size } = useThree();

  // Focus zoom exit hook - exits lens mode when zooming out
  const { handleZoomChange, captureEntryZoom } = useFocusZoomExit({
    isFocused: selectedChunkId !== null,
    onExitFocus: () => onSelectChunk(null),
    absoluteThreshold: 8000, // 80% of maxDistance=10000
    relativeMultiplier: 1.05,
  });

  const geometry = useMemo(createCardGeometry, []);

  const chunkColors = useMemo(
    () => chunks.map((chunk) => new THREE.Color().setHSL(hashToHue(chunk.sourcePath), 0.7, 0.55)),
    [chunks],
  );

  const chunkIndexById = useMemo(() => {
    const map = new Map<string, number>();
    chunks.forEach((chunk, index) => map.set(chunk.id, index));
    return map;
  }, [chunks]);

  const focusIndex = selectedChunkId ? chunkIndexById.get(selectedChunkId) ?? -1 : -1;

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
    () => focusIndex < 0 ? null : computeBfsNeighborhood(focusIndex, adjacency, LENS_MAX_HOPS),
    [focusIndex, adjacency],
  );

  const lensActive = !!lensInfo && !isRunning;
  const lensNodeSet = lensInfo?.nodeSet ?? null;
  const lensDepthMap = lensInfo?.depthMap;

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
  const colorChunksRef = useRef<ChunkEmbeddingData[] | null>(null);
  const searchOpacitiesRef = useRef(searchOpacities);
  const colorDirtyRef = useRef(false);
  if (searchOpacitiesRef.current !== searchOpacities) {
    searchOpacitiesRef.current = searchOpacities;
    colorDirtyRef.current = true;
  }

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

  // Buffer for compressed positions (computed fresh each frame, TopicsView pattern)
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
      captureEntryZoom(); // Capture zoom level for exit detection
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

    // --- Compute viewport zones fresh each frame (TopicsView pattern) ---
    // When lensActive is true, zones and extents are always non-null.
    const zones = lensActive
      ? computeViewportZones(camera as THREE.PerspectiveCamera, size.width, size.height)
      : null;
    const extents = zones ? computeCompressionExtents(zones) : null;

    // --- Compute compressed positions into buffer (for edges and labels) ---
    if (lensActive && zones && extents) {
      if (compressedPositionsRef.current.length !== layoutPositions.length) {
        compressedPositionsRef.current = new Float32Array(layoutPositions.length);
      }

      for (let i = 0; i < n; i++) {
        let x = layoutPositions[i * 2];
        let y = layoutPositions[i * 2 + 1];

        if (lensNodeSet!.has(i)) {
          const compressed = applyFisheyeCompression(
            x, y, zones.viewport.camX, zones.viewport.camY,
            extents.compressionStartHalfWidth, extents.compressionStartHalfHeight,
            extents.horizonHalfWidth, extents.horizonHalfHeight,
            lensCompressionStrength, lpNormP,
          );
          x = THREE.MathUtils.clamp(compressed.x, zones.pullBounds.left, zones.pullBounds.right);
          y = THREE.MathUtils.clamp(compressed.y, zones.pullBounds.bottom, zones.pullBounds.top);
        }

        compressedPositionsRef.current[i * 2] = x;
        compressedPositionsRef.current[i * 2 + 1] = y;
      }
    }

    // --- Update visible set for animated transitions ---
    visibleNodeIndicesRef.current.clear();
    const visibleSet = lensActive ? lensNodeSet! : null;
    for (let i = 0; i < n; i++) {
      if (!visibleSet || visibleSet.has(i)) visibleNodeIndicesRef.current.add(i);
    }

    // --- Set instance matrices ---
    chunkScreenRectsRef.current.clear();
    const renderPositions = lensActive && compressedPositionsRef.current.length > 0
      ? compressedPositionsRef.current
      : layoutPositions;

    // Stable z-ordering: card i at z = i*cardZStep, text at z = i*cardZStep + cardZStep/2.
    // Card N-1 is closest to camera (front), card 0 is farthest (back).
    // Order never changes → no flickering. Total z range = CARD_Z_RANGE world units.
    const cardZStep = n > 1 ? CARD_Z_RANGE / n : CARD_Z_RANGE;

    for (let i = 0; i < n; i++) {
      const animatedScale = nodeScalesRef.current.get(i) ?? 0;

      // Skip fully invisible nodes (optimization)
      if (animatedScale < 0.005) {
        scaleVec.current.setScalar(0);
        matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
        mesh.setMatrixAt(i, matrixRef.current);
        continue;
      }

      const x = renderPositions[i * 2];
      const y = renderPositions[i * 2 + 1];

      // Compute lens scale for nodes in lens set
      let lensScale = 1;
      if (lensActive && lensNodeSet!.has(i)) {
        const maxRadius = Math.min(extents!.horizonHalfWidth, extents!.horizonHalfHeight);
        const startRadius = Math.min(extents!.compressionStartHalfWidth, extents!.compressionStartHalfHeight);
        lensScale = computeLensNodeScale(
          x, y, zones!.viewport.camX, zones!.viewport.camY, lensDepthMap?.get(i),
          startRadius, maxRadius,
          lensCompressionStrength, lensCenterScale, lensEdgeScale,
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

      // Compute screen rect for text label positioning
      chunkScreenRectsRef.current.set(i, projectCardToScreenRect(
        x, y, textZForCard,
        (CARD_WIDTH / 2) * finalScale,
        (CARD_HEIGHT / 2) * finalScale,
        camera, size,
        centerVec.current, edgeVecX.current, edgeVecY.current,
      ));
    }

    // Hide unused instances
    for (let i = n; i < stableCount; i++) {
      scaleVec.current.setScalar(0);
      matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
      mesh.setMatrixAt(i, matrixRef.current);
    }

    // --- Apply colors when chunk data or search opacities change ---
    if (colorChunksRef.current !== chunks || colorDirtyRef.current || !mesh.instanceColor) {
      const searchActive = searchOpacitiesRef.current.size > 0;
      for (let i = 0; i < Math.min(n, chunkColors.length); i++) {
        tempColor.current.copy(chunkColors[i]);
        if (searchActive) {
          const opacity = searchOpacitiesRef.current.get(chunks[i].id) ?? 1.0;
          tempColor.current.multiplyScalar(opacity);
        }
        if (lensActive && lensNodeSet && lensNodeSet.has(i)) {
          applyLensColorEmphasis(tempColor.current, lensDepthMap?.get(i) ?? 0);
        }
        mesh.setColorAt(i, tempColor.current);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      colorChunksRef.current = chunks;
      colorDirtyRef.current = false;
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.boundingSphere = null;
  });

  const shouldRenderEdges = !isRunning && focusEdges.length > 0 && edgeOpacity > 0;

  // Use compressed positions for edges and labels when lens is active
  const displayPositions = lensActive && compressedPositionsRef.current.length > 0
    ? compressedPositionsRef.current
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
        />
      )}
      <CameraController
        maxDistance={10000}
        enableDragPan={!isDraggingNode}
        onZoomChange={handleZoomChange}
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
