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
const VERTICES_PER_EDGE = EDGE_SEGMENTS + 1;

export interface KeywordEdgesProps {
  simNodes: SimNode[];
  edges: SimLink[];
  curveIntensity: number;
  curveDirections: Map<string, number>;
  colorMixRatio: number;
  pcaTransform?: PCATransform;
}

export function KeywordEdges({
  simNodes,
  edges,
  curveIntensity,
  curveDirections,
  colorMixRatio,
  pcaTransform,
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

  const geometry = useMemo(() => {
    const totalVertices = edges.length * VERTICES_PER_EDGE;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(totalVertices * 3), 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(totalVertices * 3), 3));
    return geom;
  }, [edges.length]);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    const posArray = line.geometry.attributes.position.array as Float32Array;
    const colArray = line.geometry.attributes.color.array as Float32Array;

    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
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
      for (let i = 0; i < arcPoints.length; i++) {
        const idx = baseOffset + i * 3;
        posArray[idx] = arcPoints[i].x;
        posArray[idx + 1] = arcPoints[i].y;
        posArray[idx + 2] = 0;
      }

      tempColor.current.set(getEdgeColor(edge, nodeMap, pcaTransform, clusterColors, colorMixRatio));
      for (let i = 0; i < arcPoints.length; i++) {
        tempColor.current.toArray(colArray, baseOffset + i * 3);
      }
    }

    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.attributes.color.needsUpdate = true;
  });

  return (
    <line ref={lineRef} geometry={geometry} renderOrder={-1}>
      <lineBasicMaterial vertexColors transparent opacity={0.4} depthTest={false} />
    </line>
  );
}
