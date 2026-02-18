import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createServerClient } from "@/lib/supabase";
import { clusterUmapGraph } from "@/lib/chunks-clustering";
import { generateChunkClusterLabels } from "@/lib/llm";

const CACHE_PATH = path.join(process.cwd(), "data", "chunks-layout.json");
const EXCERPT_LENGTH = 200;
const MAX_EXCERPTS_PER_CLUSTER = 15;
const DEFAULT_COARSE_RESOLUTION = 0.3;
const DEFAULT_FINE_RESOLUTION = 1.5;

interface CachedLayout {
  positions: number[];
  edges: Array<{ source: number; target: number; weight: number }>;
  chunkIds: string[];
  coarseResolution: number;
  fineResolution: number;
  coarseClusters: Record<number, number>;
  fineClusters: Record<number, number>;
  coarseLabels: Record<number, string>;
  fineLabels: Record<number, string>;
  createdAt: string;
}

async function readCache(): Promise<CachedLayout | null> {
  try {
    const data = await fs.readFile(CACHE_PATH, "utf-8");
    return JSON.parse(data) as CachedLayout;
  } catch {
    return null;
  }
}

async function writeCache(cache: CachedLayout): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache));
}

/** Fetch chunk content excerpts from Supabase, keyed by chunk ID */
async function fetchChunkExcerpts(
  chunkIds: string[]
): Promise<Map<string, string>> {
  const supabase = createServerClient();
  const excerpts = new Map<string, string>();

  // Paginate to handle >1000 chunks
  const PAGE_SIZE = 500;
  for (let i = 0; i < chunkIds.length; i += PAGE_SIZE) {
    const batch = chunkIds.slice(i, i + PAGE_SIZE);
    const { data, error } = await supabase
      .from("nodes")
      .select("id, content")
      .in("id", batch);

    if (error) {
      console.error("[chunks/layout] Failed to fetch content:", error);
      continue;
    }
    for (const row of data ?? []) {
      if (row.content) {
        excerpts.set(row.id, row.content.slice(0, EXCERPT_LENGTH));
      }
    }
  }
  return excerpts;
}

/** Run Leiden + Haiku labeling pipeline for both resolutions */
async function clusterAndLabel(
  edges: Array<{ source: number; target: number; weight: number }>,
  nodeCount: number,
  chunkIds: string[],
  coarseResolution: number,
  fineResolution: number
) {
  // Cluster at both resolutions
  const coarseMap = clusterUmapGraph(edges, nodeCount, coarseResolution);
  const fineMap = clusterUmapGraph(edges, nodeCount, fineResolution);

  // Fetch chunk content for excerpts
  const excerpts = await fetchChunkExcerpts(chunkIds);

  // Build cluster->excerpts arrays for both resolutions
  function buildClusterExcerpts(nodeToCluster: Map<number, number>) {
    const clusterExcerpts = new Map<number, string[]>();
    for (const [nodeIdx, clusterId] of nodeToCluster) {
      const chunkId = chunkIds[nodeIdx];
      const excerpt = excerpts.get(chunkId);
      if (!excerpt) continue;
      if (!clusterExcerpts.has(clusterId)) clusterExcerpts.set(clusterId, []);
      const arr = clusterExcerpts.get(clusterId)!;
      if (arr.length < MAX_EXCERPTS_PER_CLUSTER) arr.push(excerpt);
    }
    return Array.from(clusterExcerpts, ([id, exc]) => ({ id, excerpts: exc }));
  }

  const coarseClustersForLabeling = buildClusterExcerpts(coarseMap);
  const fineClustersForLabeling = buildClusterExcerpts(fineMap);

  // Generate labels via Haiku (parallel for both resolutions)
  const [coarseLabels, fineLabels] = await Promise.all([
    generateChunkClusterLabels(coarseClustersForLabeling),
    generateChunkClusterLabels(fineClustersForLabeling),
  ]);

  // Convert Maps to Records for JSON serialization
  const coarseClusters: Record<number, number> = {};
  for (const [k, v] of coarseMap) coarseClusters[k] = v;
  const fineClusters: Record<number, number> = {};
  for (const [k, v] of fineMap) fineClusters[k] = v;

  return { coarseClusters, fineClusters, coarseLabels, fineLabels };
}

export async function GET() {
  const cache = await readCache();
  if (!cache) {
    return NextResponse.json({ error: "No cached layout" }, { status: 404 });
  }
  return NextResponse.json(cache);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      positions,
      edges,
      chunkIds,
      coarseResolution = DEFAULT_COARSE_RESOLUTION,
      fineResolution = DEFAULT_FINE_RESOLUTION,
    } = body;

    if (!positions || !edges || !chunkIds) {
      return NextResponse.json(
        { error: "Missing required fields: positions, edges, chunkIds" },
        { status: 400 }
      );
    }

    const nodeCount = chunkIds.length;
    console.log(
      `[chunks/layout] Clustering ${nodeCount} nodes with ${edges.length} edges ` +
      `(coarse=${coarseResolution}, fine=${fineResolution})`
    );

    const { coarseClusters, fineClusters, coarseLabels, fineLabels } =
      await clusterAndLabel(edges, nodeCount, chunkIds, coarseResolution, fineResolution);

    const cache: CachedLayout = {
      positions,
      edges,
      chunkIds,
      coarseResolution,
      fineResolution,
      coarseClusters,
      fineClusters,
      coarseLabels,
      fineLabels,
      createdAt: new Date().toISOString(),
    };

    await writeCache(cache);

    console.log(
      `[chunks/layout] Cached: ${Object.keys(coarseLabels).length} coarse clusters, ` +
      `${Object.keys(fineLabels).length} fine clusters`
    );

    return NextResponse.json({
      coarseClusters,
      fineClusters,
      coarseLabels,
      fineLabels,
    });
  } catch (error) {
    console.error("[chunks/layout] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
