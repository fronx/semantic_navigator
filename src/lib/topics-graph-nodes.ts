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

/**
 * Convert keyword nodes to simulation-ready format for D3 renderer.
 * D3 uses the raw KeywordNode.id for node IDs.
 */
export function convertToD3Nodes(
  options: GraphNodeConversionOptions
): GraphNodeConversionResult {
  const { keywordNodes, edges, projectNodes, width, height, getSavedPosition } = options;

  // Convert keyword nodes - D3 uses raw n.id
  const keywordMapNodes: SimNode[] = keywordNodes.map((n) => {
    const savedPos = getSavedPosition?.(n.id);
    return {
      id: n.id,
      type: "keyword" as const,
      label: n.label,
      communityId: undefined,
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

  // Convert edges - include isKNN for D3's link force strength
  const mapLinks: SimLink[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    similarity: e.similarity,
    isKNN: e.isKNN,
  }));

  return { mapNodes, mapLinks };
}

/**
 * Convert keyword nodes to simulation-ready format for Three.js renderer.
 * Three.js uses "kw:" prefix for keyword IDs.
 */
export function convertToThreeNodes(
  options: GraphNodeConversionOptions
): GraphNodeConversionResult {
  const { keywordNodes, edges, projectNodes, width, height, getSavedPosition } = options;

  // Convert keyword nodes - Three.js uses "kw:" prefix
  const keywordMapNodes: SimNode[] = keywordNodes.map((n) => {
    const id = `kw:${n.label}`;
    const savedPos = getSavedPosition?.(id);
    return {
      id,
      type: "keyword" as const,
      label: n.label,
      communityId: undefined,
      embedding: n.embedding,
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
    x: p.position_x ?? width / 2,
    y: p.position_y ?? height / 2,
  }));

  const mapNodes = [...keywordMapNodes, ...projectMapNodes];

  // Convert edges - Three.js doesn't use isKNN (has its own link force)
  const mapLinks: SimLink[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    similarity: e.similarity,
  }));

  return { mapNodes, mapLinks };
}
