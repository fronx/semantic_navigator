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
import type { FocusState } from "@/lib/focus-mode";
import { calculateScales } from "@/lib/content-scale";
import { getNodeColor, BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";
import { KEYWORD_TIER_SCALES } from "@/lib/semantic-filter-config";
import { useInstancedMeshMaterial } from "@/hooks/useInstancedMeshMaterial";
import { useStableInstanceCount } from "@/hooks/useStableInstanceCount";
import {
  computeViewportZones,
  clampToBounds,
  isInViewport,
  isInCliffZone,
} from "@/lib/viewport-edge-magnets";
import { computeKeywordPullState } from "@/lib/keyword-pull-state";

const VISIBILITY_THRESHOLD = 0.01;

/** Ease-out cubic: fast start, smooth deceleration */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

interface FocusAnimationState {
  entries: Map<string, { startX: number; startY: number; targetX: number; targetY: number }>;
  startTime: number;
  duration: number;
  type: "push" | "return";
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
  /** Focus state for click-to-focus interaction */
  focusState?: FocusState | null;
  /** Shared ref for focus-animated positions (written here, read by edges + labels) */
  focusPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number }>>;
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
  /** Cross-fade value from label fade coordinator (0 = nodes full size, 1 = nodes shrunk) */
  labelFadeT?: number;
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
  focusState,
  focusPositionsRef,
  searchOpacities,
  onKeywordClick,
  adjacencyMap,
  pulledPositionsRef,
  flyToRef,
  labelFadeT = 0,
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

  // Focus animation state (ref-driven, no React re-renders)
  const focusAnimRef = useRef<FocusAnimationState | null>(null);
  const prevFocusIdRef = useRef<string | null>(null);

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

    // Viewport edge magnets: classify nodes and pull cliff/off-screen nodes to the edge
    const zones = computeViewportZones(camera as THREE.PerspectiveCamera, size.width, size.height);

    const { pulledMap } = computeKeywordPullState({
      simNodes,
      adjacencyMap,
      zones,
    });

    // Write pulled positions to shared ref (for edges and labels)
    // Skip nodes that are being managed by focus animation
    if (pulledPositionsRef) {
      pulledPositionsRef.current.clear();
      for (const [id, data] of pulledMap) {
        if (focusPositionsRef?.current.has(id)) continue;
        pulledPositionsRef.current.set(id, {
          x: data.x,
          y: data.y,
          connectedPrimaryIds: data.connectedPrimaryIds,
        });
      }
    }

    // ── Focus mode animation ──────────────────────────────────────────
    const currentFocusId = focusState?.focusedKeywordId ?? null;
    const prevFocusId = prevFocusIdRef.current;

    if (currentFocusId !== prevFocusId) {
      if (currentFocusId && focusState) {
        // Focus activated or changed → start push animation
        const entries = new Map<string, { startX: number; startY: number; targetX: number; targetY: number }>();
        for (let i = 0; i < simNodes.length; i++) {
          const node = simNodes[i];
          if (!focusState.marginNodeIds.has(node.id)) continue;
          const prevPos = focusPositionsRef?.current.get(node.id);
          const startX = prevPos?.x ?? node.x ?? 0;
          const startY = prevPos?.y ?? node.y ?? 0;
          const target = clampToBounds(
            node.x ?? 0, node.y ?? 0,
            zones.viewport.camX, zones.viewport.camY,
            zones.pullBounds.left, zones.pullBounds.right,
            zones.pullBounds.bottom, zones.pullBounds.top,
          );
          entries.set(node.id, { startX, startY, targetX: target.x, targetY: target.y });
        }
        focusAnimRef.current = { entries, startTime: performance.now(), duration: 500, type: "push" };
      } else if (prevFocusId && !currentFocusId) {
        // Focus cleared → start return animation
        const entries = new Map<string, { startX: number; startY: number; targetX: number; targetY: number }>();
        if (focusPositionsRef) {
          for (let i = 0; i < simNodes.length; i++) {
            const node = simNodes[i];
            const pos = focusPositionsRef.current.get(node.id);
            if (!pos) continue;
            entries.set(node.id, { startX: pos.x, startY: pos.y, targetX: node.x ?? 0, targetY: node.y ?? 0 });
          }
        }
        focusAnimRef.current = { entries, startTime: performance.now(), duration: 400, type: "return" };
      }
      prevFocusIdRef.current = currentFocusId;
    }

    // Run focus animation interpolation
    if (focusAnimRef.current && focusPositionsRef) {
      const anim = focusAnimRef.current;
      const elapsed = performance.now() - anim.startTime;
      const rawT = Math.min(1, elapsed / anim.duration);
      const t = easeOutCubic(rawT);

      for (const [nodeId, entry] of anim.entries) {
        focusPositionsRef.current.set(nodeId, {
          x: entry.startX + (entry.targetX - entry.startX) * t,
          y: entry.startY + (entry.targetY - entry.startY) * t,
        });
      }

      if (rawT >= 1) {
        if (anim.type === "return") {
          focusPositionsRef.current.clear();
        }
        focusAnimRef.current = null;
      }
    }

    // After push animation completes, continuously track viewport for margin nodes
    // (handles camera pan/zoom while focus is active)
    if (focusState && !focusAnimRef.current && focusPositionsRef) {
      for (let i = 0; i < simNodes.length; i++) {
        const node = simNodes[i];
        if (!focusState.marginNodeIds.has(node.id)) continue;
        const target = clampToBounds(
          node.x ?? 0, node.y ?? 0,
          zones.viewport.camX, zones.viewport.camY,
          zones.pullBounds.left, zones.pullBounds.right,
          zones.pullBounds.bottom, zones.pullBounds.top,
        );
        focusPositionsRef.current.set(node.id, { x: target.x, y: target.y });
      }
    }

    // ── Per-node matrix + color updates ───────────────────────────────
    for (let i = 0; i < simNodes.length; i++) {
      const node = simNodes[i];
      const realX = node.x ?? 0;
      const realY = node.y ?? 0;

      // Position priority: focus animation > pulled (edge magnets) > natural
      const focusPos = focusPositionsRef?.current.get(node.id);
      const pulledData = !focusPos ? pulledMap.get(node.id) : undefined;
      const isPulled = !!pulledData;
      const isFocusMargin = !!focusPos;

      // Hide cliff-zone nodes without an anchor (only when not focus-animated)
      const isCliffWithoutAnchor =
        !isFocusMargin &&
        !isPulled &&
        isInViewport(realX, realY, zones.viewport) &&
        isInCliffZone(realX, realY, zones.pullBounds);

      if (isCliffWithoutAnchor) {
        positionRef.current.set(0, 0, 0);
        scaleRef.current.setScalar(0);
        matrixRef.current.compose(positionRef.current, quaternionRef.current, scaleRef.current);
        meshRef.current.setMatrixAt(i, matrixRef.current);
        continue;
      }

      const x = focusPos?.x ?? (isPulled ? pulledData.x : realX);
      const y = focusPos?.y ?? (isPulled ? pulledData.y : realY);

      // Base scale from zoom
      let scaleMultiplier = 1.0;

      // Apply tier-based scale multiplier if semantic filter / focus active
      if (keywordTiers) {
        const tier = keywordTiers.get(node.id);
        if (tier) {
          scaleMultiplier *= KEYWORD_TIER_SCALES[tier];
        }
      }

      // Reduce scale for margin nodes (focus mode) or pulled nodes (edge magnets)
      if (isFocusMargin) {
        scaleMultiplier *= 0.6;
      } else if (isPulled) {
        scaleMultiplier *= 0.6;
      }

      const finalScale = keywordScale * scaleMultiplier * keywordSizeMultiplier * (1 - labelFadeT);

      // Compose matrix with position and scale
      positionRef.current.set(x, y, 0);
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

      // Reduce opacity for margin nodes (focus) or pulled nodes (edge magnets)
      if (isFocusMargin) {
        colorRef.current.multiplyScalar(0.4);
      } else if (isPulled) {
        colorRef.current.multiplyScalar(0.4);
      }

      // Apply opacity for 2-hop keywords (dimmed for navigation)
      if (keywordTiers) {
        const tier = keywordTiers.get(node.id);
        if (tier === "neighbor-2") {
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

    // Pulled nodes (edge magnets): fly to real position instead of click
    const isPulled = pulledPositionsRef?.current.has(clickedNode.id);
    if (isPulled && flyToRef?.current) {
      flyToRef.current(clickedNode.x ?? 0, clickedNode.y ?? 0);
      return;
    }

    // Focus margin nodes: fly to real position
    const isFocusMargin = focusPositionsRef?.current.has(clickedNode.id);
    if (isFocusMargin && flyToRef?.current) {
      flyToRef.current(clickedNode.x ?? 0, clickedNode.y ?? 0);
      return;
    }

    // Normal node: fire click handler (triggers focus mode)
    onKeywordClick?.(clickedNode.id);
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
