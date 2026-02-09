import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Billboard } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode } from "@/lib/map-renderer";
import type { PCATransform, ClusterColorInfo } from "@/lib/semantic-colors";
import type { KeywordTierMap } from "@/lib/topics-filter";
import type { ViewportSize } from "@/lib/three-text-utils";
import type { ZoomRange } from "@/lib/zoom-phase-config";
import { computeUnitsPerPixel } from "@/lib/three-text-utils";
import { maxScaleForScreenSize } from "@/lib/screen-size-clamp";
import { calculateScales } from "@/lib/content-scale";
import { useThreeTextGeometry } from "@/hooks/useThreeTextGeometry";
import { getNodeColor, BASE_DOT_RADIUS, DOT_SCALE_FACTOR } from "@/lib/rendering-utils/node-renderer";
import { isDarkMode } from "@/lib/theme";
import type { LabelRefs } from "./R3FLabelContext";
import { handleKeywordClick, handleKeywordHover } from "@/lib/keyword-interaction-handlers";
import { KEYWORD_TIER_SCALES } from "@/lib/semantic-filter-config";

const FONT_DEFAULT = "/fonts/source-code-pro-regular.woff2";
const LABEL_LINE_HEIGHT = 1.05;
const DEFAULT_MIN_SCREEN_PX = 12;
const DEFAULT_MAX_SCREEN_PX = 18;
const DEFAULT_BASE_FONT_SIZE = 12;

/** Shared invisible material for hit area planes (no per-sprite allocation needed) */
const HIT_AREA_MAT = new THREE.MeshBasicMaterial({ visible: false });

interface KeywordLabelData {
  node: SimNode;
  text: string;
  color: string;
  baseOpacity: number;
}

interface LabelRegistration {
  id: string;
  node: SimNode;
  billboard: THREE.Group | null;
  material: THREE.MeshBasicMaterial;
  baseColor: THREE.Color;
  baseFontSize: number;
  baseOpacity: number;
  labelZ: number;
}

const MAX_VISIBLE_LABELS = 12;

export interface KeywordLabels3DProps {
  nodes: SimNode[];
  clusterColors: Map<number, ClusterColorInfo>;
  pcaTransform: PCATransform | null;
  colorMixRatio: number;
  colorDesaturation: number;
  searchOpacities?: Map<string, number>;
  minScreenPx?: number;
  maxScreenPx?: number;
  baseFontSize?: number;
  labelZ?: number;
  keywordTiers?: KeywordTierMap | null;
  /** Size multiplier for keyword nodes (default 1.0) */
  keywordSizeMultiplier?: number;
  /** Per-node size multipliers based on degree (node id -> multiplier) */
  nodeSizeMultipliers?: Map<string, number>;
  pulledPositionsRef?: LabelRefs["pulledPositionsRef"];
  /** Focus-animated positions (margin push) — highest priority position override */
  focusPositionsRef?: MutableRefObject<Map<string, { x: number; y: number }>>;
  hoveredKeywordIdRef?: MutableRefObject<string | null>;
  /** Cursor position in world space for proximity filtering */
  cursorWorldPosRef?: MutableRefObject<{ x: number; y: number } | null>;
  /** Cross-fade value from label fade coordinator (0 = hidden, 1 = fully visible) */
  labelFadeT?: number;
  /** Zoom range for computing keyword dot size (needed for label offset) */
  zoomRange?: ZoomRange;
  /** Shared ref: written each frame with keyword IDs that have visible labels (read by ContentNodes) */
  visibleLabelIdsRef?: MutableRefObject<Set<string>>;
  /** Ref for flyTo animation (clicking pulled/margin node navigates to real position) */
  flyToRef?: MutableRefObject<((x: number, y: number) => void) | null>;
  onKeywordHover?: (keywordId: string | null) => void;
  onKeywordClick?: (keywordId: string) => void;
}

