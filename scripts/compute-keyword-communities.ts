/**
 * Compute keyword communities using Louvain algorithm.
 * Reads similarity edges from keyword_similarities table,
 * runs Louvain community detection, and updates keywords table
 * with community_id and is_community_hub.
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { createServerClient } from "../src/lib/supabase";

const RESOLUTION = 1.0; // Louvain resolution parameter (higher = smaller communities)

interface KeywordInfo {
  id: string;
  keyword: string;
  degree: number;
}

/**
 * Select hub for a community: highest degree, tie-break by shortest label.
 */
function selectHub(members: KeywordInfo[]): string {
  const sorted = [...members].sort((a, b) => {
    // Primary: higher degree first
    if (b.degree !== a.degree) return b.degree - a.degree;
    // Tie-breaker: shorter label first
    return a.keyword.length - b.keyword.length;
  });
  return sorted[0].id;
}

async function main() {
  const supabase = createServerClient();

  // Fetch all similarity edges (with pagination to avoid 1000 row limit)
  console.log("Fetching similarity edges...");
  const FETCH_BATCH = 1000;
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
      .range(offset, offset + FETCH_BATCH - 1);

    if (error) {
      console.error("Error fetching edges:", error);
      process.exit(1);
    }

    if (!batch || batch.length === 0) break;

    allEdges.push(...batch);
    console.log(`  Fetched ${allEdges.length} edges...`);

    if (batch.length < FETCH_BATCH) break;
    offset += FETCH_BATCH;
  }

  if (allEdges.length === 0) {
    console.log("No similarity edges found. Run backfill script first.");
    return;
  }

  const edges = allEdges;
  console.log(`Found ${edges.length} similarity edges`);

  // Fetch all article-level keywords (for label lookup)
  console.log("Fetching keywords...");
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

  // Build undirected weighted graph
  console.log("Building graph...");
  const graph = new Graph({ type: "undirected" });

  for (const edge of edges) {
    // Add nodes if not present
    if (!graph.hasNode(edge.keyword_a_id)) {
      graph.addNode(edge.keyword_a_id);
    }
    if (!graph.hasNode(edge.keyword_b_id)) {
      graph.addNode(edge.keyword_b_id);
    }
    // Add weighted edge
    graph.addEdge(edge.keyword_a_id, edge.keyword_b_id, {
      weight: edge.similarity,
    });
  }

  console.log(`Graph has ${graph.order} nodes, ${graph.size} edges`);

  // Run Louvain community detection
  console.log(`Running Louvain (resolution=${RESOLUTION})...`);
  const result = louvain.detailed(graph, {
    resolution: RESOLUTION,
    getEdgeWeight: "weight",
  });

  console.log(`Found ${result.count} communities (modularity=${result.modularity.toFixed(4)})`);

  // Group keywords by community
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

  // Sort communities by size (largest first) for display
  const sortedCommunities = [...communities.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );

  // Show top communities
  console.log("\nTop 10 communities:");
  for (const [communityId, members] of sortedCommunities.slice(0, 10)) {
    const hubId = selectHub(members);
    const hubKeyword = keywordMap.get(hubId) || hubId;
    const memberLabels = members
      .filter((m) => m.id !== hubId)
      .map((m) => m.keyword)
      .slice(0, 5);
    console.log(
      `  [${communityId}] "${hubKeyword}" (${members.length} members): ${memberLabels.join(", ")}${members.length > 6 ? "..." : ""}`
    );
  }

  // Prepare updates
  const updates: Array<{
    id: string;
    community_id: number;
    is_community_hub: boolean;
  }> = [];

  for (const [communityId, members] of communities) {
    const hubId = selectHub(members);
    for (const member of members) {
      updates.push({
        id: member.id,
        community_id: communityId,
        is_community_hub: member.id === hubId,
      });
    }
  }

  // Keywords not in any community (isolated nodes) - clear their community
  const nodesInGraph = new Set(graph.nodes());
  const isolatedKeywords = [...keywordMap.keys()].filter(
    (id) => !nodesInGraph.has(id)
  );
  console.log(`\n${isolatedKeywords.length} keywords have no similar neighbors (isolated)`);

  // Update database in batches
  console.log(`\nUpdating ${updates.length} keywords...`);
  const BATCH_SIZE = 100;

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);

    for (const update of batch) {
      const { error: updateError } = await supabase
        .from("keywords")
        .update({
          community_id: update.community_id,
          is_community_hub: update.is_community_hub,
        })
        .eq("id", update.id);

      if (updateError) {
        console.error(`Error updating keyword ${update.id}:`, updateError);
      }
    }

    console.log(`  Updated ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`);
  }

  // Clear community for isolated keywords
  if (isolatedKeywords.length > 0) {
    console.log(`Clearing community for ${isolatedKeywords.length} isolated keywords...`);
    for (let i = 0; i < isolatedKeywords.length; i += BATCH_SIZE) {
      const batch = isolatedKeywords.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("keywords")
        .update({ community_id: null, is_community_hub: false })
        .in("id", batch);

      if (error) {
        console.error("Error clearing isolated keywords:", error);
      }
    }
  }

  // Summary
  const hubCount = updates.filter((u) => u.is_community_hub).length;
  console.log(`\nDone! ${hubCount} hubs across ${result.count} communities.`);
}

main();
