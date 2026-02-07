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
const MAX_PULLED_NODES = 20;

// Screen-pixel-based constants (consistent at all zoom levels)
const PULL_LINE_PX = 50;     // from viewport edge — where pulled nodes are placed
const CLIFF_START_PX = 120;  // from viewport edge — where cliff zone begins (nodes snap to pull line)
const UI_PROXIMITY_PX = 20;  // extra margin on sides adjacent to UI chrome (sidebar left, header top)

/**
 * Clamp a node position to explicit bounds using ray-AABB intersection.
 * Casts a ray from (camX, camY) toward the node and returns the intersection
 * with the bounding box. Works for both off-screen nodes (projects inward)
 * and cliff-zone nodes (projects outward to the pull line).
 */
function clampToBounds(
  nodeX: number,
  nodeY: number,
  camX: number,
  camY: number,
  left: number,
  right: number,
  bottom: number,
  top: number,
): { x: number; y: number } {
  const dx = nodeX - camX;
  const dy = nodeY - camY;

  let tMin = Infinity;
  if (dx > 0) tMin = Math.min(tMin, (right - camX) / dx);
  else if (dx < 0) tMin = Math.min(tMin, (left - camX) / dx);
  if (dy > 0) tMin = Math.min(tMin, (top - camY) / dy);
  else if (dy < 0) tMin = Math.min(tMin, (bottom - camY) / dy);

  if (tMin === Infinity) return { x: nodeX, y: nodeY };
  return { x: camX + dx * tMin, y: camY + dy * tMin };
}

export interface KeywordNodesProps {
  /** Total node count for stable instancedMesh allocation (from nodes.length at parent) */
  nodeCount: number;
  simNodes: SimNode[];
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform: PCATransform | null;
  zoomRange: ZoomRange;
  /** Size multiplier for keyword nodes (default 1.0) */
  keywordSizeMultiplier?: number;
  keywordTiers?: KeywordTierMap | null;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Handler for keyword node click */
  onKeywordClick?: (keywordId: string) => void;
  /** Adjacency map for viewport edge magnets (node ID -> neighbors) */
  adjacencyMap?: Map<string, Array<{ id: string; similarity: number }>>;
  /** Shared ref for pulled node positions (written here, read by edges + labels) */
  pulledPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
  /** Ref for flyTo animation (clicking pulled node navigates to real position) */
  flyToRef?: React.MutableRefObject<((x: number, y: number) => void) | null>;
}

