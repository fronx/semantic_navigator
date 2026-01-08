/**
 * Shared auto-fit logic for graph renderers.
 * Manages when to automatically fit the view to show all nodes,
 * while respecting user interactions.
 */

import type { ConvergenceState } from "./simulation-convergence";

/** State for auto-fit behavior */
export interface AutoFitState {
  /** Whether user has manually zoomed or panned */
  userHasInteracted: boolean;
  /** Whether we've done the initial fit after cooling */
  hasFittedInitially: boolean;
}

/** Configuration for auto-fit behavior */
export interface AutoFitConfig {
  /** How often to fit during simulation (in ticks) */
  fitIntervalTicks: number;
  /** Tick count threshold for fit after cooling starts */
  cooldownFitThreshold: number;
}

/** Default auto-fit configuration */
export const DEFAULT_AUTO_FIT_CONFIG: AutoFitConfig = {
  fitIntervalTicks: 100,
  cooldownFitThreshold: 150,
};

/** Create initial auto-fit state */
export function createAutoFitState(): AutoFitState {
  return {
    userHasInteracted: false,
    hasFittedInitially: false,
  };
}

/** Mark that the user has interacted (zoomed or panned) */
export function markUserInteraction(state: AutoFitState): void {
  state.userHasInteracted = true;
}

/**
 * Check if we should auto-fit during simulation.
 * Returns true if a fit should be triggered.
 */
export function shouldFitDuringSimulation(
  state: AutoFitState,
  convergenceState: ConvergenceState,
  config: AutoFitConfig = DEFAULT_AUTO_FIT_CONFIG
): boolean {
  // Don't fit if user has manually zoomed/panned
  if (state.userHasInteracted) return false;

  // Don't fit during cooling phase (handled separately)
  if (convergenceState.coolingDown) return false;

  // Fit periodically during active simulation
  return (
    convergenceState.tickCount > 0 &&
    convergenceState.tickCount % config.fitIntervalTicks === 0
  );
}

/**
 * Check if we should auto-fit after cooling starts.
 * Returns true if a fit should be triggered.
 */
export function shouldFitAfterCooling(
  state: AutoFitState,
  convergenceState: ConvergenceState,
  config: AutoFitConfig = DEFAULT_AUTO_FIT_CONFIG
): boolean {
  // Don't fit if user has manually zoomed/panned
  if (state.userHasInteracted) return false;

  // Only fit once
  if (state.hasFittedInitially) return false;

  // Fit after threshold during cooling
  return (
    convergenceState.coolingDown &&
    convergenceState.tickCount > config.cooldownFitThreshold
  );
}

/**
 * Mark that we've done the initial fit.
 * Call this after triggering the cooling fit.
 */
export function markInitialFitDone(state: AutoFitState): void {
  state.hasFittedInitially = true;
}
