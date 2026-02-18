/**
 * Text labels for chunk cards in the UMAP visualization.
 * Shows full content text on cards when zoomed in close enough, visually clipped at card bottom.
 * Only renders labels for the nearest ~50 chunks to the camera center.
 *
 * Scaling pattern mirrors ContentTextLabels3D: screen-space rect drives text scale,
 * so text automatically tracks card size (lens mode, animated transitions, zoom).
 */

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useThreeTextGeometry } from "@/hooks/useThreeTextGeometry";
import { useTextClippingPlane, type ClippingPlaneUpdater } from "@/hooks/useTextClippingPlane";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import type { ScreenRect } from "@/lib/screen-rect-projection";
import { computeUnitsPerPixel } from "@/lib/three-text-utils";

const MAX_VISIBLE_LABELS = 50;
const FONT_URL = "/fonts/source-code-pro-regular.woff2";
const BASE_FONT_SIZE = 1.2;
const LINE_HEIGHT = 1.3;
/** Card inner margin as fraction of card dimensions */
const MARGIN_RATIO = 0.08;

interface ChunkTextLabelsProps {
  chunks: ChunkEmbeddingData[];
  positions: Float32Array;
  cardWidth: number;
  cardHeight: number;
  // textZ removed — now per-card via screenRect.z
  screenRectsRef: MutableRefObject<Map<number, ScreenRect>>;
}

interface ChunkLabelRegistration {
  index: number;
  group: THREE.Group | null;
  material: THREE.MeshBasicMaterial;
  geometryWidth: number;
  clippingUpdater: ClippingPlaneUpdater;
}

export function ChunkTextLabels({
  chunks,
  positions,
  cardWidth,
  cardHeight,
  screenRectsRef,
}: ChunkTextLabelsProps) {
  const { camera, size, gl } = useThree();
  const labelRegistry = useRef(new Map<number, ChunkLabelRegistration>());

  // Determine which chunk indices should have visible labels.
  // Updated each frame imperatively; the React render only creates label components
  // for chunks that have recently been visible.
  const [visibleIndices, setVisibleIndices] = useState<number[]>([]);

  // Reusable vectors for projection (avoid GC pressure in useFrame)
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const cameraPos = useMemo(() => new THREE.Vector3(), []);

  // Inner text area dimensions (used for maxWidth in text geometry)
  const innerWidth = cardWidth * (1 - 2 * MARGIN_RATIO);

  // Enable local clipping planes on the renderer
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  // Full content strings (no truncation, clipped visually at card bottom)
  const chunkContents = useMemo(
    () => chunks.map((chunk) => chunk.content.replace(/\s+/g, " ").trim()),
    [chunks]
  );

  // Track previous visible set to avoid unnecessary React re-renders
  const prevVisibleSetRef = useRef(new Set<number>());

  useFrame(() => {
    // Find which chunks are within the viewport (in NDC space)
    const n = Math.min(chunks.length, positions.length / 2);
    const cameraCenterX = camera.position.x;
    const cameraCenterY = camera.position.y;

    // Rank chunks by distance to camera center, pick closest MAX_VISIBLE_LABELS
    const ranked: { index: number; dist: number }[] = [];
    for (let i = 0; i < n; i++) {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      // Project to screen to check if in viewport
      tempVec.set(x, y, 0);
      tempVec.project(camera);
      // Check NDC bounds (with margin for partially visible cards)
      if (tempVec.x < -1.3 || tempVec.x > 1.3 || tempVec.y < -1.3 || tempVec.y > 1.3) {
        continue;
      }
      const dx = x - cameraCenterX;
      const dy = y - cameraCenterY;
      ranked.push({ index: i, dist: dx * dx + dy * dy });
    }
    ranked.sort((a, b) => a.dist - b.dist);
    const newVisible = ranked.slice(0, MAX_VISIBLE_LABELS).map((r) => r.index);

    // Only trigger React re-render if the visible set actually changed
    const newSet = new Set(newVisible);
    const prev = prevVisibleSetRef.current;
    if (newSet.size !== prev.size || newVisible.some((idx) => !prev.has(idx))) {
      prevVisibleSetRef.current = newSet;
      setVisibleIndices(newVisible);
    }

    // Update registered labels imperatively
    labelRegistry.current.forEach((entry) => {
      const { index, group, material, geometryWidth, clippingUpdater } = entry;
      if (!group) return;

      const isVisible = newSet.has(index);
      if (!isVisible) {
        group.visible = false;
        return;
      }

      // Card must be visible (present in screenRectsRef) and large enough on screen
      const screenRect = screenRectsRef.current.get(index);
      if (!screenRect || screenRect.width < 40) {
        group.visible = false;
        return;
      }

      const x = positions[index * 2];
      const y = positions[index * 2 + 1];
      group.position.set(x, y, screenRect.z);

      // Screen-space scaling: same pattern as ContentTextLabels3D
      const worldPosition = group.getWorldPosition(tempVec);
      const unitsPerPixel = computeUnitsPerPixel(camera, size, worldPosition, cameraPos);
      const usableScreenWidth = screenRect.width * (1 - 2 * MARGIN_RATIO);
      const targetScale = (usableScreenWidth * unitsPerPixel) / (geometryWidth > 0 ? geometryWidth : 1);
      group.scale.setScalar(targetScale);

      // Clip at card bottom (convert screen height to world space)
      const worldHeight = screenRect.height * unitsPerPixel;
      clippingUpdater.setBottomClip(y, worldHeight);

      if (material.opacity !== 1) {
        material.opacity = 1;
        material.needsUpdate = true;
      }
      group.visible = true;
    });
  });

  const registerLabel = useCallback((index: number, registration: ChunkLabelRegistration | null) => {
    if (registration) {
      labelRegistry.current.set(index, registration);
    } else {
      labelRegistry.current.delete(index);
    }
  }, []);

  if (visibleIndices.length === 0) {
    return null;
  }

  return (
    <>
      {visibleIndices.map((chunkIndex) => (
        <ChunkLabel
          key={chunkIndex}
          chunkIndex={chunkIndex}
          text={chunkContents[chunkIndex]}
          maxWidth={innerWidth}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          registerLabel={registerLabel}
        />
      ))}
    </>
  );
}

