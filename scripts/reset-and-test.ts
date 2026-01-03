/**
 * Reset database and test import with a few articles.
 */
import { readFileSync, readdirSync } from "fs";
import { createServerClient } from "../src/lib/supabase";
import { ingestArticleWithChunks } from "../src/lib/ingestion-chunks";

const supabase = createServerClient();

async function clearAllData() {
  console.log("Clearing all data...");

  // Delete in order of dependencies
  await supabase.from("keywords").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("containment_edges").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("backlink_edges").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("nodes").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  console.log("Done.\n");
}

async function verifyDatabase() {
  console.log("\n=== Database Verification ===\n");

  // Count by type
  const { data: nodes } = await supabase.from("nodes").select("node_type");
  const counts = new Map<string, number>();
  for (const n of nodes || []) {
    counts.set(n.node_type, (counts.get(n.node_type) || 0) + 1);
  }
  console.log("Nodes:");
  for (const [type, count] of counts) {
    console.log(`  ${type}: ${count}`);
  }

  // Keywords by node type
  const { data: keywords } = await supabase
    .from("keywords")
    .select("node_id, nodes!inner(node_type)")
    .limit(1000);

  const kwByType = new Map<string, number>();
  for (const kw of keywords || []) {
    const type = (kw.nodes as { node_type: string }).node_type;
    kwByType.set(type, (kwByType.get(type) || 0) + 1);
  }
  console.log("\nKeywords by node type:");
  for (const [type, count] of kwByType) {
    console.log(`  ${type}: ${count}`);
  }

  // Containment edges
  const { count: edgeCount } = await supabase
    .from("containment_edges")
    .select("*", { count: "exact", head: true });
  console.log(`\nContainment edges: ${edgeCount}`);
}

async function main() {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    console.error("VAULT_PATH not set");
    process.exit(1);
  }

  // Step 1: Clear everything
  await clearAllData();

  // Step 2: Import 3 small test articles
  const testArticles = [
    "Writing/Agency/raw/agency-5.md",
    "Writing/Semantic Soup/Seeing the big picture.md",
    "Writing/Twitter/Kant impressions.md",
  ];

  console.log("Importing test articles...\n");

  for (const path of testArticles) {
    const fullPath = `${vaultPath}/${path}`;
    try {
      const content = readFileSync(fullPath, "utf-8");
      console.log(`--- ${path} (${content.length} chars) ---`);

      const startTime = Date.now();
      await ingestArticleWithChunks(supabase, path, content, {
        onProgress: (item) => console.log(`  ${item}`),
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Completed in ${elapsed}s\n`);
    } catch (err) {
      console.error(`  Failed: ${err}`);
    }
  }

  // Step 3: Verify
  await verifyDatabase();
}

main().catch(console.error);
