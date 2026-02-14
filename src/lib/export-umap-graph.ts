/**
 * Export UMAP graph data to JSON file for offline analysis.
 */

import type { ChunkEmbeddingData } from "@/app/api/chunks/embeddings/route";
import type { UmapEdge } from "@/hooks/useUmapLayout";

export interface UmapGraphNode {
  id: string;
  content: string;
  summary: string | null;
  sourcePath: string;
  headingContext: string[] | null;
  chunkType: string | null;
  /** Position in 2D space [x, y] */
  position: [number, number];
}

export interface UmapGraphData {
  nodes: UmapGraphNode[];
  edges: {
    source: number;
    target: number;
    weight: number;
    restLength: number | null;
  }[];
  metadata: {
    nodeCount: number;
    edgeCount: number;
    exportDate: string;
  };
}

export function exportUmapGraph(
  chunks: ChunkEmbeddingData[],
  positions: Float32Array,
  edges: UmapEdge[]
): void {
  // Build nodes array with positions
  const nodes: UmapGraphNode[] = chunks.map((chunk, i) => ({
    id: chunk.id,
    content: chunk.content,
    summary: chunk.summary,
    sourcePath: chunk.sourcePath,
    headingContext: chunk.headingContext,
    chunkType: chunk.chunkType,
    position: [positions[i * 2], positions[i * 2 + 1]],
  }));

  // Build graph data
  const graphData: UmapGraphData = {
    nodes,
    edges: edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      restLength: e.restLength,
    })),
    metadata: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      exportDate: new Date().toISOString(),
    },
  };

  // Create blob and trigger download
  const json = JSON.stringify(graphData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `umap-graph-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
