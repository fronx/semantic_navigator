/**
 * Shared edge rendering using merged BufferGeometry.
 * Used by KeywordEdges and ChunkEdges to avoid code duplication.
 */

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { SimLink, SimNode } from "@/lib/map-renderer";
import type { PCATransform, ClusterColorInfo } from "@/lib/semantic-colors";
import { computeArcPoints } from "@/lib/edge-curves";
import { getEdgeColor } from "@/lib/edge-colors";
import { groupNodesByCommunity } from "@/lib/hull-renderer";
import { computeClusterColors } from "@/lib/semantic-colors";
import { calculateScales } from "@/lib/content-scale";
import {
  computeViewportZones,
  isInViewport,
  isInCliffZone,
} from "@/lib/viewport-edge-magnets";
import { shouldHideEdgeForPulledEndpoints } from "@/lib/edge-visibility";

const EDGE_SEGMENTS = 16;
const ARC_VERTEX_COUNT = EDGE_SEGMENTS + 1;
const VERTICES_PER_EDGE = ARC_VERTEX_COUNT + 1; // +1 for NaN "break" vertex

/** Extract node ID from SimLink source/target (can be string or node object) */
function getLinkNodeId(ref: string | SimNode): string {
  return typeof ref === "string" ? ref : ref.id;
}

export interface EdgeRendererProps {
  /** Edges to render */
  edges: SimLink[];
  /** Map of node ID to node for position lookup */
  nodeMap: Map<string, SimNode>;
  /** Z depth for all edges */
  zDepth: number;
  /** Static opacity (0-1) or "chunk" to use zoom-based chunk opacity */
  opacity: number | "chunk";
  /** Render order (-1 for keywords, -2 for chunks) */
  renderOrder: number;
  /** Curve intensity for arcs */
  curveIntensity: number;
  /** Direction map for consistent curve directions */
  curveDirections: Map<string, number>;
  /** Color configuration */
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform?: PCATransform;
  /** Precomputed cluster colors (optional, will compute if not provided) */
  clusterColors?: Map<number, ClusterColorInfo>;
  /** Nodes for computing cluster colors if not provided */
  simNodes?: SimNode[];
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Hovered keyword ID ref — reaching edges only show for hovered node */
  hoveredKeywordIdRef?: React.RefObject<string | null>;
  /** Pulled node positions (for position overrides when rendering edges to off-screen nodes) */
  pulledPositionsRef?: React.RefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
  /** Hide edges whose source keyword is sitting in the viewport margin zone */
  suppressEdgesFromMarginKeywords?: boolean;
}

