/**
 * Shared convergence detection logic for force-directed simulations.
 * Used by both D3 and Three.js renderers for consistent behavior.
 */

/** Configuration for convergence detection */
export interface ConvergenceConfig {
  /** Maximum velocity allowed per node (prevents numerical explosion) */
  maxVelocity: number;
  /** Minimum ticks before checking for convergence */
  minTicksBeforeCheck: number;
  /** P95 velocity threshold for convergence */
  velocityThreshold: number;
}

/** Default convergence configuration */
export const DEFAULT_CONVERGENCE_CONFIG: ConvergenceConfig = {
  maxVelocity: 50,
  minTicksBeforeCheck: 40,
  velocityThreshold: 2.0,
};

/** State tracked during simulation */
export interface ConvergenceState {
  tickCount: number;
  coolingDown: boolean;
}

/** Create initial convergence state */
export function createConvergenceState(): ConvergenceState {
  return {
    tickCount: 0,
    coolingDown: false,
  };
}

/**
 * Clamp node velocities to prevent numerical explosion.
 * Mutates the nodes in place.
 */
export function clampVelocities<T extends { vx?: number; vy?: number }>(
  nodes: T[],
  maxVelocity: number
): void {
  for (const node of nodes) {
    if (node.vx !== undefined) {
      node.vx = Math.max(-maxVelocity, Math.min(maxVelocity, node.vx));
    }
    if (node.vy !== undefined) {
      node.vy = Math.max(-maxVelocity, Math.min(maxVelocity, node.vy));
    }
  }
}

/**
 * Calculate the p95 velocity (5th percentile of sorted descending velocities).
 * This represents the "top" velocity excluding outliers.
 */
export function calculateP95Velocity<T extends { vx?: number; vy?: number }>(
  nodes: T[]
): number {
  const velocities = nodes
    .map((d) => Math.sqrt((d.vx ?? 0) ** 2 + (d.vy ?? 0) ** 2))
    .sort((a, b) => b - a);

  const p95Index = Math.floor(nodes.length * 0.05);
  return velocities[p95Index] ?? velocities[0] ?? 0;
}

/**
 * Check if simulation should start cooling down.
 * Returns true if cooling should begin.
 */
export function shouldStartCooling<T extends { vx?: number; vy?: number }>(
  nodes: T[],
  state: ConvergenceState,
  config: ConvergenceConfig = DEFAULT_CONVERGENCE_CONFIG
): boolean {
  if (state.coolingDown) return false;
  if (state.tickCount <= config.minTicksBeforeCheck) return false;

  const topVelocity = calculateP95Velocity(nodes);
  return topVelocity < config.velocityThreshold;
}

/**
 * Process a simulation tick with convergence detection.
 * Returns true if cooling just started (for triggering additional actions).
 */
export function processSimulationTick<T extends { vx?: number; vy?: number }>(
  nodes: T[],
  state: ConvergenceState,
  config: ConvergenceConfig = DEFAULT_CONVERGENCE_CONFIG
): { coolingJustStarted: boolean } {
  state.tickCount++;

  // Clamp velocities
  clampVelocities(nodes, config.maxVelocity);

  // Check for convergence
  if (shouldStartCooling(nodes, state, config)) {
    state.coolingDown = true;
    return { coolingJustStarted: true };
  }

  return { coolingJustStarted: false };
}
