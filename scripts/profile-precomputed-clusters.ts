/**
 * Profile precomputed cluster loading performance.
 *
 * Usage:
 *   npm run script scripts/profile-precomputed-clusters.ts [resolution] [nodeType]
 *
 * Measures:
 *   1. RPC with node_ids filter (current behavior)
 *   2. RPC without node_ids filter
 *   3. Direct table query (bypassing RPC)
 *   4. Response processing time
 */

import { createServerClient } from "../src/lib/supabase";

const resolution = parseFloat(process.argv[2] ?? "1.0");
const nodeType = process.argv[3] ?? "article";

async function time<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  console.log(`  ${label}: ${ms.toFixed(1)}ms`);
  return { result, ms };
}

async function main() {
  const supabase = createServerClient();

  // --- Table stats ---
  console.log("=== Table Stats ===");

  // Count per resolution+nodeType
  const resolutions = [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0];
  for (const res of resolutions) {
    const { count } = await supabase
      .from("precomputed_topic_clusters")
      .select("*", { count: "exact", head: true })
      .eq("resolution", res)
      .eq("node_type", nodeType);
    if (count && count > 0) {
      console.log(`  resolution=${res}, nodeType=${nodeType}: ${count} rows`);
    }
  }

  // Get all node IDs for this resolution (simulating what client sends)
  const { data: baseline } = await (supabase.rpc as any)("get_precomputed_clusters", {
    target_resolution: resolution,
    filter_node_type: nodeType,
    node_ids: null,
  });
  const allNodeIds = (baseline ?? []).map((r: { node_id: string }) => r.node_id);
  console.log(`\n  Rows returned for resolution=${resolution}: ${allNodeIds.length}`);

  // --- Benchmark: RPC with node_ids (current client behavior) ---
  console.log(`\n=== RPC with node_ids (${allNodeIds.length} IDs) — current behavior ===`);
  const rpcWithIds: number[] = [];
  for (let i = 0; i < 5; i++) {
    const { ms } = await time(`Run ${i + 1}`, async () => {
      const { data, error } = await (supabase.rpc as any)("get_precomputed_clusters", {
        target_resolution: resolution,
        filter_node_type: nodeType,
        node_ids: allNodeIds,
      });
      if (error) throw error;
      return data;
    });
    rpcWithIds.push(ms);
  }

  // --- Benchmark: RPC without node_ids ---
  console.log("\n=== RPC without node_ids — proposed optimization ===");
  const rpcWithout: number[] = [];
  for (let i = 0; i < 5; i++) {
    const { ms } = await time(`Run ${i + 1}`, async () => {
      const { data, error } = await (supabase.rpc as any)("get_precomputed_clusters", {
        target_resolution: resolution,
        filter_node_type: nodeType,
        node_ids: null,
      });
      if (error) throw error;
      return data;
    });
    rpcWithout.push(ms);
  }

  // --- Benchmark: Direct table query (no RPC) ---
  console.log("\n=== Direct table query (no RPC, exact resolution) ===");
  const direct: number[] = [];
  for (let i = 0; i < 5; i++) {
    const { ms } = await time(`Run ${i + 1}`, async () => {
      const { data, error } = await supabase
        .from("precomputed_topic_clusters")
        .select("node_id, cluster_id, hub_node_id, cluster_label, member_count")
        .eq("resolution", resolution)
        .eq("node_type", nodeType);
      if (error) throw error;
      return data;
    });
    direct.push(ms);
  }

  // --- Response processing ---
  console.log("\n=== Response processing (Map building + JSON serialization) ===");
  const rawData = baseline ?? [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();

    const nodeToCluster = new Map<string, number>();
    const clusters = new Map<number, { id: number; members: string[]; hub: string; label: string }>();

    for (const row of rawData) {
      nodeToCluster.set(row.node_id, row.cluster_id);
      if (!clusters.has(row.cluster_id)) {
        clusters.set(row.cluster_id, {
          id: row.cluster_id, members: [], hub: row.hub_node_id, label: row.cluster_label,
        });
      }
      clusters.get(row.cluster_id)!.members.push(row.node_id);
    }

    const json = JSON.stringify({
      nodeToCluster: Array.from(nodeToCluster.entries()),
      clusters: Array.from(clusters.entries()).map(([id, data]) => [id, data]),
    });

    const elapsed = performance.now() - start;
    console.log(`  Run ${i + 1}: ${elapsed.toFixed(1)}ms (JSON: ${(json.length / 1024).toFixed(1)}KB)`);
  }

  // --- Summary ---
  const median = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  console.log("\n=== Summary (median of 5 runs) ===");
  console.log(`  RPC with node_ids:    ${median(rpcWithIds).toFixed(0)}ms`);
  console.log(`  RPC without node_ids: ${median(rpcWithout).toFixed(0)}ms`);
  console.log(`  Direct table query:   ${median(direct).toFixed(0)}ms`);
  console.log(`\n  Saving from dropping node_ids: ~${(median(rpcWithIds) - median(rpcWithout)).toFixed(0)}ms`);
  console.log(`  Saving from direct query:      ~${(median(rpcWithIds) - median(direct)).toFixed(0)}ms`);
}

main().catch(console.error);
