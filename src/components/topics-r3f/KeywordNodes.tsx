/**
 * Keyword node rendering using instancedMesh.
 * Updates positions imperatively in useFrame from simulation nodes.
 */

import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import type { ZoomRange } from "@/lib/zoom-phase-config";
import type { KeywordTierMap } from "@/lib/topics-filter";
import { calculateScales } from "@/lib/content-scale";
import { getNodeColor, BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";
import { KEYWORD_TIER_SCALES } from "@/lib/semantic-filter-config";
import { useInstancedMeshMaterial } from "@/hooks/useInstancedMeshMaterial";
import { useStableInstanceCount } from "@/hooks/useStableInstanceCount";

const VISIBILITY_THRESHOLD = 0.01;

export interface KeywordNodesProps {
  /** Total node count for stable instancedMesh allocation (from nodes.length at parent) */
  nodeCount: number;
  simNodes: SimNode[];
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform: PCATransform | null;
  zoomRange: ZoomRange;
  keywordTiers?: KeywordTierMap | null;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Handler for keyword node click */
  onKeywordClick?: (keywordId: string) => void;
}

export function KeywordNodes({
  nodeCount,
  simNodes,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  zoomRange,
  keywordTiers,
  searchOpacities,
  onKeywordClick,
}: KeywordNodesProps) {
  const { camera } = useThree();

  const { stableCount, meshKey } = useStableInstanceCount(nodeCount);

  // Track mount/unmount for debugging click issues
  useEffect(() => {
    console.log('[KeywordNodes] MOUNTED, stableCount:', stableCount, 'nodeCount:', nodeCount);
    return () => console.log('[KeywordNodes] UNMOUNTED');
  }, []);

  const { meshRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);
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

    // Update matrices for active nodes (simNodes.length may be less than nodeCount initially)
    for (let i = 0; i < simNodes.length; i++) {
      const node = simNodes[i];

      // Update position from simulation
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = 0;

      // Base scale from zoom
      let scaleMultiplier = 1.0;

      // Apply tier-based scale multiplier if semantic filter active
      if (keywordTiers) {
        const tier = keywordTiers.get(node.id);
        if (tier) {
          scaleMultiplier = KEYWORD_TIER_SCALES[tier];
        }
      }

      const finalScale = keywordScale * scaleMultiplier;

      // Compose matrix with position and scale
      positionRef.current.set(x, y, z);
      scaleRef.current.setScalar(finalScale);
      matrixRef.current.compose(positionRef.current, quaternionRef.current, scaleRef.current);
      meshRef.current.setMatrixAt(i, matrixRef.current);

      // Update color
      const color = getNodeColor(
        node,
        pcaTransform ?? undefined,
        undefined, // clusterColors not yet implemented
        colorMixRatio,
        undefined, // getParentNode not needed for keywords
        colorDesaturation
      );
      colorRef.current.set(color);

      // Apply opacity for 2-hop keywords (dimmed for navigation)
      if (keywordTiers) {
        const tier = keywordTiers.get(node.id);
        if (tier === "neighbor-2") {
          // Dim 2-hop keywords to 60% opacity
          colorRef.current.multiplyScalar(0.6);
        }
      }

      // Apply search opacity if search is active
      if (searchOpacities && searchOpacities.size > 0) {
        const searchOpacity = searchOpacities.get(node.id) ?? 1.0;
        colorRef.current.multiplyScalar(searchOpacity);
      }

      meshRef.current.setColorAt(i, colorRef.current);
    }

    // Hide unused instances by setting their scale to 0
    // This prevents raycasting issues with uninitialized instances
    for (let i = simNodes.length; i < stableCount; i++) {
      positionRef.current.set(0, 0, 0);
      scaleRef.current.setScalar(0);
      matrixRef.current.compose(positionRef.current, quaternionRef.current, scaleRef.current);
      meshRef.current.setMatrixAt(i, matrixRef.current);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }

    // InstancedMesh.raycast() checks mesh.boundingSphere (not geometry.boundingSphere).
    // Reset it each frame so it recomputes from current instance matrices.
    meshRef.current.boundingSphere = null;
  });

  // Handle click on keyword node
  const handleClick = (event: any) => {
    console.log('[KeywordNodes] onClick fired!', {
      instanceId: event.instanceId,
      simNodesLength: simNodes.length,
      hasCallback: !!onKeywordClick,
    });
    if (!onKeywordClick) return;

    // R3F provides instanceId for instancedMesh clicks
    const instanceId = event.instanceId;
    if (instanceId !== undefined && instanceId >= 0 && instanceId < simNodes.length) {
      onKeywordClick(simNodes[instanceId].id);
    }
  };

  return (
    <instancedMesh
      key={meshKey}
      ref={handleMeshRef}
      args={[geometry, undefined, stableCount]}
      frustumCulled={false}
      onClick={handleClick}
      onPointerDown={(e: any) => console.log('[KeywordNodes] onPointerDown', e.instanceId)}
      onPointerUp={(e: any) => console.log('[KeywordNodes] onPointerUp', e.instanceId)}
    >
      {/* Important: do not reactivate the following line that is commented out. Doing so causes the dots to be black. */}
      {/* <meshBasicMaterial vertexColors transparent depthTest={false} /> */}
    </instancedMesh>
  );
}
