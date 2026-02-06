import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { errorResponse } from "@/lib/api-error";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const resolution = parseFloat(body.resolution ?? "1.0");
  const nodeIds: string[] | null = body.nodeIds ?? null;
  const nodeType: string = body.nodeType ?? "article";

  try {
    const supabase = createServerClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("get_precomputed_clusters", {
      target_resolution: resolution,
      filter_node_type: nodeType,
      node_ids: nodeIds,
    });

    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json({
        nodeToCluster: [],
        clusters: [],
      });
    }

    // Convert to Map format expected by client
    const nodeToCluster = new Map<string, number>();
    const clusters = new Map<number, {
      id: number;
      members: string[];
      hub: string;
      label: string;
    }>();

    for (const row of data) {
      nodeToCluster.set(row.node_id, row.cluster_id);

      if (!clusters.has(row.cluster_id)) {
        clusters.set(row.cluster_id, {
          id: row.cluster_id,
          members: [],
          hub: row.hub_node_id,
          label: row.cluster_label,
        });
      }

      clusters.get(row.cluster_id)!.members.push(row.node_id);
    }

    return NextResponse.json({
      nodeToCluster: Array.from(nodeToCluster.entries()),
      clusters: Array.from(clusters.entries()).map(([id, data]) => [id, data]),
    });
  } catch (error) {
    console.error("[precomputed-clusters] Error:", error);
    return errorResponse(error);
  }
}
