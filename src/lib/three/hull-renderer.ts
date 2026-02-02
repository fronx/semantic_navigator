/**
 * Hull polygon renderer for the Three.js graph visualization.
 * Renders convex hull polygons around keyword communities.
 */

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { SimNode, ImmediateParams } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import {
  computeHullGeometry,
  groupNodesByCommunity,
  computeHullColor,
  HULL_STYLES,
  type HullGeometry,
} from "@/lib/hull-renderer";
import { computeGraphCenter } from "@/lib/cluster-label-position";
import { getRenderOrder } from "./node-renderer";

// ============================================================================
// Types
// ============================================================================

export interface HullRendererOptions {
  scene: THREE.Scene;
  container: HTMLElement;
  immediateParams: { current: ImmediateParams };
  visualScale: number;
  pcaTransform?: PCATransform;
}

export interface HullRenderer {
  /** Update hull communities (when nodes are filtered) */
  updateCommunities(communitiesMap: Map<number, SimNode[]>): void;
  /** Update hull positions and opacity (called each frame) */
  update(): void;
  /** Dispose all hull meshes and materials */
  dispose(): void;
}

interface HullMeshGroup {
  fill: THREE.Mesh;
  outline: Line2;
}

// ============================================================================
// Hull Renderer
// ============================================================================

