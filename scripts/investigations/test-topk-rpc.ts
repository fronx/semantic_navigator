import { createServerClient } from "../src/lib/supabase";

const supabase = createServerClient();

async function main() {
  console.log("Testing top-K RPC...\n");

  // Test with new parameters
  const { data, error } = await (supabase.rpc as any)("get_article_keyword_graph", {
    max_edges_per_article: 5,
    min_similarity: 0.3,
  });

  if (error) {
    console.error("RPC Error:", error);
    return;
  }

  console.log("Pairs found:", data?.length || 0);
  if (data && data.length > 0) {
    for (const p of data.slice(0, 5)) {
      console.log(`  "${p.keyword_text}" <-> "${p.similar_keyword_text}" (${(p.similarity * 100).toFixed(1)}%)`);
    }
  }
}

main().catch(console.error);
