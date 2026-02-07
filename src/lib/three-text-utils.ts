import * as THREE from "three";

export interface ViewportSize {
  width: number;
  height: number;
}

export function computeUnitsPerPixel(
  camera: THREE.Camera,
  size: ViewportSize,
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

export function smoothstep(t: number) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
