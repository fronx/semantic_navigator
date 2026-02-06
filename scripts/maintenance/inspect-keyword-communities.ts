/**
 * Inspect the current state of precomputed clusters for both views.
 * Shows statistics for both keyword_communities (MapView) and precomputed_topic_clusters (TopicsView).
 */
import { createServerClient } from "../src/lib/supabase";

async function main() {
  const supabase = createServerClient();

  console.log("=".repeat(80));
  console.log("KEYWORD COMMUNITIES (used by MapView)");
  console.log("=".repeat(80));

  // Check keyword_communities table (used by MapView)
  const { data: mapCommunities, error: mapError } = await supabase
    .from("keyword_communities")
    .select("keyword_id, level, community_id, is_hub");

  if (mapError) {
    console.error("Error fetching keyword_communities:", mapError);
  } else if (!mapCommunities || mapCommunities.length === 0) {
    console.log("⚠️  No data in keyword_communities table.");
    console.log("   Run: npm run script scripts/compute-keyword-communities.ts\n");
  } else {
    // Group by level
    const byLevel = new Map<number, typeof mapCommunities>();
    for (const c of mapCommunities) {
      if (!byLevel.has(c.level)) byLevel.set(c.level, []);
      byLevel.get(c.level)!.push(c);
    }

    console.log("\nLevel | Communities | Keywords | Avg Size | Hubs");
    console.log("------|-------------|----------|----------|-----");

    for (const [level, items] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
      const communityIds = new Set(items.map((i) => i.community_id));
      const hubs = items.filter((i) => i.is_hub);
      const avgSize = (items.length / communityIds.size).toFixed(1);

      console.log(
        `${level.toString().padStart(5)} | ${communityIds.size.toString().padStart(11)} | ${items.length.toString().padStart(8)} | ${avgSize.padStart(8)} | ${hubs.length.toString().padStart(4)}`
      );
    }
    console.log(`\n✓ Total: ${mapCommunities.length} assignments across ${byLevel.size} levels\n`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("PRECOMPUTED TOPIC CLUSTERS (used by TopicsView)");
  console.log("=".repeat(80));

  // Check precomputed_topic_clusters table (used by TopicsView)
  // Cast to any since this table isn't in generated types yet
  const { data: topicClusters, error: topicError } = await (supabase as any)
    .from("precomputed_topic_clusters")
    .select("resolution, node_id, hub_node_id, cluster_label, member_count") as {
      data: Array<{
        resolution: number;
        node_id: string;
        hub_node_id: string;
        cluster_label: string;
        member_count: number;
      }> | null;
      error: unknown;
    };

  if (topicError) {
    console.error("Error fetching precomputed_topic_clusters:", topicError);
    process.exit(1);
  }

  if (!topicClusters || topicClusters.length === 0) {
    console.log("⚠️  No data in precomputed_topic_clusters table.");
    console.log("   Run: npm run script scripts/precompute-topic-clusters.ts\n");
    return;
  }

  // Group by resolution
  const byResolution = new Map<number, typeof topicClusters>();
  for (const c of topicClusters) {
    if (!byResolution.has(c.resolution)) {
      byResolution.set(c.resolution, []);
    }
    byResolution.get(c.resolution)!.push(c);
  }

  console.log("\nResolution | Clusters | Nodes | Avg Size | Example Labels");
  console.log("-----------|----------|-------|----------|---------------");

  for (const [resolution, items] of [...byResolution.entries()].sort((a, b) => a[0] - b[0])) {
    // Count unique cluster labels to get cluster count
    const clusterLabels = new Set(items.map((i) => i.cluster_label));
    const avgSize = (items.length / clusterLabels.size).toFixed(1);
    const exampleLabels = [...clusterLabels].slice(0, 3).join(", ");

    console.log(
      `${resolution.toFixed(1).padStart(10)} | ${clusterLabels.size.toString().padStart(8)} | ${items.length.toString().padStart(5)} | ${avgSize.padStart(8)} | ${exampleLabels}`
    );
  }

  console.log(`\n✓ Total: ${topicClusters.length} nodes across ${byResolution.size} resolutions\n`);
}

main();
