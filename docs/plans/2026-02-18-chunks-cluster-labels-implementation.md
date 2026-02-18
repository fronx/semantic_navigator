# ChunksView Cluster Labels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two-level cluster labels to ChunksView with server-cached UMAP positions and Haiku-generated labels.

**Architecture:** Client computes UMAP, POSTs positions + neighborhood graph to server. Server runs Leiden clustering at two resolutions and labels via Haiku, caches everything as JSON. Subsequent loads fetch cached positions + labels instantly. Rendering reuses TopicsView's ClusterLabels3D with configurable fade ranges.

**Tech Stack:** graphology + graphology-communities-louvain (Leiden), Anthropic Haiku (labels), React Three Fiber (rendering), Next.js API routes (caching)

**Design doc:** [2026-02-18-chunks-cluster-labels-design.md](2026-02-18-chunks-cluster-labels-design.md)

---

### Task 1: Server-side Leiden clustering utility

Create a function to cluster an index-based weighted graph (UMAP neighborhood edges) using Leiden. The existing `computeLeidenClustering` in `src/lib/leiden-clustering.ts` expects `KeywordNode[]` and `SimilarityEdge[]`. We need a simpler variant for numeric-index graphs.

**Files:**
- Create: `src/lib/chunks-clustering.ts`
- Test: `src/lib/__tests__/chunks-clustering.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { clusterUmapGraph } from "@/lib/chunks-clustering";

describe("clusterUmapGraph", () => {
  it("assigns all nodes to clusters", () => {
    // Two cliques connected by one weak edge
    const edges = [
      { source: 0, target: 1, weight: 1.0 },
      { source: 1, target: 2, weight: 1.0 },
      { source: 0, target: 2, weight: 1.0 },
      { source: 3, target: 4, weight: 1.0 },
      { source: 4, target: 5, weight: 1.0 },
      { source: 3, target: 5, weight: 1.0 },
      { source: 2, target: 3, weight: 0.1 }, // weak bridge
    ];
    const nodeCount = 6;
    const result = clusterUmapGraph(edges, nodeCount, 1.0);

    // Every node gets a cluster
    expect(result.size).toBe(nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      expect(result.has(i)).toBe(true);
    }
  });

  it("separates loosely-connected cliques at high resolution", () => {
    const edges = [
      { source: 0, target: 1, weight: 1.0 },
      { source: 1, target: 2, weight: 1.0 },
      { source: 0, target: 2, weight: 1.0 },
      { source: 3, target: 4, weight: 1.0 },
      { source: 4, target: 5, weight: 1.0 },
      { source: 3, target: 5, weight: 1.0 },
      { source: 2, target: 3, weight: 0.05 },
    ];
    const result = clusterUmapGraph(edges, 6, 2.0);

    // Nodes 0-2 should be in same cluster, 3-5 in another
    expect(result.get(0)).toBe(result.get(1));
    expect(result.get(1)).toBe(result.get(2));
    expect(result.get(3)).toBe(result.get(4));
    expect(result.get(4)).toBe(result.get(5));
    expect(result.get(0)).not.toBe(result.get(3));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/__tests__/chunks-clustering.test.ts --run`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/lib/chunks-clustering.ts
import Graph from "graphology";
import leiden from "graphology-communities-louvain";

interface WeightedEdge {
  source: number;
  target: number;
  weight: number;
}

/**
 * Run Leiden clustering on a UMAP neighborhood graph.
 * Nodes are integer indices (0..nodeCount-1), edges carry weights.
 *
 * @returns Map from node index to cluster ID
 */
