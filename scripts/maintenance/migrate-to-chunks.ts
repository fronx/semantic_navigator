/**
 * Migration script: Drop all existing data and reimport using semantic chunking.
 *
 * Usage:
 *   npm run script scripts/migrate-to-chunks.ts
 *   npm run script scripts/migrate-to-chunks.ts --dry-run
 *   npm run script scripts/migrate-to-chunks.ts --concurrency 3
 */
import { readFileSync, existsSync } from "fs";
import { createServerClient } from "../src/lib/supabase";
import { ingestArticlesParallelChunked } from "../src/lib/ingestion-parallel";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency"));
  const concurrency = concurrencyArg ? parseInt(concurrencyArg.split("=")[1] || "5", 10) : 5;

  const supabase = createServerClient();
  const vaultPath = process.env.VAULT_PATH;

  if (!vaultPath) {
    console.error("VAULT_PATH environment variable not set");
    process.exit(1);
  }

  // 1. Get list of existing article source_paths
  console.log("Fetching existing articles...");
  const { data: existingArticles, error: fetchError } = await supabase
    .from("nodes")
    .select("source_path")
    .eq("node_type", "article");

  if (fetchError) {
    console.error("Failed to fetch existing articles:", fetchError);
    process.exit(1);
  }

  const articlePaths = existingArticles
    ?.map((a) => a.source_path)
    .filter((p): p is string => p !== null) || [];
  console.log(`Found ${articlePaths.length} articles to reimport`);

  if (articlePaths.length === 0) {
    console.log("No articles to migrate.");
    return;
  }

  // Show what we'll reimport
  console.log("\nArticles to reimport:");
  for (const path of articlePaths) {
    console.log(`  - ${path}`);
  }

  if (dryRun) {
    console.log("\n--dry-run specified, stopping here.");
    return;
  }

  // Confirm before destructive operation
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `\nThis will DELETE ALL existing nodes, edges, and keywords, then reimport ${articlePaths.length} articles.\nType "yes" to continue: `,
      resolve
    );
  });
  rl.close();

  if (answer.toLowerCase() !== "yes") {
    console.log("Aborted.");
    return;
  }

  // 2. Drop all existing data
  console.log("\nDropping all existing data...");

  // Delete in order of dependencies
  const { error: keywordsError } = await supabase
    .from("keywords")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (keywordsError) console.error("Error deleting keywords:", keywordsError);

  const { error: containmentError } = await supabase
    .from("containment_edges")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (containmentError) console.error("Error deleting containment_edges:", containmentError);

  const { error: backlinkError } = await supabase
    .from("backlink_edges")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (backlinkError) console.error("Error deleting backlink_edges:", backlinkError);

  const { error: nodesError } = await supabase
    .from("nodes")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (nodesError) console.error("Error deleting nodes:", nodesError);

  console.log("Data dropped.");

  // 3. Read all article contents from vault
  console.log("\nReading article contents from vault...");
  const files: { path: string; name: string; content: string }[] = [];
  const missingFiles: string[] = [];

  for (const sourcePath of articlePaths) {
    const fullPath = `${vaultPath}/${sourcePath}`;
    if (!existsSync(fullPath)) {
      missingFiles.push(sourcePath);
      continue;
    }
    const content = readFileSync(fullPath, "utf-8");
    const name = sourcePath.split("/").pop() || sourcePath;
    files.push({ path: sourcePath, name, content });
  }

  if (missingFiles.length > 0) {
    console.log(`\nWarning: ${missingFiles.length} files not found in vault:`);
    for (const path of missingFiles) {
      console.log(`  - ${path}`);
    }
  }

  console.log(`Read ${files.length} files, ready to reimport.`);

  // 4. Reimport with chunked ingestion
  console.log(`\nReimporting ${files.length} articles with semantic chunking (concurrency: ${concurrency})...`);
  const startTime = Date.now();

  const result = await ingestArticlesParallelChunked(
    supabase,
    files,
    {
      onProgress: (completed, total, active) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const activeStr = active.length > 0 ? ` [${active.join(", ")}]` : "";
        console.log(`[${elapsed}s] ${completed}/${total}${activeStr}`);
      },
      onError: (error, context) => {
        console.error(`Error in ${context}: ${error.message}`);
      },
    },
    { forceReimport: true },
    concurrency
  );

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nMigration complete in ${totalTime}s`);
  console.log(`  Successful: ${result.successful}`);
  console.log(`  Failed: ${result.failed}`);
}

main().catch(console.error);
