/**
 * Content node rendering using instancedMesh.
 * Renders content nodes on a separate Z plane behind keywords.
 * Scales up as camera zooms in (inverse of keyword scaling).
 */

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode } from "@/lib/map-renderer";
import type { ContentSimNode } from "@/lib/content-layout";
import type { PCATransform } from "@/lib/semantic-colors";
import type { ZoomRange } from "@/lib/zoom-phase-config";
import type { ContentScreenRect } from "./R3FLabelContext";
import { CONTENT_Z_DEPTH } from "@/lib/content-zoom-config";
import { calculateScales } from "@/lib/content-scale";
import { getNodeColor, BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/three/node-renderer";
import { useInstancedMeshMaterial } from "@/hooks/useInstancedMeshMaterial";
import { useStableInstanceCount } from "@/hooks/useStableInstanceCount";
import { adjustContrast } from "@/lib/colors";
import { isDarkMode } from "@/lib/theme";
import {
  computeViewportZones,
  isInViewport,
  isInCliffZone,
} from "@/lib/viewport-edge-magnets";
import { computeContentPullState } from "@/lib/content-pull-state";
import { useFadingMembership } from "@/hooks/useFadingMembership";

const VISIBILITY_THRESHOLD = 0.01;
const CARD_HEIGHT_SCALE = 4;
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const CARD_CORNER_RATIO = 0.08;

export interface ContentNodesProps {
  /** Total node count for stable instancedMesh allocation (from contentsByKeyword at parent) */
  nodeCount: number;
  contentNodes: SimNode[];
  simNodes: SimNode[];
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform: PCATransform | null;
  zoomRange: ZoomRange;
  /** Z-depth offset for content nodes (negative = behind keywords) */
  contentZDepth?: number;
  /** Panel material thickness (shader parameter, 0-20) */
  panelThickness?: number;
  /**
   * Scale factor for converting panel thickness to content text depth offset.
   * Positive values move text toward keywords (away from camera).
   * Negative values move text toward camera (away from keywords).
   */
  contentTextDepthScale?: number;
  /** Size multiplier for content nodes (default 1.5) */
  contentSizeMultiplier?: number;
  /** Text contrast for adjusting background brightness: 0 = low contrast, 1 = high contrast */
  contentTextContrast?: number;
  /** Ref to share content screen rects with label system (data sharing, not duplication) */
  contentScreenRectsRef?: React.MutableRefObject<Map<string, ContentScreenRect>>;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Shared ref for pulled content positions (written here, read by content edges) */
  pulledContentPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
  /** Focus-animated positions — keywords in this map are margin-pushed, exclude from primary set */
  focusPositionsRef?: React.RefObject<Map<string, { x: number; y: number }>>;
  /** Set of content node IDs currently visible (written here, read by 3D text labels) */
  visibleContentIdsRef?: React.MutableRefObject<Set<string>>;
  /** Set of primary keyword IDs (written here, read by content edges) */
  primaryKeywordIdsRef?: React.MutableRefObject<Set<string>>;
  /** Keywords to pull because their content cards are in-viewport (written here, read by KeywordNodes next frame) */
  contentDrivenKeywordIdsRef?: React.MutableRefObject<Set<string>>;
}

export function ContentNodes({
  nodeCount,
  contentNodes,
  simNodes,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  zoomRange,
  contentZDepth = CONTENT_Z_DEPTH,
  panelThickness = 0,
  contentTextDepthScale = -15.0,
  contentSizeMultiplier = 1.5,
  contentTextContrast = 0.7,
  contentScreenRectsRef,
  searchOpacities,
  pulledContentPositionsRef,
  focusPositionsRef,
  visibleContentIdsRef,
  primaryKeywordIdsRef,
  contentDrivenKeywordIdsRef,
}: ContentNodesProps) {
  const { camera, size, viewport } = useThree();

  const { stableCount, meshKey } = useStableInstanceCount(nodeCount);

  const { meshRef, handleMeshRef } = useInstancedMeshMaterial(stableCount);
  const matrixRef = useRef(new THREE.Matrix4());
  const positionRef = useRef(new THREE.Vector3());
  const quaternionRef = useRef(new THREE.Quaternion());
  const scaleRef = useRef(new THREE.Vector3(1, 1, 1));
  const colorRef = useRef(new THREE.Color());

  // Animated fade for content nodes entering/leaving visibility
  // Reads visibleContentIdsRef (written below in useFrame) — one frame behind, which is fine for smooth animation
  const contentFadeRef = useFadingMembership(visibleContentIdsRef);

  // Build map for O(1) parent keyword lookups
  const keywordMap = useMemo(
    () => new Map(simNodes.map((n) => [n.id, n])),
    [simNodes]
  );

  // Content nodes are larger than keywords
  const contentRadius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR * contentSizeMultiplier;
  const cardHeight = contentRadius * CARD_HEIGHT_SCALE;
  const cardWidth = cardHeight * GOLDEN_RATIO;
  const halfWidth = cardWidth / 2;
  const halfHeight = cardHeight / 2;

  // Create rounded rectangle geometry
  const geometry = useMemo(() => {
    const radius = Math.min(cardWidth, cardHeight) * CARD_CORNER_RATIO;
    const shape = new THREE.Shape();
    const localHalfWidth = cardWidth / 2;
    const localHalfHeight = cardHeight / 2;
    const x = -localHalfWidth;
    const y = -localHalfHeight;

    shape.moveTo(x + radius, y);
    shape.lineTo(x + cardWidth - radius, y);
    shape.quadraticCurveTo(x + cardWidth, y, x + cardWidth, y + radius);
    shape.lineTo(x + cardWidth, y + cardHeight - radius);
    shape.quadraticCurveTo(x + cardWidth, y + cardHeight, x + cardWidth - radius, y + cardHeight);
    shape.lineTo(x + radius, y + cardHeight);
    shape.quadraticCurveTo(x, y + cardHeight, x, y + cardHeight - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);

    return new THREE.ShapeGeometry(shape);
  }, [cardWidth, cardHeight]);

  // Update positions, scales, and colors every frame
  useFrame(() => {
    if (!meshRef.current) return;

    // Calculate scale based on camera Z position
    const cameraZ = camera.position.z;
    const scales = calculateScales(cameraZ, zoomRange);
    const contentScale = scales.contentScale;

    // Hide mesh entirely if below visibility threshold
    meshRef.current.visible = contentScale >= VISIBILITY_THRESHOLD;
    if (!meshRef.current.visible) return;

    // Viewport edge magnets: pull off-screen content nodes to viewport edge
    const zones = computeViewportZones(camera as THREE.PerspectiveCamera, size.width, size.height);

    // Primary keywords: in viewport, not margin-pushed by focus mode
    const focusPositions = focusPositionsRef?.current;
    const primaryKeywordIds = new Set<string>();
    for (const kwNode of simNodes) {
      if (focusPositions?.has(kwNode.id)) continue;
      const x = kwNode.x ?? 0;
      const y = kwNode.y ?? 0;
      if (isInViewport(x, y, zones.extendedViewport) && !isInCliffZone(x, y, zones.pullBounds)) {
        primaryKeywordIds.add(kwNode.id);
      }
    }

    // Share primary keyword IDs with content edges for filtering
    if (primaryKeywordIdsRef) {
      primaryKeywordIdsRef.current = primaryKeywordIds;
    }

    // Content-driven keyword pulling: when zoomed past crossfade "Full" threshold,
    // content cards in the viewport keep their off-screen parent keywords visible
    const contentDrivenActive = cameraZ <= zoomRange.near;
    const contentDrivenNodeIds = new Set<string>();
    if (contentDrivenKeywordIdsRef) {
      const nextKwIds = new Set<string>();
      if (contentDrivenActive) {
        for (const node of contentNodes) {
          const cx = node.x ?? 0;
          const cy = node.y ?? 0;
          if (!isInViewport(cx, cy, zones.viewport)) continue;

          const cNode = node as ContentSimNode;
          const hasVisibleParent = cNode.parentIds.some((pid: string) => primaryKeywordIds.has(pid));
          if (hasVisibleParent) continue; // Already handled by normal flow

          // Content card is in viewport but all parents are off-screen → pull parents
          for (const parentId of cNode.parentIds) {
            nextKwIds.add(parentId);
          }
          contentDrivenNodeIds.add(node.id);
        }
      }
      contentDrivenKeywordIdsRef.current = nextKwIds;
    }

    const pulledContentMap = computeContentPullState({
      contentNodes,
      primaryKeywordIds,
      zones,
    });

    if (visibleContentIdsRef) {
      visibleContentIdsRef.current.clear();
    }

    // Write pulled content positions to shared ref (for content edges)
    if (pulledContentPositionsRef) {
      pulledContentPositionsRef.current.clear();
    }

    // Calculate Z position for text labels based on transmission panel blur
    // Converts panel thickness (shader units 0-20) to world-space offset
    //
    // Direction (scene: camera at z=1000, content nodes at z=500, keywords at z=0):
    // - Positive contentTextDepthScale: textFrontZ decreases (500 → 400)
    //   Moves text AWAY from camera, TOWARD keywords (visual "front face")
    // - Negative contentTextDepthScale: textFrontZ increases (500 → 600)
    //   Moves text TOWARD camera, AWAY from keywords
    // - Zero: textFrontZ = contentZDepth (text at content center plane)
    const physicalThickness = panelThickness * contentTextDepthScale;
    const textFrontZ = contentZDepth - physicalThickness;

    // Clear screen rects map before populating with current frame data
    if (contentScreenRectsRef) {
      contentScreenRectsRef.current.clear();
    }

    const contentFade = contentFadeRef.current;

    for (let i = 0; i < contentNodes.length; i++) {
      const node = contentNodes[i] as ContentSimNode;

      // Visible if parent keyword is primary OR content-driven mode keeps it on-screen
      const hasVisibleParent = node.parentIds.some((parentId: string) => primaryKeywordIds.has(parentId));
      const isContentDriven = contentDrivenNodeIds.has(node.id);
      const isVisible = hasVisibleParent || isContentDriven;
      if (isVisible) {
        visibleContentIdsRef?.current.add(node.id);
      }

      // Animated fade: nodes that just left visibility continue rendering at decreasing scale
      const fadeOpacity = contentFade.get(node.id) ?? 0;
      if (!isVisible && fadeOpacity < 0.005) {
        // Fully faded out — hide
        positionRef.current.set(0, 0, 0);
        scaleRef.current.setScalar(0);
        matrixRef.current.compose(positionRef.current, quaternionRef.current, scaleRef.current);
        meshRef.current.setMatrixAt(i, matrixRef.current);
        continue;
      }

      // Check if this node is pulled to viewport edge
      const pulledData = pulledContentMap.get(node.id);
      const isPulled = !!pulledData;

      if (pulledContentPositionsRef && pulledData) {
        const connectedPrimaryIds = node.parentIds.filter((parentId: string) =>
          primaryKeywordIds.has(parentId)
        );
        pulledContentPositionsRef.current.set(node.id, {
          x: pulledData.x,
          y: pulledData.y,
          connectedPrimaryIds,
        });
      }

      // Use clamped position if pulled, otherwise real position
      const x = isPulled ? pulledData.x : (node.x ?? 0);
      const y = isPulled ? pulledData.y : (node.y ?? 0);
      const z = contentZDepth;

      // Scale with zoom — grows from 0 (far) to 1 (close) via contentScale
      let nodeScale = contentScale;

      // Reduce scale for pulled nodes (dimmer and smaller)
      if (isPulled) {
        nodeScale *= 0.6;
      }

      if (searchOpacities && searchOpacities.size > 0) {
        let maxSearchOpacity = 0;
        for (const parentId of node.parentIds) {
          const opacity = searchOpacities.get(parentId) ?? 1.0;
          maxSearchOpacity = Math.max(maxSearchOpacity, opacity);
        }
        nodeScale *= maxSearchOpacity;
      }

      // Apply fade for smooth enter/exit transitions
      nodeScale *= fadeOpacity;

      // Compose matrix with position and scale
      positionRef.current.set(x, y, z);
      scaleRef.current.setScalar(nodeScale);
      matrixRef.current.compose(positionRef.current, quaternionRef.current, scaleRef.current);
      meshRef.current.setMatrixAt(i, matrixRef.current);

      // Get color from primary parent keyword (first in list)
      const primaryParentId = node.parentIds[0];
      const parentNode = primaryParentId ? keywordMap.get(primaryParentId) : undefined;
      if (parentNode) {
        const color = getNodeColor(
          parentNode,
          pcaTransform ?? undefined,
          undefined,
          colorMixRatio,
          undefined, // getParentNode not needed
          colorDesaturation
        );

        colorRef.current.set(color);
      } else {
        // Fallback gray if parent not found
        colorRef.current.set("#e0e0e0");
      }

      // Adjust background brightness for text readability
      colorRef.current.set(
        adjustContrast(colorRef.current.getHexString(), contentTextContrast, isDarkMode())
      );

      // Reduce opacity for pulled nodes (dimmer appearance)
      if (isPulled) {
        colorRef.current.multiplyScalar(0.4);
      }

      // Apply search opacity from parent keywords (use max across all parents)
      if (searchOpacities && searchOpacities.size > 0) {
        let maxSearchOpacity = 0;
        for (const parentId of node.parentIds) {
          const opacity = searchOpacities.get(parentId) ?? 1.0;
          maxSearchOpacity = Math.max(maxSearchOpacity, opacity);
        }
        colorRef.current.multiplyScalar(maxSearchOpacity);
      }

      // Apply fade to color for smooth enter/exit transitions
      if (fadeOpacity < 1) {
        colorRef.current.multiplyScalar(fadeOpacity);
      }

      meshRef.current.setColorAt(i, colorRef.current);

      // Calculate screen rect for label positioning (data sharing with label system)
      if (contentScreenRectsRef) {
        // Project center to screen space using front Z (where text labels should appear)
        // This aligns text with the visual "front face" of the cube-like appearance
        const centerWorld = new THREE.Vector3(x, y, textFrontZ);
        centerWorld.project(camera);

        // Project edge point to get accurate screen size (accounts for perspective)
        // Use same Z as center for consistent text positioning
        // Note: use nodeScale (includes search opacity) not contentScale
        const edgeWorldX = new THREE.Vector3(x + halfWidth * nodeScale, y, textFrontZ);
        const edgeWorldY = new THREE.Vector3(x, y + halfHeight * nodeScale, textFrontZ);
        edgeWorldX.project(camera);
        edgeWorldY.project(camera);

        // Convert NDC to CSS pixels (not drawing buffer pixels)
        // Note: size from R3F is in rendering pixels, may include DPR
        // For CSS pixel accuracy, we use the ratio which cancels out DPR
        const screenCenterX = ((centerWorld.x + 1) / 2) * size.width;
        const screenCenterY = ((1 - centerWorld.y) / 2) * size.height;

        const screenEdgeX = ((edgeWorldX.x + 1) / 2) * size.width;
        const screenEdgeY = ((1 - edgeWorldY.y) / 2) * size.height;

        // Calculate half-width from center to edge, then full width
        const screenHalfWidth = Math.abs(screenEdgeX - screenCenterX);
        const screenHalfHeight = Math.abs(screenEdgeY - screenCenterY);
        const screenWidth = screenHalfWidth * 2;
        const screenHeight = screenHalfHeight * 2;

        // Each content node appears only once (no duplicates), so use node.id directly
        contentScreenRectsRef.current.set(node.id, {
          x: screenCenterX,
          y: screenCenterY,
          width: screenWidth,
          height: screenHeight,
          z: textFrontZ, // Front Z for text alignment
        });
      }
    }

    // Hide unused instances (stableCount may exceed contentNodes.length after filtering)
    for (let i = contentNodes.length; i < stableCount; i++) {
      positionRef.current.set(0, 0, 0);
      scaleRef.current.setScalar(0);
      matrixRef.current.compose(positionRef.current, quaternionRef.current, scaleRef.current);
      meshRef.current.setMatrixAt(i, matrixRef.current);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  if (contentNodes.length === 0) return null;

  return (
    <instancedMesh
      key={meshKey}
      ref={handleMeshRef}
      args={[geometry, undefined, stableCount]}
      frustumCulled={false}
    >
      {/* Important: do not reactivate the following line that is commented out. Doing so causes the dots to be black. */}
      {/* <meshBasicMaterial vertexColors transparent depthTest={false} /> */}
    </instancedMesh>
  );
}
