# Topics Loading Optimization Investigation

**Date**: 2026-02-08
**Status**: Rolled back to baseline, planning next attempt
**Branch**: `drei`

## Problem

"Loading topics..." takes too long. After pressing the play button, the graph takes multiple seconds to appear.

## Architecture

The `/api/topics` endpoint calls `getKeywordBackbone()` in `src/lib/graph-queries.ts`, which builds a keyword similarity graph. The result feeds into a D3 force simulation rendered via React Three Fiber.

## Investigation Timeline

### Phase 1: Double-load fix (committed: 9f056df)

**Problem**: Graph loaded twice — first slow render, then correct render after precomputed clusters arrived asynchronously.

**Fix**: Fetch precomputed clusters in parallel with topics data at page load, pass as `initialPrecomputedData` prop to `useClusterLabels`. No more async cluster fetch = no double render.

**Also fixed**: The `node_ids` parameter in `/api/precomputed-clusters` was the bottleneck (850ms median with IDs, 87ms without). Removed it since client always sends all IDs anyway.

### Phase 2: Parallel query optimization (committed, needs amend)

**Baseline**: `getKeywordBackbone()` made ~16 sequential Supabase round-trips at ~80-100ms each.

| Step | Queries | Time |
|------|---------|------|
| `get_keyword_graph()` RPC | 1 | ~2.7s |
| Embedding fetch (10 batches of 100) | 10 | ~3.3s |
| Community lookup (18 queries) | 18 | ~3.8s |
| JS k-NN computation | 0 | ~0.28s |
| **Total (sequential)** | **~29** | **~9s** |

**Fix**: Created `get_keyword_metadata()` SQL function (migration 031) that returns embeddings + community IDs in one query. Runs in parallel with `get_keyword_graph()`.

| Step | Queries | Time |
|------|---------|------|
| `get_keyword_graph()` + `get_keyword_metadata()` (parallel) | 2 | ~2.7s (limited by slower query) |
| JS k-NN computation | 0 | ~0.28s |
| **Total** | **2** | **~3.1s** |

### Phase 3: Client-side computation (abandoned)

**Goal**: Remove the ~2.7s `get_keyword_graph()` SQL query entirely by computing edges client-side.

**Approach**: `get_keyword_metadata()` already returns embeddings and node_ids. Compute cross-article similarity edges in JavaScript using 256-dim embeddings instead of the SQL CROSS JOIN LATERAL on 1536-dim vectors.

**Result**: 1.2s median end-to-end. But the result sets differ significantly:

| Metric | SQL (old) | Client-side (new) |
|--------|-----------|-------------------|
| Keywords | 489 | 811 |
| Edges | 1189 | 5818 |
| Similarity basis | 1536-dim | 256-dim |

**256-dim vs 1536-dim accuracy** (measured on 4950 keyword pairs):
- Mean absolute similarity diff: 0.039
- Mean bias: +0.022 (256-dim slightly overestimates)
- Top-10 neighbor preservation: 75% (7.5/10 same neighbors)

**Decision**: User requires exact equivalence with the old approach. Client-side 256-dim computation is not acceptable. Need to keep the SQL CROSS JOIN LATERAL.

### Phase 4: Lean SQL function (abandoned)

Created `get_keyword_graph_lean()` — same CROSS JOIN LATERAL but strips the 2 unnecessary `JOIN nodes` (source_path, content/summary size). The topics client only uses 3 of 11 columns.

**Benchmarks**:

| Variant | Median time | Notes |
|---------|-------------|-------|
| Original `get_keyword_graph` (max_edges=10) | 2.7s | 11 columns, 2 node JOINs |
| Lean `get_keyword_graph_lean` (max_edges=10) | 2.0s | 3 columns, no JOINs |
| Lean (max_edges=20) | 1.1s | HNSW planner prefers larger LIMIT |
| Lean (max_edges=1) | >8s (timeout) | HNSW planner falls back to seqscan |
| Parallel (lean + metadata) | 5.2s | DB resource contention, SLOWER |

**Key finding**: `max_edges=20` is 2x faster than `max_edges=10`. The PostgreSQL HNSW planner makes dramatically different choices based on the LATERAL's LIMIT value. Larger LIMIT = more eagerly uses the index.

