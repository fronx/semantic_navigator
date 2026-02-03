import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { EdgeRenderer } from "./edge-renderer";
import { KEYWORD_LAYER, CHUNK_LAYER, PANEL_LAYER } from "./node-renderer";

// ============================================================================
// Gaussian Blur Shaders
// ============================================================================

function createGaussianCoefficients(kernelRadius: number): number[] {
  const coefficients: number[] = [];
  const sigma = kernelRadius / 3;

  for (let i = 0; i < kernelRadius; i++) {
    coefficients.push(0.39894 * Math.exp(-0.5 * i * i / (sigma * sigma)) / sigma);
  }

  return coefficients;
}

const BLUR_KERNEL_RADIUS = 5;
const blurCoefficients = createGaussianCoefficients(BLUR_KERNEL_RADIUS);

const blurVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const blurFragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform vec2 direction;
  uniform float kernel[${BLUR_KERNEL_RADIUS}];

  varying vec2 vUv;

  void main() {
    vec2 invSize = 1.0 / resolution;
    float weightSum = kernel[0];
    vec4 color = texture2D(tDiffuse, vUv) * weightSum;

    for (int i = 1; i < ${BLUR_KERNEL_RADIUS}; i++) {
      vec2 offset = direction * float(i) * invSize;
      color += texture2D(tDiffuse, vUv + offset) * kernel[i];
      color += texture2D(tDiffuse, vUv - offset) * kernel[i];
      weightSum += 2.0 * kernel[i];
    }

    gl_FragColor = color / weightSum;
  }
`;

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
  render(enabled?: boolean): void;
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

  // ---------------------------------------------------------------------------
  // Clone Camera for Blur Passes
  // ---------------------------------------------------------------------------

  // CRITICAL: Clone the camera for blur rendering so we NEVER modify the main camera's layers
  // 3d-force-graph uses the main camera for raycasting, so touching its layers breaks hover detection
  const blurCamera3D = (camera as THREE.PerspectiveCamera).clone();

  // ---------------------------------------------------------------------------
  // Blur Render Targets
  // ---------------------------------------------------------------------------

  const keywordsRenderTarget = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  const blurRenderTargetH = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  const blurRenderTargetV = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  // ---------------------------------------------------------------------------
  // Blur Materials
  // ---------------------------------------------------------------------------

  const blurMaterialH = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(width, height) },
      direction: { value: new THREE.Vector2(1.0, 0.0) },
      kernel: { value: blurCoefficients },
    },
    vertexShader: blurVertexShader,
    fragmentShader: blurFragmentShader,
  });

  const blurMaterialV = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(width, height) },
      direction: { value: new THREE.Vector2(0.0, 1.0) },
      kernel: { value: blurCoefficients },
    },
    vertexShader: blurVertexShader,
    fragmentShader: blurFragmentShader,
  });

  // Fullscreen quad for blur passes
  const blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterialH);
  const blurScene = new THREE.Scene();
  blurScene.add(blurQuad);
  const blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Fullscreen quad for displaying blurred result
  const screenMaterial = new THREE.MeshBasicMaterial({ map: null });
  const screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), screenMaterial);
  const screenScene = new THREE.Scene();
  screenScene.add(screenQuad);

  // ---------------------------------------------------------------------------
  // Panel Material (with blurred texture)
  // ---------------------------------------------------------------------------

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

  function render(enabled = true): void {
    const blurRadius = getBlurRadius();
    const strength = maxBlurRadius > 0 ? Math.min(1, blurRadius / maxBlurRadius) : 0;

    // CRITICAL: Sync cloned camera with main camera position/rotation
    // NEVER touch main camera's layers - that breaks 3d-force-graph raycasting!
    blurCamera3D.position.copy(camera.position);
    blurCamera3D.quaternion.copy(camera.quaternion);
    blurCamera3D.updateMatrixWorld();

    const previousAutoClear = renderer.autoClear;
    const previousTarget = renderer.getRenderTarget();

    // Step 1: Render keywords to texture (if blur is enabled and we need blur)
    if (enabled && strength > 0.001) {
      renderer.setRenderTarget(keywordsRenderTarget);
      renderer.autoClear = true;
      renderer.clear(true, true, true);
      blurCamera3D.layers.set(0);
      blurCamera3D.layers.enable(KEYWORD_LAYER);
      originalRender(scene, blurCamera3D);

      // Step 2: Apply horizontal blur pass
      blurMaterialH.uniforms.tDiffuse.value = keywordsRenderTarget.texture;
      blurQuad.material = blurMaterialH;
      renderer.setRenderTarget(blurRenderTargetH);
      renderer.autoClear = true;
      renderer.clear(true, true, true);
      originalRender(blurScene, blurCamera);

      // Step 3: Apply vertical blur pass
      blurMaterialV.uniforms.tDiffuse.value = blurRenderTargetH.texture;
      blurQuad.material = blurMaterialV;
      renderer.setRenderTarget(blurRenderTargetV);
      renderer.autoClear = true;
      renderer.clear(true, true, true);
      originalRender(blurScene, blurCamera);

      // Step 4: Render to screen - show blurred keywords
      renderer.setRenderTarget(null);
      renderer.autoClear = true;
      renderer.clear(true, true, true);

      // Render the blurred texture as background
      screenMaterial.map = blurRenderTargetV.texture;
      screenMaterial.needsUpdate = true;
      originalRender(screenScene, blurCamera);

      // Step 5: Render panel on top
      panelMesh.visible = true;
      applyPanelStrength(strength);
      updatePanelTransform();

      renderer.autoClear = false;
      renderer.clearDepth();
      blurCamera3D.layers.set(PANEL_LAYER);
      originalRender(scene, blurCamera3D);
    } else {
      // No blur - render keywords normally
      renderer.setRenderTarget(null);
      renderer.autoClear = true;
      renderer.clear(true, true, true);

      blurCamera3D.layers.set(0);
      blurCamera3D.layers.enable(KEYWORD_LAYER);
      originalRender(scene, blurCamera3D);

      panelMesh.visible = false;
    }

    // Step 6: Render chunks on top
    renderer.autoClear = false;
    renderer.clearDepth();
    blurCamera3D.layers.set(CHUNK_LAYER);
    originalRender(scene, blurCamera3D);

    // Restore render state
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);

    // Main camera is NEVER touched - 3d-force-graph's raycasting works!
  }

  function updateSize(newWidth: number, newHeight: number): void {
    width = Math.max(1, newWidth);
    height = Math.max(1, newHeight);
    updateLineResolutions(width, height);

    // Resize blur render targets
    keywordsRenderTarget.setSize(width, height);
    blurRenderTargetH.setSize(width, height);
    blurRenderTargetV.setSize(width, height);

    // Update blur shader resolutions
    blurMaterialH.uniforms.resolution.value.set(width, height);
    blurMaterialV.uniforms.resolution.value.set(width, height);
  }

  function updateCameras(): void {
    // Panel transform is recomputed on every render when visible.
  }

  function dispose(): void {
    panelGeometry.dispose();
    panelMaterial.dispose();
    scene.remove(panelMesh);

    // Dispose blur resources
    keywordsRenderTarget.dispose();
    blurRenderTargetH.dispose();
    blurRenderTargetV.dispose();
    blurMaterialH.dispose();
    blurMaterialV.dispose();
    blurQuad.geometry.dispose();
    screenMaterial.dispose();
    screenQuad.geometry.dispose();
  }

  return {
    render,
    updateSize,
    updateCameras,
    dispose,
  };
}
