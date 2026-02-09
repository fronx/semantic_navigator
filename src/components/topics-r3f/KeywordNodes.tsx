/**
 * Keyword node rendering using instancedMesh.
 * Updates positions imperatively in useFrame from simulation nodes.
 */

import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode } from "@/lib/map-renderer";
import type { PCATransform, ClusterColorInfo } from "@/lib/semantic-colors";
import type { ZoomRange } from "@/lib/zoom-phase-config";
import type { KeywordTierMap } from "@/lib/topics-filter";
import type { FocusState } from "@/lib/focus-mode";
import { calculateScales } from "@/lib/content-scale";
import { getNodeColor, BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";
import { KEYWORD_TIER_SCALES } from "@/lib/semantic-filter-config";
import { useInstancedMeshMaterial } from "@/hooks/useInstancedMeshMaterial";
import { useStableInstanceCount } from "@/hooks/useStableInstanceCount";
import { perspectiveUnitsPerPixel, maxScaleForScreenSize } from "@/lib/screen-size-clamp";
import { isDarkMode } from "@/lib/theme";
import {
  computeViewportZones,
  clampToBounds,
  isInViewport,
  isInCliffZone,
} from "@/lib/edge-pulling";
import { computeKeywordPullState } from "@/lib/keyword-pull-state";
import { handleKeywordClick, handleKeywordHover } from "@/lib/keyword-interaction-handlers";

const VISIBILITY_THRESHOLD = 0.01;
/** Max screen-pixel diameter for a keyword dot (prevents dots from dominating at close zoom) */
const MAX_DOT_SCREEN_PX = 40;

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
  /** Cluster colors for consistent coloring with labels */
  clusterColors?: Map<number, ClusterColorInfo>;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Handler for keyword node click */
  onKeywordClick?: (keywordId: string) => void;
  /** Handler for keyword node hover */
  onKeywordHover?: (keywordId: string | null) => void;
  /** Currently hovered keyword ID (shared with labels for synchronized glow) */
  hoveredKeywordIdRef?: React.MutableRefObject<string | null>;
  /** Adjacency map for edge pulling (node ID -> neighbors) */
  adjacencyMap?: Map<string, Array<{ id: string; similarity: number }>>;
  /** Shared ref for pulled node positions (written here, read by edges + labels) */
  pulledPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
  /** Ref for flyTo animation (clicking pulled node navigates to real position) */
  flyToRef?: React.MutableRefObject<((x: number, y: number) => void) | null>;
  /** Keywords to pull because their content cards are in-viewport (written by ContentNodes, read here) */
  contentDrivenKeywordIdsRef?: React.RefObject<Set<string>>;
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
  clusterColors,
  searchOpacities,
  onKeywordClick,
  onKeywordHover,
  hoveredKeywordIdRef,
  adjacencyMap,
  pulledPositionsRef,
  flyToRef,
  contentDrivenKeywordIdsRef,
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
  const glowTarget = useMemo(() => new THREE.Color(), []);

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

    // Compute max scale so dots don't exceed MAX_DOT_SCREEN_PX on screen
    const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov);
    const unitsPerPixel = perspectiveUnitsPerPixel(fov, cameraZ, size.height);
    const maxScale = maxScaleForScreenSize(BASE_DOT_RADIUS * DOT_SCALE_FACTOR * 2, MAX_DOT_SCREEN_PX, unitsPerPixel);

    // Edge pulling: classify nodes and pull cliff/off-screen nodes to the edge
    const zones = computeViewportZones(camera as THREE.PerspectiveCamera, size.width, size.height);

    const { pulledMap } = computeKeywordPullState({
      simNodes,
      adjacencyMap,
      zones,
      contentDrivenKeywordIds: contentDrivenKeywordIdsRef?.current,
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
      // Clean up: remove keywords no longer in margin set (e.g., clicked margin keyword became focus center)
      // INVARIANT: focusPositionsRef must only contain keywords in marginNodeIds.
      // When a margin keyword is clicked, it moves from marginNodeIds to focusedNodeIds.
      // Without this cleanup, the keyword would remain at its margin position (viewport edge)
      // instead of its natural position, preventing the camera from centering on it properly.
      // See: src/lib/__tests__/focus-mode.test.ts → "clicking a margin keyword"
      for (const nodeId of Array.from(focusPositionsRef.current.keys())) {
        if (!focusState.marginNodeIds.has(nodeId)) {
          focusPositionsRef.current.delete(nodeId);
        }
      }

      // Update positions for current margin nodes
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

      // Position priority: focus animation > pulled (edge pulling) > natural
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

      // Hide margin dots entirely in focus mode; reduce pulled nodes
      if (isFocusMargin) {
        scaleMultiplier = 0;
      } else if (isPulled) {
        scaleMultiplier *= 0.6;
      }

      const finalScale = Math.min(keywordScale * scaleMultiplier * keywordSizeMultiplier, maxScale);

      // Compose matrix with position and scale
      positionRef.current.set(x, y, 0);
      scaleRef.current.setScalar(finalScale);
      matrixRef.current.compose(positionRef.current, quaternionRef.current, scaleRef.current);
      meshRef.current.setMatrixAt(i, matrixRef.current);

      // Update color
      const color = getNodeColor(
        node,
        pcaTransform ?? undefined,
        clusterColors,
        colorMixRatio,
        undefined, // getParentNode not needed for keywords
        colorDesaturation
      );
      colorRef.current.set(color);

      // Reduce opacity for margin nodes (focus) or pulled nodes (edge pulling)
      if (isFocusMargin) {
        colorRef.current.multiplyScalar(0.4);
      } else if (isPulled) {
        colorRef.current.multiplyScalar(0.4);
      }

      // Apply opacity for distant keywords (dimmed for navigation)
      if (keywordTiers) {
        const tier = keywordTiers.get(node.id);
        if (tier === "neighbor-2") {
          colorRef.current.multiplyScalar(0.6);
        } else if (tier === "neighbor-3") {
          colorRef.current.multiplyScalar(0.35);
        }
      }

      // Apply search opacity if search is active
      if (searchOpacities && searchOpacities.size > 0) {
        const searchOpacity = searchOpacities.get(node.id) ?? 1.0;
        colorRef.current.multiplyScalar(searchOpacity);
      }

      // Soft glow when hovered (matches label glow behavior)
      if (hoveredKeywordIdRef?.current === node.id) {
        glowTarget.set(isDarkMode() ? 0xffffff : 0x000000);
        colorRef.current.lerp(glowTarget, 0.35);
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

  const handlePointerOver = (event: any) => {
    event.stopPropagation();
    const instanceId = event.instanceId;
    if (instanceId === undefined || instanceId < 0 || instanceId >= simNodes.length) return;

    // Use shared handler for consistent behavior with labels
    handleKeywordHover({
      node: simNodes[instanceId],
      onKeywordHover,
    });
  };

  const handlePointerOut = (event: any) => {
    event.stopPropagation();

    // Use shared handler for consistent behavior with labels
    handleKeywordHover({
      node: null,
      onKeywordHover,
    });
  };

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

    // Use shared handler for consistent behavior with labels
    handleKeywordClick({
      node: clickedNode,
      focusPositionsRef,
      pulledPositionsRef,
      flyToRef,
      onKeywordClick,
    });
  };

  return (
    <instancedMesh
      key={meshKey}
      ref={handleMeshRef}
      args={[geometry, undefined, stableCount]}
      frustumCulled={false}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      {/* Important: do not reactivate the following line that is commented out. Doing so causes the dots to be black. */}
      {/* <meshBasicMaterial vertexColors transparent depthTest={false} /> */}
    </instancedMesh>
  );
}
