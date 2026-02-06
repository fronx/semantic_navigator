import { createServerClient } from "../src/lib/supabase";

const supabase = createServerClient();

async function main() {
  console.log("=== Import Quality Check ===\n");

  // Count nodes by type
  const { data: allNodes } = await supabase
    .from("nodes")
    .select("node_type");

  const nodeCounts = new Map<string, number>();
  for (const row of allNodes || []) {
    nodeCounts.set(row.node_type, (nodeCounts.get(row.node_type) || 0) + 1);
  }

  console.log("Node counts:");
  for (const [type, count] of nodeCounts) {
    console.log(`  ${type}: ${count}`);
  }

  // Count keywords
  const { count: keywordCount } = await supabase
    .from("keywords")
    .select("*", { count: "exact", head: true });

  console.log(`  keywords (table): ${keywordCount}`);

  // Find articles with chunks
  const { data: chunks } = await supabase
    .from("nodes")
    .select("id, source_path")
    .eq("node_type", "chunk");

  if (chunks && chunks.length > 0) {
    const chunkPaths = [...new Set(chunks.map((c) => c.source_path))];
    console.log(`\nArticles with chunks: ${chunkPaths.length}`);
    for (const path of chunkPaths.slice(0, 3)) {
      const count = chunks.filter((c) => c.source_path === path).length;
      console.log(`  ${path}: ${count} chunks`);
    }
  }

  // Get a sample article with its chunks and keywords
  const { data: articles } = await supabase
    .from("nodes")
    .select("id, source_path, summary")
    .eq("node_type", "article")
    .limit(3);

  if (!articles || articles.length === 0) {
    console.log("\nNo articles found yet.");
    return;
  }

  console.log("\n=== Sample Articles ===\n");

  for (const article of articles) {
    console.log(`--- ${article.source_path} ---`);
    console.log(`Summary: ${article.summary?.slice(0, 150)}...`);

    // Get chunks for this article
    const { data: chunks } = await supabase
      .from("containment_edges")
      .select("child:nodes!containment_edges_child_id_fkey(id, content, heading_context)")
      .eq("parent_id", article.id);

    const chunkNodes = chunks?.map((c) => c.child) || [];
    console.log(`Chunks: ${chunkNodes.length}`);

    if (chunkNodes.length > 0) {
      const sample = chunkNodes[0] as unknown as {
        id: string;
        content: string | null;
        heading_context: string[] | null;
      };
      console.log(`  First chunk: "${sample.content?.slice(0, 80)}..."`);
      if (sample.heading_context?.length) {
        console.log(`  Heading context: ${sample.heading_context.join(" > ")}`);
      }
    }

    // Get keywords for this article
    const { data: articleKeywords } = await supabase
      .from("keywords")
      .select("keyword")
      .eq("node_id", article.id);

    console.log(`Article keywords: ${articleKeywords?.length || 0}`);
    if (articleKeywords && articleKeywords.length > 0) {
      console.log(`  ${articleKeywords.map((k) => k.keyword).join(", ")}`);
    }

    // Get keywords attached to chunks (not bubbled up)
    const chunkIds = chunkNodes.map((c) => (c as unknown as { id: string }).id);
    const { data: chunkKeywords } = await supabase
      .from("keywords")
      .select("keyword")
      .in("node_id", chunkIds);

    console.log(`Chunk keywords: ${chunkKeywords?.length || 0}`);
    console.log();
  }
}

main().catch(console.error);
