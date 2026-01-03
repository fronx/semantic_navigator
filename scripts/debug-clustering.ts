import { createServerClient } from "../src/lib/supabase";

async function main() {
  const supabase = createServerClient();

  // Simulate what the API does at density=1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pairs } = await (supabase.rpc as any)("get_article_keyword_graph", {
    max_edges_per_article: 1,
    min_similarity: 0.3,
  });

  console.log(`At density=1, got ${pairs?.length || 0} keyword pairs`);

  // Collect unique keywords
  const keywordLabels = new Set<string>();
  for (const pair of pairs || []) {
    keywordLabels.add(pair.keyword_text);
    keywordLabels.add(pair.similar_keyword_text);
  }
  console.log(`Unique keywords in graph: ${keywordLabels.size}`);

  // Fetch their community info (batch to avoid .in() limit)
  const keywordArray = [...keywordLabels];
  const BATCH = 100;
  const keywords: Array<{ keyword: string; community_id: number | null; is_community_hub: boolean | null }> = [];

  for (let i = 0; i < keywordArray.length; i += BATCH) {
    const batch = keywordArray.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("keywords")
      .select("keyword, community_id, is_community_hub")
      .eq("node_type", "article")
      .in("keyword", batch);

    if (error) {
      console.error("Error fetching batch:", error);
      continue;
    }
    if (data) keywords.push(...data);
  }

  console.log(`Found community info for ${keywords?.length} keywords`);

  // Count by community status
  let isolated = 0;
  let inCommunityNotHub = 0;
  let hubs = 0;
  const communityIds = new Set<number>();

  for (const kw of keywords || []) {
    if (kw.community_id === null) {
      isolated++;
    } else {
      communityIds.add(kw.community_id);
      if (kw.is_community_hub) {
        hubs++;
      } else {
        inCommunityNotHub++;
      }
    }
  }

  console.log(`\nBreakdown:`);
  console.log(`  Isolated (no community): ${isolated}`);
  console.log(`  In community, not hub: ${inCommunityNotHub}`);
  console.log(`  Hub keywords: ${hubs}`);
  console.log(`  Unique communities: ${communityIds.size}`);

  // Fetch hubs for these communities
  const { data: hubData } = await supabase
    .from("keywords")
    .select("keyword, community_id")
    .eq("node_type", "article")
    .eq("is_community_hub", true)
    .in("community_id", [...communityIds]);

  console.log(`\nHubs for these communities: ${hubData?.length}`);
  hubData?.slice(0, 5).forEach(h =>
    console.log(`  "${h.keyword}" (community ${h.community_id})`)
  );
}

main();
