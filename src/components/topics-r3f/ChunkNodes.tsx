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
  /** Z-depth offset for chunks (negative = behind keywords) */
  chunkZDepth?: number;
}

export function ChunkNodes({
  chunkNodes,
  simNodes,
  colorMixRatio,
  pcaTransform,
  zoomRange,
  chunkZDepth = CHUNK_Z_DEPTH,
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

    // Debug first few chunks
    if (Math.random() < 0.01 && chunkNodes.length > 0) {
      console.log('[ChunkNodes Debug]', JSON.stringify({
        totalChunks: chunkNodes.length,
        chunkZDepth,
        first3Chunks: chunkNodes.slice(0, 3).map(n => ({
          id: n.id,
          x: n.x,
          y: n.y,
          parentId: (n as ChunkSimNode).parentId,
        })),
        simNodesCount: simNodes.length,
        keywordMapSize: keywordMap.size,
      }, null, 2));
    }

    for (let i = 0; i < chunkNodes.length; i++) {
      const node = chunkNodes[i] as ChunkSimNode;

      // Position at parent keyword's location but on a different Z plane
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = chunkZDepth; // Behind keywords (negative z)

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

        // Debug first chunk color
        if (i === 0 && Math.random() < 0.01) {
          console.log('[ChunkNodes Color Debug]', JSON.stringify({
            chunkId: node.id,
            parentId: node.parentId,
            parentFound: !!parentNode,
            parentLabel: parentNode?.label,
            computedColor: color,
            colorRGB: colorRef.current.set(color).toArray(),
          }, null, 2));
        }

        colorRef.current.set(color);
      } else {
        // Fallback gray if parent not found
        colorRef.current.set("#e0e0e0");
        if (i === 0 && Math.random() < 0.1) {
          console.log('[ChunkNodes] Parent not found for chunk:', node.id, 'parentId:', node.parentId);
        }
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
      {/* Important: do not reactivate the following line that is commented out. Doing so causes the dots to be black. */}
      {/* <meshBasicMaterial vertexColors transparent depthTest={false} /> */}
    </instancedMesh>
  );
}