export function KeywordNodes({
  nodeCount,
  simNodes,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  zoomRange,
  keywordSizeMultiplier = 1.0,
  keywordTiers,
  searchOpacities,
  onKeywordClick,
  adjacencyMap,
  pulledPositionsRef,
  flyToRef,
}: KeywordNodesProps) {
  const { camera, size } = useThree();

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

    // Viewport edge magnets: pull off-screen neighbors to viewport edge
    const pulledMap = new Map<string, { x: number; y: number; realX: number; realY: number; connectedPrimaryIds: string[] }>();

    if (adjacencyMap && adjacencyMap.size > 0) {
      // Phase 1: Compute viewport bounds + pull/cliff zones
      const fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;
      const visibleHeight = 2 * cameraZ * Math.tan(fov / 2);
      const visibleWidth = visibleHeight * (size.width / size.height);
      const halfW = visibleWidth / 2;
      const halfH = visibleHeight / 2;
      const camX = camera.position.x;
      const camY = camera.position.y;

      // Convert screen-pixel margins to world units (zoom-independent screen feel)
      const worldPerPx = visibleWidth / size.width;
      const pullPadBase = PULL_LINE_PX * worldPerPx;
      const cliffPadBase = CLIFF_START_PX * worldPerPx;
      const uiPad = UI_PROXIMITY_PX * worldPerPx;

      // Asymmetric pull bounds (where pulled nodes sit)
      // Extra padding on left (sidebar) and top (header)
      const pullLeft   = camX - halfW + pullPadBase + uiPad;
      const pullRight  = camX + halfW - pullPadBase;
      const pullBottom = camY - halfH + pullPadBase;
      const pullTop    = camY + halfH - pullPadBase - uiPad;

      // Asymmetric cliff bounds (inner primary zone boundary)
      const cliffLeft   = camX - halfW + cliffPadBase + uiPad;
      const cliffRight  = camX + halfW - cliffPadBase;
      const cliffBottom = camY - halfH + cliffPadBase;
      const cliffTop    = camY + halfH - cliffPadBase - uiPad;

      // Phase 2: Classify primary (visible) nodes
      // All visible nodes are "primary" (trigger neighbor pulling).
      // Nodes in the cliff zone (between cliff boundary and viewport edge)
      // get pulled treatment — they snap to the pull line.
      const primarySet = new Set<string>();
      const cliffNodeIds = new Set<string>();
      for (const node of simNodes) {
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        if (x >= camX - halfW && x <= camX + halfW &&
            y >= camY - halfH && y <= camY + halfH) {
          primarySet.add(node.id);
          // In cliff zone? (outside inner primary zone but inside viewport)
          if (x < cliffLeft || x > cliffRight || y < cliffBottom || y > cliffTop) {
            cliffNodeIds.add(node.id);
          }
        }
      }

      // Phase 3: Collect off-screen neighbors
      const nodeById = new Map<string, SimNode>();
      for (const node of simNodes) nodeById.set(node.id, node);

      const candidates = new Map<string, { node: SimNode; bestSimilarity: number; connectedPrimaryIds: string[] }>();
      for (const primaryId of primarySet) {
        const neighbors = adjacencyMap.get(primaryId);
        if (!neighbors) continue;

        for (const { id: neighborId, similarity } of neighbors) {
          if (primarySet.has(neighborId)) continue; // already visible

          const neighborNode = nodeById.get(neighborId);
          if (!neighborNode) continue;

          const existing = candidates.get(neighborId);
          if (existing) {
            existing.connectedPrimaryIds.push(primaryId);
            existing.bestSimilarity = Math.max(existing.bestSimilarity, similarity);
          } else {
            candidates.set(neighborId, {
              node: neighborNode,
              bestSimilarity: similarity,
              connectedPrimaryIds: [primaryId],
            });
          }
        }
      }

      // Phase 4: Cap and clamp off-screen neighbor positions
      const sorted = Array.from(candidates.values()).sort((a, b) => b.bestSimilarity - a.bestSimilarity);
      const pulledNeighbors = sorted.slice(0, MAX_PULLED_NODES);

      for (const { node, connectedPrimaryIds } of pulledNeighbors) {
        const realX = node.x ?? 0;
        const realY = node.y ?? 0;
        const clamped = clampToBounds(realX, realY, camX, camY, pullLeft, pullRight, pullBottom, pullTop);
        pulledMap.set(node.id, {
          x: clamped.x,
          y: clamped.y,
          realX,
          realY,
          connectedPrimaryIds,
        });
      }

      // Phase 5: Cliff nodes — visible nodes in the margin zone snap to pull line
      // These are NOT capped by MAX_PULLED_NODES (they're already visible, just repositioned)
      for (const nodeId of cliffNodeIds) {
        if (pulledMap.has(nodeId)) continue; // already pulled as a neighbor
        const node = nodeById.get(nodeId);
        if (!node) continue;
        const realX = node.x ?? 0;
        const realY = node.y ?? 0;
        const clamped = clampToBounds(realX, realY, camX, camY, pullLeft, pullRight, pullBottom, pullTop);
        pulledMap.set(node.id, {
          x: clamped.x,
          y: clamped.y,
          realX,
          realY,
          connectedPrimaryIds: [], // cliff nodes are primary themselves
        });
      }
    }

    // Write pulled positions to shared ref (for edges and labels)
    if (pulledPositionsRef) {
      pulledPositionsRef.current.clear();
      for (const [id, data] of pulledMap) {
        pulledPositionsRef.current.set(id, {
          x: data.x,
          y: data.y,
          connectedPrimaryIds: data.connectedPrimaryIds,
        });
      }
    }

    // Update matrices for active nodes (simNodes.length may be less than nodeCount initially)
    for (let i = 0; i < simNodes.length; i++) {
      const node = simNodes[i];

      // Check if this node is pulled to viewport edge
      const pulledData = pulledMap.get(node.id);
      const isPulled = !!pulledData;

      // Update position (use clamped position if pulled, otherwise real position)
      const x = isPulled ? pulledData.x : (node.x ?? 0);
      const y = isPulled ? pulledData.y : (node.y ?? 0);
      const z = 0;

      // Base scale from zoom
      let scaleMultiplier = 1.0;

      // Reduce scale for pulled nodes (dimmer and smaller)
      if (isPulled) {
        scaleMultiplier *= 0.6;
      }

      // Apply tier-based scale multiplier if semantic filter active
      if (keywordTiers) {
        const tier = keywordTiers.get(node.id);
        if (tier) {
          scaleMultiplier = KEYWORD_TIER_SCALES[tier];
        }
      }

      const finalScale = keywordScale * scaleMultiplier * keywordSizeMultiplier;

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

      // Reduce opacity for pulled nodes (dimmer appearance)
      if (isPulled) {
        colorRef.current.multiplyScalar(0.4);
      }

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

    // R3F provides instanceId for instancedMesh clicks
    const instanceId = event.instanceId;
    if (instanceId === undefined || instanceId < 0 || instanceId >= simNodes.length) return;

    const clickedNode = simNodes[instanceId];

    // Check if this is a pulled node (off-screen neighbor or cliff-zone node)
    const isPulled = pulledPositionsRef?.current.has(clickedNode.id);
    if (isPulled && flyToRef?.current) {
      // Fly to the node's real (simulated) position
      flyToRef.current(clickedNode.x ?? 0, clickedNode.y ?? 0);
    } else if (onKeywordClick) {
      // Normal node: fire click handler
      onKeywordClick(clickedNode.id);
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
