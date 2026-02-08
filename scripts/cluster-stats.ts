import { createServerClient } from "../src/lib/supabase";

async function main() {
  const sb = createServerClient();

  // Get total count
  const { count } = await sb
    .from("precomputed_topic_clusters")
    .select("*", { count: "exact", head: true });
  console.log(`Total rows: ${count}`);

  // Get distinct resolutions via SQL to avoid pagination
  const { data: resData, error: resError } = await sb.rpc(
    "get_precomputed_clusters",
    { target_resolution: 0.1, filter_node_type: "article", node_ids: null }
  ) as any;
  console.log(`\nRows at resolution nearest 0.1 for article: ${resData?.length ?? 0}`);

  // Query each candidate resolution to see what's actually there
  const resolutions = [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0];
  for (const nodeType of ["article", "chunk"]) {
    console.log(`\n--- ${nodeType} ---`);
    for (const res of resolutions) {
      const { data, count: c } = await sb
        .from("precomputed_topic_clusters")
        .select("*", { count: "exact", head: true })
        .eq("resolution", res)
        .eq("node_type", nodeType);
      if (c && c > 0) {
        console.log(`  resolution=${res}: ${c} rows`);
      }
    }
  }
}

main();
