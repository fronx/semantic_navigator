/**
 * Clustering utilities for topic clusters in TopicsView.
 * Pure functions for graph conversion and embedding fetching.
 */

import { SupabaseClient } from "@supabase/supabase-js";

export interface GraphNode {
  id: string;
  label: string;
  embedding?: number[];
}

export interface GraphEdge {
  source: string;
  target: string;
  similarity: number;
}

/**
 * Convert RPC keyword graph pairs to nodes and edges.
 * Pure function: takes array of pairs, returns graph structure.
 */
export function convertPairsToGraph(
  pairs: Array<{
    keyword_text: string;
    similar_keyword_text: string;
    keyword_id: number;
    similar_keyword_id: number;
    similarity: number;
  }>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const keywordSet = new Set<string>();
  const keywordTextToId = new Map<string, number>();
  const edgeMap = new Map<string, { similarity: number }>();

  for (const row of pairs) {
    const kw1 = row.keyword_text;
    const kw2 = row.similar_keyword_text;
    const kw1Id = row.keyword_id;
    const kw2Id = row.similar_keyword_id;
    const similarity = row.similarity;

    keywordSet.add(kw1);
    keywordSet.add(kw2);
    if (!keywordTextToId.has(kw1)) keywordTextToId.set(kw1, kw1Id);
    if (!keywordTextToId.has(kw2)) keywordTextToId.set(kw2, kw2Id);

    if (kw1 === kw2) continue;

    const edgeKey = kw1 < kw2 ? `${kw1}|${kw2}` : `${kw2}|${kw1}`;
    const existing = edgeMap.get(edgeKey);
    if (!existing || similarity > existing.similarity) {
      edgeMap.set(edgeKey, { similarity });
    }
  }

  const nodes = [...keywordSet].map((kw) => ({
    id: `kw:${kw}`,
    label: kw,
  }));

  const edges = [...edgeMap.entries()].map(([key, { similarity }]) => {
    const [kw1, kw2] = key.split("|");
    return {
      source: `kw:${kw1}`,
      target: `kw:${kw2}`,
      similarity,
    };
  });

  return { nodes, edges };
}

/**
 * Fetch embeddings for graph nodes from database.
 * Modifies nodes in place by adding embedding property.
 */
export async function fetchEmbeddings(
  supabase: SupabaseClient,
  nodes: GraphNode[],
  _nodeType: string
): Promise<void> {
  const keywords = nodes.map((n) => n.label);
  const BATCH_SIZE = 100;

  for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
    const batch = keywords.slice(i, i + BATCH_SIZE);

    // Keywords are canonical - no node_type filter
    const { data: kwData } = await supabase
      .from("keywords")
      .select("keyword, embedding_256")
      .in("keyword", batch);

    const embeddingMap = new Map<string, number[]>();
    for (const kw of kwData || []) {
      if (kw.embedding_256) {
        const emb =
          typeof kw.embedding_256 === "string"
            ? JSON.parse(kw.embedding_256)
            : kw.embedding_256;
        embeddingMap.set(kw.keyword, emb);
      }
    }

    for (const node of nodes) {
      const embedding = embeddingMap.get(node.label);
      if (embedding) node.embedding = embedding;
    }
  }

  const withEmbeddings = nodes.filter((n) => n.embedding).length;
  console.log(`Fetched embeddings for ${withEmbeddings}/${nodes.length} nodes`);
}
