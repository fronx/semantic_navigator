/**
 * Custom ShaderMaterial for chunk cards with zoom-dependent shape morphing.
 *
 * Uses a 2D rounded-rectangle SDF to define the visible shape.
 * u_cornerRatio uniform morphs corners:
 *   1.0 → capsule/circle (zoomed out)
 *   0.08 → rectangle (zoomed in, text readable)
 *
 * Handles instanceColor automatically via Three.js USE_INSTANCING_COLOR.
 */

import * as THREE from "three";

const CHUNK_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;

  void main() {
    vUv = uv;

    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif

    vec4 localPos = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * localPos;
    #else
      gl_Position = projectionMatrix * modelViewMatrix * localPos;
    #endif
  }
`;

// Card dimensions matching CARD_WIDTH=30, CARD_HEIGHT=20 from chunks-geometry.ts.
// Baked into the shader as constants — change both together if card size changes.
const CHUNK_FRAGMENT_SHADER = /* glsl */ `
  uniform float u_cornerRatio;

  varying vec2 vUv;
  varying vec3 vColor;

  float roundedBoxSDF(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    // Map UV [0,1] → card local coords: x in [-15,15], y in [-10,10]
    vec2 p = (vUv - 0.5) * vec2(30.0, 20.0);

    // Corner radius in world units.
    // min(halfWidth, halfHeight) = 10.0.
    // At ratio=1.0: r=10 → capsule/stadium shape (looks circular when small).
    // At ratio=0.08: r=0.8 → near-rectangle (matches previous ShapeGeometry).
    float r = u_cornerRatio * 10.0;

    float sdf = roundedBoxSDF(p, vec2(15.0, 10.0), r);

    // Anti-aliased edge. fwidth() uses GL_OES_standard_derivatives, available
    // by default in WebGL2 (Three.js r162+ targets WebGL2 only).
    float edge = fwidth(sdf) * 2.0;
    float alpha = 1.0 - smoothstep(-edge, edge, sdf);
    if (alpha < 0.001) discard;

    gl_FragColor = vec4(vColor, alpha);
  }
`;

export function createChunkShaderMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      u_cornerRatio: { value: 1.0 },
    },
    vertexShader: CHUNK_VERTEX_SHADER,
    fragmentShader: CHUNK_FRAGMENT_SHADER,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  material.toneMapped = false;
  return material;
}
