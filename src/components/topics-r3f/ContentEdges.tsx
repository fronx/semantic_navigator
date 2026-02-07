/**
 * Content containment edge rendering (keyword -> content node connections).
 * Wraps EdgeRenderer with content-specific configuration.
 * Visibility synced with ContentNodes via calculateScales.
 */

import { useMemo } from "react";

import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import { EdgeRenderer } from "./EdgeRenderer";

export interface ContentEdgesProps {
  simNodes: SimNode[];
  contentNodes: SimNode[];
  /** Z depth for content edges (must match ContentNodes' contentZDepth) */
  contentZDepth: number;
  curveIntensity: number;
  curveDirections: Map<string, number>;
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform?: PCATransform;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
  /** Hovered keyword ID ref — reaching edges only show for hovered node */
  hoveredKeywordIdRef?: React.RefObject<string | null>;
}

export function ContentEdges({
  simNodes,
  contentNodes,
  contentZDepth,
  curveIntensity,
  curveDirections,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  searchOpacities,
  hoveredKeywordIdRef,
}: ContentEdgesProps): React.JSX.Element | null {
  // Create containment edges (keyword -> content node) from ContentSimNode parentIds
  // After deduplication, each content node can have multiple parents
  const containmentEdges = useMemo(() => {
    const edges: SimLink[] = [];
    for (const node of contentNodes) {
      // ContentSimNode has parentIds array (multiple parents after deduplication)
      const parentIds = (node as { parentIds?: string[] }).parentIds;
      if (parentIds) {
        // Create edge from each parent keyword to this content node
        for (const parentId of parentIds) {
          edges.push({
            source: parentId,
            target: node.id,
          });
        }
      }
    }
    return edges;
  }, [contentNodes, simNodes]);

  // Combined node map (keywords + content nodes)
  const nodeMap = useMemo(
    () => new Map([...simNodes, ...contentNodes].map((n) => [n.id, n])),
    [simNodes, contentNodes]
  );

  if (containmentEdges.length === 0) {
    return null;
  }

  return (
    <EdgeRenderer
    edges={containmentEdges}
    nodeMap={nodeMap}
    zDepth={contentZDepth}
    opacity={"chunk"}
    renderOrder={-2}
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
