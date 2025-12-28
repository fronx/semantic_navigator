import { createClient } from "@supabase/supabase-js";

function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const supabase = createServerClient();

async function testPerformance() {
  // Get count of keywords
  const { count } = await supabase
    .from("keywords")
    .select("*", { count: "exact", head: true });

  console.log(`Total keywords: ${count}`);

  // Get all keywords with embeddings
  const { data: keywords, error } = await supabase
    .from("keywords")
    .select("id, keyword, embedding, node_id")
    .not("embedding", "is", null);

  if (error) {
    console.error("Error fetching keywords:", error);
    return;
  }

  console.log(`Keywords with embeddings: ${keywords.length}`);

  // Get keyword -> article mapping
  const nodeIds = [...new Set(keywords.map((k) => k.node_id))];

  // Build node -> article map by walking containment edges
  const { data: edges } = await supabase
    .from("containment_edges")
    .select("child_id, parent:nodes!containment_edges_parent_id_fkey(id, node_type)")
    .in("child_id", nodeIds);

  const nodeToParent = new Map<string, { id: string; node_type: string }>();
  const needsGrandparent = new Set<string>();

  for (const edge of edges || []) {
    const parent = edge.parent as unknown as { id: string; node_type: string };
    if (parent.node_type === "article") {
      nodeToParent.set(edge.child_id, parent);
    } else {
      nodeToParent.set(edge.child_id, parent);
      needsGrandparent.add(parent.id);
    }
  }

  // Get grandparents for sections
  if (needsGrandparent.size > 0) {
    const { data: grandEdges } = await supabase
      .from("containment_edges")
      .select("child_id, parent:nodes!containment_edges_parent_id_fkey(id, node_type)")
      .in("child_id", [...needsGrandparent]);

    const sectionToArticle = new Map<string, string>();
    for (const edge of grandEdges || []) {
      const parent = edge.parent as unknown as { id: string; node_type: string };
      if (parent.node_type === "article") {
        sectionToArticle.set(edge.child_id, parent.id);
      }
    }

    // Update nodeToParent with article ids
    for (const [nodeId, parent] of nodeToParent) {
      if (parent.node_type === "section") {
        const articleId = sectionToArticle.get(parent.id);
        if (articleId) {
          nodeToParent.set(nodeId, { id: articleId, node_type: "article" });
        }
      }
    }
  }

  // Map keyword id to article id
  const keywordToArticle = new Map<string, string>();
  for (const kw of keywords) {
    const parent = nodeToParent.get(kw.node_id);
    if (parent) {
      keywordToArticle.set(kw.id, parent.id);
    }
  }

  // Build keyword id to keyword text map
  const keywordIdToText = new Map<string, string>();
  for (const kw of keywords) {
    keywordIdToText.set(kw.id, kw.keyword);
  }

  console.log(`\n--- Testing Top-K approach (5 neighbors per keyword) ---`);

  const SIMILARITY_THRESHOLD = 0.7;
  const TOP_K = 6; // +1 for self-match

  const startTopK = performance.now();

  const similarPairs: { kw1: string; kw2: string; similarity: number }[] = [];

  // Batch keywords for parallel processing
  const BATCH_SIZE = 10;

  for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
    const batch = keywords.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (kw) => {
        const embedding = kw.embedding;
        const articleId = keywordToArticle.get(kw.id);

        const { data: similar, error } = await supabase.rpc("search_similar_keywords", {
          query_embedding: embedding,
          match_threshold: SIMILARITY_THRESHOLD,
          match_count: TOP_K,
        });

        if (error) {
          console.error(`Error for keyword ${kw.keyword}:`, error.message);
          return;
        }

        if (similar) {
          for (const match of similar) {
            if (match.id === kw.id) continue; // Skip self
            const matchArticle = keywordToArticle.get(match.id);
            // Only include if from different article and different text
            if (matchArticle && matchArticle !== articleId && match.keyword !== kw.keyword) {
              similarPairs.push({
                kw1: kw.keyword,
                kw2: match.keyword,
                similarity: match.similarity,
              });
            }
          }
        }
      })
    );

    // Progress update every 50 keywords
    if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= keywords.length) {
      console.log(`  Processed ${Math.min(i + BATCH_SIZE, keywords.length)}/${keywords.length} keywords...`);
    }
  }

  const endTopK = performance.now();
  console.log(`\nTop-K approach took ${(endTopK - startTopK).toFixed(0)}ms`);
  console.log(`Found ${similarPairs.length} similar pairs (before deduplication)`);

  // Deduplicate pairs (A-B and B-A are the same)
  const uniquePairs = new Map<string, { kw1: string; kw2: string; similarity: number }>();
  for (const pair of similarPairs) {
    const key = [pair.kw1, pair.kw2].sort().join("|||");
    if (!uniquePairs.has(key) || uniquePairs.get(key)!.similarity < pair.similarity) {
      uniquePairs.set(key, pair);
    }
  }

  console.log(`Unique pairs: ${uniquePairs.size}`);

  // Show examples
  const sortedPairs = [...uniquePairs.values()].sort((a, b) => b.similarity - a.similarity);
  console.log(`\nTop 15 similar keyword pairs:`);
  for (const pair of sortedPairs.slice(0, 15)) {
    console.log(`  "${pair.kw1}" <-> "${pair.kw2}" (${(pair.similarity * 100).toFixed(1)}%)`);
  }

  // Performance summary for Top-K
  console.log(`\n--- Top-K Summary ---`);
  console.log(`RPC calls: ${keywords.length}`);
  console.log(`Time: ${(endTopK - startTopK).toFixed(0)}ms`);
  console.log(`Per keyword: ${((endTopK - startTopK) / keywords.length).toFixed(1)}ms`);

  // Test 2: Cross-join approach (single SQL query)
  console.log(`\n\n--- Testing Cross-Join approach (single SQL query) ---`);

  const startCrossJoin = performance.now();

  const { data: crossPairs, error: crossError } = await supabase.rpc(
    "get_similar_keyword_pairs",
    { similarity_threshold: SIMILARITY_THRESHOLD }
  );

  const endCrossJoin = performance.now();

  if (crossError) {
    console.log(`Cross-join RPC error: ${crossError.message}`);
  } else {
    console.log(`Time: ${(endCrossJoin - startCrossJoin).toFixed(0)}ms`);
    console.log(`Found ${crossPairs?.length || 0} pairs`);

    if (crossPairs && crossPairs.length > 0) {
      console.log(`\nTop 15 pairs:`);
      for (const pair of crossPairs.slice(0, 15)) {
        console.log(
          `  "${pair.keyword1_text}" <-> "${pair.keyword2_text}" (${(pair.similarity * 100).toFixed(1)}%)`
        );
      }
    }
  }

  console.log(`\n\n=== COMPARISON ===`);
  console.log(`Top-K (${keywords.length} RPC calls): ${(endTopK - startTopK).toFixed(0)}ms`);
  if (!crossError) {
    console.log(`Cross-join (1 RPC call): ${(endCrossJoin - startCrossJoin).toFixed(0)}ms`);
    console.log(`Speedup: ${((endTopK - startTopK) / (endCrossJoin - startCrossJoin)).toFixed(1)}x`);
  }
}

testPerformance().catch(console.error);
