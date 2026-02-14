/**
 * Scene component for chunks UMAP visualization.
 * Renders chunk cards as an instancedMesh with rounded rectangle geometry,
 * colored by source article. Zoom-based scaling: dots when far, cards when close.
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CameraController } from "@/components/topics-r3f/CameraController";
import { useStableInstanceCount } from "@/hooks/useStableInstanceCount";
import { useInstancedMeshMaterial } from "@/hooks/useInstancedMeshMaterial";
import { ChunkTextLabels } from "./ChunkTextLabels";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";

interface ChunksSceneProps {
  chunks: ChunkEmbeddingData[];
  positions: Float32Array;
  searchOpacities: Map<string, number>;
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

export function ChunksScene({ chunks, positions, searchOpacities }: ChunksSceneProps) {
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

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || positions.length === 0) return;

    const n = Math.min(count, positions.length / 2);

    for (let i = 0; i < n; i++) {
      posVec.current.set(positions[i * 2], positions[i * 2 + 1], 0);
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
      <CameraController maxDistance={10000} />
      <instancedMesh
        key={meshKey}
        ref={handleMeshRef}
        args={[geometry, undefined, stableCount]}
        frustumCulled={false}
      />
      <ChunkTextLabels
        chunks={chunks}
        positions={positions}
        cardWidth={CARD_WIDTH}
        cardHeight={CARD_HEIGHT}
        cardScale={CARD_SCALE}
        searchOpacities={searchOpacities}
      />
    </>
  );
}
