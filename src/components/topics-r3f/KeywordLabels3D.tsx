import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { Billboard } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { SimNode } from "@/lib/map-renderer";
import type { PCATransform, ClusterColorInfo } from "@/lib/semantic-colors";
import type { KeywordTierMap } from "@/lib/topics-filter";
import type { ViewportSize } from "@/lib/three-text-utils";
import { computeUnitsPerPixel, smoothstep } from "@/lib/three-text-utils";
import { useThreeTextGeometry } from "@/hooks/useThreeTextGeometry";
import { getNodeColor } from "@/lib/three/node-renderer";
import { isDarkMode } from "@/lib/theme";
import type { LabelRefs } from "./R3FLabelContext";

const FONT_DEFAULT = "/fonts/source-code-pro-regular.woff2";
const LABEL_LINE_HEIGHT = 1.05;
const DEFAULT_MIN_SCREEN_PX = 12;
const DEFAULT_BASE_FONT_SIZE = 12;
const FADE_START_PX = 60;
const FADE_END_PX = 100;

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
  baseFontSize?: number;
  labelZ?: number;
  keywordTiers?: KeywordTierMap | null;
  pulledPositionsRef?: LabelRefs["pulledPositionsRef"];
  /** Focus-animated positions (margin push) — highest priority position override */
  focusPositionsRef?: MutableRefObject<Map<string, { x: number; y: number }>>;
  hoveredKeywordIdRef?: MutableRefObject<string | null>;
  /** Cursor position in world space for proximity filtering */
  cursorWorldPosRef?: MutableRefObject<{ x: number; y: number } | null>;
  /** Cross-fade value from label fade coordinator (0 = hidden, 1 = fully visible) */
  labelFadeT?: number;
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
  baseFontSize = DEFAULT_BASE_FONT_SIZE,
  labelZ = 0,
  keywordTiers,
  pulledPositionsRef,
  focusPositionsRef,
  hoveredKeywordIdRef,
  cursorWorldPosRef,
  labelFadeT = 0,
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
        if (tier === "neighbor-2") {
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

    // Build proximity ranking: closest MAX_VISIBLE_LABELS labels to cursor
    const visibleSet = new Set<string>();
    // Map from id -> rank-based fade (1.0 for top labels, fades for tail)
    const rankFade = new Map<string, number>();

    if (isFocusActive) {
      // Focus mode: all labels visible, no cursor dependency
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

      // Position priority: focus (margin push) > pulled (edge magnets) > natural
      const focusPos = focusPositionsRef?.current.get(id);
      const pulledPosition = !focusPos ? pulledPositionsRef?.current.get(id) : undefined;
      const isFocusMargin = !!focusPos;
      const x = focusPos?.x ?? pulledPosition?.x ?? node.x ?? 0;
      const y = focusPos?.y ?? pulledPosition?.y ?? node.y ?? 0;
      billboard.position.set(x, y, entry.labelZ);

      const worldPosition = billboard.getWorldPosition(tempVec);
      const unitsPerPixel = computeUnitsPerPixel(
        camera,
        size as ViewportSize,
        worldPosition,
        cameraPos
      );

      const minWorldSize = minScreenPx * unitsPerPixel;
      let desiredScale = Math.max(1, minWorldSize / fontSize);

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

      // Fade out when label gets too large on screen
      const pixelSize = (fontSize * desiredScale) / unitsPerPixel;
      const sizeFadeT = (pixelSize - FADE_START_PX) / (FADE_END_PX - FADE_START_PX);
      opacity *= 1 - smoothstep(sizeFadeT);

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
    return [(min.x + max.x) / 2, (min.y + max.y) / 2];
  }, [geometryEntry]);

  // Invisible hit area covering the full bounding box of the label text
  const hitAreaGeo = useMemo(() => {
    if (!geometryEntry) return null;
    const { min, max } = geometryEntry.planeBounds;
    const w = max.x - min.x;
    const h = max.y - min.y;
    const pad = h * 0.15; // small padding around text
    return new THREE.PlaneGeometry(w + pad * 2, h + pad * 2);
  }, [geometryEntry]);

  useEffect(() => () => { hitAreaGeo?.dispose(); }, [hitAreaGeo]);

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
    ? (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      onKeywordHover(node.id);
    }
    : undefined;

  const handlePointerOut = onKeywordHover
    ? (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      onKeywordHover(null);
    }
    : undefined;

  const handleClick = onKeywordClick
    ? (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onKeywordClick(node.id);
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
          raycast={() => {}} // text glyphs don't need raycasting; hit area handles it
        />
        {hitAreaGeo && (
          <mesh
            geometry={hitAreaGeo}
            material={HIT_AREA_MAT}
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

