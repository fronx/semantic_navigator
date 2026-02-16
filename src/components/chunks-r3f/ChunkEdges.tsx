import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { UmapEdge } from "@/hooks/useUmapLayout";
import { computeArcPoints, computeOutwardDirection } from "@/lib/edge-curves";
import { computeViewportZones, computeCompressionRadii } from "@/lib/edge-pulling";

const EDGE_SEGMENTS = 16;
const ARC_VERTEX_COUNT = EDGE_SEGMENTS + 1;
const VERTICES_PER_EDGE = ARC_VERTEX_COUNT + 1; // +1 for NaN break
const EDGE_COLOR = 0.533; // ~#888888
const OUTBOUND_EDGE_OFFSET = 40;

export interface ChunkEdgesProps {
  edges: UmapEdge[];
  edgesVersion: number;
  positions: Float32Array;
  opacity: number;
  focusNodeSet?: Set<number> | null;
  projectOutsideFocus?: boolean;
}

export function ChunkEdges({
  edges,
  edgesVersion,
  positions,
  opacity,
  focusNodeSet,
  projectOutsideFocus = false,
}: ChunkEdgesProps) {
  const lineRef = useRef<THREE.Line | null>(null);
  const { camera, size } = useThree();

  const geometry = useMemo(() => {
    const totalVertices = Math.max(edges.length, 1) * VERTICES_PER_EDGE;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(totalVertices * 3), 3)
    );
    geom.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(totalVertices * 4), 4)
    );
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10000);
    return geom;
  }, [edges.length, edgesVersion]);

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useFrame(() => {
    const line = lineRef.current;
    if (!line) return;

    const shouldRender =
      opacity > 0.001 &&
      edges.length > 0 &&
      positions.length >= 4;

    line.visible = shouldRender;
    if (!shouldRender) {
      return;
    }

    const positionAttr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colorAttr = line.geometry.getAttribute("color") as THREE.BufferAttribute;
    const posArray = positionAttr.array as Float32Array;
    const colArray = colorAttr.array as Float32Array;

    const nodeCount = Math.floor(positions.length / 2);
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < nodeCount; i++) {
      sumX += positions[i * 2];
      sumY += positions[i * 2 + 1];
    }
    const centroid = {
      x: nodeCount > 0 ? sumX / nodeCount : 0,
      y: nodeCount > 0 ? sumY / nodeCount : 0,
    };

    const perspCamera = camera as THREE.PerspectiveCamera;
    const zones = computeViewportZones(perspCamera, size.width, size.height);
    const viewport = zones.viewport;
    const { maxRadius } = computeCompressionRadii(zones);
    const camX = zones.viewport.camX;
    const camY = zones.viewport.camY;
    const shouldProject = Boolean(projectOutsideFocus && focusNodeSet && focusNodeSet.size > 0);
    const width = viewport.right - viewport.left;
    const height = viewport.top - viewport.bottom;
    const marginX = width * 0.2;
    const marginY = height * 0.2;
    const minX = viewport.left - marginX;
    const maxX = viewport.right + marginX;
    const minY = viewport.bottom - marginY;
    const maxY = viewport.top + marginY;

    const projectPosition = (nodeIndex: number, x: number, y: number) => {
      if (!shouldProject || focusNodeSet?.has(nodeIndex)) {
        return { x, y };
      }

      const insidePullBounds =
        x >= zones.pullBounds.left &&
        x <= zones.pullBounds.right &&
        y >= zones.pullBounds.bottom &&
        y <= zones.pullBounds.top;
      if (insidePullBounds) {
        return { x, y };
      }
      const dx = x - camX;
      const dy = y - camY;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDistance = maxRadius + OUTBOUND_EDGE_OFFSET;
      const ratio = targetDistance / distance;
      let px = camX + dx * ratio;
      let py = camY + dy * ratio;
      px = Math.max(zones.pullBounds.left, Math.min(zones.pullBounds.right, px));
      py = Math.max(zones.pullBounds.bottom, Math.min(zones.pullBounds.top, py));
      return { x: px, y: py };
    };

    let maxWeight = 0;
    for (const edge of edges) {
      if (edge.weight > maxWeight) maxWeight = edge.weight;
    }
    const weightNormalizer = maxWeight > 0 ? 1 / maxWeight : 0;

    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      const basePos = edgeIndex * VERTICES_PER_EDGE * 3;
      const baseColor = edgeIndex * VERTICES_PER_EDGE * 4;

      const sourceIdx = edge.source * 2;
      const targetIdx = edge.target * 2;

      if (
        sourceIdx + 1 >= positions.length ||
        targetIdx + 1 >= positions.length
      ) {
        for (let i = 0; i < VERTICES_PER_EDGE * 3; i++) {
          posArray[basePos + i] = Number.NaN;
        }
        for (let i = 0; i < VERTICES_PER_EDGE * 4; i++) {
          colArray[baseColor + i] = 0;
        }
        continue;
      }

      const sourceRawX = positions[sourceIdx];
      const sourceRawY = positions[sourceIdx + 1];
      const targetRawX = positions[targetIdx];
      const targetRawY = positions[targetIdx + 1];

      const sourcePoint = projectPosition(edge.source, sourceRawX, sourceRawY);
      const targetPoint = projectPosition(edge.target, targetRawX, targetRawY);

      const sourceInView =
        sourcePoint.x >= minX && sourcePoint.x <= maxX && sourcePoint.y >= minY && sourcePoint.y <= maxY;
      const targetInView =
        targetPoint.x >= minX && targetPoint.x <= maxX && targetPoint.y >= minY && targetPoint.y <= maxY;
      if (!sourceInView && !targetInView) {
        for (let i = 0; i < VERTICES_PER_EDGE * 3; i++) {
          posArray[basePos + i] = Number.NaN;
        }
        for (let i = 0; i < VERTICES_PER_EDGE * 4; i++) {
          colArray[baseColor + i] = 0;
        }
        continue;
      }

      const direction = computeOutwardDirection(
        { id: `${edge.source}`, x: sourcePoint.x, y: sourcePoint.y },
        { id: `${edge.target}`, x: targetPoint.x, y: targetPoint.y },
        centroid
      );

      const arcPoints = computeArcPoints(
        { x: sourcePoint.x, y: sourcePoint.y },
        { x: targetPoint.x, y: targetPoint.y },
        0.15,
        direction,
        EDGE_SEGMENTS
      );

      for (let i = 0; i < ARC_VERTEX_COUNT; i++) {
        const idx = basePos + i * 3;
        const point = arcPoints[i] ?? arcPoints[arcPoints.length - 1];
        posArray[idx] = point.x;
        posArray[idx + 1] = point.y;
        posArray[idx + 2] = 0;
      }

      const breakIdx = basePos + ARC_VERTEX_COUNT * 3;
      posArray[breakIdx] = Number.NaN;
      posArray[breakIdx + 1] = Number.NaN;
      posArray[breakIdx + 2] = Number.NaN;

      const normalizedWeight = weightNormalizer > 0 ? Math.min(edge.weight * weightNormalizer, 1) : 0;
      const baseAlpha = 0.05 + normalizedWeight * 0.95;
      const alpha = baseAlpha * opacity;

      for (let i = 0; i < VERTICES_PER_EDGE; i++) {
        const cIdx = baseColor + i * 4;
        colArray[cIdx] = EDGE_COLOR;
        colArray[cIdx + 1] = EDGE_COLOR;
        colArray[cIdx + 2] = EDGE_COLOR;
        colArray[cIdx + 3] = alpha;
      }
    }

    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  });

  if (edges.length === 0 || positions.length < 4) {
    return null;
  }

  return (
    // @ts-expect-error Three.js line primitive
    <line ref={lineRef} geometry={geometry} frustumCulled={false} renderOrder={-2}>
      <lineBasicMaterial vertexColors transparent depthTest={false} opacity={1} />
    </line>
  );
}
