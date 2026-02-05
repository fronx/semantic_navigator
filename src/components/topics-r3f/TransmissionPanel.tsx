/**
 * Frosted glass transmission panel between keyword and chunk layers.
 * Uses MeshTransmissionMaterial for blur effect (inspired by drei Nike example).
 *
 * Position and size are computed atomically in useFrame to prevent flickering.
 * Panel is sized to exactly cover the visible viewport at its Z position,
 * rather than using a huge fixed size (which was causing performance issues).
 */

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshTransmissionMaterial } from "@react-three/drei";
import type { Mesh, PerspectiveCamera } from "three";

// Base panel size in world units - matches original fixed size
// (using 1x1 caused issues with MeshTransmissionMaterial's internal calculations)
const BASE_PANEL_SIZE = 10000;

export interface TransmissionPanelProps {
  enabled?: boolean;
  /** Ratio of distance from camera to keywords (0 = at camera, 1 = at keywords) */
  distanceRatio: number;
  /** Material thickness (controls blur strength, 0 = no blur, 20 = full blur) */
  thickness: number;
}

export function TransmissionPanel({ enabled = true, distanceRatio, thickness }: TransmissionPanelProps) {
  const meshRef = useRef<Mesh>(null);
  const { camera, viewport } = useThree();

  // Update panel position and size every frame based on current camera
  // This ensures atomic updates - no intermediate frames with stale values
  useFrame(() => {
    if (!meshRef.current) return;

    // Panel Z position = ratio * camera.z
    // When ratio = 0, panel is at keyword layer (z=0, behind keywords, no blur)
    // When ratio = 1, panel is at camera position (max distance, max blur)
    const panelZ = camera.position.z * distanceRatio;

    // Calculate visible area at panel's Z position
    // Distance from camera to panel
    const distanceToPanel = camera.position.z - panelZ;

    // Guard against invalid states (camera not initialized, division issues)
    if (distanceToPanel <= 0 || !isFinite(distanceToPanel)) {
      meshRef.current.visible = false;
      return;
    }

    // For perspective camera: visible height = 2 * distance * tan(fov/2)
    const perspCam = camera as PerspectiveCamera;
    const fovRadians = (perspCam.fov * Math.PI) / 180;
    const visibleHeight = 2 * distanceToPanel * Math.tan(fovRadians / 2);
    const visibleWidth = visibleHeight * viewport.aspect;

    // Guard against invalid computed values
    if (!isFinite(visibleWidth) || !isFinite(visibleHeight) || visibleWidth <= 0 || visibleHeight <= 0) {
      meshRef.current.visible = false;
      return;
    }

    // Panel X/Y follows camera to stay centered in viewport
    meshRef.current.position.set(camera.position.x, camera.position.y, panelZ);

    // Add small margin (5%) to prevent edge artifacts during fast panning
    // Scale relative to BASE_PANEL_SIZE (geometry is created at this size)
    const margin = 1.05;
    meshRef.current.scale.set(
      (visibleWidth * margin) / BASE_PANEL_SIZE,
      (visibleHeight * margin) / BASE_PANEL_SIZE,
      1
    );

    // Only show when we have valid position and scale
    meshRef.current.visible = true;
  });

  if (!enabled) return null;

  const resolution = thickness > 0 ? 1024 : undefined;
  return (
    <mesh ref={meshRef} visible={false} raycast={() => null}>
      {/* Base size panel, scaled in useFrame to match viewport */}
      <planeGeometry args={[BASE_PANEL_SIZE, BASE_PANEL_SIZE]} />
      <MeshTransmissionMaterial
        samples={16}
        resolution={resolution}
        thickness={thickness}
        roughness={1.0}
        transmission={0.97}
        anisotropicBlur={5.0}
      />
    </mesh>
  );
}
