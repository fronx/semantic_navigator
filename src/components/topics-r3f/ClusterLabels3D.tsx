import { useCallback, useEffect, useMemo, useRef } from "react";
import { Billboard } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { computeClusterLabels } from "@/lib/cluster-labels";
import { clusterColorToCSS, type ClusterColorInfo } from "@/lib/semantic-colors";
import { getGlobalContrastParams } from "@/lib/rendering-utils/node-renderer";
import type { SimNode } from "@/lib/map-renderer";
import type { FocusState } from "@/lib/focus-mode";
import { useThreeTextGeometry } from "@/hooks/useThreeTextGeometry";
import { computeUnitsPerPixel, smoothstep } from "@/lib/three-text-utils";
import { isDarkMode } from "@/lib/theme";

function buildClusterSearchOpacity(
  nodeToCluster: Map<string, number> | undefined,
  searchOpacities?: Map<string, number>
): Map<number, number> | null {
  if (!nodeToCluster || !searchOpacities || searchOpacities.size === 0) {
    return null;
  }

  const map = new Map<number, number>();
  for (const [nodeId, opacity] of searchOpacities.entries()) {
    const clusterId = nodeToCluster.get(nodeId);
    if (clusterId === undefined) continue;
    const current = map.get(clusterId) ?? 0;
    map.set(clusterId, Math.max(current, opacity));
  }
  return map;
}

export interface ClusterLabels3DProps {
  nodes: SimNode[];
  clusterColors?: Map<number, ClusterColorInfo>;
  nodeToCluster?: Map<string, number>;
  searchOpacities?: Map<string, number>;
  labelZ?: number;
  onClusterLabelClick?: (clusterId: number) => void;
  visible?: boolean;
  minScreenPx?: number;
  baseFontSize?: number;
  colorDesaturation?: number;
  /** Global color contrast (0-1). Used as useMemo dependency to trigger recomputation. */
  globalContrast?: number;
  /** Cross-fade value from label fade coordinator (0 = clusters visible, 1 = keywords visible) */
  labelFadeT?: number;
  /** Focus state — when active, only show cluster labels for clusters with focused nodes */
  focusState?: FocusState | null;
  /** Shadow strength (0 = no shadow, 2 = extra strong) */
  shadowStrength?: number;
}

const DEFAULT_MIN_SCREEN_PX = 18;
const DEFAULT_BASE_FONT_SIZE = 52;
const FADE_START_PX = 60;
const FADE_END_PX = 100;
const LABEL_LINE_HEIGHT = 1.05;
const FONT_DEFAULT = "/fonts/source-code-pro-regular.woff2";

interface LabelRegistration {
  communityId: number;
  billboard: THREE.Group | null;
  material: THREE.MeshBasicMaterial;
  shadowMaterial: THREE.MeshBasicMaterial;
  baseOpacity: number;
  baseFontSize: number;
  clusterNodes: SimNode[];
  labelZ: number;
}

