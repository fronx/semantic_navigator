import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../src/lib/embeddings";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testScript(query: string, embedding: number[]) {
  const start = performance.now();
  const { data, error } = await supabase.rpc("search_similar", {
    query_embedding: embedding,
    match_threshold: 0.1,
    match_count: 10,
  });
  const elapsed = performance.now() - start;
  return { elapsed, count: data?.length, error: error?.message };
}

async function testApi(query: string) {
  const start = performance.now();
  const res = await fetch("http://localhost:3000/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 10 }),
  });
  const data = await res.json();
  const elapsed = performance.now() - start;
  return { elapsed, count: data.results?.length, error: data.error };
}

async function main() {
  const queries = ["agency", "consciousness", "memory"];

  // Pre-generate embeddings
  console.log("Generating embeddings...");
  const embeddings: Record<string, number[]> = {};
  for (const q of queries) {
    embeddings[q] = await generateEmbedding(q);
  }

  console.log("\n--- Interleaved comparison ---\n");

  for (let round = 1; round <= 3; round++) {
    console.log(`Round ${round}:`);
    for (const query of queries) {
      const scriptResult = await testScript(query, embeddings[query]);
      const apiResult = await testApi(query);

      console.log(
        `  "${query}": script=${scriptResult.elapsed.toFixed(0)}ms, api=${apiResult.elapsed.toFixed(0)}ms, diff=${(apiResult.elapsed - scriptResult.elapsed).toFixed(0)}ms`
      );
    }
    console.log();
  }
}

main().catch(console.error);
