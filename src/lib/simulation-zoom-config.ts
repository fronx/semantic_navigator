/**
 * Zoom-dependent force simulation energy.
 *
 * - Zoomed OUT (high Z): Base D3 energy -- normal dynamic layout
 * - Zoomed IN  (low Z):  Very low energy -- graph halts while reading content
 */

import { CAMERA_Z_MAX } from "./content-zoom-config";

/**
 * Simulation-specific zoom range (narrower than camera range).
 * Below SIMULATION_Z_MIN the simulation is halted (user is reading content).
 */
const SIMULATION_Z_MIN = 1800;
const SIMULATION_Z_MAX = CAMERA_Z_MAX; // 20000

/** Shared normalization: maps cameraZ to a 0-1 curve within the simulation range. */
function zoomCurve(cameraZ: number): number {
  const t = Math.max(
    0,
    Math.min(1, (cameraZ - SIMULATION_Z_MIN) / (SIMULATION_Z_MAX - SIMULATION_Z_MIN))
  );
  // 0.65 exponent = gentle curve for smooth transition from halt to full energy
  return Math.pow(t, 0.65);
}

/**
 * Simulation alpha (energy level) based on camera zoom.
 * Returns 0.01 (halted) at low Z, 0.30 (base D3 default) at high Z.
 */
export function calculateSimulationAlpha(cameraZ: number): number {
  const minAlpha = 0.01;
  const maxAlpha = 0.30;
  return minAlpha + zoomCurve(cameraZ) * (maxAlpha - minAlpha);
}

/**
 * Velocity decay (damping) based on camera zoom.
 * Returns 0.9 (high damping, motion dies fast) at low Z,
 * 0.5 (base D3 default) at high Z.
 */
export function calculateVelocityDecay(cameraZ: number): number {
  const minDecay = 0.5;
  const maxDecay = 0.9;
  // Invert: high decay at low Z, low decay at high Z
  return maxDecay - zoomCurve(cameraZ) * (maxDecay - minDecay);
}
