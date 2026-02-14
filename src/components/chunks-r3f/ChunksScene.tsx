/**
 * Scene component for chunks UMAP visualization.
 * Renders chunk cards as an instancedMesh with rounded rectangle geometry,
 * colored by source article. Zoom-based scaling: dots when far, cards when close.
 */

import { useRef, useMemo, useState, useEffect, useCallback } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
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

interface ChunksSceneProps {
  chunks: ChunkEmbeddingData[];
  umapPositions: Float32Array;
  searchOpacities: Map<string, number>;
  neighborhoodEdges: UmapEdge[];
  neighborhoodEdgesVersion: number;
  isRunning: boolean;
}

const CARD_WIDTH = 30;
const CARD_HEIGHT = 20;
const CORNER_RATIO = 0.08;
/** Constant world-space scale. At z=6000 cards are ~10px dots, at z=300 ~200px readable cards. */
const CARD_SCALE = 0.3;

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
}: ChunksSceneProps) {
  const count = chunks.length;
  const { stableCount, meshKey } = useStableInstanceCount(count);
  const { meshRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);

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

    const n = Math.min(count, layoutPositions.length / 2);

    for (let i = 0; i < n; i++) {
      posVec.current.set(layoutPositions[i * 2], layoutPositions[i * 2 + 1], 0);
      scaleVec.current.setScalar(CARD_SCALE);
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
        mesh.setColorAt(i, tempColor.current);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      colorChunksRef.current = chunks;
      colorDirtyRef.current = false;
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.boundingSphere = null;
  });

  return (
    <>
      {!isRunning && neighborhoodEdges.length > 0 && edgeOpacity > 0 && (
        <ChunkEdges
          edges={neighborhoodEdges}
          edgesVersion={neighborhoodEdgesVersion}
          positions={layoutPositions}
          opacity={edgeOpacity * 0.35}
        />
      )}
      <CameraController maxDistance={10000} enableDragPan={false} />
      <instancedMesh
        key={meshKey}
        ref={handleMeshRef}
        args={[geometry, undefined, stableCount]}
        frustumCulled={false}
        {...dragHandlers}
      />
      <ChunkTextLabels
        chunks={chunks}
        positions={layoutPositions}
        cardWidth={CARD_WIDTH}
        cardHeight={CARD_HEIGHT}
        cardScale={CARD_SCALE}
      />
    </>
  );
}
