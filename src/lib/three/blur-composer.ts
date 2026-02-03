/**
 * Blur composer for frosted glass edge rendering.
 * Implements post-processing with layer separation to blur edges behind sharp nodes.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { EdgeRenderer } from "./edge-renderer";
import { KEYWORD_LAYER, CHUNK_LAYER } from "./node-renderer";

// ============================================================================
// Gaussian Blur Shaders
// ============================================================================

/**
 * Horizontal gaussian blur shader (9-tap separable)
 */
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

      // 9-tap gaussian kernel weights (sum = 1.0)
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

/**
 * Vertical gaussian blur shader (9-tap separable)
 */
const VerticalBlurShader = {
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

      // 9-tap gaussian kernel weights (sum = 1.0)
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
// Blur Composer Implementation
// ============================================================================

export function createBlurComposer(options: BlurComposerOptions): BlurComposer {
  const { renderer, scene, camera, container, getBlurRadius, edgeRenderer, originalRender } = options;

  const rect = container.getBoundingClientRect();
  let width = rect.width;
  let height = rect.height;
  let halfWidth = Math.floor(width / 2);
  let halfHeight = Math.floor(height / 2);

  // Create new cameras for layer-separated rendering (avoid cloning to prevent circular refs)
  const edgesCamera = new THREE.PerspectiveCamera();
  const nodesCamera = new THREE.PerspectiveCamera();

  // Assign layer masks
  edgesCamera.layers.set(0); // See only edges and hulls (layer 0)
  nodesCamera.layers.set(KEYWORD_LAYER); // Keywords (layer 2)
  nodesCamera.layers.enable(CHUNK_LAYER); // Chunks (layer 3)

  // Create half-res render target for edges
  const edgesTarget = new THREE.WebGLRenderTarget(halfWidth, halfHeight, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    stencilBuffer: false,
  });

  // Create composer for the multi-pass pipeline
  const composer = new EffectComposer(renderer);

  // Pass 1: Render edges to half-res target
  const edgesPass = new RenderPass(scene, edgesCamera);
  edgesPass.clear = true;
  composer.addPass(edgesPass);

  // Pass 2: Horizontal blur
  const horizontalBlurPass = new ShaderPass(HorizontalBlurShader);
  horizontalBlurPass.uniforms.resolution.value.set(halfWidth, halfHeight);
  composer.addPass(horizontalBlurPass);

  // Pass 3: Vertical blur
  const verticalBlurPass = new ShaderPass(VerticalBlurShader);
  verticalBlurPass.uniforms.resolution.value.set(halfWidth, halfHeight);
  composer.addPass(verticalBlurPass);

  // Pass 4: Render nodes on top (sharp)
  const nodesPass = new RenderPass(scene, nodesCamera);
  nodesPass.clear = false; // Don't clear - composite on top of blurred edges
  composer.addPass(nodesPass);

  // Pass 5: Output pass for final tone mapping
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  // Set initial composer size
  composer.setSize(width, height);

  /**
   * Update LineMaterial resolution uniforms for Line2 thickness correctness.
   * Must be called before rendering edges at half-res and after restoring to full-res.
   */
  function updateLineResolutions(resWidth: number, resHeight: number): void {
    const lines = edgeRenderer.getAllLineObjects();
    for (const line of lines) {
      const mat = line.material as LineMaterial;
      if (mat.resolution) {
        mat.resolution.set(resWidth, resHeight);
      }
    }
  }

  /**
   * Synchronize layer cameras with main camera.
   * Must be called every frame before rendering.
   */
  function updateCameras(): void {
    const mainCam = camera as THREE.PerspectiveCamera;

    // Manually sync transform properties (avoid .copy() circular refs)
    for (const cam of [edgesCamera, nodesCamera]) {
      cam.position.set(mainCam.position.x, mainCam.position.y, mainCam.position.z);
      cam.quaternion.set(
        mainCam.quaternion.x,
        mainCam.quaternion.y,
        mainCam.quaternion.z,
        mainCam.quaternion.w
      );

      // Copy camera parameters
      cam.fov = mainCam.fov;
      cam.aspect = mainCam.aspect;
      cam.near = mainCam.near;
      cam.far = mainCam.far;

      // Update projection matrix and matrices
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
    }
  }

  /**
   * Main render function with blur.
   * Early exits when blur radius is negligible (performance optimization).
   */
  function render(): void {
    const blurRadius = getBlurRadius();

    // Early exit: skip blur when zoomed out (zero overhead)
    if (blurRadius < 0.01) {
      originalRender(scene, camera);
      return;
    }

    // Update camera clones to match main camera
    updateCameras();

    // Update blur shader uniforms
    horizontalBlurPass.uniforms.radius.value = blurRadius;
    verticalBlurPass.uniforms.radius.value = blurRadius;

    // Update LineMaterial resolutions for half-res rendering
    updateLineResolutions(halfWidth, halfHeight);

    // Render the multi-pass pipeline. Swap in the original renderer implementation
    // so EffectComposer internals don't recurse back into our interceptor.
    const previousRender = renderer.render;
    renderer.render = originalRender;
    try {
      composer.render();
    } finally {
      renderer.render = previousRender;
    }

    // Restore LineMaterial resolutions to full-res (for UI consistency)
    updateLineResolutions(width, height);
  }

  /**
   * Update render target and composer sizes when window resizes.
   */
  function updateSize(newWidth: number, newHeight: number): void {
    // Update cached dimensions
    width = newWidth;
    height = newHeight;
    halfWidth = Math.floor(newWidth / 2);
    halfHeight = Math.floor(newHeight / 2);

    // Update composer size
    composer.setSize(width, height);

    // Update edges target size
    edgesTarget.setSize(halfWidth, halfHeight);

    // Update blur shader resolutions
    horizontalBlurPass.uniforms.resolution.value.set(halfWidth, halfHeight);
    verticalBlurPass.uniforms.resolution.value.set(halfWidth, halfHeight);
  }

  /**
   * Dispose all resources.
   */
  function dispose(): void {
    edgesTarget.dispose();
    composer.dispose();
  }

  return {
    render,
    updateSize,
    updateCameras,
    dispose,
  };
}
