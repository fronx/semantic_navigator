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
import type { ChunkScreenRect } from "./R3FLabelContext";
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
  /** Panel material thickness (shader parameter, 0-20) */
  panelThickness?: number;
  /**
   * Scale factor for converting panel thickness to chunk text depth offset.
   * Positive values move text toward keywords (away from camera).
   * Negative values move text toward camera (away from keywords).
   */
  chunkTextDepthScale?: number;
  /** Handler for chunk click (locks/unlocks chunk label) */
  onChunkClick?: (chunkId: string) => void;
  /** Handler for chunk hover (for text preview) */
  onChunkHover?: (chunkId: string | null) => void;
  /** Ref to share chunk screen rects with label system (data sharing, not duplication) */
  chunkScreenRectsRef?: React.MutableRefObject<Map<string, ChunkScreenRect>>;
}

export function ChunkNodes({
  chunkNodes,
  simNodes,
  colorMixRatio,
  pcaTransform,
  zoomRange,
  chunkZDepth = CHUNK_Z_DEPTH,
  panelThickness = 0,
  chunkTextDepthScale = -15.0,
  onChunkClick,
  onChunkHover,
  chunkScreenRectsRef,
}: ChunkNodesProps) {
  const { camera, size, viewport } = useThree();
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

  // Create rounded square geometry
  const geometry = useMemo(() => {
    const size = chunkRadius * 2; // Square size (side length)
    const radius = chunkRadius * 0.2; // Corner radius (20% of chunk radius)

    // Create rounded rectangle shape
    const shape = new THREE.Shape();
    const x = -size / 2;
    const y = -size / 2;

    shape.moveTo(x + radius, y);
    shape.lineTo(x + size - radius, y);
    shape.quadraticCurveTo(x + size, y, x + size, y + radius);
    shape.lineTo(x + size, y + size - radius);
    shape.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
    shape.lineTo(x + radius, y + size);
    shape.quadraticCurveTo(x, y + size, x, y + size - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);

    return new THREE.ShapeGeometry(shape);
  }, [chunkRadius]);

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

    // Calculate Z position for text labels based on transmission panel blur
    // Converts panel thickness (shader units 0-20) to world-space offset
    //
    // Direction (scene: camera at z=1000, chunks at z=500, keywords at z=0):
    // - Positive chunkTextDepthScale: textFrontZ decreases (500 → 400)
    //   Moves text AWAY from camera, TOWARD keywords (visual "front face")
    // - Negative chunkTextDepthScale: textFrontZ increases (500 → 600)
    //   Moves text TOWARD camera, AWAY from keywords
    // - Zero: textFrontZ = chunkZDepth (text at chunk center plane)
    const physicalThickness = panelThickness * chunkTextDepthScale;
    const textFrontZ = chunkZDepth - physicalThickness;

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

    // Clear screen rects map before populating with current frame data
    if (chunkScreenRectsRef) {
      chunkScreenRectsRef.current.clear();
    }

    for (let i = 0; i < chunkNodes.length; i++) {
      const node = chunkNodes[i] as ChunkSimNode;

      // Position at parent keyword's location but on a different Z plane
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const z = chunkZDepth;

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

      // Calculate screen rect for label positioning (data sharing with label system)
      if (chunkScreenRectsRef) {
        // Project center to screen space using front Z (where text labels should appear)
        // This aligns text with the visual "front face" of the cube-like appearance
        const centerWorld = new THREE.Vector3(x, y, textFrontZ);
        centerWorld.project(camera);

        // Project edge point to get accurate screen size (accounts for perspective)
        // Use same Z as center for consistent text positioning
        const edgeWorld = new THREE.Vector3(x + chunkRadius * chunkScale, y, textFrontZ);
        edgeWorld.project(camera);

        // Convert NDC to CSS pixels (not drawing buffer pixels)
        // Note: size from R3F is in rendering pixels, may include DPR
        // For CSS pixel accuracy, we use the ratio which cancels out DPR
        const screenCenterX = ((centerWorld.x + 1) / 2) * size.width;
        const screenCenterY = ((1 - centerWorld.y) / 2) * size.height;

        const screenEdgeX = ((edgeWorld.x + 1) / 2) * size.width;

        // Calculate half-width from center to edge, then full width
        const screenHalfWidth = Math.abs(screenEdgeX - screenCenterX);
        const screenWidth = screenHalfWidth * 2;

        chunkScreenRectsRef.current.set(node.id, {
          x: screenCenterX,
          y: screenCenterY,
          width: screenWidth,
          height: screenWidth, // Square
          z: textFrontZ, // Front Z for text alignment
        });
      }
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  if (chunkNodes.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, chunkNodes.length]}
      frustumCulled={false}
      onClick={(e) => {
        if (!onChunkClick) return;
        e.stopPropagation();

        // Get instance index from event
        const instanceId = e.instanceId;
        if (instanceId !== undefined && instanceId < chunkNodes.length) {
          const clickedChunk = chunkNodes[instanceId];
          onChunkClick(clickedChunk.id);
        }
      }}
      onPointerOver={(e) => {
        if (!onChunkHover) return;
        e.stopPropagation();

        const instanceId = e.instanceId;
        if (instanceId !== undefined && instanceId < chunkNodes.length) {
          const hoveredChunk = chunkNodes[instanceId];
          onChunkHover(hoveredChunk.id);
        }
      }}
      onPointerOut={() => {
        if (!onChunkHover) return;
        onChunkHover(null);
      }}
    >
      {/* Important: do not reactivate the following line that is commented out. Doing so causes the dots to be black. */}
      {/* <meshBasicMaterial vertexColors transparent depthTest={false} /> */}
    </instancedMesh>
  );
}
