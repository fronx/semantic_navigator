/**
 * Shared utility for converting keyword/project nodes to simulation-ready format.
 * Used by both D3 and Three.js renderers in TopicsView.
 */

import type { SimNode, SimLink } from "@/lib/map-renderer";
import type { KeywordNode, SimilarityEdge, ProjectNode } from "@/lib/graph-queries";

export interface GraphNodeConversionOptions {
  keywordNodes: KeywordNode[];
  edges: SimilarityEdge[];
  projectNodes: ProjectNode[];
  width: number;
  height: number;
  /** Get saved position for smooth filter transitions */
  getSavedPosition?: (id: string) => { x: number; y: number } | undefined;
}

export interface GraphNodeConversionResult {
  mapNodes: SimNode[];
  mapLinks: SimLink[];
}

interface ConvertToSimNodesOptions extends GraphNodeConversionOptions {
  /** Whether to include isKNN on edges (D3 uses it for link force strength) */
  includeKNN?: boolean;
}

/**
 * Convert keyword/project nodes to simulation-ready format.
 * Unified function used by both D3 and Three.js renderers.
 *
 * Note: KeywordNode.id and SimilarityEdge source/target are already in
 * "kw:label" format from the API, so both renderers use the same ID format.
 */
export function convertToSimNodes(
  options: ConvertToSimNodesOptions
): GraphNodeConversionResult {
  const {
    keywordNodes,
    edges,
    projectNodes,
    width,
    height,
    getSavedPosition,
    includeKNN = false,
  } = options;

  // Convert keyword nodes (IDs already in "kw:label" format from API)
  const keywordMapNodes: SimNode[] = keywordNodes.map((n) => {
    const savedPos = getSavedPosition?.(n.id);
    return {
      id: n.id,
      type: "keyword" as const,
      label: n.label,
      communityId: n.communityId, // Preserve community from source data
      embedding: n.embedding,
      communityMembers: undefined,
      hullLabel: undefined,
      x: savedPos?.x,
      y: savedPos?.y,
    };
  });

  // Convert project nodes with their persisted positions
  const projectMapNodes: SimNode[] = projectNodes.map((p) => ({
    id: `proj:${p.id}`,
    type: "project" as const,
    label: p.title,
    communityId: undefined,
    embedding: p.embedding,
    communityMembers: undefined,
    hullLabel: undefined,
    x: p.position_x ?? width / 2,
    y: p.position_y ?? height / 2,
  }));

  const mapNodes = [...keywordMapNodes, ...projectMapNodes];

  // Convert edges (IDs already in "kw:label" format from API)
  const mapLinks: SimLink[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    similarity: e.similarity,
    ...(includeKNN ? { isKNN: e.isKNN } : {}),
  }));

  return { mapNodes, mapLinks };
}

/**
 * Convert keyword nodes to simulation-ready format for D3 renderer.
 */
export function convertToD3Nodes(
  options: GraphNodeConversionOptions
): GraphNodeConversionResult {
  return convertToSimNodes({
    ...options,
    includeKNN: true,
  });
}
