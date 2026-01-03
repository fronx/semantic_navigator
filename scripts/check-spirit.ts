import { createServerClient } from "../src/lib/supabase";

async function main() {
  const supabase = createServerClient();

  const { data } = await supabase
    .from("keywords")
    .select("keyword, community_id, is_community_hub")
    .eq("node_type", "article")
    .ilike("keyword", "%spirit%");

  console.log("Spirit keywords:");
  data?.forEach(k =>
    console.log(`  ${k.keyword}: community=${k.community_id}, hub=${k.is_community_hub}`)
  );

  // Find hub for community 4
  const { data: hub } = await supabase
    .from("keywords")
    .select("keyword")
    .eq("node_type", "article")
    .eq("community_id", 4)
    .eq("is_community_hub", true)
    .single();

  console.log("\nHub for community 4:", hub?.keyword);

  // Count members in community 4
  const { count } = await supabase
    .from("keywords")
    .select("*", { count: "exact", head: true })
    .eq("node_type", "article")
    .eq("community_id", 4);

  console.log("Total members in community 4:", count);
}

main();