export function EdgeRenderer({
  edges,
  nodeMap,
  zDepth,
  opacity,
  renderOrder,
  curveIntensity,
  curveDirections,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  clusterColors: providedClusterColors,
  simNodes,
  searchOpacities,
  hoveredKeywordIdRef,
  pulledPositionsRef,
  suppressEdgesFromMarginKeywords = false,
}: EdgeRendererProps): React.JSX.Element | null {
  const lineRef = useRef<THREE.Line>(null);
  const tempColor = useRef(new THREE.Color());
  const { camera, size } = useThree();

  // Compute cluster colors if not provided
  const clusterColors = useMemo(() => {
    if (providedClusterColors) return providedClusterColors;
    if (!pcaTransform || !simNodes) return undefined;
    return computeClusterColors(groupNodesByCommunity(simNodes), pcaTransform);
  }, [providedClusterColors, simNodes, pcaTransform]);

  const geometry = useMemo(() => {
    const totalVertices = edges.length * VERTICES_PER_EDGE;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(totalVertices * 3), 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(totalVertices * 3), 3));
    // Set a manual bounding sphere to prevent Three.js from computing it
    // (our NaN break vertices would cause the computed radius to be NaN)
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10000);
    return geom;
  }, [edges.length]);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    // Calculate actual opacity
    let actualOpacity: number;
    if (opacity === "chunk") {
      const scales = calculateScales(camera.position.z);
      actualOpacity = scales.contentEdgeOpacity;
    } else {
      actualOpacity = opacity;
    }

    // Update material opacity
    const material = line.material as THREE.LineBasicMaterial;
    material.opacity = actualOpacity;

    // Hide if nearly invisible
    if (actualOpacity < 0.01) {
      line.visible = false;
      return;
    }
    line.visible = true;

    const posArray = line.geometry.attributes.position.array as Float32Array;
    const colArray = line.geometry.attributes.color.array as Float32Array;

    // Compute viewport bounds for edge culling (hide edges where neither node is visible)
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const zones = computeViewportZones(perspectiveCamera, size.width, size.height);
    const viewportWidth = zones.viewport.right - zones.viewport.left;
    const viewportHeight = zones.viewport.top - zones.viewport.bottom;
    const marginX = viewportWidth * 0.2;
    const marginY = viewportHeight * 0.2;
    const minX = zones.viewport.left - marginX;
    const maxX = zones.viewport.right + marginX;
    const minY = zones.viewport.bottom - marginY;
    const maxY = zones.viewport.top + marginY;

    // Hovered node ID for revealing reaching edges on hover
    const hoveredId = hoveredKeywordIdRef?.current ?? null;

    // Pulled node positions for position overrides
    const pulledPositions = pulledPositionsRef?.current ?? new Map();

    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      const sourceId = getLinkNodeId(edge.source);
      const targetId = getLinkNodeId(edge.target);
      const sourceNode = nodeMap.get(sourceId);
      const targetNode = nodeMap.get(targetId);
      const baseOffset = edgeIndex * VERTICES_PER_EDGE * 3;
      if (!sourceNode || !targetNode) {
        for (let i = 0; i < VERTICES_PER_EDGE * 3; i++) posArray[baseOffset + i] = NaN;
        continue;
      }

      // Position override for pulled nodes: use clamped position if node is pulled
      const sourcePulled = pulledPositions.get(sourceId);
      const targetPulled = pulledPositions.get(targetId);

      if (shouldHideEdgeForPulledEndpoints(sourcePulled, targetPulled)) {
        for (let i = 0; i < VERTICES_PER_EDGE * 3; i++) posArray[baseOffset + i] = NaN;
        continue;
      }

      // Skip edges if explicitly requested when the source keyword sits in the margin zone
      if (suppressEdgesFromMarginKeywords && sourceNode.type === "keyword") {
        const realX = sourceNode.x ?? 0;
        const realY = sourceNode.y ?? 0;
        const isCliffKeyword = isInViewport(realX, realY, zones.viewport) && isInCliffZone(realX, realY, zones.pullBounds);
        if (isCliffKeyword) {
          for (let i = 0; i < VERTICES_PER_EDGE * 3; i++) posArray[baseOffset + i] = NaN;
          continue;
        }
      }

      // Viewport culling: hide if neither node visible, dim if only one visible
      const sx = sourcePulled ? sourcePulled.x : (sourceNode.x ?? 0);
      const sy = sourcePulled ? sourcePulled.y : (sourceNode.y ?? 0);
      const tx = targetPulled ? targetPulled.x : (targetNode.x ?? 0);
      const ty = targetPulled ? targetPulled.y : (targetNode.y ?? 0);
      const sourceInView = sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;
      const targetInView = tx >= minX && tx <= maxX && ty >= minY && ty <= maxY;
      if (!sourceInView && !targetInView) {
        for (let i = 0; i < VERTICES_PER_EDGE * 3; i++) posArray[baseOffset + i] = NaN;
        continue;
      }
      // Edges reaching off-screen: only show when hovering the visible endpoint
      if (!sourceInView || !targetInView) {
        if (hoveredId !== sourceId && hoveredId !== targetId) {
          for (let i = 0; i < VERTICES_PER_EDGE * 3; i++) posArray[baseOffset + i] = NaN;
          continue;
        }
      }

      const direction = curveDirections.get(`${sourceId}->${targetId}`) ?? 1;
      const arcPoints = computeArcPoints(
        { x: sx, y: sy },
        { x: tx, y: ty },
        curveIntensity,
        direction,
        EDGE_SEGMENTS
      );

      // Get Z positions for source and target (support 3D edges across layers)
      // Keywords are at z=0, content nodes at their z property (or zDepth default)
      const sourceZ = sourceNode.type === "keyword" ? 0 : ((sourceNode as any).z ?? zDepth);
      const targetZ = targetNode.type === "keyword" ? 0 : ((targetNode as any).z ?? zDepth);

      // Write arc positions with interpolated Z
      if (arcPoints.length >= ARC_VERTEX_COUNT) {
        for (let i = 0; i < ARC_VERTEX_COUNT; i++) {
          const idx = baseOffset + i * 3;
          const t = i / (ARC_VERTEX_COUNT - 1); // 0 to 1 along the edge
          posArray[idx] = arcPoints[i].x;
          posArray[idx + 1] = arcPoints[i].y;
          posArray[idx + 2] = sourceZ + t * (targetZ - sourceZ); // Interpolate Z
        }
      } else {
        // Straight line case - interpolate endpoints to fill vertices
        const first = arcPoints[0];
        const last = arcPoints[arcPoints.length - 1];
        for (let i = 0; i < ARC_VERTEX_COUNT; i++) {
          const idx = baseOffset + i * 3;
          const t = i / (ARC_VERTEX_COUNT - 1);
          posArray[idx] = first.x + t * (last.x - first.x);
          posArray[idx + 1] = first.y + t * (last.y - first.y);
          posArray[idx + 2] = sourceZ + t * (targetZ - sourceZ); // Interpolate Z
        }
      }

      // Write NaN "break" vertex to prevent line connecting to next edge
      const breakIdx = baseOffset + ARC_VERTEX_COUNT * 3;
      posArray[breakIdx] = NaN;
      posArray[breakIdx + 1] = NaN;
      posArray[breakIdx + 2] = NaN;

      // Compute edge color
      const edgeColor = getEdgeColor(
        edge, nodeMap, pcaTransform, clusterColors,
        colorMixRatio, undefined, colorDesaturation
      );
      tempColor.current.set(edgeColor);

      // Apply search opacity - use minimum of source and target opacity
      if (searchOpacities && searchOpacities.size > 0) {
        const sourceOpacity = searchOpacities.get(sourceId) ?? 1.0;
        const targetOpacity = searchOpacities.get(targetId) ?? 1.0;
        tempColor.current.multiplyScalar(Math.min(sourceOpacity, targetOpacity));
      }

      // Write color to all vertices
      for (let i = 0; i < VERTICES_PER_EDGE; i++) {
        tempColor.current.toArray(colArray, baseOffset + i * 3);
      }
    }

    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.attributes.color.needsUpdate = true;
  });

  if (edges.length === 0) {
    return null;
  }

  return (
    // @ts-expect-error - R3F's <line> element is Three.js Line, not SVGLineElement
    <line ref={lineRef} geometry={geometry} renderOrder={renderOrder} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={0} depthTest={false} />
    </line>
  );
}
