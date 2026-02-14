/**
 * Text labels for chunk cards in the UMAP visualization.
 * Shows truncated content text on cards when zoomed in close enough.
 * Only renders labels for the nearest ~50 chunks to the camera center.
 */

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useThreeTextGeometry } from "@/hooks/useThreeTextGeometry";
import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";

const MAX_VISIBLE_LABELS = 50;
const PREVIEW_CHAR_LIMIT = 150;
const FONT_URL = "/fonts/source-code-pro-regular.woff2";
const BASE_FONT_SIZE = 1.2;
const LINE_HEIGHT = 1.3;
/** Card inner margin as fraction of card dimensions */
const MARGIN_RATIO = 0.08;
/** Camera Z below which labels start to appear */
const FADE_IN_Z = 600;
/** Camera Z below which labels are fully opaque */
const FULL_OPACITY_Z = 200;

interface ChunkTextLabelsProps {
  chunks: ChunkEmbeddingData[];
  positions: Float32Array;
  cardWidth: number;
  cardHeight: number;
  cardScale: number;
  searchOpacities: Map<string, number>;
}

interface ChunkLabelRegistration {
  index: number;
  group: THREE.Group | null;
  material: THREE.MeshBasicMaterial;
  geometryWidth: number;
}

/**
 * Truncate text to a character limit, breaking at word boundaries.
 */
function truncateContent(content: string, limit: number): string {
  // Collapse whitespace and trim
  const clean = content.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const sliced = clean.slice(0, limit);
  const trimmed = sliced.replace(/\s+\S*$/, "");
  return `${trimmed}...`;
}

export function ChunkTextLabels({
  chunks,
  positions,
  cardWidth,
  cardHeight,
  cardScale,
  searchOpacities,
}: ChunkTextLabelsProps) {
  const { camera } = useThree();
  const labelRegistry = useRef(new Map<number, ChunkLabelRegistration>());
  const searchOpacitiesRef = useRef(searchOpacities);
  searchOpacitiesRef.current = searchOpacities;

  // Determine which chunk indices should have visible labels.
  // Updated each frame imperatively; the React render only creates label components
  // for chunks that have recently been visible.
  const [visibleIndices, setVisibleIndices] = useState<number[]>([]);

  // Reusable vector for projection
  const tempVec = useMemo(() => new THREE.Vector3(), []);

  // Inner text area dimensions (used for maxWidth in text geometry)
  const innerWidth = cardWidth * (1 - 2 * MARGIN_RATIO);

  // Truncated content strings, memoized per chunk set
  const chunkPreviews = useMemo(
    () => chunks.map((chunk) => truncateContent(chunk.content, PREVIEW_CHAR_LIMIT)),
    [chunks]
  );

  // Track previous visible set to avoid unnecessary React re-renders
  const prevVisibleSetRef = useRef(new Set<number>());

  useFrame(() => {
    const cameraZ = camera.position.z;

    // Zoom-based opacity: invisible when far, opaque when close
    const zoomOpacity = cameraZ <= FULL_OPACITY_Z
      ? 1
      : cameraZ >= FADE_IN_Z
        ? 0
        : (FADE_IN_Z - cameraZ) / (FADE_IN_Z - FULL_OPACITY_Z);

    if (zoomOpacity <= 0.01) {
      // Too zoomed out -- hide all labels, skip work
      labelRegistry.current.forEach((entry) => {
        if (entry.group) entry.group.visible = false;
      });
      if (prevVisibleSetRef.current.size > 0) {
        prevVisibleSetRef.current.clear();
        setVisibleIndices([]);
      }
      return;
    }

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
    const searchActive = searchOpacitiesRef.current.size > 0;
    labelRegistry.current.forEach((entry) => {
      const { index, group, material, geometryWidth } = entry;
      if (!group) return;

      const isVisible = newSet.has(index);
      if (!isVisible) {
        group.visible = false;
        return;
      }

      const x = positions[index * 2];
      const y = positions[index * 2 + 1];
      group.position.set(x, y, 0.1); // slightly above cards

      // Scale text to fit within card bounds
      const cardWorldWidth = cardWidth * cardScale;
      const usableWidth = cardWorldWidth * (1 - 2 * MARGIN_RATIO);
      const textScale = geometryWidth > 0 ? usableWidth / geometryWidth : cardScale;
      group.scale.setScalar(textScale);

      // Set opacity (zoom * search)
      let finalOpacity = zoomOpacity;
      if (searchActive) {
        const chunkId = chunks[index].id;
        finalOpacity *= searchOpacitiesRef.current.get(chunkId) ?? 1.0;
      }
      const clamped = THREE.MathUtils.clamp(finalOpacity, 0, 1);
      if (Math.abs(material.opacity - clamped) > 0.01) {
        material.opacity = clamped;
        material.needsUpdate = true;
      }
      group.visible = clamped > 0.02;
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
          text={chunkPreviews[chunkIndex]}
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

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        toneMapped: false,
        depthTest: false,
        depthWrite: false,
        opacity: 0,
      }),
    []
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
    };
    registrationRef.current = registration;
    registerLabel(chunkIndex, registration);

    return () => {
      registerLabel(chunkIndex, null);
      registrationRef.current = null;
    };
  }, [geometryEntry, chunkIndex, material, registerLabel]);

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
