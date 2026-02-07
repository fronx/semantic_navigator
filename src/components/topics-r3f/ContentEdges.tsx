/**
 * Content containment edge rendering (keyword -> content node connections).
 * Wraps EdgeRenderer with content-specific configuration.
 * Visibility synced with ContentNodes via calculateScales.
 */

import { useMemo } from "react";

import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { PCATransform } from "@/lib/semantic-colors";
import type { KeywordTierMap } from "@/lib/topics-filter";
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
  /** Pulled keyword positions (for position overrides when keyword is pulled to edge) */
  pulledPositionsRef?: React.RefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
  /** Pulled content positions (for position overrides when content node is pulled to edge) */
  pulledContentPositionsRef?: React.RefObject<Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>>;
  /** Focus-animated positions (margin push) — hide edges to focus-margin keywords */
  focusPositionsRef?: React.RefObject<Map<string, { x: number; y: number }>>;
  /** Keyword tiers for focus mode edge filtering */
  keywordTiers?: KeywordTierMap | null;
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
  pulledPositionsRef,
  pulledContentPositionsRef,
  focusPositionsRef,
  keywordTiers,
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

  // Merge keyword and content pulled positions into a single map for EdgeRenderer
  // This allows edges to use clamped positions for both pulled keywords and pulled content
  const combinedPulledPositionsRef = useMemo(() => {
    return {
      get current() {
        const combined = new Map<string, { x: number; y: number; connectedPrimaryIds: string[] }>();

        // Add keyword pulled positions
        if (pulledPositionsRef?.current) {
          for (const [id, data] of pulledPositionsRef.current) {
            combined.set(id, data);
          }
        }

        // Add content pulled positions, preserving their anchor metadata
        if (pulledContentPositionsRef?.current) {
          for (const [id, data] of pulledContentPositionsRef.current) {
            combined.set(id, {
              x: data.x,
              y: data.y,
              connectedPrimaryIds: data.connectedPrimaryIds ?? [],
            });
          }
        }

        return combined;
      }
    };
  }, [pulledPositionsRef, pulledContentPositionsRef]);

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
    pulledPositionsRef={combinedPulledPositionsRef}
    focusPositionsRef={focusPositionsRef}
    keywordTiers={keywordTiers}
  />
);
}
