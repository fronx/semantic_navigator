import { useMemo, useRef } from "react";
import { Billboard } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Text as TroikaText } from "troika-three-text";
import { GraphTextLabel } from "./GraphTextLabel";
import { computeClusterLabels } from "@/lib/cluster-labels";
import { clusterColorToCSS, type ClusterColorInfo } from "@/lib/semantic-colors";
import type { SimNode } from "@/lib/map-renderer";

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
}

const DEFAULT_MIN_SCREEN_PX = 14;
const DEFAULT_BASE_FONT_SIZE = 52;
const FADE_START_PX = 30;
const FADE_END_PX = 80;

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
}: ClusterLabels3DProps) {
  const { camera, size } = useThree();

  const labelData = useMemo(() => {
    if (!visible || nodes.length === 0) {
      return [];
    }
    return computeClusterLabels({
      nodes,
      getColor: (communityId) => {
        if (clusterColors?.has(communityId)) {
          return clusterColorToCSS(clusterColors.get(communityId)!, colorDesaturation);
        }
        return clusterColorToCSS(
          { h: 220, s: 10, l: 60, pcaCentroid: [0, 0] },
          colorDesaturation
        );
      },
      nodeToCluster,
    });
  }, [visible, nodes, clusterColors, nodeToCluster, colorDesaturation]);

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
            camera={camera}
            size={size}
            minScreenPx={minScreenPx}
            baseFontSize={baseFontSize}
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
  camera: THREE.Camera;
  size: { width: number; height: number };
  minScreenPx: number;
  baseFontSize: number;
}

function ClusterLabelSprite({
  communityId,
  text,
  color,
  position,
  baseOpacity,
  onClusterLabelClick,
  camera,
  size,
  minScreenPx,
  baseFontSize,
}: ClusterLabelSpriteProps) {
  const textRef = useRef<TroikaText>(null);
  const billboardRef = useRef<THREE.Group>(null);
  const tempVec = useMemo(() => new THREE.Vector3(), []);
  const scaleVec = useMemo(() => new THREE.Vector3(), []);
  const cameraPos = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!textRef.current || !textRef.current.material || !billboardRef.current) return;
    const worldPosition = billboardRef.current.getWorldPosition(tempVec);
    const unitsPerPixel = computeUnitsPerPixel(camera, size, worldPosition, cameraPos);
    const minWorldSize = minScreenPx * unitsPerPixel;
    const desiredScale = Math.max(1, minWorldSize / baseFontSize);
    scaleVec.setScalar(desiredScale);
    if (!billboardRef.current.scale.equals(scaleVec)) {
      billboardRef.current.scale.setScalar(desiredScale);
    }

    const pixelSize = (baseFontSize * desiredScale) / unitsPerPixel;
    const fadeT = THREE.MathUtils.clamp(
      (pixelSize - FADE_START_PX) / (FADE_END_PX - FADE_START_PX),
      0,
      1
    );
    const smooth = fadeT * fadeT * (3 - 2 * fadeT); // smoothstep easing
    const sizeFade = 1 - smooth;
    const finalOpacity = baseOpacity * sizeFade;
    const material = textRef.current.material as THREE.Material & { opacity: number; transparent: boolean };
    if (material.opacity !== finalOpacity) {
      material.opacity = finalOpacity;
      material.transparent = true;
      material.needsUpdate = true;
    }
    if (textRef.current.fillOpacity !== finalOpacity) {
      textRef.current.fillOpacity = finalOpacity;
      textRef.current.outlineOpacity = finalOpacity;
    }
  });

  const handleClick = onClusterLabelClick
    ? (event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        onClusterLabelClick(communityId);
      }
    : undefined;

  return (
    <Billboard ref={billboardRef} position={position} follow={false} lockZ>
      <GraphTextLabel
        ref={textRef}
        text={text}
        color={color}
        fontSize={baseFontSize}
        opacity={baseOpacity}
        onClick={handleClick}
      />
    </Billboard>
  );
}

function computeUnitsPerPixel(
  camera: THREE.Camera,
  size: { width: number; height: number },
  position: THREE.Vector3,
  cameraPos: THREE.Vector3
) {
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const perspective = camera as THREE.PerspectiveCamera;
    const distance = cameraPos.copy(perspective.position).distanceTo(position);
    const fov = THREE.MathUtils.degToRad(perspective.fov);
    return (2 * Math.tan(fov / 2) * Math.max(distance, 1e-3)) / size.height;
  }

  const ortho = camera as THREE.OrthographicCamera;
  const height = ortho.top - ortho.bottom;
  return height / size.height;
}
