/**
 * Compute multi-level keyword communities using Louvain algorithm.
 * Runs Louvain at 8 resolution levels for semantic zooming.
 * Level 0 = coarsest (fewest, largest communities)
 * Level 7 = finest (most, smallest communities)
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { createServerClient } from "../src/lib/supabase";

// Resolution values for each level (1.5x exponential growth in avg cluster size)
// Level 0 (coarsest) -> Level 7 (finest)
const RESOLUTIONS = [0.1, 0.5, 1.5, 6, 10, 15, 25, 30];

interface KeywordInfo {
  id: string;
  keyword: string;
  degree: number;
}

function selectHub(members: KeywordInfo[]): string {
  const sorted = [...members].sort((a, b) => {
    if (b.degree !== a.degree) return b.degree - a.degree;
    return a.keyword.length - b.keyword.length;
  });
  return sorted[0].id;
}

async function main() {
  const supabase = createServerClient();

  // Fetch all similarity edges
  console.log("Fetching similarity edges...");
  const allEdges: Array<{
    keyword_a_id: string;
    keyword_b_id: string;
    similarity: number;
  }> = [];

  let offset = 0;
  while (true) {
    const { data: batch, error } = await supabase
      .from("keyword_similarities")
      .select("keyword_a_id, keyword_b_id, similarity")
      .range(offset, offset + 999);

    if (error) {
      console.error("Error fetching edges:", error);
      process.exit(1);
    }
    if (!batch || batch.length === 0) break;
    allEdges.push(...batch);
    if (batch.length < 1000) break;
    offset += 1000;
  }

  if (allEdges.length === 0) {
    console.log("No similarity edges found. Run backfill script first.");
    return;
  }
  console.log(`Found ${allEdges.length} similarity edges`);

  // Fetch keywords for label lookup
  const { data: keywords, error: kwError } = await supabase
    .from("keywords")
    .select("id, keyword")
    .eq("node_type", "article");

  if (kwError) {
    console.error("Error fetching keywords:", kwError);
    process.exit(1);
  }

  const keywordMap = new Map(keywords?.map((k) => [k.id, k.keyword]) || []);
  console.log(`Found ${keywordMap.size} article-level keywords`);

  // Build graph
  const graph = new Graph({ type: "undirected" });
  for (const edge of allEdges) {
    if (!graph.hasNode(edge.keyword_a_id)) graph.addNode(edge.keyword_a_id);
    if (!graph.hasNode(edge.keyword_b_id)) graph.addNode(edge.keyword_b_id);
    graph.addEdge(edge.keyword_a_id, edge.keyword_b_id, {
      weight: edge.similarity,
    });
  }
  console.log(`Graph: ${graph.order} nodes, ${graph.size} edges\n`);

  // Clear existing community data
  console.log("Clearing existing community data...");
  const { error: deleteError } = await supabase
    .from("keyword_communities")
    .delete()
    .neq("keyword_id", "00000000-0000-0000-0000-000000000000"); // Delete all rows

  if (deleteError) {
    console.error("Error clearing communities:", deleteError);
    process.exit(1);
  }

  // Compute communities at each level
  const allInserts: Array<{
    keyword_id: string;
    level: number;
    community_id: number;
    is_hub: boolean;
  }> = [];

  console.log("Level | Resolution | Communities | Avg Size");
  console.log("------|------------|-------------|----------");

  for (let level = 0; level < RESOLUTIONS.length; level++) {
    const resolution = RESOLUTIONS[level];
    const result = louvain.detailed(graph, {
      resolution,
      getEdgeWeight: "weight",
    });

    const avgSize = (graph.order / result.count).toFixed(1);
    console.log(
      `${level.toString().padStart(5)} | ${resolution.toString().padStart(10)} | ${result.count.toString().padStart(11)} | ${avgSize.padStart(8)}`
    );

    // Group by community to find hubs
    const communities = new Map<number, KeywordInfo[]>();
    for (const [nodeId, communityId] of Object.entries(result.communities)) {
      if (!communities.has(communityId)) {
        communities.set(communityId, []);
      }
      communities.get(communityId)!.push({
        id: nodeId,
        keyword: keywordMap.get(nodeId) || nodeId,
        degree: graph.degree(nodeId),
      });
    }

    // Create inserts for this level
    for (const [communityId, members] of communities) {
      const hubId = selectHub(members);
      for (const member of members) {
        allInserts.push({
          keyword_id: member.id,
          level,
          community_id: communityId,
          is_hub: member.id === hubId,
        });
      }
    }
  }

  // Insert all community assignments
  console.log(`\nInserting ${allInserts.length} community assignments...`);
  const BATCH_SIZE = 500;

  for (let i = 0; i < allInserts.length; i += BATCH_SIZE) {
    const batch = allInserts.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await supabase
      .from("keyword_communities")
      .insert(batch);

    if (insertError) {
      console.error("Error inserting batch:", insertError);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + BATCH_SIZE, allInserts.length)}/${allInserts.length}`);
  }

  // Summary
  const hubsPerLevel = RESOLUTIONS.map((_, level) =>
    allInserts.filter((i) => i.level === level && i.is_hub).length
  );
  console.log(`\nDone! Hubs per level: ${hubsPerLevel.join(", ")}`);
}

main();
