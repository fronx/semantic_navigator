/**
 * Precompute Leiden clusters at fixed resolutions.
 * Generates semantic labels via Haiku API and stores in database.
 *
 * Run: npm run script scripts/precompute-topic-clusters.ts
 */
import { createServerClient } from "@/lib/supabase";
import { computeLeidenClustering } from "@/lib/leiden-clustering";
import { generateClusterLabels } from "@/lib/llm";
import type { KeywordNode, SimilarityEdge } from "@/lib/graph-queries";

const RESOLUTIONS = [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0];

async function main() {
  const supabase = createServerClient();

  console.log("Fetching graph data from get_article_keyword_graph...");

  // Fetch full graph via same RPC used by TopicsView
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawPairs, error } = await (supabase.rpc as any)(
    "get_article_keyword_graph",
    {
      max_edges_per_article: 10,
      min_similarity: 0.3,
    }
  );

  if (error) {
    throw new Error(`Failed to fetch graph: ${error.message}`);
  }

  // Convert pairs to nodes and edges
  const { nodes, edges } = convertPairsToGraph(rawPairs);

  console.log(`Graph: ${nodes.length} nodes, ${edges.length} edges`);

  // Fetch embeddings for nodes
  console.log("Fetching embeddings...");
  await fetchEmbeddings(supabase, nodes);

  // Clear existing precomputed data
  console.log("Clearing existing precomputed clusters...");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from as any)("precomputed_topic_clusters").delete().gte("resolution", 0);

  // Precompute for each resolution
  for (const resolution of RESOLUTIONS) {
    console.log(`\n=== Resolution ${resolution} ===`);

    // Run Leiden clustering with periphery detection
    console.log("Running Leiden clustering...");
    const { nodeToCluster, clusters } = computeLeidenClustering(
      nodes,
      edges,
      resolution
    );

    console.log(`Generated ${clusters.size} clusters`);

    // Generate semantic labels via Haiku
    const clustersForLabeling = Array.from(clusters.values()).map(c => ({
      id: c.id,
      keywords: c.members,
    }));

    console.log(`Calling Haiku API for ${clustersForLabeling.length} labels...`);
    const labels = await generateClusterLabels(clustersForLabeling);

    // Insert into database
    const rows = [];
    for (const [nodeId, clusterId] of nodeToCluster) {
      const cluster = clusters.get(clusterId)!;
      rows.push({
        resolution,
        node_id: nodeId,
        cluster_id: clusterId,
        hub_node_id: `kw:${cluster.hub}`,
        cluster_label: labels[clusterId] || cluster.hub,
        member_count: cluster.members.length,
      });
    }

    console.log(`Inserting ${rows.length} rows...`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (supabase.from as any)("precomputed_topic_clusters")
      .insert(rows);

    if (insertError) {
      throw new Error(`Insert failed: ${insertError.message}`);
    }

    console.log(`✓ Resolution ${resolution} complete`);
  }

  console.log("\n✓ All resolutions precomputed!");
  console.log("\nSummary:");
  for (const resolution of RESOLUTIONS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (supabase.from as any)("precomputed_topic_clusters")
      .select("*", { count: "exact", head: true })
      .eq("resolution", resolution);

    console.log(`  Resolution ${resolution}: ${count} nodes`);
  }
}

/**
 * Convert RPC result to nodes and edges.
 * Same logic as getKeywordBackbone in src/lib/graph-queries.ts
 */
function convertPairsToGraph(pairs: any[]): {
  nodes: KeywordNode[];
  edges: SimilarityEdge[];
} {
  // Extract unique keywords and keyword-keyword edges
  const keywordSet = new Set<string>();
  const keywordTextToId = new Map<string, string>();
  const edgeMap = new Map<string, { similarity: number }>();

  for (const row of pairs) {
    const kw1 = row.keyword_text as string;
    const kw2 = row.similar_keyword_text as string;
    const kw1Id = row.keyword_id as string;
    const kw2Id = row.similar_keyword_id as string;
    const similarity = row.similarity as number;

    // Add keywords
    keywordSet.add(kw1);
    keywordSet.add(kw2);
    if (!keywordTextToId.has(kw1)) keywordTextToId.set(kw1, kw1Id);
    if (!keywordTextToId.has(kw2)) keywordTextToId.set(kw2, kw2Id);

    // Skip self-loops
    if (kw1 === kw2) continue;

    // Canonical edge key (alphabetical order)
    const edgeKey = kw1 < kw2 ? `${kw1}|${kw2}` : `${kw2}|${kw1}`;

    // Track max similarity for each edge
    const existing = edgeMap.get(edgeKey);
    if (!existing || similarity > existing.similarity) {
      edgeMap.set(edgeKey, { similarity });
    }
  }

  // Build nodes
  const nodes: KeywordNode[] = [...keywordSet].map((kw) => ({
    id: `kw:${kw}`,
    label: kw,
  }));

  // Build edges
  const edges: SimilarityEdge[] = [...edgeMap.entries()].map(([key, { similarity }]) => {
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
 * Fetch embeddings for all nodes from database.
 * Modifies nodes in place to add embedding field.
 */
async function fetchEmbeddings(
  supabase: any,
  nodes: KeywordNode[]
): Promise<void> {
  // Extract keyword labels (strip "kw:" prefix)
  const keywords = nodes.map(n => n.label);

  // Fetch embeddings in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
    const batch = keywords.slice(i, i + BATCH_SIZE);

    const { data: kwData } = await supabase
      .from("keywords")
      .select("keyword, embedding_256")
      .in("keyword", batch);

    // Build map of keyword -> embedding
    const embeddingMap = new Map<string, number[]>();
    for (const kw of kwData || []) {
      if (kw.embedding_256) {
        const emb = typeof kw.embedding_256 === "string"
          ? JSON.parse(kw.embedding_256)
          : kw.embedding_256;
        embeddingMap.set(kw.keyword, emb);
      }
    }

    // Add embeddings to nodes
    for (const node of nodes) {
      const embedding = embeddingMap.get(node.label);
      if (embedding) {
        node.embedding = embedding;
      }
    }
  }

  const withEmbeddings = nodes.filter(n => n.embedding).length;
  console.log(`Fetched embeddings for ${withEmbeddings}/${nodes.length} nodes`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