export function clusterUmapGraph(
  edges: WeightedEdge[],
  nodeCount: number,
  resolution: number
): Map<number, number> {
  const graph = new Graph({ type: "undirected" });

  for (let i = 0; i < nodeCount; i++) {
    graph.addNode(String(i));
  }

  for (const edge of edges) {
    const src = String(edge.source);
    const tgt = String(edge.target);
    if (src === tgt) continue;
    if (graph.hasEdge(src, tgt)) continue;
    graph.addEdge(src, tgt, { weight: edge.weight });
  }

  const result = leiden.detailed(graph, {
    resolution,
    getEdgeWeight: "weight",
  });

  const nodeToCluster = new Map<number, number>();
  for (const [nodeStr, clusterId] of Object.entries(result.communities)) {
    nodeToCluster.set(parseInt(nodeStr, 10), clusterId);
  }
  return nodeToCluster;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/__tests__/chunks-clustering.test.ts --run`
Expected: PASS

**Step 5: Type check**

Run: `npx tsc --noEmit`

**Step 6: Commit**

```
git add src/lib/chunks-clustering.ts src/lib/__tests__/chunks-clustering.test.ts
git commit -m "feat: add Leiden clustering for UMAP neighborhood graphs"
```

---

### Task 2: Chunk content label generation

Create a function that generates labels for chunk clusters by sending content excerpts to Haiku. Adapts the pattern from `generateClusterLabels` in `src/lib/llm.ts` (which uses keyword lists) to use chunk content excerpts instead.

**Files:**
- Modify: `src/lib/llm.ts` — add `generateChunkClusterLabels`

**Step 1: Write the function**

Add to `src/lib/llm.ts`:

```typescript
/**
 * Generate labels for chunk clusters using content excerpts.
 * Each cluster sends first ~200 chars of up to 15 member chunks to Haiku.
 */
export async function generateChunkClusterLabels(
  clusters: Array<{ id: number; excerpts: string[] }>
): Promise<Record<number, string>> {
  if (clusters.length === 0) return {};

  if (!isLLMAvailable()) {
    const result: Record<number, string> = {};
    for (const c of clusters) {
      result[c.id] = c.excerpts[0]?.slice(0, 30) ?? `cluster ${c.id}`;
    }
    return result;
  }

  const clusterDescriptions = clusters.map((c) => {
    const samples = c.excerpts.slice(0, 15).map((e) => `  - ${e}`).join("\n");
    return `Cluster ${c.id}:\n${samples}`;
  });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: `You are labeling clusters of text chunks for a knowledge base visualization.

Each cluster contains semantically related text passages. Generate a SHORT label (2-4 words) that captures the common theme.

${clusterDescriptions.join("\n\n")}

Return a JSON object mapping cluster IDs to labels, like:
{"0": "neural network training", "1": "web authentication", "2": "data modeling"}

Labels should be:
- Descriptive but concise (2-4 words)
- In lowercase
- Capture the common theme, not quote specific text

Return ONLY the JSON object.`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock?.text) return {};

  try {
    const jsonText = extractJsonFromResponse(textBlock.text);
    const parsed = JSON.parse(jsonText);
    const result: Record<number, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        result[parseInt(key, 10)] = value;
      }
    }
    return result;
  } catch (error) {
    console.error("[llm] Failed to parse chunk cluster labels:", textBlock.text);
    return {};
  }
}
```

**Step 2: Type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
git add src/lib/llm.ts
git commit -m "feat: add chunk content excerpt labeling for Haiku"
```

---

### Task 3: GET + POST /api/chunks/layout endpoints

Server endpoints for caching UMAP layout + computing cluster labels. The cache file lives at `data/chunks-layout.json`.

**Files:**
- Create: `src/app/api/chunks/layout/route.ts`

**Step 1: Implement the endpoints**

```typescript
// src/app/api/chunks/layout/route.ts
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
```

**Step 2: Type check**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```
git add src/app/api/chunks/layout/route.ts
git commit -m "feat: add GET/POST /api/chunks/layout for UMAP caching"
```

---

### Task 4: POST /api/chunks/layout/recluster endpoint

Re-clusters cached positions with new resolution values without re-running UMAP.

**Files:**
- Create: `src/app/api/chunks/layout/recluster/route.ts`

**Step 1: Implement the endpoint**

```typescript
// src/app/api/chunks/layout/recluster/route.ts
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
```

**Step 2: Type check, commit**

Run: `npx tsc --noEmit`

