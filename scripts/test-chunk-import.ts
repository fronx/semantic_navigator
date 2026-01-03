import { readFileSync } from "fs";
import { createServerClient } from "../src/lib/supabase";
import { ingestArticleWithChunks } from "../src/lib/ingestion-chunks";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run script scripts/test-chunk-import.ts <file.md>");
    process.exit(1);
  }

  const forceReimport = process.argv.includes("--force");

  const content = readFileSync(filePath, "utf-8");
  const supabase = createServerClient();

  console.log(`\nImporting: ${filePath}`);
  console.log(`Content length: ${content.length} chars`);
  console.log(`Force reimport: ${forceReimport}\n`);

  const articleId = await ingestArticleWithChunks(
    supabase,
    filePath,
    content,
    {
      onProgress: (current, completed, total) => {
        console.log(`[${completed}/${total}] ${current}`);
      },
    },
    { forceReimport }
  );

  console.log(`\nArticle ID: ${articleId}`);

  // Show what was created
  const { data: chunks } = await supabase
    .from("containment_edges")
    .select("child_id, position")
    .eq("parent_id", articleId)
    .order("position");

  if (chunks && chunks.length > 0) {
    console.log(`\nCreated ${chunks.length} chunks:`);

    const chunkIds = chunks.map((c) => c.child_id);
    const { data: chunkNodes } = await supabase
      .from("nodes")
      .select("*")
      .in("id", chunkIds);

    for (const chunk of chunks) {
      const node = chunkNodes?.find((n) => n.id === chunk.child_id);
      if (node) {
        const preview = node.content?.slice(0, 80).replace(/\n/g, " ") || "";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunkType = (node as any).chunk_type || "?";
        console.log(`  ${chunk.position + 1}. [${chunkType}] ${preview}...`);

        // Show keywords
        const { data: keywords } = await supabase
          .from("keywords")
          .select("keyword")
          .eq("node_id", node.id);

        if (keywords && keywords.length > 0) {
          console.log(`     Keywords: ${keywords.map((k) => k.keyword).join(", ")}`);
        }
      }
    }
  }
}

main().catch(console.error);
