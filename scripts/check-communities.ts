import { createServerClient } from "../src/lib/supabase";

async function main() {
  const supabase = createServerClient();

  // Check how many keywords have community assignments
  const { data: stats } = await supabase
    .from("keywords")
    .select("community_id, is_community_hub")
    .eq("node_type", "article");

  const withCommunity = stats?.filter((k) => k.community_id !== null) || [];
  const hubs = stats?.filter((k) => k.is_community_hub) || [];

  console.log("Total article keywords:", stats?.length);
  console.log("With community_id:", withCommunity.length);
  console.log("Hubs:", hubs.length);

  // Check a sample of semantic* keywords
  const { data: semantic } = await supabase
    .from("keywords")
    .select("keyword, community_id, is_community_hub")
    .eq("node_type", "article")
    .ilike("keyword", "semantic%")
    .limit(15);

  console.log("\nSemantic keywords sample:");
  semantic?.forEach((k) =>
    console.log(
      `  ${k.keyword}: community=${k.community_id}, hub=${k.is_community_hub}`
    )
  );

  // Check some hub keywords with their members
  const { data: hubsWithMembers } = await supabase
    .from("keywords")
    .select("keyword, community_id")
    .eq("node_type", "article")
    .eq("is_community_hub", true)
    .limit(5);

  console.log("\nSample hubs and their communities:");
  for (const hub of hubsWithMembers || []) {
    if (hub.community_id === null) continue;

    const { data: members } = await supabase
      .from("keywords")
      .select("keyword")
      .eq("community_id", hub.community_id)
      .eq("node_type", "article")
      .neq("keyword", hub.keyword)
      .limit(5);

    console.log(`  Hub: "${hub.keyword}" (community ${hub.community_id})`);
    console.log(`    Members: ${members?.map((m) => m.keyword).join(", ")}`);
  }
}

main();
