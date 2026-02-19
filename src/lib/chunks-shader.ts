/**
 * Custom ShaderMaterial for chunk cards with per-instance shape morphing.
 *
 * Uses a 2D rounded-rectangle SDF to define the visible shape.
 * instanceCornerRatio attribute morphs corners per instance based on effective screen size:
 *   1.0 → capsule/circle (small/zoomed out)
 *   0.08 → rectangle (large/zoomed in, text readable)
 *
 * Handles instanceColor automatically via Three.js USE_INSTANCING_COLOR.
 */

import * as THREE from "three";

const CHUNK_VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vCornerRatio;

  // Per-instance opacity — 1.0 normally, <1.0 when dimmed (search, hover preview, edge pull).
  // Stored separately from instanceColor so dimming fades to transparent, not black.
  attribute float instanceOpacity;

  // Per-instance corner ratio: 0.08 = rectangle, 1.0 = circle.
  // Driven by effective screen size so hovered/focused nodes morph independently.
  attribute float instanceCornerRatio;

  void main() {
    vUv = uv;
    vOpacity = instanceOpacity;
    vCornerRatio = instanceCornerRatio;

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

    #include <logdepthbuf_vertex>
  }
`;

// Card dimensions matching CARD_WIDTH=30, CARD_HEIGHT=20 from chunks-geometry.ts.
// Baked into the shader as constants — change both together if card size changes.
const CHUNK_FRAGMENT_SHADER = /* glsl */ `
  #include <logdepthbuf_pars_fragment>

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vCornerRatio;

  float roundedBoxSDF(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    // Must be before any discard — log depth write is skipped for discarded fragments
    // if this comes after, silently breaking depth precision for antialiased card edges.
    #include <logdepthbuf_fragment>

    // Map UV [0,1] → card local coords: x in [-15,15], y in [-10,10]
    vec2 p = (vUv - 0.5) * vec2(30.0, 20.0);

    // Corner radius in world units.
    // min(halfWidth, halfHeight) = 10.0.
    // At ratio=1.0: r=10 → capsule/stadium shape (looks circular when small).
    // At ratio=0.08: r=0.8 → near-rectangle (matches previous ShapeGeometry).
    float r = vCornerRatio * 10.0;

    float sdf = roundedBoxSDF(p, vec2(15.0, 10.0), r);

    // Anti-aliased edge. fwidth() uses GL_OES_standard_derivatives, available
    // by default in WebGL2 (Three.js r162+ targets WebGL2 only).
    float edge = fwidth(sdf) * 2.0;
    float alpha = 1.0 - smoothstep(-edge, edge, sdf);
    if (alpha < 0.001) discard;

    gl_FragColor = vec4(vColor, alpha * vOpacity);
  }
`;

export function createChunkShaderMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: CHUNK_VERTEX_SHADER,
    fragmentShader: CHUNK_FRAGMENT_SHADER,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 4,
  });
  material.toneMapped = false;
  return material;
}