```
git add src/app/api/chunks/layout/recluster/route.ts
git commit -m "feat: add /api/chunks/layout/recluster endpoint"
```

---

### Task 5: Add `fadeInT` prop to ClusterLabels3D

Small backwards-compatible extension: add an optional `fadeInT` multiplier so fine-level labels can fade in and out independently.

**Files:**
- Modify: `src/components/topics-r3f/ClusterLabels3D.tsx`

**Step 1: Add the prop and use it in useFrame**

In `ClusterLabels3DProps` (line 33), add:

```typescript
/** Additional fade-in multiplier (0-1). Used for fine labels that fade in when coarse labels fade out. Default 1. */
fadeInT?: number;
```

In the component destructuring (line 73), add `fadeInT = 1`:

```typescript
export function ClusterLabels3D({
  ...existing props...,
  fadeInT = 1,
}: ClusterLabels3DProps) {
```

In the `useFrame` opacity calculation (line 134), multiply by `fadeInT`:

```typescript
// Before:
const finalOpacity = baseOpacity * sizeFade * (1 - labelFadeT);
// After:
const finalOpacity = baseOpacity * sizeFade * fadeInT * (1 - labelFadeT);
```

**Step 2: Type check**

Run: `npx tsc --noEmit`
Verify TopicsView still works (fadeInT defaults to 1, so behavior unchanged).

**Step 3: Commit**

```
git add src/components/topics-r3f/ClusterLabels3D.tsx
git commit -m "feat: add fadeInT prop to ClusterLabels3D for two-level fade"
```

---

### Task 6: ChunksView layout caching and state management

Wire ChunksView to fetch cached layout on mount, fall back to client-side UMAP if no cache, and POST results to server after UMAP completes. Add new settings to ChunksControlSidebar.

**Files:**
- Modify: `src/components/ChunksView.tsx`
- Modify: `src/components/ChunksControlSidebar.tsx` (add settings fields)

**Step 1: Extend ChunksSettings with new fields**

In `ChunksControlSidebar.tsx`, add to the `ChunksSettings` interface:

```typescript
coarseResolution: number;
fineResolution: number;
coarseFadeStart: number;  // far Z where coarse begins fading
coarseFadeEnd: number;    // mid Z where coarse fully faded
fineFadeStart: number;    // mid Z where fine begins fading
fineFadeEnd: number;      // near Z where fine fully faded
```

**Step 2: Add sidebar controls**

Add a new "Cluster Labels" section in ChunksControlSidebar with sliders for all six values plus a "Redo UMAP" button. The button triggers a callback passed via props.

Reference existing `Section` and `Slider` patterns. Ranges:
- Coarse resolution: 0.1–2.0, default 0.3, step 0.1
- Fine resolution: 0.5–4.0, default 1.5, step 0.1
- Fade Z values: 100–8000, step 100 (defaults: coarseFadeStart=6000, coarseFadeEnd=2000, fineFadeStart=2000, fineFadeEnd=400)

**Step 3: Wire ChunksView to fetch/POST layout**

In `ChunksView.tsx`:

1. Add state for cached layout data:
   ```typescript
   const [cachedLayout, setCachedLayout] = useState<CachedLayout | null>(null);
   const [isLoadingCache, setIsLoadingCache] = useState(true);
   ```

2. Fetch cache on mount:
   ```typescript
   useEffect(() => {
     fetch("/api/chunks/layout")
       .then((r) => r.ok ? r.json() : null)
       .then(setCachedLayout)
       .catch(() => null)
       .finally(() => setIsLoadingCache(false));
   }, []);
   ```

3. When cached: use cached positions directly, skip UMAP and embedding fetch.
   When not cached: run UMAP as before, POST after completion.

