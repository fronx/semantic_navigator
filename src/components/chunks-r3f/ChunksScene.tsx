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
import { ChunkEdges } from "./ChunkEdges";
import { ChunkTextLabels } from "./ChunkTextLabels";

// --- Constants ---

/** Constant world-space scale. At z=6000 cards are ~10px dots, at z=300 ~200px readable cards. */
const CARD_SCALE = 0.3;
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
  lensCompressionStrength,
  lensCenterScale,
  lensEdgeScale,
  lpNormP,
}: ChunksSceneProps) {
  const count = chunks.length;
  const { stableCount, meshKey } = useStableInstanceCount(count);
  const { meshRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);
  const { camera, size } = useThree();

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

  // Track when colors need repainting
  const colorChunksRef = useRef<ChunkEmbeddingData[] | null>(null);
  const searchOpacitiesRef = useRef(searchOpacities);
  const colorDirtyRef = useRef(false);
  if (searchOpacitiesRef.current !== searchOpacities) {
    searchOpacitiesRef.current = searchOpacities;
    colorDirtyRef.current = true;
  }

  const renderPositionsRef = useRef<Float32Array>(new Float32Array(0));
  const renderScalesRef = useRef<Float32Array>(new Float32Array(0));
  const [, setRenderBufferVersion] = useState(0);
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

  // Allocate lens buffers when entering lens mode
  useEffect(() => {
    if (!lensActive) return;
    if (renderPositionsRef.current.length !== layoutPositions.length) {
      renderPositionsRef.current = new Float32Array(layoutPositions.length);
      setRenderBufferVersion((v) => v + 1);
    }
    const nodeCount = layoutPositions.length / 2;
    if (renderScalesRef.current.length !== nodeCount) {
      renderScalesRef.current = new Float32Array(nodeCount);
    }
  }, [lensActive, layoutPositions.length]);

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
    onDragStart: startDrag,
    onDrag: drag,
    onDragEnd: endDrag,
    enabled: !isRunning,
    onDragStateChange: setIsDraggingNode,
    onClick: (index) => onSelectChunk(chunks[index].id),
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
    const bufferReady = renderPositionsRef.current.length === layoutPositions.length;
    const scalesReady = renderScalesRef.current.length === n;
    const usingLensBuffer = lensActive && bufferReady && scalesReady && lensNodeSet;
    const targetPositions = usingLensBuffer ? renderPositionsRef.current : layoutPositions;

    // --- Update visible set for animated transitions ---
    visibleNodeIndicesRef.current.clear();
    if (lensActive && lensNodeSet) {
      for (const nodeIndex of lensNodeSet) {
        visibleNodeIndicesRef.current.add(nodeIndex);
      }
    } else {
      // All nodes visible when lens inactive
      for (let i = 0; i < n; i++) {
        visibleNodeIndicesRef.current.add(i);
      }
    }

    // --- Compute lens positions and scales ---
    if (usingLensBuffer && lensInfo && lensNodeSet) {
      const zones = computeViewportZones(camera as THREE.PerspectiveCamera, size.width, size.height);
      const {
        horizonHalfWidth,
        horizonHalfHeight,
        compressionStartHalfWidth,
        compressionStartHalfHeight,
      } = computeCompressionExtents(zones);
      const camX = zones.viewport.camX;
      const camY = zones.viewport.camY;
      const scales = renderScalesRef.current;

      // computeLensNodeScale uses circular radii (min of half-extents)
      const maxRadius = Math.min(horizonHalfWidth, horizonHalfHeight);
      const compressionStartRadius = Math.min(compressionStartHalfWidth, compressionStartHalfHeight);

      for (let i = 0; i < n; i++) {
        let x = layoutPositions[i * 2];
        let y = layoutPositions[i * 2 + 1];
        let scale = 1;

        if (lensNodeSet.has(i)) {
          const compressed = applyFisheyeCompression(
            x, y, camX, camY,
            compressionStartHalfWidth, compressionStartHalfHeight,
            horizonHalfWidth, horizonHalfHeight,
            lensCompressionStrength,
            lpNormP
          );
          x = THREE.MathUtils.clamp(compressed.x, zones.pullBounds.left, zones.pullBounds.right);
          y = THREE.MathUtils.clamp(compressed.y, zones.pullBounds.bottom, zones.pullBounds.top);
          scale = computeLensNodeScale(
            x, y, camX, camY, lensDepthMap?.get(i),
            compressionStartRadius, maxRadius,
            lensCompressionStrength, lensCenterScale, lensEdgeScale
          );
        }

        scales[i] = scale;
        targetPositions[i * 2] = x;
        targetPositions[i * 2 + 1] = y;
      }
    } else if (renderScalesRef.current.length) {
      renderScalesRef.current.fill(1);
    }

    // --- Set instance matrices ---
    for (let i = 0; i < n; i++) {
      const animatedScale = nodeScalesRef.current.get(i) ?? 0;

      // Skip fully invisible nodes (optimization)
      if (animatedScale < 0.005) {
        scaleVec.current.setScalar(0);
        matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
        mesh.setMatrixAt(i, matrixRef.current);
        continue;
      }

      // Apply lens scale AND animated fade
      const lensScale = usingLensBuffer ? renderScalesRef.current[i] : 1;
      const finalScale = CARD_SCALE * lensScale * animatedScale;

      posVec.current.set(targetPositions[i * 2], targetPositions[i * 2 + 1], 0);
      scaleVec.current.setScalar(finalScale);
      matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
      mesh.setMatrixAt(i, matrixRef.current);
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

  const renderedPositions =
    lensActive && renderPositionsRef.current.length === layoutPositions.length
      ? renderPositionsRef.current
      : layoutPositions;

  const scalesToRender =
    lensActive && renderScalesRef.current.length === layoutPositions.length / 2
      ? renderScalesRef.current
      : null;

  const shouldRenderEdges = !isRunning && focusEdges.length > 0 && edgeOpacity > 0;

  return (
    <>
      {shouldRenderEdges && (
        <ChunkEdges
          edges={focusEdges}
          edgesVersion={focusEdgesVersion}
          positions={renderedPositions}
          opacity={edgeOpacity * 0.35}
        />
      )}
      <CameraController maxDistance={10000} enableDragPan={!isDraggingNode} />
      <instancedMesh
        key={meshKey}
        ref={handleMeshRef}
        args={[geometry, undefined, stableCount]}
        frustumCulled={false}
        {...dragHandlers}
      />
      <ChunkTextLabels
        chunks={chunks}
        positions={renderedPositions}
        scales={scalesToRender}
        cardWidth={CARD_WIDTH}
        cardHeight={CARD_HEIGHT}
        cardScale={CARD_SCALE}
      />
    </>
  );
}