**Key finding**: Running the edge query and metadata query in parallel is SLOWER (5.2s) than sequential (2.0s + 0.5s = 2.5s). The two heavy vector queries compete for database resources.

### Phase 5: Scaling analysis

The SQL function is fundamentally doing per-request **O(N x topK vector_search)** work. No amount of JOIN pruning or planner coaxing changes that asymptotic. To make this scalable we have to stop rebuilding the entire backbone graph synchronously for each `/api/topics` call. The realistic path is **precomputation**: treat the lean SQL query as an offline batch step that writes into a cache table instead of streaming rows through PostgREST.

### Phase 6: Implementation attempt (rolled back)

Attempted to implement the cache approach with migrations 031-034. This added:
- `get_keyword_metadata()` function
- `get_keyword_graph_lean()` function
- `keyword_backbone_cache` table with dirty-flag trigger
- Pagination params on all graph functions
- Precompute script

**What went wrong**:
1. Migration 034 was edited in-place after being applied to the DB, causing DB and local files to diverge
2. The paginated function rewrites accidentally replaced `get_keyword_graph` with a broken version
3. `graph-queries.ts` was rewritten to depend on paginated functions that were never successfully deployed
4. The app returned wrong results or timed out

**Rollback**: All experimental migrations (031-034) were reverted and replaced with `031_rollback_optimization_experiments.sql` which drops all experimental objects and restores `get_keyword_graph` to its original definition from migration 029.

## Critical Bug: 1000-Row Truncation

**All RPC results are capped at 1000 rows** by Supabase's PostgREST `max_rows` default. This affects both old and new code:

- `get_keyword_graph()` returns 1000 rows (actual count unknown, likely much higher)
- `.range(0, 49999)` does NOT override the cap (it's server-side)

This means the current graph is silently incomplete. The 489-keyword / 1189-edge result was from a truncated 1000-row result set.

## Current state

- **DB**: Original `get_keyword_graph(text, int, float)` from migration 029 is restored
- **Code**: `src/lib/graph-queries.ts` is the committed version calling `get_keyword_graph` with no caching
- **Migration**: `031_rollback_optimization_experiments.sql` is committed (commit 3d853c5)
- **Scripts**: Experimental scripts deleted, `scripts/profile-topics-api.ts` retained for baseline profiling

## Lessons learned

- **Don't edit applied migrations in place.** Create new migrations for changes. Editing after `db push` causes the DB and local files to diverge silently.
- **Test DB changes against the actual remote before building TS on top.** The pagination SQL was never successfully applied, but graph-queries.ts was rewritten to depend on it.
- **The CROSS JOIN LATERAL doesn't scale.** At O(N x topK vector_search) per request, it grows linearly with keyword count. The only viable path for fast loading is precomputation.

## Next steps

The caching approach from Phase 5 is still the right direction. To implement it cleanly:

1. **Fix the 1000-row truncation first.** Either add pagination params to `get_keyword_graph` via a NEW migration, return results as JSON blob via `json_agg`, or change PostgREST `max_rows` in Supabase dashboard.

2. **Add a cache table** (`keyword_backbone_cache`) with a dirty-flag trigger on keywords. Keep it in a single clean migration.

3. **Build the precompute script** that populates the cache by calling the (paginated) SQL function.

4. **Update `getKeywordBackbone`** to read from cache first, fall back to live query.

5. **Address DB quota** (~636 MB vs 500 MB free tier) before adding more tables/indexes.

## Performance Summary

| Approach | Time | Queries | Equivalence |
|----------|------|---------|-------------|
| Original (sequential batching) | ~9s | ~29 | Baseline (truncated) |
| Parallel SQL (Phase 2) | ~3.1s | 2 | Exact (truncated) |
| Client-side 256-dim (Phase 3) | ~1.2s | 1 | Different (75% neighbor overlap) |
| Lean SQL sequential (Phase 4) | ~2.5s | 2 | Exact (truncated) |
| Lean SQL max_edges=20 (Phase 4) | ~1.6s | 2 | More edges, same algorithm |
| **Target: cached** | **~50-80ms** | **1** | **Exact (full graph)** |
