import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../src/lib/embeddings";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function explainQuery(queryText: string) {
  console.log(`\nGenerating embedding for "${queryText}"...`);
  const embedding = await generateEmbedding(queryText);

  // Format embedding as PostgreSQL array literal
  const embeddingLiteral = `'[${embedding.join(",")}]'::vector(1536)`;

  // Run EXPLAIN ANALYZE on the search_similar function body
  const explainQuery = `
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    WITH
    top_node_candidates AS (
      SELECT
        n.id,
        n.content,
        n.summary,
        n.node_type,
        n.source_path,
        1 - (n.embedding <=> ${embeddingLiteral}) AS similarity
      FROM nodes n
      WHERE
        n.embedding IS NOT NULL
      ORDER BY n.embedding <=> ${embeddingLiteral}
      LIMIT 30
    ),
    node_matches AS (
      SELECT * FROM top_node_candidates
      WHERE similarity > 0.1
    ),
    top_keyword_candidates AS (
      SELECT
        k.id AS keyword_id,
        k.node_id,
        k.keyword,
        1 - (k.embedding <=> ${embeddingLiteral}) AS keyword_similarity
      FROM keywords k
      WHERE k.embedding IS NOT NULL
      ORDER BY k.embedding <=> ${embeddingLiteral}
      LIMIT 50
    ),
    keyword_matches AS (
      SELECT * FROM top_keyword_candidates
      WHERE keyword_similarity > 0.1
    ),
    nodes_from_keywords AS (
      SELECT
        n.id,
        n.content,
        n.summary,
        n.node_type,
        n.source_path,
        MAX(km.keyword_similarity) AS similarity
      FROM keyword_matches km
      JOIN nodes n ON n.id = km.node_id
      GROUP BY n.id, n.content, n.summary, n.node_type, n.source_path
    ),
    all_matching_nodes AS (
      SELECT id, content, summary, node_type, source_path, MAX(similarity) AS similarity
      FROM (
        SELECT * FROM node_matches
        UNION ALL
        SELECT * FROM nodes_from_keywords
      ) combined
      GROUP BY id, content, summary, node_type, source_path
    ),
    with_keywords AS (
      SELECT
        amn.*,
        COALESCE(
          jsonb_agg(
            jsonb_build_object('keyword', km.keyword, 'similarity', km.keyword_similarity)
            ORDER BY km.keyword_similarity DESC
          ) FILTER (WHERE km.keyword IS NOT NULL),
          '[]'::jsonb
        ) AS matched_keywords
      FROM all_matching_nodes amn
      LEFT JOIN keyword_matches km ON km.node_id = amn.id
      GROUP BY amn.id, amn.content, amn.summary, amn.node_type, amn.source_path, amn.similarity
    )
    SELECT * FROM with_keywords
    ORDER BY similarity DESC
    LIMIT 10;
  `;

  console.log("\nRunning EXPLAIN ANALYZE...\n");

  const { data, error } = await supabase.rpc("exec_sql", { sql: explainQuery });

  if (error) {
    // If exec_sql doesn't exist, try running directly
    console.log("exec_sql not available, trying direct query...");
    const { data: data2, error: error2 } = await supabase.from("nodes").select("id").limit(1);
    if (error2) {
      console.log("Direct query error:", error2.message);
    }

    // Let's try a simpler approach - explain just the node search
    console.log("\nTrying simpler EXPLAIN on just node search...");
  } else {
    console.log(data);
  }
}

// Also test individual components
async function testComponents(queryText: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing components for "${queryText}"`);
  console.log("=".repeat(60));

  const embedding = await generateEmbedding(queryText);

  // Test 1: Just node search
  console.log("\n--- Node search only ---");
  let start = performance.now();
  const { data: nodeData, error: nodeErr } = await supabase.rpc("test_node_search", {
    query_embedding: embedding,
    match_count: 30
  });
  console.log(`Time: ${(performance.now() - start).toFixed(0)}ms, Results: ${nodeData?.length}, Error: ${nodeErr?.message || "none"}`);

  // Test 2: Just keyword search
  console.log("\n--- Keyword search only ---");
  start = performance.now();
  const { data: kwData, error: kwErr } = await supabase.rpc("test_keyword_search", {
    query_embedding: embedding,
    match_count: 50
  });
  console.log(`Time: ${(performance.now() - start).toFixed(0)}ms, Results: ${kwData?.length}, Error: ${kwErr?.message || "none"}`);

  // Test 3: Full search
  console.log("\n--- Full search_similar ---");
  start = performance.now();
  const { data: fullData, error: fullErr } = await supabase.rpc("search_similar", {
    query_embedding: embedding,
    match_threshold: 0.1,
    match_count: 10
  });
  console.log(`Time: ${(performance.now() - start).toFixed(0)}ms, Results: ${fullData?.length}, Error: ${fullErr?.message || "none"}`);
}

async function main() {
  await testComponents("agency");
  await testComponents("consciousness");
  await testComponents("memory and learning");
}

main().catch(console.error);
