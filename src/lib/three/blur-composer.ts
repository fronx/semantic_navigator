import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { EdgeRenderer } from "./edge-renderer";
import { KEYWORD_LAYER, CHUNK_LAYER, PANEL_LAYER } from "./node-renderer";

export interface BlurComposerOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  container: HTMLElement;
  /** Returns the configured blur radius (0 → maxRadius) */
  getBlurRadius: () => number;
  /** Maximum blur radius used in zoomPhaseConfig */
  maxBlurRadius: number;
  edgeRenderer: EdgeRenderer;
  originalRender: (scene: THREE.Scene, camera: THREE.Camera) => void;
}

export interface BlurComposer {
  render(): void;
  updateSize(width: number, height: number): void;
  updateCameras(): void;
  dispose(): void;
}

export function createBlurComposer(options: BlurComposerOptions): BlurComposer {
  const {
    renderer,
    scene,
    camera,
    container,
    getBlurRadius,
    maxBlurRadius,
    edgeRenderer,
    originalRender,
  } = options;

  const rect = container.getBoundingClientRect();
  let width = rect.width;
  let height = rect.height;

  const panelMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#f3f4f6"),
    roughness: 0.45,
    metalness: 0.0,
    transparent: true,
    opacity: 0.0,
    transmission: 0.0,
    thickness: 0.05,
    ior: 1.1,
    attenuationDistance: 6,
    attenuationColor: new THREE.Color("#e5e7eb"),
    clearcoat: 0.2,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.05,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
  });
  const panelGeometry = new THREE.PlaneGeometry(1, 1);
  const panelMesh = new THREE.Mesh(panelGeometry, panelMaterial);
  panelMesh.layers.set(PANEL_LAYER);
  panelMesh.frustumCulled = false;
  scene.add(panelMesh);

  const tempDir = new THREE.Vector3();
  const tempPos = new THREE.Vector3();
  const PANEL_DISTANCE = 50;

  function updatePanelTransform(): void {
    const cam = camera as THREE.PerspectiveCamera;
    cam.getWorldDirection(tempDir);
    tempPos.copy(cam.position).add(tempDir.multiplyScalar(PANEL_DISTANCE));
    panelMesh.position.copy(tempPos);
    panelMesh.quaternion.copy(cam.quaternion);

    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * PANEL_DISTANCE;
    const viewWidth = viewHeight * cam.aspect;
    panelMesh.scale.set(viewWidth, viewHeight, 1);
  }

  function updateLineResolutions(resWidth: number, resHeight: number): void {
    const lines = edgeRenderer.getAllLineObjects();
    for (const line of lines) {
      const mat = line.material as LineMaterial;
      if (mat.resolution) {
        mat.resolution.set(resWidth, resHeight);
      }
    }
  }

  updateLineResolutions(width, height);

  function applyPanelStrength(strength: number): void {
    const clamped = THREE.MathUtils.clamp(strength, 0, 1);
    panelMaterial.opacity = THREE.MathUtils.lerp(0.05, 0.75, clamped);
    panelMaterial.transmission = THREE.MathUtils.lerp(0.15, 1.0, clamped);
    panelMaterial.thickness = THREE.MathUtils.lerp(0.05, 0.4, clamped);
    panelMaterial.roughness = THREE.MathUtils.lerp(0.6, 0.25, clamped);
    panelMaterial.envMapIntensity = THREE.MathUtils.lerp(0.05, 0.3, clamped);
  }

  function render(): void {
    const blurRadius = getBlurRadius();
    const strength = maxBlurRadius > 0 ? Math.min(1, blurRadius / maxBlurRadius) : 0;

    const previousMask = camera.layers.mask;
    const previousAutoClear = renderer.autoClear;
    const previousTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    renderer.clear(true, true, true);

    camera.layers.set(0);
    camera.layers.enable(KEYWORD_LAYER);
    originalRender(scene, camera);

    if (strength > 0.001) {
      panelMesh.visible = true;
      applyPanelStrength(strength);
      updatePanelTransform();

      renderer.autoClear = false;
      renderer.clearDepth();
      camera.layers.set(PANEL_LAYER);
      originalRender(scene, camera);
    } else {
      panelMesh.visible = false;
    }

    renderer.autoClear = false;
    renderer.clearDepth();
    camera.layers.set(CHUNK_LAYER);
    originalRender(scene, camera);

    camera.layers.mask = previousMask;
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }

  function updateSize(newWidth: number, newHeight: number): void {
    width = Math.max(1, newWidth);
    height = Math.max(1, newHeight);
    updateLineResolutions(width, height);
  }

  function updateCameras(): void {
    // Panel transform is recomputed on every render when visible.
  }

  function dispose(): void {
    panelGeometry.dispose();
    panelMaterial.dispose();
    scene.remove(panelMesh);
  }

  return {
    render,
    updateSize,
    updateCameras,
    dispose,
  };
}
