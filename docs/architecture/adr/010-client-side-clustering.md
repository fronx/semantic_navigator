# ADR 010: Client-Side Clustering with Semantic Labeling

## Status
Implemented

## Context

The Topics view shows keyword clusters with colored hulls, but two problems have emerged:

1. **Label overlap**: Dense clusters render all keyword labels, causing unreadable overlap in the visualization center.

2. **Clustering mismatch**: Pre-computed communities don't reflect the rendered graph.

### The Mismatch Problem

Community detection (Louvain) runs offline on a different graph than what Topics renders:

| | Community Detection | Topics View |
|---|---|---|
| **Source** | `keyword_similarities` table | `get_article_keyword_graph` RPC |
| **Threshold** | > 0.7 similarity | > 0.3 similarity |
| **Edges** | All pairs above threshold | Top-K per article + k-NN |

The colors users see come from one graph topology, but node positions are determined by a completely different edge set. Clusters that appear visually grouped may have different colors because they weren't clustered together in the pre-computed data.

### Why This Matters

- Users can't trust cluster colors to reflect visual groupings
- Adding new visualization parameters (contrast, k-NN strength) changes the rendered graph but not the pre-computed clusters
- Future features like semantic zoom filtering would further widen the mismatch

## Decision

Move clustering to client-side, running Louvain on the actual rendered graph. Use a Haiku API endpoint for generating semantic cluster labels.

### Architecture

```
Current:
  DB (keyword_similarities) → Louvain offline → keyword_communities table
  API (get_article_keyword_graph) → different edge set → Topics View
  ↳ colors from table don't match rendered graph

Proposed:
  API (get_article_keyword_graph) → edges + embeddings → Client
  Client → Louvain on rendered edges → clusters
  Client → POST /api/cluster-labels → Haiku → semantic labels
  ↳ clusters exactly match what user sees
```

### Key Components

**1. `useClusterLabels` hook**

Runs Louvain client-side using graphology (already a dependency). Returns cluster membership that matches the force layout's edge set.

```typescript
const { clusters, nodeToCluster } = useClusterLabels(nodes, edges, resolution);
```

Resolution is user-controllable via a slider in the Topics view UI.

**2. Shared LLM infrastructure via `llm.ts`**

Extract shared Haiku/LLM infrastructure to `src/lib/llm.ts`:
- Anthropic client setup
- JSON response parsing helpers (from `summarization.ts`)
- `generateClusterLabels()` function

```typescript
// src/lib/llm.ts
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export function parseJsonArray(text: string): string[] { ... }
export async function generateClusterLabels(
  clusters: Array<{ id: number; keywords: string[] }>
): Promise<Record<number, string>>
```

`summarization.ts` imports from `llm.ts` instead of creating its own client. A thin API route (`/api/cluster-labels`) delegates to `generateClusterLabels` for client-side access.

**3. Cluster-level labels only**

Instead of showing every keyword label (causing overlap), show one label per cluster at the hull centroid. Initially the hub keyword, upgraded to Haiku label when available.

## Consequences

### Benefits

- **Accurate clustering**: Clusters match what users see
- **Adaptive**: Can re-cluster when parameters change or user zooms
- **Semantic labels**: Haiku generates meaningful names like "machine learning frameworks" instead of just showing the hub keyword
- **Foundation for semantic zoom**: Client-side clustering enables filtering to visible nodes and re-clustering at different granularities

### Trade-offs

- **Client computation**: Louvain runs in browser (~50-100ms for ~500 keywords, acceptable)
- **API latency**: Haiku call adds ~500ms for labels, but progressive display (hub first) mitigates perceived delay
- **No offline consistency**: Clusters may differ between page loads if graph edges change

### Backward Compatibility

- `keyword_communities` table remains for Map view
- Topics view switches to client-side clustering
- No database migrations needed

## Implementation

### Phase 1: Client-Side Clustering with Hub Labels

**New Files:**
- `src/hooks/useClusterLabels.ts` - Louvain + cluster state management

**Modified Files:**
- `src/app/topics/page.tsx` - Add resolution slider, integrate hook
- `src/components/TopicsView.tsx` - Cluster-based coloring and hull labels
- `src/lib/hull-renderer.ts` - Add cluster label rendering at hull centroids

Labels show hub keyword per cluster. Error handling: log errors, fall back gracefully.

### Phase 2: Semantic Labels via Haiku

**New Files:**
- `src/lib/llm.ts` - Shared Anthropic client, JSON helpers, `generateClusterLabels()`
- `src/app/api/cluster-labels/route.ts` - Thin route delegating to `llm.ts`

**Modified Files:**
- `src/lib/summarization.ts` - Import client from `llm.ts` instead of creating own
- `src/lib/chunker.ts` - Import client from `llm.ts` instead of creating own
- `src/hooks/useClusterLabels.ts` - Add Haiku label fetching, caching strategy

Swap hub labels for Haiku-generated semantic labels. On API error: log and keep hub label.

## Future Possibilities

With client-side clustering established:

1. **Zoom-adaptive resolution**: Tie Louvain resolution to zoom level
2. **Semantic zoom filtering**: Re-cluster only visible/relevant nodes
3. **Interactive labeling**: "Summarize what I'm looking at" via Haiku
4. **Cross-view consistency**: Share clustering approach across Map and Topics

### Future Optimizations

5. **Database cache**: Migrate from localStorage to database for cross-user caching. See `docs/architecture/cluster-label-caching-plan.md` for proposed schema with pgvector similarity search.

6. **Parallel label requests**: If benchmarks show benefit, split large batches into parallel requests for faster response.

7. **Topics data fetch optimization**: `/api/topics` currently takes ~2.8s due to `getKeywordBackbone` query complexity (k-NN computation, embedding fetches). Could benefit from server-side caching or query optimization.

### Resolved Issues

5. **Client-side label caching**: Implemented in `src/lib/cluster-label-cache.ts`. Uses localStorage with semantic similarity matching via cluster centroid embeddings (256-dim). Cache hits at 0.85+ similarity reuse labels immediately. Near-matches (0.85-0.95) show cached label then request refinement in background via `/api/cluster-labels/refine`.

6. **Latency investigation**: Added benchmark script `scripts/investigations/benchmark-cluster-labels.ts` to measure endpoint vs direct API latency. Run with `npm run script scripts/investigations/benchmark-cluster-labels.ts`.

7. **Full re-render on label arrival**: Fixed by separating `baseClusters` (stable) from `labels` (volatile) in `useClusterLabels`. TopicsView now depends only on `baseClusters` for simulation setup, and updates hull labels via a ref when semantic labels arrive.

8. **Hull labels redraw every tick**: Fixed by using D3 data join pattern in `map-renderer.ts`. Labels are now updated in place instead of removed/recreated every frame. Tspan content is only rebuilt when the label text actually changes.

9. **No debounce on resolution slider**: Fixed by adding `useDebouncedValue` hook in `topics/page.tsx`. The slider provides immediate visual feedback, but computation only triggers after 300ms of inactivity.
