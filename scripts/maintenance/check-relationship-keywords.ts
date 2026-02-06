import { createServerClient } from "../src/lib/supabase";

async function check() {
  const supabase = createServerClient();

  // Count total article-level keywords
  const { count: totalKeywords } = await supabase
    .from("keywords")
    .select("*", { count: "exact", head: true })
    .eq("node_type", "article")
    .not("embedding", "is", null);

  // Count keywords with community assignments
  const { count: inCommunity } = await supabase
    .from("keywords")
    .select("*", { count: "exact", head: true })
    .eq("node_type", "article")
    .not("community_id", "is", null);

  const { count: isolated } = await supabase
    .from("keywords")
    .select("*", { count: "exact", head: true })
    .eq("node_type", "article")
    .is("community_id", null);

  console.log("Keyword Statistics:");
  console.log(`  Total article-level keywords with embeddings: ${totalKeywords}`);
  console.log(`  Keywords in communities: ${inCommunity}`);
  console.log(`  Isolated keywords (no community): ${isolated}`);

  // Check similarity table
  const { count: simPairs } = await supabase
    .from("keyword_similarities")
    .select("*", { count: "exact", head: true });

  console.log(`\nSimilarity table:`);
  console.log(`  Total pairs stored: ${simPairs}`);
}
check();
