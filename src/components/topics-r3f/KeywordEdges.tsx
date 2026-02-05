/**
 * Keyword edge rendering using merged BufferGeometry.
 * Renders all edges in a single draw call with curved lines.
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import { computeArcPoints } from "@/lib/edge-curves";
import { getEdgeColor } from "@/lib/edge-colors";
import { groupNodesByCommunity } from "@/lib/hull-renderer";
import { computeClusterColors } from "@/lib/semantic-colors";

const EDGE_SEGMENTS = 16;
// +1 for the arc points, +1 for a NaN "break" vertex to separate edges
const VERTICES_PER_EDGE = EDGE_SEGMENTS + 2;

export interface KeywordEdgesProps {
  simNodes: SimNode[];
  edges: SimLink[];
  curveIntensity: number;
  curveDirections: Map<string, number>;
  colorMixRatio: number;
  pcaTransform?: PCATransform;
  /** Show k-NN connectivity edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
}

export function KeywordEdges({
  simNodes,
  edges,
  curveIntensity,
  curveDirections,
  colorMixRatio,
  pcaTransform,
  showKNNEdges = false,
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
  const visibleEdges = useMemo(() => {
    const filtered = showKNNEdges ? edges : edges.filter(e => !e.isKNN);
    return filtered;
  }, [edges, showKNNEdges]);

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

    // Debug: track straight line counts
    let straightLineCount = 0;
    const straightLineLengths: number[] = [];

    for (let edgeIndex = 0; edgeIndex < visibleEdges.length; edgeIndex++) {
      const edge = visibleEdges[edgeIndex];
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
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

      // Write arc points (17 vertices for 16 segments)
      const arcVertexCount = EDGE_SEGMENTS + 1; // 17

      // Track straight lines for debugging
      if (arcPoints.length < arcVertexCount) {
        straightLineCount++;
        const dx = (targetNode.x ?? 0) - (sourceNode.x ?? 0);
        const dy = (targetNode.y ?? 0) - (sourceNode.y ?? 0);
        const length = Math.sqrt(dx * dx + dy * dy);
        straightLineLengths.push(length);
      }

      if (arcPoints.length >= arcVertexCount) {
        // Normal curved line - use arc points directly
        for (let i = 0; i < arcVertexCount; i++) {
          const idx = baseOffset + i * 3;
          posArray[idx] = arcPoints[i].x;
          posArray[idx + 1] = arcPoints[i].y;
          posArray[idx + 2] = 0;
        }
      } else {
        // Short/straight line - interpolate to fill all vertices
        const first = arcPoints[0];
        const last = arcPoints[arcPoints.length - 1];
        for (let i = 0; i < arcVertexCount; i++) {
          const idx = baseOffset + i * 3;
          const t = i / (arcVertexCount - 1);
          posArray[idx] = first.x + t * (last.x - first.x);
          posArray[idx + 1] = first.y + t * (last.y - first.y);
          posArray[idx + 2] = 0;
        }
      }

      // Write NaN "break" vertex to prevent line connecting to next edge
      const breakIdx = baseOffset + arcVertexCount * 3;
      posArray[breakIdx] = NaN;
      posArray[breakIdx + 1] = NaN;
      posArray[breakIdx + 2] = NaN;

      tempColor.current.set(getEdgeColor(edge, nodeMap, pcaTransform, clusterColors, colorMixRatio));
      // Write colors for all vertices including break vertex (18 total)
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
