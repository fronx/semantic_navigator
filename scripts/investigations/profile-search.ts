import { generateEmbedding } from "../src/lib/embeddings";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function countRows() {
  const [nodes, keywords] = await Promise.all([
    supabase.from("nodes").select("id", { count: "exact", head: true }),
    supabase.from("keywords").select("id", { count: "exact", head: true }),
  ]);
  console.log("Row counts:");
  console.log(`  nodes: ${nodes.count}`);
  console.log(`  keywords: ${keywords.count}`);
}

async function profileQuery(name: string, fn: () => Promise<unknown>) {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  console.log(`${name}: ${elapsed.toFixed(0)}ms`);
  return { result, elapsed };
}

async function testSearchWithExplain(queryText: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing search for: "${queryText}"`);
  console.log(`${"=".repeat(60)}\n`);

  const queryEmbedding = await generateEmbedding(queryText);

  // Test 1: Simple node search (isolated)
  console.log("--- Test 1: Simple node search (test_node_search) ---");
  const { elapsed: nodeTime } = await profileQuery("node search", async () => {
    const { data, error } = await supabase.rpc("test_node_search", {
      query_embedding: queryEmbedding,
      match_count: 10,
    });
    if (error) console.log(`  Error: ${error.message}`);
    else console.log(`  Results: ${data?.length}`);
    return data;
  });

  // Test 2: Simple keyword search (isolated)
  console.log("\n--- Test 2: Simple keyword search (test_keyword_search) ---");
  const { elapsed: keywordTime } = await profileQuery("keyword search", async () => {
    const { data, error } = await supabase.rpc("test_keyword_search", {
      query_embedding: queryEmbedding,
      match_count: 10,
    });
    if (error) console.log(`  Error: ${error.message}`);
    else console.log(`  Results: ${data?.length}`);
    return data;
  });

  // Test 3: Full search_similar (10 results)
  console.log("\n--- Test 3: Full search_similar (limit 10) ---");
  const { elapsed: fullTime10 } = await profileQuery("search_similar(10)", async () => {
    const { data, error } = await supabase.rpc("search_similar", {
      query_embedding: queryEmbedding,
      match_threshold: 0.1,
      match_count: 10,
    });
    if (error) console.log(`  Error: ${error.message}`);
    else console.log(`  Results: ${data?.length}`);
    return data;
  });

  // Test 4: Full search_similar (50 results - what the UI requests)
  console.log("\n--- Test 4: Full search_similar (limit 50) ---");
  const { elapsed: fullTime50 } = await profileQuery("search_similar(50)", async () => {
    const { data, error } = await supabase.rpc("search_similar", {
      query_embedding: queryEmbedding,
      match_threshold: 0.1,
      match_count: 50,
    });
    if (error) console.log(`  Error: ${error.message}`);
    else console.log(`  Results: ${data?.length}`);
    return data;
  });

  return { nodeTime, keywordTime, fullTime10, fullTime50 };
}

async function verifyMigration() {
  console.log("Verifying migration 008 was applied...\n");

  // The test functions should exist if migration 008 was applied
  const { error: testError } = await supabase.rpc("test_node_search", {
    query_embedding: new Array(1536).fill(0),
    match_count: 1,
  });

  if (testError) {
    console.log("ERROR: test_node_search doesn't exist!");
    console.log("Migration 008 may not have been applied correctly.");
    console.log("Try: npx supabase migration repair 008 --status reverted --linked");
    console.log("Then: npx supabase db push");
    return false;
  }

  console.log("OK: test_node_search exists - migration 008 is applied\n");
  return true;
}

async function main() {
  const migrationOk = await verifyMigration();
  if (!migrationOk) return;

  await countRows();

  // Test with both search terms
  const agency = await testSearchWithExplain("agency");
  const consciousness = await testSearchWithExplain("consciousness");

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`\n"agency":`);
  console.log(`  node search:     ${agency.nodeTime.toFixed(0)}ms`);
  console.log(`  keyword search:  ${agency.keywordTime.toFixed(0)}ms`);
  console.log(`  full (limit 10): ${agency.fullTime10.toFixed(0)}ms`);
  console.log(`  full (limit 50): ${agency.fullTime50.toFixed(0)}ms`);
  console.log(`\n"consciousness":`);
  console.log(`  node search:     ${consciousness.nodeTime.toFixed(0)}ms`);
  console.log(`  keyword search:  ${consciousness.keywordTime.toFixed(0)}ms`);
  console.log(`  full (limit 10): ${consciousness.fullTime10.toFixed(0)}ms`);
  console.log(`  full (limit 50): ${consciousness.fullTime50.toFixed(0)}ms`);
}

main().catch(console.error);
