/**
 * Chunk containment edge rendering (keyword -> chunk connections).
 * Wraps EdgeRenderer with chunk-specific configuration.
 * Visibility synced with ChunkNodes via calculateScales.
 */

import { useMemo } from "react";

import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import { CHUNK_Z_DEPTH } from "@/lib/chunk-zoom-config";
import { EdgeRenderer } from "./EdgeRenderer";

export interface ChunkEdgesProps {
  simNodes: SimNode[];
  chunkNodes: SimNode[];
  curveIntensity: number;
  curveDirections: Map<string, number>;
  colorMixRatio: number;
  colorDesaturation: number;
  pcaTransform?: PCATransform;
  /** Search opacity map (node id -> opacity) for semantic search highlighting */
  searchOpacities?: Map<string, number>;
}

export function ChunkEdges({
  simNodes,
  chunkNodes,
  curveIntensity,
  curveDirections,
  colorMixRatio,
  colorDesaturation,
  pcaTransform,
  searchOpacities,
}: ChunkEdgesProps): React.JSX.Element | null {
  // Create containment edges (keyword -> chunk) from chunk parentId
  const containmentEdges = useMemo(() => {
    const edges: SimLink[] = [];
    for (const chunk of chunkNodes) {
      // ChunkSimNode has parentId field
      const parentId = (chunk as { parentId?: string }).parentId;
      if (parentId) {
        edges.push({
          source: parentId,
          target: chunk.id,
        });
      }
    }
    return edges;
  }, [chunkNodes]);

  // Combined node map (keywords + chunks)
  const nodeMap = useMemo(
    () => new Map([...simNodes, ...chunkNodes].map((n) => [n.id, n])),
    [simNodes, chunkNodes]
  );

  if (containmentEdges.length === 0) {
    return null;
  }

  return (
    <EdgeRenderer
      edges={containmentEdges}
      nodeMap={nodeMap}
      zDepth={CHUNK_Z_DEPTH}
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
