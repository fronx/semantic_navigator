/**
 * Three.js renderer module for graph visualization.
 *
 * Building blocks:
 * - renderer.ts: Main orchestration, composes all other modules
 * - camera-controller.ts: Viewport, coordinate conversion, fit-to-nodes
 * - input-handler.ts: Pan, zoom, click/drag detection
 * - node-renderer.ts: Mesh creation, caching, colors, highlighting
 * - edge-renderer.ts: Curve rendering (bezier/arc), link objects
 * - label-overlays.ts: HTML labels positioned over WebGL canvas
 */

export { createThreeRenderer } from "./renderer";
export type { ThreeRenderer, ThreeRendererCallbacks, ThreeRendererOptions } from "./renderer";
