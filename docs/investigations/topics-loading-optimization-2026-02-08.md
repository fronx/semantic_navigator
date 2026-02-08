# Topics Loading Optimization Investigation

**Date**: 2026-02-08
**Status**: In progress
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

**Files**:
- `supabase/migrations/031_keyword_metadata_function.sql` — `get_keyword_metadata()` + HNSW index for chunk keywords
- `supabase/migrations/032_keyword_metadata_add_node_id.sql` — added `node_id` to return type
- `src/lib/graph-queries.ts` — refactored to parallel queries

### Phase 3: Eliminating the SQL CROSS JOIN (current, uncommitted)

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

### Phase 4: Optimizing the SQL query (current, uncommitted)

Created `get_keyword_graph_lean()` (migration 033) — same CROSS JOIN LATERAL but strips the 2 unnecessary `JOIN nodes` (source_path, content/summary size). The topics client only uses 3 of 11 columns.

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

## Critical Bug: 1000-Row Truncation

**All RPC results are capped at 1000 rows** by Supabase's PostgREST `max_rows` default. This affects both old and new code:

- `get_keyword_metadata()` returns 1000 of 1617 keywords
- `get_keyword_graph()` returns 1000 rows (actual count unknown, likely much higher)
- `get_keyword_graph_lean()` same truncation
- `.range(0, 49999)` does NOT override the cap (it's server-side)

This means the old approach was already silently losing data. The 489-keyword / 1189-edge result was from a truncated 1000-row result set.

**Needs resolution**: Paginate RPC calls or use a workaround (e.g., JSON blob return type, SQL-level LIMIT/OFFSET params, or changing the Supabase PostgREST `max_rows` config).

## Current State of Code

### Uncommitted changes in `src/lib/graph-queries.ts`

Currently has the **client-side computation** approach (Phase 3). This needs to be either:
- (a) Reverted to the SQL-based approach with the lean function + pagination fix, OR
- (b) Kept if we decide 256-dim approximation is acceptable after all

### Migrations applied but not committed

- `031_keyword_metadata_function.sql` — `get_keyword_metadata()` (useful either way)
- `032_keyword_metadata_add_node_id.sql` — adds `node_id` to metadata (only needed for client-side approach)
- `033_lean_keyword_graph.sql` — `get_keyword_graph_lean()` (useful for SQL approach)

### Temporary scripts (can be deleted)

- `scripts/profile-lean-graph-query.ts`
- `scripts/profile-e2e-only.ts`
- `scripts/compare-backbone-methods.ts`
- `scripts/compare-similarity-accuracy.ts`
- `scripts/test-rpc-pagination.ts`

### Scripts to keep

- `scripts/profile-topics-api.ts` — baseline profiling of each phase
- `scripts/profile-precomputed-clusters.ts` — precomputed cluster benchmarking
- `scripts/cluster-stats.ts` — cluster row counts per resolution

## Next Steps

1. **Fix the 1000-row truncation**. Options:
   - Add LIMIT/OFFSET params to SQL functions and paginate from client
   - Return results as JSON blob (`json_agg`) to bypass PostgREST row limit
   - Change Supabase PostgREST `max_rows` config in dashboard

2. **Choose SQL approach**: Use `get_keyword_graph_lean` + sequential metadata query (not parallel — parallel is slower due to DB contention)

3. **Exploit the max_edges/speed tradeoff**: `max_edges=20` runs in 1.1s vs 2.0s for `max_edges=10`. Could use `max_edges=20` with a higher `min_similarity` threshold to get roughly the same edge count but faster execution.

4. **Benchmark end-to-end** with the chosen approach and pagination fix.

5. **Compare result sets** once pagination is fixed to verify we get the full, correct graph.

## Performance Summary

| Approach | Time | Queries | Equivalence |
|----------|------|---------|-------------|
| Original (sequential batching) | ~9s | ~29 | Baseline (truncated) |
| Parallel SQL (current commit) | ~3.1s | 2 | Exact (truncated) |
| Client-side 256-dim | ~1.2s | 1 | Different (75% neighbor overlap) |
| Lean SQL sequential | ~2.5s | 2 | Exact (truncated) |
| Lean SQL max_edges=20 | ~1.6s | 2 | More edges, same algorithm |

## Phase 5: Back to the original SQL query (and what it would take to scale)

### Query anatomy refresher

1. `filtered_keywords` CTE loads every keyword for the requested `node_type`. Today that is ~1.6k article keywords, but the topics loader only sees **1000** of them because of the PostgREST cap.
2. For each row in `filtered_keywords`, the `CROSS JOIN LATERAL` runs a separate `ORDER BY fk.embedding <=> k2.embedding LIMIT max_edges_per_node` search over the entire `keywords` table (restricted to the same `node_type` and `node_id != fk.node_id`). Even with the partial HNSW index, Postgres still performs **N** vector searches where **N = keyword count**.
3. The outer filter drops neighbors whose similarity falls below `min_similarity`, but that happens only after we have already paid the cost of the HNSW search and sorting.
4. PostgREST returns at most 1000 rows per RPC call, so we are throwing away ~38% of the rows before the client ever sees them. `.range()` does not help here because the cap sits in PostgREST, not the SQL function.

### Why this does not scale

- With `max_edges=20` (the fastest setting so far), the lean query still took **~1.1s** while truncated to 1000 rows. That implies roughly `1.1s / 1,617 ≈ 0.68ms` per keyword/HNSW lookup. At 5k keywords, the same query would take ~3.4s; at 10k it would push past 6.8s; at 50k we are looking at ~34s even before serialization. In other words, the latency grows **linearly with the number of keywords** times the HNSW cost, so it will never feel “actually fast” when executed on-demand.
- Increasing `max_edges` buys us better planner choices (HNSW instead of seqscan), but that is just treating the symptom. We are still launching thousands of index lookups per request.
- Running `get_keyword_graph_lean` and `get_keyword_metadata` concurrently made things worse (5.2s) because both queries contend for the same `idx_keywords_*_embedding` indexes and saturate the vector ops. Concurrency inside a single request is therefore off the table.
- Fixing the 1000-row limit would *increase* the amount of work the SQL query has to return on every call, so the wall time would grow by another ~40% immediately.

### What “actually fast” requires

The SQL function is fundamentally doing per-request **O(N × topK vector_search)** work. No amount of `JOIN` pruning or planner coaxing changes that asymptotic. To make this scalable we have to stop rebuilding the entire backbone graph synchronously for each `/api/topics` call. The realistic path looks like:

1. **Precompute the backbone once per ingest cycle.** Treat the lean SQL query as an offline batch step that writes into a cache table instead of streaming rows through PostgREST. A single batch that takes 1–2 seconds is acceptable when amortized over many requests.
2. **Store the result in Postgres (or S3) as a JSON blob or per-edge table.** Either approach collapses the row-count problem (one row per graph or simple `SELECT * FROM cached_edges WHERE graph_id = …`). Returning a single JSON document from SQL also bypasses PostgREST’s 1000-row ceiling.
3. **Expose `/api/topics` as a pure read of the cached payload.** The API becomes an O(1) lookup plus JSON parse (~50–80 ms end-to-end) instead of spinning up expensive RPCs.
4. **Invalidate the cache when inputs change.** Keep a checksum such as `MAX(keywords.updated_at)` + total keyword count. If it differs from what was stored with the cache row, rerun the batch job. This can run on a Vercel cron, Supabase scheduled job, or part of the ingestion pipeline.
5. **Keep the old on-demand path as a fallback.** If someone requests a non-default combination of `{nodeType, maxEdges, minSimilarity}`, fall back to the live SQL query (or compute on the fly) but make the default UI hits use the cache.

### Proposed implementation steps

1. **Migration:** create `keyword_backbone_cache` with columns such as `node_type`, `community_level`, `max_edges`, `min_similarity`, `node_count`, `edge_count`, `payload jsonb`, `source_checksum`, `computed_at`.
2. **Batch script:** add `scripts/maintenance/precompute-keyword-backbone.ts` that (a) pages through `get_keyword_graph_lean` + metadata, (b) builds the payload JSON (nodes + edges), (c) upserts into the cache table with a new checksum. This can reuse the existing Supabase service-role client.
3. **API change:** update `getKeywordBackbone` to fetch from the cache when the requested params match a cached row; only run the heavy SQL when no cache entry exists. Add logging so we can track cache hit rate.
4. **Observability and guardrails:** surface `node_count`, `edge_count`, and `computed_at` in the API response headers or logs so we can confirm the cache is fresh. Alert if cache is older than X hours.
5. **Stretch goal:** if we need multiple densities (e.g., `maxEdges` slider), precompute a small menu of graphs (say, 5, 10, 20) and store each as a separate row. That is still far cheaper than recomputing on every request.

**Requirement: keep the graph live.** Precomputation must be triggered automatically whenever ingestion writes new content so the cached payload reflects fresh data (think change-driven invalidation or incremental recompute). The cached path is the fast default, but the on-demand SQL remains as a fallback whenever a cache entry is missing or marked dirty.

Once the cache is in place, we can revisit additional niceties (JSON aggregation inside SQL, streaming, etc.), but the key shift is turning the expensive vector search into an offline job so the user-facing request path is essentially constant time while still reacting immediately to new content.

## Phase 6: Implementing the cache (this branch)

- **Migration 034** adds:
  - `keyword_backbone_cache` table (payload JSON, source stats, checksum, dirty flag)
  - Pagination params on `get_keyword_metadata`, `get_keyword_graph_lean`, and the legacy `get_keyword_graph`
  - `get_keyword_backbone_source_stats(filter_node_type)` RPC for checksum inputs
  - Trigger `mark_keyword_backbone_cache_dirty` so any keyword insert/update/delete marks the relevant cache rows dirty immediately
- **New script** `scripts/maintenance/precompute-keyword-backbone.ts` materializes the graph per `{nodeType, maxEdges, minSimilarity, communityLevel}` combo, upserting cache rows with payload size + source metadata. Supports `NODE_TYPE=article|chunk` overrides.
- **Runtime behavior** (`src/lib/graph-queries.ts`):
  1. `/api/topics` now calls `getKeywordBackbone`, which first checks `keyword_backbone_cache`.
  2. If a fresh cache row exists, it returns the JSON payload in ~50 ms.
  3. If the row is missing or marked dirty, it fetches paginated metadata + lean edges, rebuilds the graph (including k-NN edges) once, serves it, and upserts the cache. This path is the fallback and should only run immediately after new content ingestion or before the precompute script has filled the cache.
- **Live requirement satisfied**: keyword writes trigger the dirty flag, so `/api/topics` refuses to serve stale payloads. The precompute script (or ingestion worker) reruns immediately to repopulate the cache, keeping Semantic Navigator live while making the default code path O(1).

### Current blockers (2026-02-08)

1. **Supabase migrations**: The paging changes for `get_keyword_graph(_lean)` were edited in place inside `034_keyword_backbone_cache.sql` after it had already been applied. Supabase won’t re-run an existing migration, so the production database still has the old (unpaged) functions. Fix: create a new migration (e.g., `035_keyword_backbone_paging.sql`) that drops/recreates the RPCs with the new `ROW_NUMBER` paging logic, then run `supabase db push`.
2. **Precompute script timeouts**: Because the live database still runs the unpaged RPCs, `scripts/maintenance/precompute-keyword-backbone.ts` hits `statement timeout` as soon as it tries to fetch the full graph (even with client-side pagination). Once migration 035 is applied, each RPC call will only touch ~500 keywords and the script should complete in ~1–2 s.
3. **Database quota**: Supabase reports the project at **636 MB**, exceeding the free tier’s 0.5 GB cap. Until we either reclaim space (delete stale data + `VACUUM FULL`) or upgrade plans, large queries are more likely to be throttled and future migrations may fail. We need a cleanup plan (e.g., purge old `precomputed_topic_clusters`, shrink temporary tables) or budget for a paid tier.

Action items:
- [ ] Author migration 035 with the new paging SQL, push to Supabase, and rerun the precompute script (should succeed).
- [ ] Audit table sizes via Supabase “Manage Database Size” and remove/compact enough data to get below 0.5 GB, or upgrade the project.
