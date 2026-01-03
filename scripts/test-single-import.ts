/**
 * Test importing a single article with chunking and verify the results.
 */
import { readFileSync } from "fs";
import { createServerClient } from "../src/lib/supabase";
import { ingestArticleWithChunks } from "../src/lib/ingestion-chunks";

const supabase = createServerClient();

async function main() {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    console.error("VAULT_PATH not set");
    process.exit(1);
  }

  // Pick a small test article
  const testPath = "Writing/Agency/raw/agency-5.md";
  const fullPath = `${vaultPath}/${testPath}`;

  console.log(`\n=== Testing import of: ${testPath} ===\n`);

  // Read the file
  const content = readFileSync(fullPath, "utf-8");
  console.log(`File size: ${content.length} chars`);

  // Import with forceReimport
  console.log("\nImporting with chunking...\n");
  const startTime = Date.now();

  try {
    const articleId = await ingestArticleWithChunks(
      supabase,
      testPath,
      content,
      {
        onProgress: (item, completed, total) => {
          console.log(`  [${completed}/${total}] ${item}`);
        },
        onError: (error, context) => {
          console.error(`  Error in ${context}: ${error.message}`);
        },
      },
      { forceReimport: true }
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nImport complete in ${elapsed}s`);
    console.log(`Article ID: ${articleId}`);

    // Verify what's in the database
    console.log("\n=== Verifying Database ===\n");

    // Check article
    const { data: article } = await supabase
      .from("nodes")
      .select("id, source_path, summary, node_type")
      .eq("id", articleId)
      .single();

    console.log("Article node:");
    console.log(`  ID: ${article?.id}`);
    console.log(`  Type: ${article?.node_type}`);
    console.log(`  Summary: ${article?.summary?.slice(0, 100)}...`);

    // Check chunks
    const { data: chunks } = await supabase
      .from("containment_edges")
      .select("child:nodes!containment_edges_child_id_fkey(id, node_type, content, heading_context)")
      .eq("parent_id", articleId);

    console.log(`\nChunks: ${chunks?.length || 0}`);
    if (chunks && chunks.length > 0) {
      for (let i = 0; i < Math.min(3, chunks.length); i++) {
        const chunk = chunks[i].child as any;
        console.log(`  [${i + 1}] ${chunk.content?.slice(0, 60)}...`);
        if (chunk.heading_context?.length) {
          console.log(`      Heading: ${chunk.heading_context.join(" > ")}`);
        }
      }
      if (chunks.length > 3) {
        console.log(`  ... and ${chunks.length - 3} more`);
      }
    }

    // Check article-level keywords
    const { data: articleKeywords } = await supabase
      .from("keywords")
      .select("keyword")
      .eq("node_id", articleId);

    console.log(`\nArticle-level keywords: ${articleKeywords?.length || 0}`);
    if (articleKeywords && articleKeywords.length > 0) {
      console.log(`  ${articleKeywords.map((k) => k.keyword).join(", ")}`);
    }

    // Check chunk-level keywords
    const chunkIds = chunks?.map((c) => (c.child as any).id) || [];
    const { data: chunkKeywords } = await supabase
      .from("keywords")
      .select("keyword, node_id")
      .in("node_id", chunkIds);

    console.log(`\nChunk-level keywords: ${chunkKeywords?.length || 0}`);

  } catch (error) {
    console.error("\nImport failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
