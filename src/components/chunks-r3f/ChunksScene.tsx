/**
 * Scene component for chunks UMAP visualization.
 * Renders chunk cards as an instancedMesh with rounded rectangle geometry,
 * colored by source article. Zoom-based scaling: dots when far, cards when close.
 */

import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { CameraController } from "@/components/topics-r3f/CameraController";
import { useStableInstanceCount } from "@/hooks/useStableInstanceCount";
import { useInstancedMeshMaterial } from "@/hooks/useInstancedMeshMaterial";
import { ChunkTextLabels } from "./ChunkTextLabels";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import type { UmapEdge } from "@/hooks/useUmapLayout";
import { ChunkEdges } from "./ChunkEdges";
import { useChunkForceLayout } from "@/hooks/useChunkForceLayout";
import { useInstancedMeshDrag } from "@/hooks/useInstancedMeshDrag";
import { applyFisheyeCompression, computeCompressionRadii } from "@/lib/fisheye-viewport";
import { computeViewportZones } from "@/lib/edge-pulling";

interface ChunksSceneProps {
  chunks: ChunkEmbeddingData[];
  umapPositions: Float32Array;
  searchOpacities: Map<string, number>;
  neighborhoodEdges: UmapEdge[];
  neighborhoodEdgesVersion: number;
  isRunning: boolean;
  selectedChunkId: string | null;
  onSelectChunk: (chunkId: string | null) => void;
}

const CARD_WIDTH = 30;
const CARD_HEIGHT = 20;
const CORNER_RATIO = 0.08;
/** Constant world-space scale. At z=6000 cards are ~10px dots, at z=300 ~200px readable cards. */
const CARD_SCALE = 0.3;
const LENS_MAX_HOPS = 2;
const LENS_CENTER_SCALE = 1.3;
const LENS_EDGE_SCALE = 0.75;
const LENS_EDGE_LIMIT_RATIO = 0.65;
const LENS_EDGE_MAX_SCALE = 1.0;

/**
 * Hash a string to a number in [0, 1) for deterministic hue assignment.
 */
function hashToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return (((hash % 360) + 360) % 360) / 360;
}

