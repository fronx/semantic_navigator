/**
 * Chunk edge renderer using mesh-based thick lines.
 *
 * ## Why mesh quads instead of GL_LINES?
 *
 * WebGL's `GL_LINES` (Three.js `<line>` + `lineBasicMaterial`) is clamped to
 * 1px on most browsers regardless of `lineWidth`. To get zoom-dependent and
 * weight-dependent thickness we render each arc segment as a **quad** — two
 * triangles formed by offsetting vertices perpendicular to the arc tangent.
 *
 * ## Geometry layout
 *
 * Each edge is a 16-segment arc (17 points). At every arc point we emit two
 * vertices offset ±halfWidth along the arc normal, forming a ribbon of 34
 * vertices and 32 triangles. A static index buffer wires up the quads once;
 * per-frame updates only touch the position and color attribute arrays.
 *
 * ## Width computation
 *
 * Pixel width is count-driven: more edges → thinner lines, fewer → thicker.
 *
 *   countMul       = floor + (1-floor) × pivot / (pivot + edgeCount)
 *   basePixelWidth = clamp(edgeThickness × countMul, minPx, maxPx)
 *   effectivePx    = max(basePixelWidth × weightFactor, minPx)
 *   worldHalfWidth = effectivePx × worldUnitsPerPixel / 2
 *
 * `weightFactor` maps each edge's normalized UMAP affinity weight to the
 * range [0.2, 1.0], so the strongest edges are 5× wider than the weakest.
 * Opacity also encodes weight for a double visual cue.
 *
 * The `edgeThickness` slider sets the max pixel width (at countMul=1).
 * `edgeCountPivot` sets the edge count at the midpoint.
 * `edgeCountFloor` sets the minimum scale factor.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import type { UmapEdge } from "@/hooks/useUmapLayout";
import type { PulledChunkNode } from "@/lib/chunks-pull-state";
import { computeArcPoints, computeOutwardDirection } from "@/lib/edge-curves";
import { computeViewportZones, computeCompressionExtents } from "@/lib/edge-pulling";

const EDGE_SEGMENTS = 16;
const ARC_VERTEX_COUNT = EDGE_SEGMENTS + 1;
const VERTS_PER_EDGE = 2 * ARC_VERTEX_COUNT; // 34 vertices (ribbon left + right)
const INDICES_PER_EDGE = EDGE_SEGMENTS * 6; // 96 indices (2 triangles × 16 segments)
const EDGE_COLOR = 0.533; // ~#888888
/** Edges share the z-plane of the farthest card layer to minimize parallax. */
const EDGE_Z = 0;
const OUTBOUND_EDGE_OFFSET = 40;
const VIEWPORT_FADE_SPEED = 0.08;

// Width constants
const FOV_HALF_TAN = Math.tan((5 * Math.PI) / 180); // half of 10° FOV

// Zoom-based contrast: dim when zoomed out (many edges cluttered), sharp when zoomed in
const CONTRAST_FAR_Z = 6000;
const CONTRAST_NEAR_Z = 400;
const CONTRAST_AT_FAR = 4;
const CONTRAST_AT_NEAR = 13;
const MAX_PIXEL_WIDTH = 5;
const MIN_PIXEL_WIDTH = 0.3;
/** Minimum pixel width for edges connecting two search-matched nodes. */
const SEARCH_MATCH_MIN_PIXEL_WIDTH = 1.5;
/** Opacity threshold above which an endpoint is considered a search match. */
const SEARCH_MATCH_THRESHOLD = 0.2;

/**
 * Normalized logistic S-curve on [0,1].
 * At contrast=0 this returns `t` (linear). Increasing contrast pushes weak
 * values toward 0 and strong values toward 1, creating visual separation.
 * `midpoint` shifts the inflection point (0.5 = centered).
 */
function applySCurve(t: number, contrast: number, midpoint: number): number {
  if (contrast <= 0) return t;
  const lo = 1 / (1 + Math.exp(contrast * midpoint));
  const hi = 1 / (1 + Math.exp(-contrast * (1 - midpoint)));
  const raw = 1 / (1 + Math.exp(-contrast * (t - midpoint)));
  return (raw - lo) / (hi - lo);
}