export function ClusterLabels3D({
  nodes,
  clusterColors,
  nodeToCluster,
  searchOpacities,
  labelZ = 0,
  onClusterLabelClick,
  visible = true,
  minScreenPx = DEFAULT_MIN_SCREEN_PX,
  baseFontSize = DEFAULT_BASE_FONT_SIZE,
  colorDesaturation = 0,
  globalContrast = 0,
  labelFadeT = 0,
  focusState,
  shadowStrength = 0.8,
}: ClusterLabels3DProps) {
  const { camera, size } = useThree();
  const labelRegistry = useRef(new Map<number, LabelRegistration>());
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const scaleVec = useMemo(() => new THREE.Vector3(), []);
  const cameraPos = useMemo(() => new THREE.Vector3(), []);

  const registerLabel = useCallback(
    (communityId: number, data: LabelRegistration | null) => {
      if (data) {
        labelRegistry.current.set(communityId, data);
      } else {
        labelRegistry.current.delete(communityId);
      }
    },
    []
  );

  useFrame(() => {
    labelRegistry.current.forEach((entry) => {
      const { billboard, material, shadowMaterial, baseOpacity, baseFontSize, clusterNodes, labelZ } = entry;
      if (!billboard) return;
      if (clusterNodes && clusterNodes.length > 0) {
        let sumX = 0;
        let sumY = 0;
        for (const node of clusterNodes) {
          sumX += node.x ?? 0;
          sumY += node.y ?? 0;
        }
        billboard.position.set(sumX / clusterNodes.length, sumY / clusterNodes.length, labelZ);
      }
      const worldPosition = billboard.getWorldPosition(tempVec);
      const unitsPerPixel = computeUnitsPerPixel(camera, size, worldPosition, cameraPos);
      const minWorldSize = minScreenPx * unitsPerPixel;
      const desiredScale = Math.max(1, minWorldSize / baseFontSize);
      scaleVec.setScalar(desiredScale);
      if (!billboard.scale.equals(scaleVec)) {
        billboard.scale.setScalar(desiredScale);
      }

      const pixelSize = (baseFontSize * desiredScale) / unitsPerPixel;
      const fadeT = (pixelSize - FADE_START_PX) / (FADE_END_PX - FADE_START_PX);
      // When cluster labels are primary (labelFadeT near 0), skip size fade
      // to keep them visible even when small on screen
      const sizeFade = labelFadeT > 0.5 ? 1 - smoothstep(fadeT) : 1.0;
      const finalOpacity = baseOpacity * sizeFade * (1 - labelFadeT);

      for (const mat of [material, shadowMaterial]) {
        if (mat.opacity !== finalOpacity) {
          mat.opacity = finalOpacity;
          mat.needsUpdate = true;
        }
      }
    });
  });

  const labelData = useMemo(() => {
    if (!visible || nodes.length === 0) {
      return [];
    }
    const all = computeClusterLabels({
      nodes,
      getColor: (communityId) => {
        const { amount: contrast, isDark } = getGlobalContrastParams();
        if (clusterColors?.has(communityId)) {
          return clusterColorToCSS(clusterColors.get(communityId)!, colorDesaturation, contrast, isDark);
        }
        return clusterColorToCSS(
          { h: 220, s: 10, l: 60, pcaCentroid: [0, 0] },
          colorDesaturation, contrast, isDark
        );
      },
      nodeToCluster,
    });

    // In focus mode, only show clusters that contain at least one focused node
    if (focusState && nodeToCluster) {
      return all.filter((data) => {
        return nodes.some(
          (n) => nodeToCluster.get(n.id) === data.communityId && focusState.focusedNodeIds.has(n.id)
        );
      });
    }

    return all;
  // globalContrast is read from module-level state inside getColor, but listed as dep to trigger recomputation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, nodes, clusterColors, nodeToCluster, colorDesaturation, globalContrast, focusState]);

  const clusterSearchOpacity = useMemo(
    () => buildClusterSearchOpacity(nodeToCluster, searchOpacities),
    [nodeToCluster, searchOpacities]
  );

  if (!visible || labelData.length === 0) {
    return null;
  }

  return (
    <>
      {labelData.map((data) => {
        const nodesInCluster = nodes.filter(
          (node) => nodeToCluster?.get(node.id) === data.communityId
        );
        const text = data.label.split(/\s+/).join("\n");
        const visibilityOpacity = Math.max(0.2, data.visibilityRatio) * 0.7;
        const searchOpacity = clusterSearchOpacity?.get(data.communityId) ?? 1;
        const baseOpacity = Math.min(1, visibilityOpacity * searchOpacity);
        return (
          <ClusterLabelSprite
            key={data.communityId}
            communityId={data.communityId}
            text={text}
            color={data.color}
            position={[data.centroid[0], data.centroid[1], labelZ]}
            baseOpacity={baseOpacity}
            onClusterLabelClick={onClusterLabelClick}
            baseFontSize={baseFontSize}
            registerLabel={registerLabel}
            clusterNodes={nodesInCluster}
            labelZ={labelZ}
            shadowStrength={shadowStrength}
          />
        );
      })}
    </>
  );
}

interface ClusterLabelSpriteProps {
  communityId: number;
  text: string;
  color: string;
  position: [number, number, number];
  baseOpacity: number;
  onClusterLabelClick?: (clusterId: number) => void;
  baseFontSize: number;
  registerLabel: (communityId: number, data: LabelRegistration | null) => void;
  clusterNodes: SimNode[];
  labelZ: number;
  shadowStrength: number;
}

function ClusterLabelSprite({
  communityId,
  text,
  color,
  position,
  baseOpacity,
  onClusterLabelClick,
  baseFontSize,
  registerLabel,
  clusterNodes,
  labelZ,
  shadowStrength,
}: ClusterLabelSpriteProps) {
  const geometryEntry = useThreeTextGeometry({
    text,
    fontSize: baseFontSize,
    fontUrl: FONT_DEFAULT,
    lineHeight: LABEL_LINE_HEIGHT,
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
        side: THREE.DoubleSide,
        opacity: baseOpacity,
      }),
    [color, baseOpacity]
  );

  // Shadow material (dark version for background)
  const shadowMaterial = useMemo(() => {
    const isDark = isDarkMode();
    const shadowColor = isDark ? "#000000" : "#333333";
    return new THREE.MeshBasicMaterial({
      color: shadowColor,
      transparent: true,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: baseOpacity, // Updated dynamically in useFrame to match label
    });
  }, [baseOpacity]);

  useEffect(() => {
    material.color.set(color);
  }, [material, color]);

  useEffect(() => {
    material.opacity = baseOpacity;
  }, [material, baseOpacity]);

  useEffect(() => () => {
    material.dispose();
  }, [material]);

  useEffect(() => () => {
    shadowMaterial.dispose();
  }, [shadowMaterial]);

  useEffect(() => {
    if (!geometryEntry) {
      registerLabel(communityId, null);
      registrationRef.current = null;
      return;
    }
    const registration: LabelRegistration = {
      communityId,
      billboard: billboardRef.current,
      material,
      shadowMaterial,
      baseOpacity,
      baseFontSize,
      clusterNodes,
      labelZ,
    };
    registrationRef.current = registration;
    registerLabel(communityId, registration);
    return () => {
      registerLabel(communityId, null);
      registrationRef.current = null;
    };
  }, [communityId, geometryEntry, material, shadowMaterial, baseFontSize, registerLabel]);

  useEffect(() => {
    if (registrationRef.current) {
      registrationRef.current.baseOpacity = baseOpacity;
    }
  }, [baseOpacity]);

  const handleClick = onClusterLabelClick
    ? (event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onClusterLabelClick(communityId);
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
    <Billboard ref={setBillboardRef} position={position} follow={false} lockZ>
      <group position={[-anchorOffset[0], -anchorOffset[1], 0]}>
        {/* Shadow layer positioned close behind text */}
        {shadowStrength > 0 && (
          <mesh
            geometry={geometryEntry.geometry}
            material={shadowMaterial}
            position={[2, -2, -0.13]}
            frustumCulled={false}
          />
        )}
        {/* Label mesh (rendered last, appears in front) */}
        <mesh
          geometry={geometryEntry.geometry}
          material={material}
          frustumCulled={false}
          onClick={handleClick}
        />
      </group>
    </Billboard>
  );
}
