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

export function ChunksScene({ chunks, positions }: ChunksSceneProps) {
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

  // Expose current scale for text labels to read
  const currentScaleRef = useRef(CARD_SCALE);

  // Track whether colors have been applied (only need to set once per chunk set)
  const colorsAppliedRef = useRef(false);

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

    // Apply colors once (they don't change per frame)
    if (!colorsAppliedRef.current && chunkColors.length > 0) {
      for (let i = 0; i < Math.min(n, chunkColors.length); i++) {
        mesh.setColorAt(i, chunkColors[i]);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      colorsAppliedRef.current = true;
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
        currentScaleRef={currentScaleRef}
      />
    </>
  );
}