export interface ChunkEdgesProps {
  edges: UmapEdge[];
  edgesVersion: number;
  positions: Float32Array;
  opacity: number;
  edgeThickness: number;
  edgeMidpoint: number;
  edgeCountPivot: number;
  edgeCountFloor: number;
  focusNodeSet?: Set<number> | null;
  projectOutsideFocus?: boolean;
  nodeColors?: THREE.Color[];
  brightness?: number;
  /** Per-node opacity multiplier from hover preview dim (sparse map, absent = 1.0) */
  previewDimRef?: React.RefObject<Map<number, number>>;
  /** Pulled chunk positions for edge endpoint overrides (index -> ghost position) */
  pulledPositionsRef?: React.RefObject<Map<number, PulledChunkNode>>;
  /** Per-chunk search opacity (keyed by chunk ID, absent = 1.0) */
  searchOpacitiesRef?: React.RefObject<Map<string, number>>;
  /** Chunk IDs indexed by node index, for search opacity lookup */
  chunkIds?: string[];
  /** Per-node flee/return opacity (node index → 0..1, absent = 1.0). Min of both endpoints applied. */
  fleeDimRef?: React.RefObject<Map<number, number>>;
  /** Animated cluster hover intensity (0 = no hover, 1 = full). Used with clusterHoverMemberSetRef. */
  clusterHoverIntensityRef?: React.RefObject<number>;
  /** Set of chunk indices belonging to the hovered cluster label. */
  clusterHoverMemberSetRef?: React.RefObject<Set<number>>;
}