export function ChunksScene({
  chunks,
  umapPositions,
  searchOpacities,
  neighborhoodEdges,
  neighborhoodEdgesVersion,
  isRunning,
  selectedChunkId,
  onSelectChunk,
}: ChunksSceneProps) {
  const count = chunks.length;
  const { stableCount, meshKey } = useStableInstanceCount(count);
  const { meshRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);
  const { camera, size } = useThree();

  const geometry = useMemo(() => {
    const radius = Math.min(CARD_WIDTH, CARD_HEIGHT) * CORNER_RATIO;
    const shape = new THREE.Shape();
    const hw = CARD_WIDTH / 2;
    const hh = CARD_HEIGHT / 2;
    shape.moveTo(-hw + radius, -hh);
    shape.lineTo(hw - radius, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh + radius);
    shape.lineTo(hw, hh - radius);
    shape.quadraticCurveTo(hw, hh, hw - radius, hh);
    shape.lineTo(-hw + radius, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh - radius);
    shape.lineTo(-hw, -hh + radius);
    shape.quadraticCurveTo(-hw, -hh, -hw + radius, -hh);
    return new THREE.ShapeGeometry(shape);
  }, []);

  // Pre-compute per-chunk colors from sourcePath
  const chunkColors = useMemo(() => {
    const colors: THREE.Color[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const hue = hashToHue(chunks[i].sourcePath);
      const color = new THREE.Color();
      color.setHSL(hue, 0.7, 0.55);
      colors.push(color);
    }
    return colors;
  }, [chunks]);
  const highlightColor = useMemo(() => new THREE.Color(1, 1, 1), []);

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

  const lensInfo = useMemo(() => {
    if (focusIndex < 0) return null;
    const nodeSet = new Set<number>([focusIndex]);
    const depthMap = new Map<number, number>([[focusIndex, 0]]);
    const queue: Array<{ index: number; depth: number }> = [{ index: focusIndex, depth: 0 }];
    while (queue.length) {
      const current = queue.shift()!;
      if (current.depth >= LENS_MAX_HOPS) continue;
      const neighbors = adjacency.get(current.index) ?? [];
      for (const neighbor of neighbors) {
        if (nodeSet.has(neighbor)) continue;
        nodeSet.add(neighbor);
        depthMap.set(neighbor, current.depth + 1);
        queue.push({ index: neighbor, depth: current.depth + 1 });
      }
    }
    return { focusIndex, nodeSet, depthMap };
  }, [focusIndex, adjacency]);

  const lensActive = !!lensInfo && !isRunning;
  const lensNodeSet = lensInfo?.nodeSet ?? null;
  const lensDepthMap = lensInfo?.depthMap;

  const focusEdges = useMemo(() => {
    if (!lensActive || !lensInfo) return neighborhoodEdges;
    const set = lensInfo.nodeSet;
    return neighborhoodEdges.filter(
      (edge) => set.has(edge.source) && set.has(edge.target)
    );
  }, [lensActive, lensInfo, neighborhoodEdges]);

  const outboundEdges = useMemo(() => {
    if (!lensActive || !lensInfo) return [];
    const set = lensInfo.nodeSet;
    return neighborhoodEdges.filter((edge) => {
      const sourceIn = set.has(edge.source);
      const targetIn = set.has(edge.target);
      return sourceIn !== targetIn;
    });
  }, [lensActive, lensInfo, neighborhoodEdges]);

  const focusEdgesVersion = lensActive
    ? neighborhoodEdgesVersion * 31 + (lensInfo?.nodeSet.size ?? 0)
    : neighborhoodEdgesVersion;

  const outboundEdgesVersion = lensActive
    ? neighborhoodEdgesVersion * 37 + (lensInfo?.nodeSet.size ?? 0)
    : 0;

  // Reusable objects for useFrame (avoid GC pressure)
  const matrixRef = useRef(new THREE.Matrix4());
  const posVec = useRef(new THREE.Vector3());
  const quat = useRef(new THREE.Quaternion());
  const scaleVec = useRef(new THREE.Vector3(1, 1, 1));

  // Track which chunks have had colors applied (reset when chunk data changes)
  const colorChunksRef = useRef<ChunkEmbeddingData[] | null>(null);
  const searchOpacitiesRef = useRef(searchOpacities);
  const colorDirtyRef = useRef(false);
  if (searchOpacitiesRef.current !== searchOpacities) {
    searchOpacitiesRef.current = searchOpacities;
    colorDirtyRef.current = true;
  }

  const tempColor = useRef(new THREE.Color());
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
    [chunks.length]
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

  const [edgeOpacity, setEdgeOpacity] = useState(0);

  useEffect(() => {
    let raf: number | null = null;

    if (isRunning) {
      setEdgeOpacity(0);
      return () => {
        if (raf) cancelAnimationFrame(raf);
      };
    }

    const duration = 500;
    const start = performance.now();

    const tick = () => {
      const elapsed = performance.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      setEdgeOpacity(progress);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isRunning]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || layoutPositions.length === 0) return;

    const bufferReady = renderPositionsRef.current.length === layoutPositions.length;
    const scalesReady = renderScalesRef.current.length === layoutPositions.length / 2;
    const usingLensBuffer = lensActive && bufferReady && scalesReady && lensNodeSet;
    const targetPositions = usingLensBuffer ? renderPositionsRef.current : layoutPositions;

    const n = Math.min(count, layoutPositions.length / 2);

    if (usingLensBuffer && lensInfo && lensNodeSet) {
      const zones = computeViewportZones(camera as THREE.PerspectiveCamera, size.width, size.height);
      const { maxRadius, compressionStartRadius } = computeCompressionRadii(zones);
      const camX = zones.viewport.camX;
      const camY = zones.viewport.camY;
      const scales = renderScalesRef.current;

      for (let i = 0; i < n; i++) {
        let x = layoutPositions[i * 2];
        let y = layoutPositions[i * 2 + 1];
        let scale = 1;
        if (lensNodeSet.has(i)) {
          const compressed = applyFisheyeCompression(
            x,
            y,
            camX,
            camY,
            compressionStartRadius,
            maxRadius
          );
          x = Math.max(zones.pullBounds.left, Math.min(zones.pullBounds.right, compressed.x));
          y = Math.max(zones.pullBounds.bottom, Math.min(zones.pullBounds.top, compressed.y));

          if (maxRadius > compressionStartRadius) {
            const dxAfter = x - camX;
            const dyAfter = y - camY;
            const radialDistance = Math.sqrt(dxAfter * dxAfter + dyAfter * dyAfter);
            const radialWeight =
              1 -
              THREE.MathUtils.smoothstep(radialDistance, compressionStartRadius, maxRadius);

            const depth = lensDepthMap?.get(i);
            const depthWeight =
              depth == null
                ? 0
                : 1 - Math.min(depth, LENS_MAX_HOPS) / Math.max(1, LENS_MAX_HOPS);

            const blendedWeight = Math.max(
              0,
              Math.min(1, radialWeight * 0.7 + depthWeight * 0.3)
            );
            scale = THREE.MathUtils.lerp(LENS_EDGE_SCALE, LENS_CENTER_SCALE, blendedWeight);

            const edgeZoneStart =
              compressionStartRadius +
              (maxRadius - compressionStartRadius) * LENS_EDGE_LIMIT_RATIO;
            if (maxRadius > edgeZoneStart) {
              const limitT = Math.min(
                1,
                Math.max(0, (radialDistance - edgeZoneStart) / (maxRadius - edgeZoneStart))
              );
              if (limitT > 0) {
                const edgeLimit = THREE.MathUtils.lerp(LENS_EDGE_MAX_SCALE, LENS_EDGE_SCALE, limitT);
                scale = Math.min(scale, edgeLimit);
              }
            }
          } else {
            scale = LENS_CENTER_SCALE;
          }
        }
        scales[i] = scale;
        targetPositions[i * 2] = x;
        targetPositions[i * 2 + 1] = y;
      }
    } else if (renderScalesRef.current.length) {
      const scales = renderScalesRef.current;
      for (let i = 0; i < scales.length; i++) {
        scales[i] = 1;
      }
    }

    for (let i = 0; i < n; i++) {
      const x = targetPositions[i * 2];
      const y = targetPositions[i * 2 + 1];
      const nodeScale =
        usingLensBuffer && renderScalesRef.current.length === n ? renderScalesRef.current[i] : 1;
      posVec.current.set(x, y, 0);
      scaleVec.current.setScalar(CARD_SCALE * nodeScale);
      matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
      mesh.setMatrixAt(i, matrixRef.current);
    }

    // Hide unused instances
    for (let i = n; i < stableCount; i++) {
      scaleVec.current.setScalar(0);
      matrixRef.current.compose(posVec.current, quat.current, scaleVec.current);
      mesh.setMatrixAt(i, matrixRef.current);
    }

    // Apply colors when chunk data or search opacities change
    if (colorChunksRef.current !== chunks || colorDirtyRef.current || !mesh.instanceColor) {
      const searchActive = searchOpacitiesRef.current.size > 0;
      for (let i = 0; i < Math.min(n, chunkColors.length); i++) {
        tempColor.current.copy(chunkColors[i]);
        if (searchActive) {
          const opacity = searchOpacitiesRef.current.get(chunks[i].id) ?? 1.0;
          tempColor.current.multiplyScalar(opacity);
        }
        if (lensActive && lensNodeSet) {
          if (!lensNodeSet.has(i)) {
            tempColor.current.multiplyScalar(0.35);
          } else {
            const depth = lensDepthMap?.get(i) ?? 0;
            const emphasis = depth === 0 ? 1.35 : depth === 1 ? 1.15 : 1.05;
            tempColor.current.lerp(highlightColor, 0.15 * (LENS_MAX_HOPS - depth) / LENS_MAX_HOPS);
            tempColor.current.multiplyScalar(emphasis);
            tempColor.current.r = Math.min(1, Math.max(0, tempColor.current.r));
            tempColor.current.g = Math.min(1, Math.max(0, tempColor.current.g));
            tempColor.current.b = Math.min(1, Math.max(0, tempColor.current.b));
          }
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

  const shouldRenderFocusEdges = !isRunning && focusEdges.length > 0 && edgeOpacity > 0;
  const shouldRenderOutboundEdges =
    lensActive && !isRunning && outboundEdges.length > 0 && edgeOpacity > 0;

  return (
    <>
      {shouldRenderFocusEdges && (
        <ChunkEdges
          edges={focusEdges}
          edgesVersion={focusEdgesVersion}
          positions={renderedPositions}
          opacity={edgeOpacity * 0.35}
        />
      )}
      {shouldRenderOutboundEdges && (
        <ChunkEdges
          edges={outboundEdges}
          edgesVersion={outboundEdgesVersion}
          positions={renderedPositions}
          opacity={edgeOpacity * 0.15}
          focusNodeSet={lensNodeSet}
          projectOutsideFocus
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
