import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../src/lib/embeddings";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testWithoutFilter(embedding: number[]) {
  const start = performance.now();
  const { data, error } = await supabase.rpc("search_similar", {
    query_embedding: embedding,
    match_threshold: 0.1,
    match_count: 10,
    // No filter_node_type - uses SQL default
  });
  return { elapsed: performance.now() - start, count: data?.length, error: error?.message };
}

async function testWithNullFilter(embedding: number[]) {
  const start = performance.now();
  const { data, error } = await supabase.rpc("search_similar", {
    query_embedding: embedding,
    match_threshold: 0.1,
    match_count: 10,
    filter_node_type: null,  // Explicit null like API does
  });
  return { elapsed: performance.now() - start, count: data?.length, error: error?.message };
}

async function main() {
  console.log("Generating embedding for 'agency'...");
  const embedding = await generateEmbedding("agency");

  console.log("\n--- Comparing filter_node_type handling ---\n");

  for (let round = 1; round <= 5; round++) {
    const withoutFilter = await testWithoutFilter(embedding);
    const withNullFilter = await testWithNullFilter(embedding);

    console.log(
      `Round ${round}: without=${withoutFilter.elapsed.toFixed(0)}ms, with_null=${withNullFilter.elapsed.toFixed(0)}ms, diff=${(withNullFilter.elapsed - withoutFilter.elapsed).toFixed(0)}ms`
    );
  }
}

main().catch(console.error);