export function KeywordLabels3D({
  nodes,
  clusterColors,
  pcaTransform,
  colorMixRatio,
  colorDesaturation,
  searchOpacities,
  minScreenPx = DEFAULT_MIN_SCREEN_PX,
  maxScreenPx = DEFAULT_MAX_SCREEN_PX,
  baseFontSize = DEFAULT_BASE_FONT_SIZE,
  labelZ = 0,
  keywordTiers,
  keywordSizeMultiplier = 1.0,
  nodeSizeMultipliers,
  pulledPositionsRef,
  focusPositionsRef,
  hoveredKeywordIdRef,
  cursorWorldPosRef,
  labelFadeT = 0,
  zoomRange,
  visibleLabelIdsRef,
  flyToRef,
  onKeywordHover,
  onKeywordClick,
}: KeywordLabels3DProps) {
  const { camera, size } = useThree();
  const labelRegistry = useRef(new Map<string, LabelRegistration>());
  const searchOpacitiesRef = useRef(searchOpacities);
  searchOpacitiesRef.current = searchOpacities;
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const scaleVec = useMemo(() => new THREE.Vector3(), []);
  const cameraPos = useMemo(() => new THREE.Vector3(), []);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const glowTarget = useMemo(() => new THREE.Color(), []);

  const labelMeta = useMemo<KeywordLabelData[]>(() => {
    return nodes
      .filter((node): node is SimNode & { type: "keyword" } => node.type === "keyword")
      .map((node) => {
        const color = getNodeColor(
          node,
          pcaTransform ?? undefined,
          clusterColors,
          colorMixRatio,
          undefined,
          colorDesaturation
        );
        const tier = keywordTiers?.get(node.id);
        let baseOpacity = 1;
        if (tier === "neighbor-3") {
          baseOpacity = 0.4;
        } else if (tier === "neighbor-2") {
          baseOpacity = 0.65;
        } else if (tier === "neighbor-1") {
          baseOpacity = 0.85;
        }
        return {
          node,
          text: node.label ?? node.id,
          color,
          baseOpacity,
        };
      });
  }, [nodes, pcaTransform, clusterColors, colorMixRatio, colorDesaturation, keywordTiers]);

  const registerLabel = useCallback((nodeId: string, registration: LabelRegistration | null) => {
    if (registration) {
      labelRegistry.current.set(nodeId, registration);
    } else {
      labelRegistry.current.delete(nodeId);
    }
  }, []);

  // Reusable array for sorting by cursor distance (avoids per-frame allocation)
  const sortBuffer = useRef<{ id: string; dist: number }[]>([]);

  useFrame(() => {
    const cursor = cursorWorldPosRef?.current;
    const isFocusActive = (focusPositionsRef?.current.size ?? 0) > 0;

    // Content crossfade: shrink keyword label max size as content becomes visible
    const contentT = zoomRange
      ? calculateScales(camera.position.z, zoomRange).contentLabelOpacity
      : 0;
    // Interpolate maxScreenPx from full value down to minScreenPx as content fades in
    const effectiveMaxScreenPx = maxScreenPx - contentT * (maxScreenPx - minScreenPx);

    // Build proximity ranking: closest MAX_VISIBLE_LABELS labels to cursor
    const visibleSet = new Set<string>();
    // Map from id -> rank-based fade (1.0 for top labels, fades for tail)
    const rankFade = new Map<string, number>();

    if (isFocusActive) {
      // Focus mode: all labels visible (margin-pushed get reduced opacity below)
      labelRegistry.current.forEach((entry) => {
        visibleSet.add(entry.id);
      });
    } else if (cursor && labelFadeT > 0) {
      // Normal mode: proximity-based visibility (top N nearest cursor)
      const buf = sortBuffer.current;
      buf.length = 0;
      labelRegistry.current.forEach((entry) => {
        const pulledPos = pulledPositionsRef?.current.get(entry.id);
        const nx = pulledPos?.x ?? entry.node.x ?? 0;
        const ny = pulledPos?.y ?? entry.node.y ?? 0;
        const dx = nx - cursor.x;
        const dy = ny - cursor.y;
        buf.push({ id: entry.id, dist: dx * dx + dy * dy });
      });
      buf.sort((a, b) => a.dist - b.dist);

      const fadeStart = Math.max(0, MAX_VISIBLE_LABELS - 3); // index 9
      for (let i = 0; i < Math.min(buf.length, MAX_VISIBLE_LABELS); i++) {
        visibleSet.add(buf[i].id);
        if (i >= fadeStart) {
          // Fade from 1.0 at fadeStart to 0.3 at MAX_VISIBLE_LABELS-1
          const rankT = (i - fadeStart) / (MAX_VISIBLE_LABELS - 1 - fadeStart);
          rankFade.set(buf[i].id, 1.0 - rankT * 0.7);
        }
      }
    }

    labelRegistry.current.forEach((entry) => {
      const { id, node, billboard, material, baseFontSize: fontSize, baseOpacity } = entry;
      if (!billboard) return;

      // Position priority: focus (margin push) > pulled (edge pulling) > natural
      const focusPos = focusPositionsRef?.current.get(id);
      const pulledPosition = !focusPos ? pulledPositionsRef?.current.get(id) : undefined;
      const isFocusMargin = !!focusPos;
      const x = focusPos?.x ?? pulledPosition?.x ?? node.x ?? 0;
      const y = focusPos?.y ?? pulledPosition?.y ?? node.y ?? 0;

      // Calculate full keyword dot scale (matching KeywordNodes.tsx logic)
      let scaleMultiplier = 1.0;

      // Apply tier-based scale multiplier (semantic filter)
      if (keywordTiers) {
        const tier = keywordTiers.get(id);
        if (tier) {
          scaleMultiplier *= KEYWORD_TIER_SCALES[tier];
        }
      }

      // Hide margin dots entirely in focus mode (same logic as KeywordNodes)
      if (isFocusMargin) {
        scaleMultiplier = 0;
      }

      // Base zoom scale
      const { keywordScale } = zoomRange
        ? calculateScales(camera.position.z, zoomRange)
        : { keywordScale: 1.0 };

      // Apply degree-based size multiplier
      const degreeMultiplier = nodeSizeMultipliers?.get(id) ?? 1.0;

      // Final scale (matches KeywordNodes.tsx line 313)
      const finalScale = keywordScale * scaleMultiplier * keywordSizeMultiplier * degreeMultiplier;

      const dotWorldRadius = BASE_DOT_RADIUS * DOT_SCALE_FACTOR * finalScale;
      billboard.position.set(x, y - dotWorldRadius * 1.9, entry.labelZ);

      const worldPosition = billboard.getWorldPosition(tempVec);
      const unitsPerPixel = computeUnitsPerPixel(
        camera,
        size as ViewportSize,
        worldPosition,
        cameraPos
      );

      const minWorldSize = minScreenPx * unitsPerPixel;
      const maxLabelScale = maxScaleForScreenSize(fontSize, effectiveMaxScreenPx, unitsPerPixel);
      let desiredScale = THREE.MathUtils.clamp(1, minWorldSize / fontSize, maxLabelScale);

      if (isFocusMargin) {
        desiredScale *= 0.7;
      } else if (pulledPosition) {
        desiredScale *= 0.9;
      }

      scaleVec.setScalar(desiredScale);
      if (!billboard.scale.equals(scaleVec)) {
        billboard.scale.copy(scaleVec);
      }

      const isHovered = hoveredKeywordIdRef?.current === id;

      // Proximity-based visibility: only show top MAX_VISIBLE_LABELS nearest cursor
      let opacity = visibleSet.has(id) ? baseOpacity : 0;

      // Apply rank-based tail fade for smooth cutoff
      const rFade = rankFade.get(id);
      if (rFade !== undefined) {
        opacity *= rFade;
      }

      // Cross-fade with cluster labels (bypassed during focus mode)
      opacity *= isFocusActive ? 1 : labelFadeT;

      if (isFocusMargin) {
        opacity *= isHovered ? 0.5 : 0.3;
      } else if (pulledPosition) {
        opacity *= isHovered ? 0.85 : 0.55;
      }

      const searchOpacity = searchOpacitiesRef.current?.get(id);
      if (searchOpacity !== undefined) {
        opacity *= searchOpacity;
      }

      const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
      if (Math.abs(material.opacity - clampedOpacity) > 0.01) {
        material.opacity = clampedOpacity;
        material.needsUpdate = true;
      }

      // Soft glow: shift color toward white (dark mode) or black (light mode)
      tempColor.copy(entry.baseColor);
      if (isHovered) {
        glowTarget.set(isDarkMode() ? 0xffffff : 0x000000);
        tempColor.lerp(glowTarget, 0.35);
      }
      if (!material.color.equals(tempColor)) {
        material.color.copy(tempColor);
      }

      billboard.visible = clampedOpacity > 0.02;
    });

    // Share content-eligible label set with ContentNodes (excludes margin-pushed)
    if (visibleLabelIdsRef) {
      if (isFocusActive && focusPositionsRef) {
        const contentSet = new Set<string>();
        for (const id of visibleSet) {
          if (!focusPositionsRef.current.has(id)) {
            contentSet.add(id);
          }
        }
        visibleLabelIdsRef.current = contentSet;
      } else {
        visibleLabelIdsRef.current = visibleSet;
      }
    }
  });

  if (labelMeta.length === 0) {
    return null;
  }

  return (
    <>
      {labelMeta.map(({ node, text, color, baseOpacity }) => (
        <KeywordLabelSprite
          key={node.id}
          node={node}
          text={text}
          color={color}
          baseOpacity={baseOpacity}
          baseFontSize={baseFontSize}
          labelZ={labelZ}
          registerLabel={registerLabel}
          focusPositionsRef={focusPositionsRef}
          pulledPositionsRef={pulledPositionsRef}
          flyToRef={flyToRef}
          onKeywordHover={onKeywordHover}
          onKeywordClick={onKeywordClick}
        />
      ))}
    </>
  );
}

