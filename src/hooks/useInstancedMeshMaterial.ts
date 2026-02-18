/**
 * Hook to initialize instanceColor and material for an instancedMesh.
 * Ensures vertex colors work by creating the material after instanceColor exists.
 */

import { useRef, useCallback } from "react";
import * as THREE from "three";
import { createChunkShaderMaterial } from "@/lib/chunks-shader";

export function useInstancedMeshMaterial(instanceCount: number) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  // Store instanceCount in a ref so the callback doesn't need to change identity
  const instanceCountRef = useRef(instanceCount);
  instanceCountRef.current = instanceCount;

  // Stable callback ref — never changes identity, so R3F won't
  // trigger the cleanup/setup cycle on every parent re-render.
  const handleMeshRef = useCallback((mesh: THREE.InstancedMesh | null) => {
    meshRef.current = mesh;

    if (!mesh) {
      materialRef.current = null;
      return;
    }

    if (!mesh.instanceColor) {
      const count = instanceCountRef.current;
      // FIRST: Create instanceColor attribute with default white color
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = 1; // R
        colors[i * 3 + 1] = 1; // G
        colors[i * 3 + 2] = 1; // B
      }
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      mesh.instanceColor.needsUpdate = true;

      // Per-instance opacity (1.0 = fully opaque). Dim factors (search, preview, pull)
      // are written here rather than darkening the color, so dimmed nodes fade to
      // transparent rather than black.
      const opacities = new Float32Array(count).fill(1.0);
      mesh.geometry.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(opacities, 1));

      // Per-instance corner ratio: 0.08 = rectangle, 1.0 = circle.
      // Written each frame from the scale loop based on effective screen size.
      const cornerRatios = new Float32Array(count).fill(1.0);
      mesh.geometry.setAttribute('instanceCornerRatio', new THREE.InstancedBufferAttribute(cornerRatios, 1));

      // SECOND: Create and attach material AFTER instanceColor exists
      // This ensures the shader compiles with USE_INSTANCING_COLOR defined.

      // Dispose old material if it exists
      if (mesh.material) {
        (mesh.material as THREE.Material).dispose();
      }

      const material = createChunkShaderMaterial();
      mesh.material = material;
      materialRef.current = material;

      // CRITICAL: Force shader recompilation to include instanceColor support
      material.needsUpdate = true;
    }
  }, []);

  return { meshRef, materialRef, handleMeshRef };
}
