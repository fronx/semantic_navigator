import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createServerClient } from "@/lib/supabase";
import { clusterUmapGraph } from "@/lib/chunks-clustering";
import { generateChunkClusterLabels } from "@/lib/llm";

const CACHE_PATH = path.join(process.cwd(), "data", "chunks-layout.json");
const EXCERPT_LENGTH = 200;
const MAX_EXCERPTS_PER_CLUSTER = 15;

export async function POST(request: Request) {
  try {
    const { coarseResolution, fineResolution } = await request.json();

    if (coarseResolution == null || fineResolution == null) {
      return NextResponse.json(
        { error: "Missing coarseResolution or fineResolution" },
        { status: 400 }
      );
    }

    // Read existing cache
    let cache;
    try {
      const data = await fs.readFile(CACHE_PATH, "utf-8");
      cache = JSON.parse(data);
    } catch {
      return NextResponse.json(
        { error: "No cached layout to recluster. Run UMAP first." },
        { status: 404 }
      );
    }

    const { edges, chunkIds } = cache;
    const nodeCount = chunkIds.length;

    console.log(
      `[chunks/layout/recluster] Re-clustering ${nodeCount} nodes ` +
      `(coarse=${coarseResolution}, fine=${fineResolution})`
    );

    // Re-cluster
    const coarseMap = clusterUmapGraph(edges, nodeCount, coarseResolution);
    const fineMap = clusterUmapGraph(edges, nodeCount, fineResolution);

    // Fetch excerpts for labeling
    const supabase = createServerClient();
    const excerpts = new Map<string, string>();
    const PAGE_SIZE = 500;
    for (let i = 0; i < chunkIds.length; i += PAGE_SIZE) {
      const batch = chunkIds.slice(i, i + PAGE_SIZE);
      const { data } = await supabase
        .from("nodes")
        .select("id, content")
        .in("id", batch);
      for (const row of data ?? []) {
        if (row.content) excerpts.set(row.id, row.content.slice(0, EXCERPT_LENGTH));
      }
    }

    // Build excerpts per cluster
    function buildExcerpts(nodeToCluster: Map<number, number>) {
      const map = new Map<number, string[]>();
      for (const [idx, cid] of nodeToCluster) {
        const excerpt = excerpts.get(chunkIds[idx]);
        if (!excerpt) continue;
        if (!map.has(cid)) map.set(cid, []);
        const arr = map.get(cid)!;
        if (arr.length < MAX_EXCERPTS_PER_CLUSTER) arr.push(excerpt);
      }
      return Array.from(map, ([id, exc]) => ({ id, excerpts: exc }));
    }

    const [coarseLabels, fineLabels] = await Promise.all([
      generateChunkClusterLabels(buildExcerpts(coarseMap)),
      generateChunkClusterLabels(buildExcerpts(fineMap)),
    ]);

    // Serialize and update cache
    const coarseClusters: Record<number, number> = {};
    for (const [k, v] of coarseMap) coarseClusters[k] = v;
    const fineClusters: Record<number, number> = {};
    for (const [k, v] of fineMap) fineClusters[k] = v;

    cache.coarseResolution = coarseResolution;
    cache.fineResolution = fineResolution;
    cache.coarseClusters = coarseClusters;
    cache.fineClusters = fineClusters;
    cache.coarseLabels = coarseLabels;
    cache.fineLabels = fineLabels;

    await fs.writeFile(CACHE_PATH, JSON.stringify(cache));

    return NextResponse.json({ coarseClusters, fineClusters, coarseLabels, fineLabels });
  } catch (error) {
    console.error("[chunks/layout/recluster] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