interface KeywordLabelSpriteProps {
  node: SimNode;
  text: string;
  color: string;
  baseOpacity: number;
  baseFontSize: number;
  labelZ: number;
  registerLabel: (id: string, registration: LabelRegistration | null) => void;
  focusPositionsRef?: MutableRefObject<Map<string, { x: number; y: number }>>;
  pulledPositionsRef?: MutableRefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
  flyToRef?: MutableRefObject<((x: number, y: number) => void) | null>;
  onKeywordHover?: (keywordId: string | null) => void;
  onKeywordClick?: (keywordId: string) => void;
}

function KeywordLabelSprite({
  node,
  text,
  color,
  baseOpacity,
  baseFontSize,
  labelZ,
  registerLabel,
  focusPositionsRef,
  pulledPositionsRef,
  flyToRef,
  onKeywordHover,
  onKeywordClick,
}: KeywordLabelSpriteProps) {
  const geometryEntry = useThreeTextGeometry({
    text,
    fontSize: baseFontSize,
    fontUrl: FONT_DEFAULT,
    lineHeight: LABEL_LINE_HEIGHT,
    maxWidth: 150,
    hyphenate: false,
  });
  const billboardRef = useRef<THREE.Group>(null);
  const registrationRef = useRef<LabelRegistration | null>(null);
  const anchorOffset = useMemo<[number, number]>(() => {
    if (!geometryEntry) return [0, 0];
    const { min, max } = geometryEntry.planeBounds;
    // Anchor at horizontal center, top-aligned so label hangs below the dot
    return [(min.x + max.x) / 2, max.y];
  }, [geometryEntry]);

  // Invisible hit area covering the full bounding box of the label text
  // Returns { geo, center } so the mesh can be positioned at the text center
  // Hit area covering label text. No top padding — prevents overlap with keyword dot above.
  const hitArea = useMemo(() => {
    if (!geometryEntry) return null;
    const { min, max } = geometryEntry.planeBounds;
    const w = max.x - min.x;
    const h = max.y - min.y;
    const pad = h * 0.4;
    return {
      geo: new THREE.PlaneGeometry(w + pad * 2, h + pad),
      center: [(min.x + max.x) / 2, (min.y + max.y) / 2 - pad / 2, 0] as [number, number, number],
    };
  }, [geometryEntry]);

  useEffect(() => () => { hitArea?.geo.dispose(); }, [hitArea]);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        toneMapped: false,
        depthTest: false,
        depthWrite: false,
        opacity: baseOpacity,
      }),
    []
  );

  useEffect(() => {
    material.color.set(color);
    if (registrationRef.current) {
      registrationRef.current.baseColor.set(color);
    }
  }, [material, color]);

  useEffect(() => {
    material.opacity = baseOpacity;
  }, [material, baseOpacity]);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (!geometryEntry) {
      registerLabel(node.id, null);
      registrationRef.current = null;
      return;
    }

    const registration: LabelRegistration = {
      id: node.id,
      node,
      billboard: billboardRef.current,
      material,
      baseColor: new THREE.Color(color),
      baseFontSize,
      baseOpacity,
      labelZ,
    };

    registrationRef.current = registration;
    registerLabel(node.id, registration);
    return () => {
      registerLabel(node.id, null);
      registrationRef.current = null;
    };
  }, [geometryEntry, node, material, baseFontSize, baseOpacity, labelZ, registerLabel]);

  useEffect(() => {
    if (registrationRef.current) {
      registrationRef.current.baseOpacity = baseOpacity;
    }
  }, [baseOpacity]);

  const handlePointerOver = onKeywordHover
    ? () => {
      // Use shared handler for consistent behavior with dots
      handleKeywordHover({ node, onKeywordHover });
    }
    : undefined;

  const handlePointerOut = onKeywordHover
    ? () => {
      // Use shared handler for consistent behavior with dots
      handleKeywordHover({ node: null, onKeywordHover });
    }
    : undefined;

  const handleClick = onKeywordClick
    ? (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      // Use shared handler for consistent behavior with dots
      handleKeywordClick({
        node,
        focusPositionsRef,
        pulledPositionsRef,
        flyToRef,
        onKeywordClick,
      });
    }
    : undefined;

  const setBillboardRef = useCallback((instance: THREE.Group | null) => {
    billboardRef.current = instance;
    if (registrationRef.current) {
      registrationRef.current.billboard = instance;
    }
  }, []);

  if (!geometryEntry) {
    return null;
  }

  return (
    <Billboard ref={setBillboardRef} position={[node.x ?? 0, node.y ?? 0, labelZ]} follow={false} lockZ>
      <group position={[-anchorOffset[0], -anchorOffset[1], 0]}>
        <mesh
          geometry={geometryEntry.geometry}
          material={material}
          frustumCulled={false}
          raycast={() => { }} // text glyphs don't need raycasting; hit area handles it
        />
        {hitArea && (
          <mesh
            geometry={hitArea.geo}
            material={HIT_AREA_MAT}
            position={hitArea.center}
            frustumCulled={false}
            onPointerOver={handlePointerOver}
            onPointerOut={handlePointerOut}
            onClick={handleClick}
          />
        )}
      </group>
    </Billboard>
  );
}

