/**
 * Custom blur pipeline that renders background layers to a texture,
 * applies a separable blur, and composites sharp chunk nodes on top.
 */

import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { EdgeRenderer } from "./edge-renderer";
import { KEYWORD_LAYER, CHUNK_LAYER, PANEL_LAYER } from "./node-renderer";

// ============================================================================
// Gaussian Blur Shaders
// ============================================================================

const HorizontalBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2() },
    radius: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float radius;
    varying vec2 vUv;

    void main() {
      vec2 texelSize = 1.0 / resolution;
      vec4 color = vec4(0.0);

      float weights[9];
      weights[0] = 0.05;
      weights[1] = 0.09;
      weights[2] = 0.12;
      weights[3] = 0.15;
      weights[4] = 0.18;
      weights[5] = 0.15;
      weights[6] = 0.12;
      weights[7] = 0.09;
      weights[8] = 0.05;

      for (int i = -4; i <= 4; i++) {
        vec2 offset = vec2(float(i) * radius * texelSize.x, 0.0);
        color += texture2D(tDiffuse, vUv + offset) * weights[i + 4];
      }

      gl_FragColor = color;
    }
  `,
};

const VerticalBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2() },
    radius: { value: 1.0 },
  },
  vertexShader: HorizontalBlurShader.vertexShader,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float radius;
    varying vec2 vUv;

    void main() {
      vec2 texelSize = 1.0 / resolution;
      vec4 color = vec4(0.0);

      float weights[9];
      weights[0] = 0.05;
      weights[1] = 0.09;
      weights[2] = 0.12;
      weights[3] = 0.15;
      weights[4] = 0.18;
      weights[5] = 0.15;
      weights[6] = 0.12;
      weights[7] = 0.09;
      weights[8] = 0.05;

      for (int i = -4; i <= 4; i++) {
        vec2 offset = vec2(0.0, float(i) * radius * texelSize.y);
        color += texture2D(tDiffuse, vUv + offset) * weights[i + 4];
      }

      gl_FragColor = color;
    }
  `,
};

// ============================================================================
// Interfaces
// ============================================================================

export interface BlurComposerOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  container: HTMLElement;
  getBlurRadius: () => number;
  edgeRenderer: EdgeRenderer;
  originalRender: (scene: THREE.Scene, camera: THREE.Camera) => void;
}

export interface BlurComposer {
  render(): void;
  updateSize(width: number, height: number): void;
  updateCameras(): void;
  dispose(): void;
}

// ============================================================================
// Helpers
// ============================================================================

function makeShaderMaterial(definition: typeof HorizontalBlurShader): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(definition.uniforms),
    vertexShader: definition.vertexShader,
    fragmentShader: definition.fragmentShader,
    depthTest: false,
    depthWrite: false,
    transparent: false,
  });
}

function createFullscreenQuad(): {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  mesh: THREE.Mesh;
} {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x000000 }));
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(mesh);
  return { scene, camera, mesh };
}

// ============================================================================
// Blur Composer Implementation
// ============================================================================

export function createBlurComposer(options: BlurComposerOptions): BlurComposer {
  const { renderer, scene, camera, container, getBlurRadius, edgeRenderer, originalRender } = options;

  const rect = container.getBoundingClientRect();
  let width = rect.width;
  let height = rect.height;
  let halfWidth = Math.max(1, Math.floor(width / 2));
  let halfHeight = Math.max(1, Math.floor(height / 2));

  const backgroundTarget = new THREE.WebGLRenderTarget(halfWidth, halfHeight, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    stencilBuffer: false,
  });
  const blurPingTarget = backgroundTarget.clone();
  const blurOutputTarget = backgroundTarget.clone();

  const fullscreen = createFullscreenQuad();
  const horizontalBlurMaterial = makeShaderMaterial(HorizontalBlurShader);
  const verticalBlurMaterial = makeShaderMaterial(VerticalBlurShader);
  const panelMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(tDiffuse, vUv);
      }
    `,
    transparent: false,
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

    const height = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * PANEL_DISTANCE;
    const width = height * cam.aspect;
    panelMesh.scale.set(width, height, 1);
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

  function renderFullscreenQuad(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    fullscreen.mesh.material = material;
    renderer.setRenderTarget(target);
    originalRender(fullscreen.scene, fullscreen.camera);
  }

  function render(): void {
    const blurRadius = getBlurRadius();

    if (blurRadius < 0.01) {
      panelMesh.visible = false;
      originalRender(scene, camera);
      return;
    }
    panelMesh.visible = true;

    // Save renderer + camera state
    const previousMask = camera.layers.mask;
    const previousAutoClear = renderer.autoClear;
    const previousTarget = renderer.getRenderTarget();

    // Step 1: render background layers (edges + keywords) to off-screen target
    camera.layers.set(0);
    camera.layers.enable(KEYWORD_LAYER);

    updateLineResolutions(halfWidth, halfHeight);
    renderer.setRenderTarget(backgroundTarget);
    renderer.autoClear = true;
    renderer.clear(true, true, true);
    originalRender(scene, camera);
    updateLineResolutions(width, height);

    // Step 2: separable blur (horizontal -> vertical)
    horizontalBlurMaterial.uniforms.tDiffuse.value = backgroundTarget.texture;
    horizontalBlurMaterial.uniforms.resolution.value.set(halfWidth, halfHeight);
    horizontalBlurMaterial.uniforms.radius.value = blurRadius;
    renderFullscreenQuad(horizontalBlurMaterial, blurPingTarget);

    verticalBlurMaterial.uniforms.tDiffuse.value = blurPingTarget.texture;
    verticalBlurMaterial.uniforms.resolution.value.set(halfWidth, halfHeight);
    verticalBlurMaterial.uniforms.radius.value = blurRadius;
    renderFullscreenQuad(verticalBlurMaterial, blurOutputTarget);

    // Step 3: draw frosted panel sampling blurred texture
    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    renderer.clear(true, true, true);
    panelMaterial.uniforms.tDiffuse.value = blurOutputTarget.texture;
    updatePanelTransform();
    camera.layers.set(PANEL_LAYER);
    originalRender(scene, camera);

    // Step 4: render chunk layer sharply on top
    renderer.autoClear = false;
    renderer.clearDepth();
    camera.layers.set(CHUNK_LAYER);
    originalRender(scene, camera);

    // Restore renderer state
    camera.layers.mask = previousMask;
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }

  function updateSize(newWidth: number, newHeight: number): void {
    width = Math.max(1, newWidth);
    height = Math.max(1, newHeight);
    halfWidth = Math.max(1, Math.floor(width / 2));
    halfHeight = Math.max(1, Math.floor(height / 2));

    backgroundTarget.setSize(halfWidth, halfHeight);
    blurPingTarget.setSize(halfWidth, halfHeight);
    blurOutputTarget.setSize(halfWidth, halfHeight);

    horizontalBlurMaterial.uniforms.resolution.value.set(halfWidth, halfHeight);
    verticalBlurMaterial.uniforms.resolution.value.set(halfWidth, halfHeight);
  }

  function updateCameras(): void {
    // No-op in the new pipeline (uses main camera directly)
  }

  function dispose(): void {
    backgroundTarget.dispose();
    blurPingTarget.dispose();
    blurOutputTarget.dispose();
    fullscreen.mesh.geometry.dispose();
    (fullscreen.mesh.material as THREE.Material).dispose();
    horizontalBlurMaterial.dispose();
    verticalBlurMaterial.dispose();
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
