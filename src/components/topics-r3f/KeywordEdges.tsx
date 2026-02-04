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
}: KeywordEdgesProps) {
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const colorRef = useRef(new THREE.Color());

  // Build node lookup map
  const nodeMap = useMemo(
    () => new Map(simNodes.map((n) => [n.id, n])),
    [simNodes]
  );

  // Compute cluster colors from simNodes
  const clusterColors = useMemo(() => {
    if (!pcaTransform) return undefined;
    return computeClusterColors(groupNodesByCommunity(simNodes), pcaTransform);
  }, [simNodes, pcaTransform]);

  // Create geometry once - allocate space for all edges
  const geometry = useMemo(() => {
    const totalVertices = edges.length * (EDGE_SEGMENTS + 1);
    const positions = new Float32Array(totalVertices * 3);
    const colors = new Float32Array(totalVertices * 3);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    return geom;
  }, [edges.length]);

  // Update positions and colors every frame
  useFrame(() => {
    if (!geometryRef.current) return;

    const posArray = geometryRef.current.attributes.position.array as Float32Array;
    const colArray = geometryRef.current.attributes.color.array as Float32Array;

    edges.forEach((edge, edgeIndex) => {
      // Get source/target nodes
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
      const sourceNode = nodeMap.get(sourceId);
      const targetNode = nodeMap.get(targetId);
      if (!sourceNode || !targetNode) return;

      // Get curve direction for this edge
      const edgeKey = `${sourceId}->${targetId}`;
      const direction = curveDirections.get(edgeKey) ?? 1;

      // Compute arc points using shared logic
      const arcPoints = computeArcPoints(
        { x: sourceNode.x ?? 0, y: sourceNode.y ?? 0 },
        { x: targetNode.x ?? 0, y: targetNode.y ?? 0 },
        curveIntensity,
        direction,
        EDGE_SEGMENTS
      );

      // Write positions to buffer
      const offset = edgeIndex * (EDGE_SEGMENTS + 1) * 3;
      arcPoints.forEach((p, i) => {
        posArray[offset + i * 3] = p.x;
        posArray[offset + i * 3 + 1] = p.y;
        posArray[offset + i * 3 + 2] = 0;
      });

      // Get edge color using shared logic
      const colorStr = getEdgeColor(
        edge,
        nodeMap,
        pcaTransform,
        clusterColors,
        colorMixRatio
      );
      colorRef.current.set(colorStr);

      // Write colors to buffer (per-vertex, all same color)
      arcPoints.forEach((_, i) => {
        colorRef.current.toArray(colArray, offset + i * 3);
      });
    });

    geometryRef.current.attributes.position.needsUpdate = true;
    geometryRef.current.attributes.color.needsUpdate = true;
  });

  return (
    <lineSegments ref={geometryRef} geometry={geometry} renderOrder={-1}>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.4}
        depthTest={false}
      />
    </lineSegments>
  );
}
