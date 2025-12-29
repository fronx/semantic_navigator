# Search Performance Investigation

**Date**: 2024-12-29
**Status**: Resolved

## Problem Statement

The semantic search feature was timing out consistently at ~8 seconds, returning PostgreSQL error code `57014` (statement timeout).

## Environment

- **Database**: Supabase (free tier) with pgvector extension
- **Data size**: 5,104 nodes, 18,692 keywords
- **Vector dimensions**: 1536 (text-embedding-3-small)
- **Index type**: IVFFlat with 100 lists

## Root Cause

The API was passing `filter_node_type: null` explicitly to the `search_similar` RPC function, while the profiling script omitted the parameter entirely (using the SQL default).

PostgreSQL's query planner creates different execution plans for these two cases:
- **Omitted parameter**: Planner knows the value is `null` at plan time and optimizes accordingly
- **Explicit null**: Planner must account for the possibility of non-null values, creating a less efficient plan

This caused a **10x performance difference** between script and API for the same query.

## Resolution

Changed the API to only include `filter_node_type` when a value is actually provided:

```typescript
// Before (slow)
const { data, error } = await supabase.rpc("search_similar", {
  query_embedding: queryEmbedding,
  match_threshold: 0.1,
  match_count: limit,
  filter_node_type: nodeType || null,  // Always passed, even as null
});

// After (fast)
const rpcParams = {
  query_embedding: queryEmbedding,
  match_threshold: 0.1,
  match_count: limit,
};
if (nodeType) {
  rpcParams.filter_node_type = nodeType;  // Only include when provided
}
const { data, error } = await supabase.rpc("search_similar", rpcParams);
```

## Performance Results

### Before Fix

| Source | RPC Time |
|--------|----------|
| Script (omits parameter) | 300-500ms |
| API (passes null explicitly) | 2,500-8,000ms |

### After Fix

| Source | RPC Time |
|--------|----------|
| Script | 300-400ms |
| API | 300-400ms |

Both now perform consistently at 300-400ms when the database is warm.

## Cold Start Issue

The first query after database idle still takes 3-8 seconds due to IVFFlat index loading into memory. This is a Supabase free tier limitation and not addressed by this fix.

Potential solutions for cold start:
- Use HNSW index instead (faster queries, slower inserts)
- Upgrade to paid tier with more memory
- Implement keep-alive pings to prevent database sleep

## Investigation Process

### Initial Hypothesis (Incorrect)

We initially suspected:
- Index not being used (WHERE clause preventing index usage)
- CTE complexity
- Connection pooling differences
- PostgREST overhead

### Key Insight

By running script and API calls **interleaved** with pre-generated embeddings, we isolated the variable to a single difference: how parameters were passed to the RPC function.

A targeted test confirmed the hypothesis:

```typescript
// This is slow
await supabase.rpc("search_similar", { ..., filter_node_type: null });

// This is fast
await supabase.rpc("search_similar", { ... });  // omit parameter
```

## Lesson Learned

When calling PostgreSQL functions via Supabase RPC, **omit optional parameters rather than passing null explicitly**. The query planner treats these differently and can produce vastly different execution plans.

## Files Changed

- `src/app/api/search/route.ts` - Fixed parameter passing
- `scripts/compare-script-vs-api.ts` - Comparison test script
- `scripts/compare-with-filter.ts` - Filter parameter test script
- `scripts/explain-search.ts` - Component timing script

## Relevant Scripts

```bash
# Compare script vs API performance
npm run script scripts/compare-script-vs-api.ts

# Test filter parameter behavior
npm run script scripts/compare-with-filter.ts

# Profile individual search components
npm run script scripts/explain-search.ts
```
