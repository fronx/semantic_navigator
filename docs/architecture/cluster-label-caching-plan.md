# Plan: Cluster Label Caching with Semantic Similarity

Addresses ADR-010 optimizations #5 (caching) and #6 (parallelization investigation).

## Summary

1. **Benchmark first** - measure actual latency breakdown before optimizing
2. **Client-side cache** - localStorage with semantic similarity matching via centroid embeddings
3. **Refinement pass** - show cached label immediately, ask Haiku to refine if keywords changed
4. **Future: database cache** - document migration path for when proven valuable

## Phase 1: Benchmark Script

**New file:** `scripts/benchmark-cluster-labels.ts`

Measurements:
- Fetch sample clusters from `/api/topics` (same data as UI)
- Run Louvain locally to get clusters
- Call `/api/cluster-labels` with timing
- Call Anthropic API directly to isolate network vs inference time
- Multiple iterations for statistical reliability
- Output timing breakdown (network overhead, Haiku time, total)

Pattern: follow `scripts/profile-search.ts` structure.

## Phase 2: Cache Infrastructure

**New file:** `src/lib/cluster-label-cache.ts`

```typescript
interface CachedClusterLabel {
  keywords: string[];           // sorted canonical form
  centroid: number[];           // 256-dim (average of keyword embeddings)
  label: string;
  timestamp: number;
}

interface ClusterLabelCache {
  version: number;              // for cache invalidation
  entries: CachedClusterLabel[];
}
```

Functions:
- `loadCache(): ClusterLabelCache` - from localStorage
- `saveCache(cache): void` - with LRU eviction (max ~500 entries)
- `computeCentroid(embeddings: number[][]): number[]` - average + normalize
- `findBestMatch(centroid, keywords, cache, threshold=0.85): CachedClusterLabel | null`

Reuse: `cosineSimilarity` and `normalize` from `src/lib/math-utils.ts`.

## Phase 3: Hook Integration

**Modify:** `src/hooks/useClusterLabels.ts`

New flow in `useEffect`:
1. Load cache from localStorage
2. For each cluster:
   - Compute centroid from `node.embedding` values
   - `findBestMatch` against cache (threshold 0.85)
   - If match found: use cached label, queue for refinement if similarity < 0.95
   - If no match: add to `missedClusters`
3. Set cached labels immediately (fast perceived latency)
4. Fetch fresh labels for `missedClusters` only
5. On fresh response: update cache with new entries

Track label sources: `'cache' | 'fresh' | 'refined'` for debugging.

## Phase 4: Refinement Pass

**Modify:** `src/lib/llm.ts`

```typescript
export async function refineClusterLabels(
  refinements: Array<{
    id: number;
    oldLabel: string;
    oldKeywords: string[];
    newKeywords: string[];
  }>
): Promise<Record<number, string>>
```

Prompt: "Here's a previous label for similar keywords. Keywords changed slightly. Return 'keep' or provide a better label (1-2 words, rarely 3 if needed for specificity)."

**Modify:** `src/app/api/cluster-labels/route.ts`

Add handling for refinement requests (can be same endpoint with different payload shape, or separate `/api/cluster-labels/refine`).

**Modify:** `src/hooks/useClusterLabels.ts`

Background refinement for near-matches (0.85-0.95 similarity):
- Show cached label immediately
- Call refinement endpoint in background
- Update label + cache if Haiku refines

## Phase 5: Documentation

**Update:** `docs/architecture/adr/010-client-side-clustering.md`

Move items 5 and 6 from "Optimizations" to "Resolved Issues" with summary of implementation.

**Add section:** Database cache migration path

```sql
-- Future migration
create table cluster_label_cache (
  id uuid primary key default gen_random_uuid(),
  centroid vector(256) not null,
  keywords_hash text not null,
  keywords text[] not null,
  label text not null,
  created_at timestamptz default now(),
  last_used_at timestamptz default now()
);

create index idx_cluster_label_cache_centroid
  on cluster_label_cache using ivfflat (centroid vector_cosine_ops);
```

## Files Summary

| File | Action |
|------|--------|
| `scripts/benchmark-cluster-labels.ts` | Create |
| `src/lib/cluster-label-cache.ts` | Create |
| `src/hooks/useClusterLabels.ts` | Modify |
| `src/lib/llm.ts` | Modify (add `refineClusterLabels`) |
| `src/app/api/cluster-labels/route.ts` | Modify (add refinement handling) |
| `docs/architecture/adr/010-client-side-clustering.md` | Update |

## Implementation Order

1. Benchmark script (establishes baseline, helps validate optimization)
2. Cache infrastructure (`cluster-label-cache.ts`)
3. Hook integration (cache lookup + population)
4. Refinement pass (background refinement for near-matches)
5. Documentation updates
