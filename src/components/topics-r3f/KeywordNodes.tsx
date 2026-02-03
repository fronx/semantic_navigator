/**
 * Keyword node rendering using instancedMesh.
 * Updates positions imperatively in useFrame from simulation nodes.
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import { getNodeColor, BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";

export interface KeywordNodesProps {
  simNodes: SimNode[];
  colorMixRatio: number;
  pcaTransform: PCATransform | null;
  onKeywordClick?: (keyword: string) => void;
}

export function KeywordNodes({
  simNodes,
  colorMixRatio,
  pcaTransform,
  onKeywordClick,
}: KeywordNodesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const matrixRef = useRef(new THREE.Matrix4());
  const colorRef = useRef(new THREE.Color());

  // Create geometry once - match Three.js renderer size
  const geometry = useMemo(() => new THREE.CircleGeometry(BASE_DOT_RADIUS * DOT_SCALE_FACTOR, 64), []);

  // Update positions and colors every frame
  useFrame(() => {
    if (!meshRef.current) return;

    for (let i = 0; i < simNodes.length; i++) {
      const node = simNodes[i];

      // Update position from simulation
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = 0;

      matrixRef.current.setPosition(x, y, z);
      meshRef.current.setMatrixAt(i, matrixRef.current);

      // Update color
      const color = getNodeColor(
        node,
        pcaTransform ?? undefined,
        undefined, // clusterColors not yet implemented
        colorMixRatio
      );
      colorRef.current.set(color);
      meshRef.current.setColorAt(i, colorRef.current);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, simNodes.length]}
      onClick={(e) => {
        e.stopPropagation();
        const instanceId = e.instanceId;
        if (instanceId !== undefined && simNodes[instanceId]) {
          onKeywordClick?.(simNodes[instanceId].label);
        }
      }}
    >
      <meshBasicMaterial depthTest={false} transparent />
    </instancedMesh>
  );
}
