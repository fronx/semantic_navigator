/**
 * Keyword node rendering using instancedMesh.
 * Updates positions imperatively in useFrame from simulation nodes.
 */

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import type { ZoomRange } from "@/lib/zoom-phase-config";
import { calculateScales } from "@/lib/chunk-scale";
import { getNodeColor, BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";

const VISIBILITY_THRESHOLD = 0.01;

export interface KeywordNodesProps {
  simNodes: SimNode[];
  colorMixRatio: number;
  pcaTransform: PCATransform | null;
  zoomRange: ZoomRange;
  onKeywordClick?: (keyword: string) => void;
}

export function KeywordNodes({
  simNodes,
  colorMixRatio,
  pcaTransform,
  zoomRange,
  onKeywordClick,
}: KeywordNodesProps) {
  const { camera } = useThree();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const matrixRef = useRef(new THREE.Matrix4());
  const positionRef = useRef(new THREE.Vector3());
  const quaternionRef = useRef(new THREE.Quaternion());
  const scaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const colorRef = useRef(new THREE.Color());

  // Create geometry once - match Three.js renderer size
  const geometry = useMemo(() => new THREE.CircleGeometry(BASE_DOT_RADIUS * DOT_SCALE_FACTOR, 64), []);

  // Update positions, scales, and colors every frame
  useFrame(() => {
    if (!meshRef.current) return;

    // Calculate scale based on camera Z position
    const cameraZ = camera.position.z;
    const scales = calculateScales(cameraZ, zoomRange);
    const keywordScale = scales.keywordScale;

    // Hide mesh entirely if below visibility threshold
    meshRef.current.visible = keywordScale >= VISIBILITY_THRESHOLD;
    if (!meshRef.current.visible) return;

    for (let i = 0; i < simNodes.length; i++) {
      const node = simNodes[i];

      // Update position from simulation
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = 0;

      // Compose matrix with position and scale
      positionRef.current.set(x, y, z);
      scaleRef.current.setScalar(keywordScale);
      matrixRef.current.compose(positionRef.current, quaternionRef.current, scaleRef.current);
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
      frustumCulled={false}
      onClick={(e) => {
        e.stopPropagation();
        const instanceId = e.instanceId;
        if (instanceId !== undefined && simNodes[instanceId]) {
          onKeywordClick?.(simNodes[instanceId].label);
        }
      }}
    >
      {/* Important: do not reactivate the following line that is commented out. Doing so causes the dots to be black. */}
      {/* <meshBasicMaterial vertexColors transparent depthTest={false} /> */}
    </instancedMesh>
  );
}
