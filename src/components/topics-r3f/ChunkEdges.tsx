/**
 * Chunk containment edge rendering (keyword → chunk connections).
 * Uses single merged BufferGeometry with zoom-based opacity.
 * Hidden when zoomed out, fades in as camera zooms in.
 */

import { useRef, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import { computeArcPoints } from "@/lib/edge-curves";
import { getEdgeColor } from "@/lib/edge-colors";
import { groupNodesByCommunity } from "@/lib/hull-renderer";
import { computeClusterColors } from "@/lib/semantic-colors";
import { CHUNK_Z_DEPTH } from "@/lib/chunk-zoom-config";

const EDGE_SEGMENTS = 16;
const VERTICES_PER_EDGE = EDGE_SEGMENTS + 1;

// Zoom-based opacity calculation (matches Three.js chunk-scale.ts)
function calculateChunkEdgeOpacity(cameraZ: number): number {
  // From chunk-scale.ts: invT = 1 - normalizeZoom(cameraZ, range)
  // range.min = 100, range.max = 1500
  const zoomMin = 100;
  const zoomMax = 1500;
  const normalized = Math.max(0, Math.min(1, (cameraZ - zoomMin) / (zoomMax - zoomMin)));
  const invT = 1 - normalized;
  return invT ** 2; // Exponential fade (chunkEdgeOpacity formula)
}

export interface ChunkEdgesProps {
  simNodes: SimNode[];
  chunkNodes: SimNode[];
  curveIntensity: number;
  curveDirections: Map<string, number>;
  colorMixRatio: number;
  pcaTransform?: PCATransform;
}

export function ChunkEdges({
  simNodes,
  chunkNodes,
  curveIntensity,
  curveDirections,
  colorMixRatio,
  pcaTransform,
}: ChunkEdgesProps): React.JSX.Element | null {
  const lineRef = useRef<THREE.Line>(null);
  const tempColor = useRef(new THREE.Color());
  const { camera } = useThree();

  // Create containment edges (keyword → chunk) from chunk parentId
  const containmentEdges = useMemo(() => {
    const edges: SimLink[] = [];
    for (const chunk of chunkNodes) {
      // ChunkSimNode has parentId field
      const parentId = (chunk as any).parentId;
      if (parentId) {
        edges.push({
          source: parentId,
          target: chunk.id,
        });
      }
    }
    return edges;
  }, [chunkNodes]);

  // Combined node map (keywords + chunks)
  const nodeMap = useMemo(
    () => new Map([...simNodes, ...chunkNodes].map((n) => [n.id, n])),
    [simNodes, chunkNodes]
  );

  const clusterColors = useMemo(() => {
    if (!pcaTransform) return undefined;
    return computeClusterColors(groupNodesByCommunity(simNodes), pcaTransform);
  }, [simNodes, pcaTransform]);

  const geometry = useMemo(() => {
    const totalVertices = containmentEdges.length * VERTICES_PER_EDGE;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(totalVertices * 3), 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(totalVertices * 3), 3));
    return geom;
  }, [containmentEdges.length]);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    // Calculate zoom-based opacity
    const cameraZ = camera.position.z;
    const opacity = calculateChunkEdgeOpacity(cameraZ);

    // Update material opacity
    const material = line.material as THREE.LineBasicMaterial;
    material.opacity = opacity;

    // Early exit if invisible (zoomed out too far)
    if (opacity < 0.01) {
      line.visible = false;
      return;
    }
    line.visible = true;

    const posArray = line.geometry.attributes.position.array as Float32Array;
    const colArray = line.geometry.attributes.color.array as Float32Array;

    for (let edgeIndex = 0; edgeIndex < containmentEdges.length; edgeIndex++) {
      const edge = containmentEdges[edgeIndex];
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

      if (arcPoints.length >= VERTICES_PER_EDGE) {
        // Curved line - use all arc points directly
        for (let i = 0; i < VERTICES_PER_EDGE; i++) {
          const idx = baseOffset + i * 3;
          posArray[idx] = arcPoints[i].x;
          posArray[idx + 1] = arcPoints[i].y;
          posArray[idx + 2] = CHUNK_Z_DEPTH; // Chunks are behind keywords
        }
      } else {
        // Straight line (2 points) - interpolate all 17 vertices uniformly
        const first = arcPoints[0];
        const last = arcPoints[arcPoints.length - 1];
        for (let i = 0; i < VERTICES_PER_EDGE; i++) {
          const idx = baseOffset + i * 3;
          const t = i / (VERTICES_PER_EDGE - 1);
          posArray[idx] = first.x + t * (last.x - first.x);
          posArray[idx + 1] = first.y + t * (last.y - first.y);
          posArray[idx + 2] = CHUNK_Z_DEPTH;
        }
      }

      tempColor.current.set(getEdgeColor(edge, nodeMap, pcaTransform, clusterColors, colorMixRatio));
      for (let i = 0; i < VERTICES_PER_EDGE; i++) {
        tempColor.current.toArray(colArray, baseOffset + i * 3);
      }
    }

    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.attributes.color.needsUpdate = true;
  });

  // Don't render if no chunk edges
  if (containmentEdges.length === 0) {
    return null;
  }

  return (
    <line ref={lineRef} geometry={geometry} renderOrder={-2}>
      <lineBasicMaterial vertexColors transparent opacity={0} depthTest={false} />
    </line>
  );
}
