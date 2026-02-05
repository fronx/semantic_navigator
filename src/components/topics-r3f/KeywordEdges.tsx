/**
 * Keyword edge rendering using merged BufferGeometry.
 * Renders all edges in a single draw call with curved lines.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { SimLink, SimNode } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import { computeArcPoints } from "@/lib/edge-curves";
import { getEdgeColor } from "@/lib/edge-colors";
import { groupNodesByCommunity } from "@/lib/hull-renderer";
import { computeClusterColors } from "@/lib/semantic-colors";

const EDGE_SEGMENTS = 16;
const ARC_VERTEX_COUNT = EDGE_SEGMENTS + 1;
const VERTICES_PER_EDGE = ARC_VERTEX_COUNT + 1; // +1 for NaN "break" vertex

/** Extract node ID from SimLink source/target (can be string or node object) */
function getLinkNodeId(ref: string | SimNode): string {
  return typeof ref === "string" ? ref : ref.id;
}

export interface KeywordEdgesProps {
  simNodes: SimNode[];
  edges: SimLink[];
  curveIntensity: number;
  curveDirections: Map<string, number>;
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform?: PCATransform;
  /** Show k-NN connectivity edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
}

export function KeywordEdges({
  simNodes,
  edges,
  curveIntensity,
  curveDirections,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  showKNNEdges = false,
  searchOpacities,
}: KeywordEdgesProps): React.JSX.Element {
  const lineRef = useRef<THREE.Line>(null);
  const tempColor = useRef(new THREE.Color());

  const nodeMap = useMemo(
    () => new Map(simNodes.map((n) => [n.id, n])),
    [simNodes]
  );

  const clusterColors = useMemo(() => {
    if (!pcaTransform) return undefined;
    return computeClusterColors(groupNodesByCommunity(simNodes), pcaTransform);
  }, [simNodes, pcaTransform]);

  // Filter k-NN connectivity edges unless explicitly enabled
  const visibleEdges = useMemo(
    () => showKNNEdges ? edges : edges.filter(e => !e.isKNN),
    [edges, showKNNEdges]
  );

  const geometry = useMemo(() => {
    const totalVertices = visibleEdges.length * VERTICES_PER_EDGE;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(totalVertices * 3), 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(totalVertices * 3), 3));
    // Set a manual bounding sphere to prevent Three.js from computing it
    // (our NaN break vertices would cause the computed radius to be NaN)
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10000);
    return geom;
  }, [visibleEdges.length]);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    const posArray = line.geometry.attributes.position.array as Float32Array;
    const colArray = line.geometry.attributes.color.array as Float32Array;

    for (let edgeIndex = 0; edgeIndex < visibleEdges.length; edgeIndex++) {
      const edge = visibleEdges[edgeIndex];
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

      // Write arc positions (interpolate if arcPoints is shorter than expected)
      if (arcPoints.length >= ARC_VERTEX_COUNT) {
        for (let i = 0; i < ARC_VERTEX_COUNT; i++) {
          const idx = baseOffset + i * 3;
          posArray[idx] = arcPoints[i].x;
          posArray[idx + 1] = arcPoints[i].y;
          posArray[idx + 2] = 0;
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
          posArray[idx + 2] = 0;
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

  return (
    // @ts-expect-error - R3F's <line> element is Three.js Line, not SVGLineElement
    <line ref={lineRef} geometry={geometry} renderOrder={-1} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent opacity={0.4} depthTest={false} />
    </line>
  );
}
