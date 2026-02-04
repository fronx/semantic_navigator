/**
 * Frosted glass transmission panel between keyword and chunk layers.
 * Uses MeshTransmissionMaterial for blur effect (inspired by drei Nike example).
 *
 * Position is computed atomically in useFrame to prevent flickering during zoom.
 */

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshTransmissionMaterial } from "@react-three/drei";
import type { Mesh } from "three";

export interface TransmissionPanelProps {
  enabled?: boolean;
  /** Ratio of distance from camera to keywords (0 = at camera, 1 = at keywords) */
  distanceRatio: number;
  /** Material thickness (controls blur strength, 0 = no blur, 20 = full blur) */
  thickness: number;
}

export function TransmissionPanel({ enabled = true, distanceRatio, thickness }: TransmissionPanelProps) {
  const meshRef = useRef<Mesh>(null);
  const { camera } = useThree();

  // Update panel position every frame based on current camera position
  // This ensures atomic updates - no intermediate frames where camera has moved but panel hasn't
  useFrame(() => {
    if (meshRef.current) {
      // Panel position = ratio * camera.z
      // When ratio = 0, panel is at keyword layer (z=0, behind keywords, no blur)
      // When ratio = 1, panel is at camera position (max distance, max blur)
      meshRef.current.position.z = camera.position.z * distanceRatio;
    }
  });

  if (!enabled) return null;

  // Large enough to cover the viewport at all zoom levels
  const panelSize = 10000;
  const resolution = thickness > 0 ? 1024 : undefined; // Max res when no blur needed
  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <planeGeometry args={[panelSize, panelSize]} />
      <MeshTransmissionMaterial
        samples={16}
        resolution={resolution}
        thickness={thickness}
        roughness={1.0}
        transmission={0.97}
        // ior={1.5}
        anisotropicBlur={5.0}
      // distortion={1.0}
      // distortionScale={0.5}
      // temporalDistortion={0.1}
      // chromaticAberration={0.05}
      // backside
      />
    </mesh>
  );
}
