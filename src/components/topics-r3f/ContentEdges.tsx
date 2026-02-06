/**
 * Content containment edge rendering (keyword -> content node connections).
 * Wraps EdgeRenderer with content-specific configuration.
 * Visibility synced with ContentNodes via calculateScales.
 */

import { useMemo } from "react";

import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import { CONTENT_Z_DEPTH } from "@/lib/content-zoom-config";
import { EdgeRenderer } from "./EdgeRenderer";

export interface ContentEdgesProps {
  simNodes: SimNode[];
  contentNodes: SimNode[];
  curveIntensity: number;
  curveDirections: Map<string, number>;
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform?: PCATransform;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
}

export function ContentEdges({
  simNodes,
  contentNodes,
  curveIntensity,
  curveDirections,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  searchOpacities,
}: ContentEdgesProps): React.JSX.Element | null {
  // Create containment edges (keyword -> content node) from ContentSimNode parentId
  const containmentEdges = useMemo(() => {
    const edges: SimLink[] = [];
    for (const node of contentNodes) {
      // ContentSimNode has parentId field
      const parentId = (node as { parentId?: string }).parentId;
      if (parentId) {
        edges.push({
          source: parentId,
          target: node.id,
        });
      }
    }
    return edges;
  }, [contentNodes]);

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
      zDepth={CONTENT_Z_DEPTH}
      opacity="chunk"
      renderOrder={-2}
      curveIntensity={curveIntensity}
      curveDirections={curveDirections}
      colorMixRatio={colorMixRatio}
      colorDesaturation={colorDesaturation}
      pcaTransform={pcaTransform}
      simNodes={simNodes}
      searchOpacities={searchOpacities}
    />
  );
}
