/**
 * Reusable drag handlers for any D3 force simulation.
 * All three chunk layout hooks (base, manifold focus, click focus)
 * use this to expose identical startDrag / drag / endDrag interfaces.
 */

import type { SimulationNodeDatum, Simulation } from "d3-force";
import type { MutableRefObject } from "react";

export interface SimulationDragHandlers {
  startDrag: (index: number) => void;
  drag: (index: number, x: number, y: number) => void;
  endDrag: (index: number) => void;
  /** Called when the hovered node changes. Reheats the simulation and adjusts collision radius. */
  notifyHoverChange?: (index: number | null, scaleFactor: number) => void;
}

/**
 * Creates drag handlers bound to a d3 simulation.
 * @param simulationRef - ref to the current simulation (may be null between effect cycles)
 * @param findNode - lookup a simulation node by chunk index; return undefined if not found
 */
export function createSimulationDrag(
  simulationRef: MutableRefObject<Simulation<any, any> | null>,
  findNode: (index: number) => SimulationNodeDatum | undefined,
): SimulationDragHandlers {
  return {
    startDrag(index: number) {
      const node = findNode(index);
      if (!node) return;
      node.fx = node.x;
      node.fy = node.y;
      simulationRef.current?.alphaTarget(0.3).restart();
    },
    drag(index: number, x: number, y: number) {
      const node = findNode(index);
      if (!node) return;
      node.fx = x;
      node.fy = y;
    },
    endDrag(index: number) {
      const node = findNode(index);
      if (!node) return;
      node.fx = null;
      node.fy = null;
      simulationRef.current?.alphaTarget(0);
    },
  };
}