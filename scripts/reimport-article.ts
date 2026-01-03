import { readFileSync, existsSync } from "fs";
import { createServerClient } from "../src/lib/supabase";
import { ingestArticle } from "../src/lib/ingestion";
import { parseMarkdown, flattenSections } from "../src/lib/parser";

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
  const flat = flattenSections(parsed.sections);

  console.log(`\n=== Document Structure ===`);
  console.log(`Title: ${parsed.title}`);
  console.log(`Backlinks: ${parsed.backlinks.length}`);
  console.log(`Top-level sections: ${parsed.sections.length}`);
  console.log(`Total flattened sections: ${flat.length}`);

  let totalParagraphs = 0;
  for (const section of flat) {
    totalParagraphs += section.paragraphs.length;
  }
  console.log(`Total paragraphs: ${totalParagraphs}`);
  console.log(`Estimated API calls: ~${1 + flat.length + totalParagraphs * 3} (article + sections + paragraphs*3)`);

  console.log(`\n=== Hierarchy ===`);
  for (const section of flat) {
    const indent = "  ".repeat(section.level - 1);
    console.log(`${indent}[h${section.level}] ${section.title} (${section.paragraphs.length} paragraphs)`);
  }

  if (dryRun) {
    console.log(`\n--dry-run specified, stopping here.`);
    return;
  }

  console.log(`\n=== Starting Import ===`);
  const startTime = Date.now();

  const articleId = await ingestArticle(
    supabase,
    sourcePath,
    content,
    {
      onProgress: (item, completed, total) => {
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