interface ChunkLabelProps {
  chunkIndex: number;
  text: string;
  maxWidth: number;
  cardWidth: number;
  cardHeight: number;
  registerLabel: (index: number, registration: ChunkLabelRegistration | null) => void;
}

function ChunkLabel({
  chunkIndex,
  text,
  maxWidth,
  cardWidth,
  cardHeight,
  registerLabel,
}: ChunkLabelProps) {
  const geometryEntry = useThreeTextGeometry({
    text,
    fontSize: BASE_FONT_SIZE,
    fontUrl: FONT_URL,
    lineHeight: LINE_HEIGHT,
    maxWidth,
    hyphenate: false,
  });

  const groupRef = useRef<THREE.Group>(null);
  const registrationRef = useRef<ChunkLabelRegistration | null>(null);

  // Compute text offset to position at top-left of card with margin
  const textOffset = useMemo<[number, number]>(() => {
    if (!geometryEntry) return [0, 0];
    const { min, max } = geometryEntry.planeBounds;
    const hMargin = cardWidth * MARGIN_RATIO;
    const vMargin = cardHeight * MARGIN_RATIO;
    // Position text at top-left of card interior
    const offsetX = -cardWidth / 2 + hMargin - min.x;
    const offsetY = cardHeight / 2 - vMargin - max.y;
    return [offsetX, offsetY];
  }, [geometryEntry, cardWidth, cardHeight]);

  // Clipping plane for this label (clips text below card bottom edge)
  const [clippingPlane, clippingUpdater] = useTextClippingPlane();

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        toneMapped: false,
        depthTest: true,   // Occluded by cards in front (was false)
        depthWrite: false, // Prevents text self-occlusion
        opacity: 0,
        clippingPlanes: [clippingPlane],
      }),
    [clippingPlane]
  );

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (!geometryEntry) {
      registerLabel(chunkIndex, null);
      registrationRef.current = null;
      return;
    }

    const { min, max } = geometryEntry.planeBounds;
    const geometryWidth = Math.max(1e-3, max.x - min.x);

    const registration: ChunkLabelRegistration = {
      index: chunkIndex,
      group: groupRef.current,
      material,
      geometryWidth,
      clippingUpdater,
    };
    registrationRef.current = registration;
    registerLabel(chunkIndex, registration);

    return () => {
      registerLabel(chunkIndex, null);
      registrationRef.current = null;
    };
  }, [geometryEntry, chunkIndex, material, clippingUpdater, registerLabel]);

  const setGroupRef = useCallback((instance: THREE.Group | null) => {
    groupRef.current = instance;
    if (registrationRef.current) {
      registrationRef.current.group = instance;
    }
  }, []);

  if (!geometryEntry) {
    return null;
  }

  return (
    <group ref={setGroupRef} visible={false}>
      <mesh
        geometry={geometryEntry.geometry}
        material={material}
        position={[textOffset[0], textOffset[1], 0]}
        frustumCulled={false}
      />
    </group>
  );
}