4. POST after UMAP completes (when `!isRunning` and positions exist and no cache):
   ```typescript
   useEffect(() => {
     if (isRunning || positions.length === 0 || cachedLayout) return;
     const chunkIds = chunks.map(c => c.id);
     fetch("/api/chunks/layout", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({
         positions: Array.from(positions),
         edges: neighborhoodEdges.map(e => ({
           source: e.source, target: e.target, weight: e.weight,
         })),
         chunkIds,
         coarseResolution: store.debounced.coarseResolution,
         fineResolution: store.debounced.fineResolution,
       }),
     })
       .then(r => r.json())
       .then(data => setCachedLayout(prev => ({
         ...prev, ...data,
         positions: Array.from(positions),
         edges: neighborhoodEdges,
         chunkIds,
       })))
       .catch(console.error);
   }, [isRunning]);
   ```

5. "Redo UMAP" handler: clear cached layout, re-run UMAP.

6. Recluster handler: when resolution sliders change, POST to `/api/chunks/layout/recluster`.

**Step 4: Pass cluster data through to ChunksCanvas/ChunksScene**

Add new props to `ChunksCanvas` and `ChunksScene`:
- `coarseClusters: Record<number, number> | null`
- `fineClusters: Record<number, number> | null`
- `coarseLabels: Record<number, string> | null`
- `fineLabels: Record<number, string> | null`
- `coarseFadeStart`, `coarseFadeEnd`, `fineFadeStart`, `fineFadeEnd`

**Step 5: Type check**

Run: `npx tsc --noEmit`

**Step 6: Commit**

```
git add src/components/ChunksView.tsx src/components/ChunksControlSidebar.tsx
git commit -m "feat: wire ChunksView to cached layout with cluster data"
```

---

### Task 7: Render ClusterLabels3D in ChunksScene

Add two ClusterLabels3D instances (coarse + fine) to ChunksScene, with fade values computed from camera Z.

**Files:**
- Modify: `src/components/chunks-r3f/ChunksScene.tsx`

**Key challenge:** ClusterLabels3D expects `SimNode[]` with mutable `x`/`y` properties. ChunksView positions live in a Float32Array. Solution: create lightweight proxy objects with getters that read from the positions buffer, and set `hullLabel` on one node per cluster so `computeClusterLabels` picks up server labels.

**Step 1: Build SimNode-compatible objects for cluster labels**

```typescript
// Inside ChunksScene, after displayPositionsRef is set:
const chunkLabelNodes = useMemo(() => {
  if (!coarseClusters && !fineClusters) return [];
  return chunks.map((chunk, i) => {
    const node = {
      id: chunk.id,
      type: "chunk" as const,
      label: "",
      hullLabel: undefined as string | undefined,
    };
    // Positions read dynamically via defineProperty
    Object.defineProperty(node, "x", {
      get: () => displayPositionsRef.current[i * 2] ?? 0,
      enumerable: true,
    });
    Object.defineProperty(node, "y", {
      get: () => displayPositionsRef.current[i * 2 + 1] ?? 0,
      enumerable: true,
    });
    return node as unknown as SimNode;
  });
}, [chunks, coarseClusters, fineClusters]);
```

**Step 2: Build nodeToCluster maps and assign hullLabels**

```typescript
const { coarseNodeToCluster, fineNodeToCluster } = useMemo(() => {
  const coarseMap = new Map<string, number>();
  const fineMap = new Map<string, number>();
  const coarseLabelAssigned = new Set<number>();
  const fineLabelAssigned = new Set<number>();

  for (let i = 0; i < chunks.length; i++) {
    const id = chunks[i].id;
    const node = chunkLabelNodes[i];
    if (node) node.hullLabel = undefined; // reset

    if (coarseClusters) {
      const cid = coarseClusters[i];
      if (cid !== undefined) {
        coarseMap.set(id, cid);
        if (!coarseLabelAssigned.has(cid) && coarseLabels?.[cid]) {
          node.hullLabel = coarseLabels[cid];
          coarseLabelAssigned.add(cid);
        }
      }
    }
    if (fineClusters) {
      const cid = fineClusters[i];
      if (cid !== undefined) {
        fineMap.set(id, cid);
        if (!fineLabelAssigned.has(cid) && fineLabels?.[cid]) {
          // Fine labels assigned separately — create separate nodes
          // or use a different approach (see below)
        }
      }
    }
  }
  return { coarseNodeToCluster: coarseMap, fineNodeToCluster: fineMap };
}, [chunks, chunkLabelNodes, coarseClusters, fineClusters, coarseLabels, fineLabels]);
```