export function ChunkEdges({
  edges,
  edgesVersion,
  positions,
  opacity,
  edgeThickness,
  edgeMidpoint,
  edgeCountPivot,
  edgeCountFloor,
  focusNodeSet,
  projectOutsideFocus = false,
  nodeColors,
  brightness = 1,
  previewDimRef,
  pulledPositionsRef,
  searchOpacitiesRef,
  chunkIds,
  fleeDimRef,
  clusterHoverIntensityRef,
  clusterHoverMemberSetRef,
}: ChunkEdgesProps) {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const edgeFadeRef = useRef<Float32Array>(new Float32Array(0));
  const { camera, size, gl } = useThree();

  const geometry = useMemo(() => {
    const maxEdges = Math.max(edges.length, 1);
    const geom = new THREE.BufferGeometry();

    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(maxEdges * VERTS_PER_EDGE * 3), 3)
    );
    geom.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(maxEdges * VERTS_PER_EDGE * 4), 4)
    );

    // Static index buffer: same quad pattern repeated for every edge.
    const indices = new Uint32Array(maxEdges * INDICES_PER_EDGE);
    for (let e = 0; e < maxEdges; e++) {
      const vertBase = e * VERTS_PER_EDGE;
      const idxBase = e * INDICES_PER_EDGE;
      for (let s = 0; s < EDGE_SEGMENTS; s++) {
        const a0 = vertBase + s * 2; // "left" vertex at arc point s
        const b0 = vertBase + s * 2 + 1; // "right" vertex at arc point s
        const a1 = vertBase + (s + 1) * 2; // "left" vertex at arc point s+1
        const b1 = vertBase + (s + 1) * 2 + 1; // "right" vertex at arc point s+1
        const i = idxBase + s * 6;
        // Two CCW triangles forming a quad
        indices[i] = a0;
        indices[i + 1] = b0;
        indices[i + 2] = a1;
        indices[i + 3] = b0;
        indices[i + 4] = b1;
        indices[i + 5] = a1;
      }
    }
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10000);

    return geom;
  }, [edges.length, edgesVersion]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const shouldRender = opacity > 0.001 && edges.length > 0 && positions.length >= 4;
    mesh.visible = shouldRender;
    if (!shouldRender) return;

    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;
    const colArray = colAttr.array as Float32Array;

    // Only draw the edges we actually fill (skip stale tail from previous larger set)
    geometry.setDrawRange(0, edges.length * INDICES_PER_EDGE);

    const perspCamera = camera as THREE.PerspectiveCamera;

    // --- Camera-dependent width and contrast ---
    const cameraZ = perspCamera.position.z;
    const zoomT = Math.max(0, Math.min(1, (cameraZ - CONTRAST_NEAR_Z) / (CONTRAST_FAR_Z - CONTRAST_NEAR_Z)));
    const edgeContrast = CONTRAST_AT_NEAR + (CONTRAST_AT_FAR - CONTRAST_AT_NEAR) * zoomT;
    const worldPerPixel = (2 * cameraZ * FOV_HALF_TAN) / (size.height / gl.getPixelRatio());
    const countMul = edgeCountFloor + (1 - edgeCountFloor) * (edgeCountPivot / (edgeCountPivot + edges.length));
    const basePixelWidth = Math.max(MIN_PIXEL_WIDTH, Math.min(edgeThickness * countMul, MAX_PIXEL_WIDTH));

    // --- Centroid for arc curvature direction ---
    const nodeCount = positions.length / 2;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < nodeCount; i++) {
      sumX += positions[i * 2];
      sumY += positions[i * 2 + 1];
    }
    const centroid = { x: sumX / nodeCount, y: sumY / nodeCount };

    // --- Viewport culling setup ---
    const zones = computeViewportZones(perspCamera, size.width, size.height);
    const viewport = zones.viewport;
    const { horizonHalfWidth, horizonHalfHeight } = computeCompressionExtents(zones);
    const maxRadius = Math.min(horizonHalfWidth, horizonHalfHeight);
    const camX = viewport.camX;
    const camY = viewport.camY;
    const shouldProject = Boolean(
      projectOutsideFocus && focusNodeSet && focusNodeSet.size > 0
    );
    const cullLeft = viewport.left;
    const cullRight = viewport.right;
    const cullBottom = viewport.bottom;
    const cullTop = viewport.top;

    const projectPosition = (nodeIndex: number, x: number, y: number) => {
      if (!shouldProject || focusNodeSet!.has(nodeIndex)) return { x, y };

      const { pullBounds } = zones;
      if (x >= pullBounds.left && x <= pullBounds.right &&
          y >= pullBounds.bottom && y <= pullBounds.top) {
        return { x, y };
      }

      const dx = x - camX;
      const dy = y - camY;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const ratio = (maxRadius + OUTBOUND_EDGE_OFFSET) / distance;
      return {
        x: THREE.MathUtils.clamp(camX + dx * ratio, pullBounds.left, pullBounds.right),
        y: THREE.MathUtils.clamp(camY + dy * ratio, pullBounds.bottom, pullBounds.top),
      };
    };

    // --- Normalize weights across all edges ---
    let maxWeight = 0;
    for (const edge of edges) {
      if (edge.weight > maxWeight) maxWeight = edge.weight;
    }

    // --- Per-edge fade tracking ---
    let edgeFade = edgeFadeRef.current;
    if (edgeFade.length !== edges.length) {
      edgeFade = new Float32Array(edges.length).fill(1);
      edgeFadeRef.current = edgeFade;
    }

    // --- Pulled positions for edge endpoint overrides ---
    const pulledPositions = pulledPositionsRef?.current;

    // --- Build ribbon geometry per edge ---
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      const vertBase = edgeIndex * VERTS_PER_EDGE;

      const sourceIdx = edge.source * 2;
      const targetIdx = edge.target * 2;

      // Bounds check
      if (
        sourceIdx + 1 >= positions.length ||
        targetIdx + 1 >= positions.length
      ) {
        edgeFade[edgeIndex] = 0;
        zeroEdge(posArray, colArray, vertBase);
        continue;
      }

      // Edge pulling: override endpoints for pulled ghost nodes
      const sourcePulled = pulledPositions?.get(edge.source);
      const targetPulled = pulledPositions?.get(edge.target);

      // Hide edges where both endpoints are pulled with no primary connections
      if (sourcePulled && targetPulled
          && sourcePulled.connectedPrimaryIndices.length === 0
          && targetPulled.connectedPrimaryIndices.length === 0) {
        edgeFade[edgeIndex] = 0;
        zeroEdge(posArray, colArray, vertBase);
        continue;
      }

      const sourceRawX = sourcePulled?.x ?? positions[sourceIdx];
      const sourceRawY = sourcePulled?.y ?? positions[sourceIdx + 1];
      const targetRawX = targetPulled?.x ?? positions[targetIdx];
      const targetRawY = targetPulled?.y ?? positions[targetIdx + 1];

      const sourcePoint = projectPosition(edge.source, sourceRawX, sourceRawY);
      const targetPoint = projectPosition(edge.target, targetRawX, targetRawY);

      // Viewport fade: lerp toward 0 when both endpoints are off-screen
      const sourceInView =
        sourcePoint.x >= cullLeft && sourcePoint.x <= cullRight &&
        sourcePoint.y >= cullBottom && sourcePoint.y <= cullTop;
      const targetInView =
        targetPoint.x >= cullLeft && targetPoint.x <= cullRight &&
        targetPoint.y >= cullBottom && targetPoint.y <= cullTop;
      const fadeTarget = (sourceInView || targetInView) ? 1 : 0;
      edgeFade[edgeIndex] += (fadeTarget - edgeFade[edgeIndex]) * VIEWPORT_FADE_SPEED;
      if (edgeFade[edgeIndex] < 0.005) {
        edgeFade[edgeIndex] = 0;
        zeroEdge(posArray, colArray, vertBase);
        continue;
      }

      // Compute arc
      const direction = computeOutwardDirection(
        { id: "", x: sourcePoint.x, y: sourcePoint.y },
        { id: "", x: targetPoint.x, y: targetPoint.y },
        centroid
      );
      const arcPoints = computeArcPoints(
        sourcePoint, targetPoint, 0.15, direction, EDGE_SEGMENTS
      );

      // Per-edge width from weight (S-curve applied to both width and opacity)
      const normalizedWeight = maxWeight > 0 ? edge.weight / maxWeight : 0;
      const curved = applySCurve(normalizedWeight, edgeContrast, edgeMidpoint);
      const weightFactor = 0.2 + 0.8 * curved;

      // Search opacity — computed once, reused for both width floor and alpha dim
      const searchMap = searchOpacitiesRef?.current;
      const isSearchActive = !!(searchMap && searchMap.size > 0 && chunkIds);
      const sourceSO = isSearchActive ? (searchMap!.get(chunkIds![edge.source]) ?? 1) : 1;
      const targetSO = isSearchActive ? (searchMap!.get(chunkIds![edge.target]) ?? 1) : 1;
      const minEndpointSO = Math.min(sourceSO, targetSO);
      const isMatchedEdge = isSearchActive && sourceSO > SEARCH_MATCH_THRESHOLD && targetSO > SEARCH_MATCH_THRESHOLD;
      const searchMinPx = isMatchedEdge ? SEARCH_MATCH_MIN_PIXEL_WIDTH : 0;

      const pixelWidth = Math.max(basePixelWidth * weightFactor, MIN_PIXEL_WIDTH, searchMinPx);
      const halfWidth = (pixelWidth * worldPerPixel) / 2;

      // Emit ribbon vertices: at each arc point, offset ±halfWidth along the normal
      for (let i = 0; i < ARC_VERTEX_COUNT; i++) {
        const p = arcPoints[i] ?? arcPoints[arcPoints.length - 1];

        // Tangent via central differences (one-sided at endpoints)
        let tx: number, ty: number;
        if (i === 0) {
          const next = arcPoints[1] ?? p;
          tx = next.x - p.x;
          ty = next.y - p.y;
        } else if (i === ARC_VERTEX_COUNT - 1) {
          const prev = arcPoints[i - 1] ?? p;
          tx = p.x - prev.x;
          ty = p.y - prev.y;
        } else {
          const prev = arcPoints[i - 1] ?? p;
          const next = arcPoints[i + 1] ?? p;
          tx = next.x - prev.x;
          ty = next.y - prev.y;
        }

        // Perpendicular to tangent
        const len = Math.sqrt(tx * tx + ty * ty) || 1;
        const nx = -ty / len;
        const ny = tx / len;

        // "Left" vertex (index 2*i)
        const li = (vertBase + i * 2) * 3;
        posArray[li] = p.x + nx * halfWidth;
        posArray[li + 1] = p.y + ny * halfWidth;
        posArray[li + 2] = EDGE_Z;

        // "Right" vertex (index 2*i + 1)
        const ri = (vertBase + i * 2 + 1) * 3;
        posArray[ri] = p.x - nx * halfWidth;
        posArray[ri + 1] = p.y - ny * halfWidth;
        posArray[ri + 2] = EDGE_Z;
      }

      // Colors: RGBA with per-edge alpha encoding weight + overall opacity + viewport fade
      const baseAlpha = 0.05 + curved * 0.95;
      const dimMap = previewDimRef?.current;
      const previewMul = dimMap && dimMap.size > 0
        ? Math.min(dimMap.get(edge.source) ?? 1, dimMap.get(edge.target) ?? 1)
        : 1;
      const fleeMap = fleeDimRef?.current;
      const fleeMul = fleeMap && fleeMap.size > 0
        ? Math.min(fleeMap.get(edge.source) ?? 1, fleeMap.get(edge.target) ?? 1)
        : 1;
      const searchMul = isSearchActive ? Math.pow(minEndpointSO, 2) : 1;
      const clusterIntensity = clusterHoverIntensityRef?.current ?? 0;
      let clusterMul = 1.0;
      if (clusterIntensity > 0.001 && clusterHoverMemberSetRef?.current) {
        const memberSet = clusterHoverMemberSetRef.current;
        const srcDim = memberSet.has(edge.source) ? 1.0 : 1.0 - clusterIntensity * (1.0 - 0.15);
        const tgtDim = memberSet.has(edge.target) ? 1.0 : 1.0 - clusterIntensity * (1.0 - 0.15);
        clusterMul = Math.min(srcDim, tgtDim);
      }
      const rawAlpha = baseAlpha * opacity * edgeFade[edgeIndex] * previewMul * fleeMul * searchMul * clusterMul;
      const opacityFloor = Math.max(0, (brightness - 1) * 0.1);
      const alpha = Math.max(opacityFloor, rawAlpha);

      // Blend source and target node colors; fall back to flat grey
      let er = EDGE_COLOR, eg = EDGE_COLOR, eb = EDGE_COLOR;
      if (nodeColors) {
        const sc = nodeColors[edge.source];
        const tc = nodeColors[edge.target];
        if (sc && tc) {
          er = (sc.r + tc.r) / 2;
          eg = (sc.g + tc.g) / 2;
          eb = (sc.b + tc.b) / 2;
        } else if (sc) {
          er = sc.r; eg = sc.g; eb = sc.b;
        } else if (tc) {
          er = tc.r; eg = tc.g; eb = tc.b;
        }
      }
      if (brightness !== 1) {
        er = Math.min(1, er * brightness);
        eg = Math.min(1, eg * brightness);
        eb = Math.min(1, eb * brightness);
      }

      for (let v = 0; v < VERTS_PER_EDGE; v++) {
        const ci = (vertBase + v) * 4;
        colArray[ci] = er;
        colArray[ci + 1] = eg;
        colArray[ci + 2] = eb;
        colArray[ci + 3] = alpha;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  });

  if (edges.length === 0 || positions.length < 4) {
    return null;
  }

  return (
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false} renderOrder={-2}>
      <meshBasicMaterial
        vertexColors
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** Zero out an edge's vertices and colors to produce invisible degenerate triangles. */
function zeroEdge(posArray: Float32Array, colArray: Float32Array, vertBase: number): void {
  posArray.fill(0, vertBase * 3, (vertBase + VERTS_PER_EDGE) * 3);
  colArray.fill(0, vertBase * 4, (vertBase + VERTS_PER_EDGE) * 4);
}