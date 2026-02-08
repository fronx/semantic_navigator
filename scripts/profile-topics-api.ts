/**
 * Profile /api/topics loading performance.
 *
 * Usage:
 *   npm run script scripts/profile-topics-api.ts [nodeType]
 *
 * Measures each phase of getKeywordBackbone() independently:
 *   1. get_keyword_graph() RPC
 *   2. Embedding fetch (batched)
 *   3. Community lookup (batched)
 *   4. k-NN computation (JS)
 *   5. Total end-to-end
 */

import { createServerClient } from "../src/lib/supabase";
import { getKeywordBackbone } from "../src/lib/graph-queries";

const nodeType = (process.argv[2] ?? "article") as "article" | "chunk";

async function time<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`  ${label}: ${ms.toFixed(0)}ms`);
  return { result, ms };
}

async function main() {
  const supabase = createServerClient();

  console.log(`=== Profiling /api/topics (nodeType=${nodeType}) ===\n`);

  // Warm up connection
  await supabase.from("keywords").select("id").limit(1);

  // --- Phase 1: get_keyword_graph RPC ---
  console.log("--- Phase 1: get_keyword_graph() RPC ---");
  for (let i = 0; i < 3; i++) {
    await time(`Run ${i + 1}`, async () => {
      const { data, error } = await (supabase.rpc as any)("get_keyword_graph", {
        filter_node_type: nodeType,
        max_edges_per_node: 10,
        min_similarity: 0.3,
      });
      if (error) throw error;
      return data?.length ?? 0;
    });
  }

  // --- Phase 2: Embedding fetch (simulating batch pattern) ---
  console.log("\n--- Phase 2: Embedding fetch (batched, QUERY_BATCH_SIZE=100) ---");
  // First get keyword IDs
  const { data: allKeywords } = await supabase
    .from("keywords")
    .select("id")
    .eq("node_type", nodeType)
    .not("embedding", "is", null);

  const keywordIds = (allKeywords ?? []).map(k => k.id);
  console.log(`  Keywords to fetch: ${keywordIds.length}`);

  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const BATCH_SIZE = 100;
    let batchCount = 0;
    for (let i = 0; i < keywordIds.length; i += BATCH_SIZE) {
      const batch = keywordIds.slice(i, i + BATCH_SIZE);
      await supabase.from("keywords").select("id, keyword, embedding_256").in("id", batch);
      batchCount++;
    }
    const ms = performance.now() - start;
    console.log(`  Run ${run + 1}: ${ms.toFixed(0)}ms (${batchCount} batches)`);
  }

  // --- Phase 3: Community lookup (simulating batch pattern) ---
  console.log("\n--- Phase 3: Community lookup (batched, 2 queries per batch) ---");
  const { data: kwLabels } = await supabase
    .from("keywords")
    .select("keyword")
    .eq("node_type", nodeType)
    .not("embedding", "is", null);

  const labels = [...new Set((kwLabels ?? []).map(k => k.keyword))];
  console.log(`  Unique keywords: ${labels.length}`);

  for (let run = 0; run < 3; run++) {
    const start = performance.now();
    const BATCH_SIZE = 100;
    let queryCount = 0;
    for (let i = 0; i < labels.length; i += BATCH_SIZE) {
      const batch = labels.slice(i, i + BATCH_SIZE);
      const { data: kwData } = await supabase
        .from("keywords")
        .select("id, keyword")
        .eq("node_type", nodeType)
        .in("keyword", batch);
      queryCount++;

      if (kwData && kwData.length > 0) {
        const ids = kwData.map(k => k.id);
        await supabase
          .from("keyword_communities")
          .select("keyword_id, community_id")
          .eq("level", 3)
          .in("keyword_id", ids);
        queryCount++;
      }
    }
    const ms = performance.now() - start;
    console.log(`  Run ${run + 1}: ${ms.toFixed(0)}ms (${queryCount} queries)`);
  }

  // --- Phase 4: Proposed optimization - single metadata query ---
  console.log("\n--- Phase 4: Proposed get_keyword_metadata() RPC ---");
  // Try calling it (will fail if migration not applied yet)
  for (let i = 0; i < 3; i++) {
    try {
      await time(`Run ${i + 1}`, async () => {
        const { data, error } = await (supabase.rpc as any)("get_keyword_metadata", {
          filter_node_type: nodeType,
          community_level: 3,
        });
        if (error) throw error;
        return data?.length ?? 0;
      });
    } catch {
      console.log(`  Run ${i + 1}: SKIPPED (migration not applied yet)`);
    }
  }

  // --- End-to-end: getKeywordBackbone ---
  console.log("\n--- End-to-end: getKeywordBackbone() ---");
  for (let i = 0; i < 3; i++) {
    await time(`Run ${i + 1}`, async () => {
      const result = await getKeywordBackbone(supabase, {
        maxEdgesPerArticle: 10,
        minSimilarity: 0.3,
        communityLevel: 3,
        nearestNeighbors: 1,
        nodeType,
        forceLive: true,
      });
      return `${result.nodes.length} nodes, ${result.edges.length} edges`;
    });
  }
}

main().catch(console.error);
