/**
 * Chunk node rendering using instancedMesh.
 * Renders chunks on a separate Z plane behind keywords.
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode } from "@/lib/map-renderer";
import { CHUNK_Z_DEPTH } from "@/lib/chunk-zoom-config";
import { BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";

export interface ChunkNodesProps {
  chunkNodes: SimNode[];
}

export function ChunkNodes({ chunkNodes }: ChunkNodesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const matrixRef = useRef(new THREE.Matrix4());

  // Chunks are larger than keywords
  const chunkRadius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR * 1.5;
  const geometry = useMemo(() => new THREE.CircleGeometry(chunkRadius, 64), [chunkRadius]);

  // Update positions every frame
  useFrame(() => {
    if (!meshRef.current) return;

    for (let i = 0; i < chunkNodes.length; i++) {
      const node = chunkNodes[i];

      // Position at parent keyword's location but on a different Z plane
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = CHUNK_Z_DEPTH; // Behind keywords (negative z)

      matrixRef.current.setPosition(x, y, z);
      meshRef.current.setMatrixAt(i, matrixRef.current);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (chunkNodes.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, chunkNodes.length]} frustumCulled={false}>
      <meshBasicMaterial color="#e0e0e0" transparent opacity={1.0} depthTest={false} />
    </instancedMesh>
  );
}
