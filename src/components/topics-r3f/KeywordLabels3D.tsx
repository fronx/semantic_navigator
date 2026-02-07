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
import type { LabelRefs } from "./R3FLabelContext";

const FONT_DEFAULT = "/fonts/source-code-pro-regular.woff2";
const LABEL_LINE_HEIGHT = 1.05;
const DEFAULT_MIN_SCREEN_PX = 12;
const DEFAULT_BASE_FONT_SIZE = 12;
const FADE_START_PX = 60;
const FADE_END_PX = 100;

interface KeywordLabelRange {
  start: number;
  full: number;
}

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
  baseFontSize: number;
  baseOpacity: number;
  labelZ: number;
}

export interface KeywordLabels3DProps {
  nodes: SimNode[];
  nodeDegrees: Map<string, number>;
  keywordLabelRange: KeywordLabelRange;
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
  hoveredKeywordIdRef?: MutableRefObject<string | null>;
  onKeywordHover?: (keywordId: string | null) => void;
  onKeywordClick?: (keywordId: string) => void;
}

export function KeywordLabels3D({
  nodes,
  nodeDegrees,
  keywordLabelRange,
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
  hoveredKeywordIdRef,
  onKeywordHover,
  onKeywordClick,
}: KeywordLabels3DProps) {
  const { camera, size } = useThree();
  const labelRegistry = useRef(new Map<string, LabelRegistration>());
  const nodeDegreesRef = useRef(nodeDegrees);
  nodeDegreesRef.current = nodeDegrees;
  const searchOpacitiesRef = useRef(searchOpacities);
  searchOpacitiesRef.current = searchOpacities;
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const scaleVec = useMemo(() => new THREE.Vector3(), []);
  const cameraPos = useMemo(() => new THREE.Vector3(), []);

  const maxDegree = useMemo(() => {
    let max = 1;
    nodeDegrees.forEach((value) => {
      if (value > max) max = value;
    });
    return max;
  }, [nodeDegrees]);

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

  useFrame(() => {
    const degreeThreshold = computeDegreeThreshold(
      camera.position.z,
      keywordLabelRange,
      maxDegree
    );

    labelRegistry.current.forEach((entry) => {
      const { id, node, billboard, material, baseFontSize: fontSize, baseOpacity } = entry;
      if (!billboard) return;

      const pulledPosition = pulledPositionsRef?.current.get(id);
      const x = pulledPosition?.x ?? node.x ?? 0;
      const y = pulledPosition?.y ?? node.y ?? 0;
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

      if (hoveredKeywordIdRef?.current === id) {
        desiredScale *= 1.3;
      } else if (pulledPosition) {
        desiredScale *= 0.9;
      }

      scaleVec.setScalar(desiredScale);
      if (!billboard.scale.equals(scaleVec)) {
        billboard.scale.copy(scaleVec);
      }

      const degree = nodeDegreesRef.current.get(id) ?? 0;
      let opacity = degree >= degreeThreshold ? baseOpacity : 0;

      if (pulledPosition) {
        opacity *= 0.55;
      }

      const searchOpacity = searchOpacitiesRef.current?.get(id);
      if (searchOpacity !== undefined) {
        opacity *= searchOpacity;
      }

      const pixelSize = (fontSize * desiredScale) / unitsPerPixel;
      const fadeT = (pixelSize - FADE_START_PX) / (FADE_END_PX - FADE_START_PX);
      opacity *= 1 - smoothstep(fadeT);

      const clampedOpacity = THREE.MathUtils.clamp(opacity, 0, 1);
      if (Math.abs(material.opacity - clampedOpacity) > 0.01) {
        material.opacity = clampedOpacity;
        material.needsUpdate = true;
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
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        />
      </group>
    </Billboard>
  );
}

function computeDegreeThreshold(cameraZ: number, range: KeywordLabelRange, maxDegree: number) {
  const start = Math.max(range.start, range.full);
  const full = Math.min(range.start, range.full);

  if (cameraZ >= start) {
    return Infinity;
  }
  if (cameraZ <= full) {
    return 0;
  }

  const t = (cameraZ - full) / (start - full || 1);
  return t * maxDegree;
}
