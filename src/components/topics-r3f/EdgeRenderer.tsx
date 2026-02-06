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
}: EdgeRendererProps): React.JSX.Element | null {
  const lineRef = useRef<THREE.Line>(null);
  const tempColor = useRef(new THREE.Color());
  const { camera } = useThree();

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

    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      const sourceId = getLinkNodeId(edge.source);
      const targetId = getLinkNodeId(edge.target);
      const sourceNode = nodeMap.get(sourceId);
      const targetNode = nodeMap.get(targetId);
      if (!sourceNode || !targetNode) continue;

      const direction = curveDirections.get(`${sourceId}->${targetId}`) ?? 1;
      const arcPoints = computeArcPoints(
        { x: sourceNode.x ?? 0, y: sourceNode.y ?? 0 },
        { x: targetNode.x ?? 0, y: targetNode.y ?? 0 },
        curveIntensity,
        direction,
        EDGE_SEGMENTS
      );

      const baseOffset = edgeIndex * VERTICES_PER_EDGE * 3;

      // Write arc positions
      if (arcPoints.length >= ARC_VERTEX_COUNT) {
        for (let i = 0; i < ARC_VERTEX_COUNT; i++) {
          const idx = baseOffset + i * 3;
          posArray[idx] = arcPoints[i].x;
          posArray[idx + 1] = arcPoints[i].y;
          posArray[idx + 2] = zDepth;
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
          posArray[idx + 2] = zDepth;
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
