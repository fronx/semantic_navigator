import { readFileSync, existsSync } from "fs";
import { createServerClient } from "../src/lib/supabase";
import { ingestArticleWithChunks } from "../src/lib/ingestion-chunks";
import { parseMarkdown } from "../src/lib/parser";
import { chunkTextToArray } from "../src/lib/chunker";

async function main() {
  const sourcePath = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");

  if (!sourcePath) {
    console.error("Usage: npm run script scripts/reimport-article.ts <source_path> [--dry-run]");
    console.error("Example: npm run script scripts/reimport-article.ts 'Writing/Agency/raw/agency-2.md'");
    console.error("         npm run script scripts/reimport-article.ts 'Writing/Agency/raw/agency-2.md' --dry-run");
    process.exit(1);
  }

  const supabase = createServerClient();
  const vaultPath = process.env.VAULT_PATH;

  if (!vaultPath) {
    console.error("VAULT_PATH environment variable not set");
    process.exit(1);
  }

  const fullPath = `${vaultPath}/${sourcePath}`;

  if (!existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  console.log(`Reimporting: ${sourcePath}`);
  console.log(`Full path: ${fullPath}`);

  const content = readFileSync(fullPath, "utf-8");
  const filename = sourcePath.split("/").pop() || sourcePath;
  const parsed = parseMarkdown(content, filename);

  console.log(`\n=== Document Structure ===`);
  console.log(`Title: ${parsed.title}`);
  console.log(`Backlinks: ${parsed.backlinks.length}`);
  console.log(`Content length: ${parsed.content.length} chars`);

  if (dryRun) {
    // Show chunk preview
    console.log(`\n=== Chunk Preview (dry run) ===`);
    const chunks = await chunkTextToArray(parsed.content);
    console.log(`Total chunks: ${chunks.length}`);
    for (const chunk of chunks) {
      const preview = chunk.content.slice(0, 100).replace(/\n/g, " ");
      console.log(`  [${chunk.position}] ${chunk.chunkType || "unlabeled"}: "${preview}..."`);
      console.log(`      Keywords: ${chunk.keywords.join(", ")}`);
    }
    console.log(`\n--dry-run specified, stopping here.`);
    return;
  }

  console.log(`\n=== Starting Import ===`);
  const startTime = Date.now();

  const articleId = await ingestArticleWithChunks(
    supabase,
    sourcePath,
    content,
    {
      onProgress: (item: string, completed: number, total: number) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[${elapsed}s] [${completed}/${total}] ${item}`);
      },
    },
    { forceReimport: true }
  );

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nReimport complete in ${totalTime}s. Article ID: ${articleId}`);
}

main().catch(console.error);
