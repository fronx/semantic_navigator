/**
 * Keyword similarity edge rendering.
 * Wraps EdgeRenderer with keyword-specific configuration.
 */

import { useMemo } from "react";

import type { SimLink, SimNode } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import { EdgeRenderer } from "./EdgeRenderer";

export interface KeywordEdgesProps {
  simNodes: SimNode[];
  edges: SimLink[];
  curveIntensity: number;
  curveDirections: Map<string, number>;
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform?: PCATransform;
  /** Show k-NN connectivity edges (usually hidden, only affect force simulation) */
  showKNNEdges?: boolean;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Hovered keyword ID ref — reaching edges only show for hovered node */
  hoveredKeywordIdRef?: React.RefObject<string | null>;
}

export function KeywordEdges({
  simNodes,
  edges,
  curveIntensity,
  curveDirections,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  showKNNEdges = false,
  searchOpacities,
  hoveredKeywordIdRef,
}: KeywordEdgesProps): React.JSX.Element | null {
  const nodeMap = useMemo(
    () => new Map(simNodes.map((n) => [n.id, n])),
    [simNodes]
  );

  // Filter k-NN connectivity edges unless explicitly enabled
  const visibleEdges = useMemo(
    () => showKNNEdges ? edges : edges.filter(e => !e.isKNN),
    [edges, showKNNEdges]
  );

  if (visibleEdges.length === 0) {
    return null;
  }

  return (
    <EdgeRenderer
      edges={visibleEdges}
      nodeMap={nodeMap}
      zDepth={0}
      opacity={0.4}
      renderOrder={-1}
      curveIntensity={curveIntensity}
      curveDirections={curveDirections}
      colorMixRatio={colorMixRatio}
      colorDesaturation={colorDesaturation}
      pcaTransform={pcaTransform}
      simNodes={simNodes}
      searchOpacities={searchOpacities}
      hoveredKeywordIdRef={hoveredKeywordIdRef}
    />
  );
}
