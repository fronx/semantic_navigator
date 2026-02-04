/**
 * Chunk node rendering using instancedMesh.
 * Renders chunks on a separate Z plane behind keywords.
 * Scales up as camera zooms in (inverse of keyword scaling).
 */

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode } from "@/lib/map-renderer";
import type { ChunkSimNode } from "@/lib/chunk-layout";
import type { PCATransform } from "@/lib/semantic-colors";
import type { ZoomRange } from "@/lib/zoom-phase-config";
import { CHUNK_Z_DEPTH } from "@/lib/chunk-zoom-config";
import { calculateScales } from "@/lib/chunk-scale";
import { getNodeColor, BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";

const VISIBILITY_THRESHOLD = 0.01;

export interface ChunkNodesProps {
  chunkNodes: SimNode[];
  simNodes: SimNode[];
  colorMixRatio: number;
  pcaTransform: PCATransform | null;
  zoomRange: ZoomRange;
}

export function ChunkNodes({
  chunkNodes,
  simNodes,
  colorMixRatio,
  pcaTransform,
  zoomRange,
}: ChunkNodesProps) {
  const { camera } = useThree();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const matrixRef = useRef(new THREE.Matrix4());
  const positionRef = useRef(new THREE.Vector3());
  const quaternionRef = useRef(new THREE.Quaternion());
  const scaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const colorRef = useRef(new THREE.Color());

  // Build map for O(1) parent keyword lookups
  const keywordMap = useMemo(
    () => new Map(simNodes.map((n) => [n.id, n])),
    [simNodes]
  );

  // Chunks are larger than keywords
  const chunkRadius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR * 1.5;
  const geometry = useMemo(() => new THREE.CircleGeometry(chunkRadius, 64), [chunkRadius]);

  // Update positions, scales, and colors every frame
  useFrame(() => {
    if (!meshRef.current) return;

    // Calculate scale based on camera Z position
    const cameraZ = camera.position.z;
    const scales = calculateScales(cameraZ, zoomRange);
    const chunkScale = scales.chunkScale;

    // Hide mesh entirely if below visibility threshold
    meshRef.current.visible = chunkScale >= VISIBILITY_THRESHOLD;
    if (!meshRef.current.visible) return;

    for (let i = 0; i < chunkNodes.length; i++) {
      const node = chunkNodes[i] as ChunkSimNode;

      // Position at parent keyword's location but on a different Z plane
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = CHUNK_Z_DEPTH; // Behind keywords (negative z)

      // Compose matrix with position and scale
      positionRef.current.set(x, y, z);
      scaleRef.current.setScalar(chunkScale);
      matrixRef.current.compose(positionRef.current, quaternionRef.current, scaleRef.current);
      meshRef.current.setMatrixAt(i, matrixRef.current);

      // Get color from parent keyword
      const parentNode = keywordMap.get(node.parentId);
      if (parentNode) {
        const color = getNodeColor(
          parentNode,
          pcaTransform ?? undefined,
          undefined,
          colorMixRatio
        );
        colorRef.current.set(color);
      } else {
        // Fallback gray if parent not found
        colorRef.current.set("#e0e0e0");
      }
      meshRef.current.setColorAt(i, colorRef.current);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  if (chunkNodes.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, chunkNodes.length]} frustumCulled={false}>
      <meshBasicMaterial vertexColors transparent depthTest={false} />
    </instancedMesh>
  );
}