Note: Since a single node can only carry one `hullLabel`, and coarse/fine clusters share the same nodes, we need **separate node arrays** for coarse and fine — or we assign `hullLabel` per-pass. The simplest approach is two separate node arrays. Each is lightweight (just proxy objects).

**Step 3: Compute fade values in useFrame**

Import `computeLabelFade` from `src/lib/label-fade-coordinator.ts`. Add refs for fade values:

```typescript
const coarseFadeRef = useRef(0);
const fineFadeInRef = useRef(0);
const fineFadeRef = useRef(0);

// In the existing useFrame callback, after camZ is available:
const coarseRange = { start: coarseFadeStart, full: coarseFadeEnd };
const fineRange = { start: fineFadeStart, full: fineFadeEnd };
coarseFadeRef.current = computeLabelFade(camZ, coarseRange);
fineFadeInRef.current = coarseFadeRef.current; // fine fades in as coarse fades out
fineFadeRef.current = computeLabelFade(camZ, fineRange);
```

Pass as state (updated in useFrame, read by ClusterLabels3D):

```typescript
const [coarseLabelFadeT, setCoarseLabelFadeT] = useState(0);
const [fineLabelFadeT, setFineLabelFadeT] = useState(0);
const [fineFadeInT, setFineFadeInT] = useState(0);
```

Update these from useFrame only when the values change significantly (avoid re-renders every frame):

```typescript
// In useFrame, after computing fades:
if (Math.abs(coarseFadeRef.current - coarseLabelFadeT) > 0.01) {
  setCoarseLabelFadeT(coarseFadeRef.current);
}
// Same for fineLabelFadeT and fineFadeInT
```

**Step 4: Render the two ClusterLabels3D instances**

In the JSX return, add after CardTextLabels:

```tsx
{coarseLabels && coarseNodeToCluster.size > 0 && !isRunning && (
  <ClusterLabels3D
    nodes={coarseLabelNodes}
    nodeToCluster={coarseNodeToCluster}
    labelFadeT={coarseLabelFadeT}
    labelZ={CARD_Z_RANGE + 0.5}
    baseFontSize={60}
    useSemanticFonts={false}
  />
)}
{fineLabels && fineNodeToCluster.size > 0 && !isRunning && (
  <ClusterLabels3D
    nodes={fineLabelNodes}
    nodeToCluster={fineNodeToCluster}
    labelFadeT={fineLabelFadeT}
    fadeInT={fineFadeInT}
    labelZ={CARD_Z_RANGE + 0.3}
    baseFontSize={40}
    useSemanticFonts={false}
  />
)}
```

**Step 5: Type check and test visually**

Run: `npx tsc --noEmit`
Verify in dev server: coarse labels visible when zoomed out, fine labels appear at mid zoom, both fade as expected.

**Step 6: Commit**

```
git add src/components/chunks-r3f/ChunksScene.tsx
git commit -m "feat: render two-level cluster labels in ChunksScene"
```

---

### Task 8: End-to-end manual testing and polish

Verify the full flow works and tune defaults.

**Steps:**
1. Start dev server, navigate to ChunksView
2. First load: UMAP runs, POST saves cache, labels appear
3. Refresh: cached layout loads instantly with labels
4. Adjust coarse/fine resolution sliders → recluster API fires, labels update
5. Adjust fade range sliders → labels crossfade at different zoom levels
6. Click "Redo UMAP" → re-runs UMAP, re-caches, re-labels
7. Tune default Z thresholds (coarseFadeStart, coarseFadeEnd, fineFadeStart, fineFadeEnd) based on what feels right with the actual data
8. Update `docs/README.md` if needed

**Commit:**

```
git add -A
git commit -m "polish: tune ChunksView cluster label defaults"
```