export function createHullRenderer(options: HullRendererOptions): HullRenderer {
  const { scene, container, immediateParams, visualScale, pcaTransform } = options;

  // Cache for hull meshes (fill + outline per community)
  const hullCache = new Map<number, HullMeshGroup>();

  // Current communities map
  let communitiesMap = new Map<number, SimNode[]>();

  /**
   * Create fill polygon mesh from hull geometry.
   */
  function createFillMesh(geometry: HullGeometry, color: string, opacity: number): THREE.Mesh {
    // Create Three.js Shape from hull points
    const shape = new THREE.Shape();
    const points = geometry.expandedHull;
    if (points.length > 0) {
      shape.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        shape.lineTo(points[i][0], points[i][1]);
      }
      shape.closePath();
    }

    const shapeGeometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: HULL_STYLES.FILL_OPACITY * opacity,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(shapeGeometry, material);
    mesh.renderOrder = getRenderOrder("edges", -2); // Behind edges and nodes
    return mesh;
  }

  /**
   * Create outline line from hull geometry.
   */
  function createOutlineLine(geometry: HullGeometry, color: string, opacity: number): Line2 {
    const points = geometry.expandedHull;
    const positions = new Float32Array((points.length + 1) * 3);

    // Convert hull points to Line2 positions (close the loop)
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i][0];
      positions[i * 3 + 1] = points[i][1];
      positions[i * 3 + 2] = 0;
    }
    // Close the polygon
    positions[points.length * 3] = points[0][0];
    positions[points.length * 3 + 1] = points[0][1];
    positions[points.length * 3 + 2] = 0;

    const lineGeometry = new LineGeometry();
    lineGeometry.setPositions(positions);

    const rect = container.getBoundingClientRect();
    const material = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: HULL_STYLES.STROKE_WIDTH_SCALE * visualScale,
      transparent: true,
      opacity: HULL_STYLES.STROKE_OPACITY * opacity,
      resolution: new THREE.Vector2(rect.width, rect.height),
      worldUnits: true,
      depthTest: false,
    });

    const line = new Line2(lineGeometry, material);
    line.computeLineDistances();
    line.renderOrder = getRenderOrder("edges", -1); // In front of fills, behind edges
    line.frustumCulled = false; // Disable frustum culling for hulls
    return line;
  }

  /**
   * Update hull positions and materials from current communities and opacity.
   */
  function update(): void {
    const opacity = immediateParams.current.hullOpacity;

    // Remove hulls for communities that no longer exist
    for (const communityId of hullCache.keys()) {
      if (!communitiesMap.has(communityId)) {
        const cached = hullCache.get(communityId)!;
        scene.remove(cached.fill);
        scene.remove(cached.outline);
        cached.fill.geometry.dispose();
        (cached.fill.material as THREE.MeshBasicMaterial).dispose();
        cached.outline.geometry.dispose();
        (cached.outline.material as LineMaterial).dispose();
        hullCache.delete(communityId);
      }
    }

    // Update or create hulls for each community
    if (opacity > 0) {
      // Compute graph center (mean of all node positions) for label positioning
      const graphCenter = computeGraphCenter(communitiesMap.values());

      for (const [communityId, members] of communitiesMap) {
        const points: [number, number][] = members.map((n) => [n.x!, n.y!]);
        const geometry = computeHullGeometry(points, 1.3, graphCenter);

        if (!geometry) {
          // Remove hull if geometry cannot be computed (< 3 points)
          const cached = hullCache.get(communityId);
          if (cached) {
            scene.remove(cached.fill);
            scene.remove(cached.outline);
            cached.fill.geometry.dispose();
            (cached.fill.material as THREE.MeshBasicMaterial).dispose();
            cached.outline.geometry.dispose();
            (cached.outline.material as LineMaterial).dispose();
            hullCache.delete(communityId);
          }
          continue;
        }

        const color = computeHullColor(communityId, members, pcaTransform);
        const cached = hullCache.get(communityId);

        if (cached) {
          // Update existing hull geometry and materials
          updateHullMesh(cached, geometry, color, opacity);
        } else {
          // Create new hull meshes
          const fill = createFillMesh(geometry, color, opacity);
          const outline = createOutlineLine(geometry, color, opacity);
          scene.add(fill);
          scene.add(outline);
          hullCache.set(communityId, { fill, outline });
        }
      }
    } else {
      // Hide all hulls when opacity is 0
      for (const cached of hullCache.values()) {
        cached.fill.visible = false;
        cached.outline.visible = false;
      }
    }
  }

  /**
   * Update an existing hull mesh with new geometry and materials.
   */
  function updateHullMesh(
    cached: HullMeshGroup,
    geometry: HullGeometry,
    color: string,
    opacity: number
  ): void {
    // Update fill geometry
    const shape = new THREE.Shape();
    const points = geometry.expandedHull;
    if (points.length > 0) {
      shape.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        shape.lineTo(points[i][0], points[i][1]);
      }
      shape.closePath();
    }

    // Dispose old geometry and create new one
    cached.fill.geometry.dispose();
    cached.fill.geometry = new THREE.ShapeGeometry(shape);

    // Update fill material
    const fillMat = cached.fill.material as THREE.MeshBasicMaterial;
    fillMat.color.set(color);
    fillMat.opacity = HULL_STYLES.FILL_OPACITY * opacity;
    fillMat.needsUpdate = true;
    cached.fill.visible = true;

    // Update outline geometry
    const positions = new Float32Array((points.length + 1) * 3);
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i][0];
      positions[i * 3 + 1] = points[i][1];
      positions[i * 3 + 2] = 0;
    }
    positions[points.length * 3] = points[0][0];
    positions[points.length * 3 + 1] = points[0][1];
    positions[points.length * 3 + 2] = 0;

    const lineGeometry = cached.outline.geometry as LineGeometry;
    lineGeometry.setPositions(positions);
    cached.outline.computeLineDistances();

    // Update outline material
    const outlineMat = cached.outline.material as LineMaterial;
    outlineMat.color.set(color);
    outlineMat.opacity = HULL_STYLES.STROKE_OPACITY * opacity;
    outlineMat.needsUpdate = true;
    cached.outline.visible = true;
  }

  function updateCommunities(newCommunitiesMap: Map<number, SimNode[]>): void {
    communitiesMap = newCommunitiesMap;
  }

  function dispose(): void {
    for (const cached of hullCache.values()) {
      scene.remove(cached.fill);
      scene.remove(cached.outline);
      cached.fill.geometry.dispose();
      (cached.fill.material as THREE.MeshBasicMaterial).dispose();
      cached.outline.geometry.dispose();
      (cached.outline.material as LineMaterial).dispose();
    }
    hullCache.clear();
  }

  return {
    updateCommunities,
    update,
    dispose,
  };
}
