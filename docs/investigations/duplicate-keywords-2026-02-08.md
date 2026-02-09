# Duplicate Keywords Investigation

**Date**: 2026-02-08
**Status**: Root cause identified, fix planned
**Branch**: `drei`

## Problem

The keyword graph displays duplicate nodes for the same keyword text:
- "active inference": 11 duplicate nodes
- "agency": 24 duplicate nodes
- "identity": 14 duplicate nodes
- And many more...

This was discovered when loading the full cached backbone (16,090 edges) after fixing the Cloudflare 520 error.

## Root Cause

### Current Data Model

The `keywords` table uses `(node_id, keyword)` as a unique constraint:

```sql
UNIQUE (node_id, keyword)
```

This means:
- Each article/chunk can have unique keywords
- But the same keyword text gets separate rows for each article
- Example: "active inference" appears in 11 articles → 11 separate UUID rows

### Ingestion Code

From [`src/lib/ingestion-chunks.ts:346-355`](../../src/lib/ingestion-chunks.ts):

```typescript
await supabase.from("keywords").upsert(
  {
    keyword,                    // Text (e.g., "active inference")
    embedding,
    embedding_256: truncateEmbedding(embedding, 256),
    node_id: chunkNode.id,      // Different for each chunk
    node_type: "chunk",
  },
  { onConflict: "node_id,keyword" }  // ⚠️ Allows duplicates across nodes
);
```

This is **intentional by design** - keywords are scoped to their parent nodes. But it creates graph visualization issues when we want to show keywords as unified concepts.

## Impact

### Before (Truncated Data)
- PostgREST 1000-row limit hid most duplicates
- Only partial graph visible
- Problem not obvious

### After (Full Cache)
- All 16,090 edges loaded
- All duplicate keywords visible
- Graph cluttered with duplicate nodes

### Current Workaround

TypeScript deduplication in [`src/lib/graph-queries.ts:108-149`](../../src/lib/graph-queries.ts):
- Groups keywords by text (not ID)
- Remaps edges to canonical keyword IDs
- Deduplicates merged edges

This fixes the visualization but doesn't address the underlying data issue.

## Why This Design Exists

### Benefits of Current Model
1. **Preserves context** - Each article's keywords are independent
2. **Accurate embeddings** - Each keyword embedding captures its context in that article
3. **Flexible querying** - Can ask "which articles mention X?"
4. **Simple ingestion** - No need to check for existing keywords

### Drawbacks
1. **Graph duplication** - Same concept appears as multiple nodes
2. **Storage overhead** - Duplicate embeddings for same text
3. **Query complexity** - Need to deduplicate at query time
4. **Cache complexity** - Backbone cache has 16k edges instead of ~2-3k

## Proposed Fix: Keyword Canonicalization

### Option A: Shared Keyword Table (Recommended)

**Schema changes:**
```sql
-- New global keywords table
CREATE TABLE keyword_canonical (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT UNIQUE NOT NULL,           -- Unique keyword text
  embedding VECTOR(1536) NOT NULL,        -- Canonical embedding
  embedding_256 VECTOR(256) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link keywords to nodes via many-to-many
CREATE TABLE keyword_occurrences (
  keyword_id UUID REFERENCES keyword_canonical(id),
  node_id UUID REFERENCES nodes(id),
  node_type TEXT NOT NULL,                -- Denormalized for filtering
  context_embedding VECTOR(1536),         -- Optional: embedding in this context
  PRIMARY KEY (keyword_id, node_id)
);
```

**Ingestion changes:**
1. Extract unique keywords from article/chunks
2. Upsert into `keyword_canonical` (idempotent)
3. Link to node via `keyword_occurrences`

**Benefits:**
- ✅ No duplicates in graph
- ✅ Canonical embeddings for keyword similarity
- ✅ Still can query "which articles have keyword X"
- ✅ Smaller backbone cache (~2-3k edges)

**Drawbacks:**
- ⚠️ Breaking schema change (migration required)
- ⚠️ Need to backfill existing data
- ⚠️ Context-specific embeddings lost (could store in `context_embedding`)

### Option B: Keep Current Model, Improve Cache

Keep `(node_id, keyword)` model but improve cache population:

1. **Deduplicate at cache build time** - Merge duplicate keywords when building cache
2. **Store canonical ID mapping** - Cache stores which UUID is canonical for each text
3. **TypeScript layer transparent** - No changes to query code

**Benefits:**
- ✅ No schema migration
- ✅ Keeps context-specific embeddings
- ✅ Simpler migration path

**Drawbacks:**
- ⚠️ Still storing duplicate keywords in DB
- ⚠️ Deduplication logic needed in multiple places
- ⚠️ Graph queries still complex

### Option C: Hybrid Approach

1. Keep `keywords` table for storage (preserves context)
2. Add `keyword_canonical` for graph visualization
3. Populate canonical table on cache rebuild
4. Graph queries use canonical table, content queries use keywords table

**Benefits:**
- ✅ Best of both worlds
- ✅ Gradual migration path
- ✅ Preserves existing functionality

**Drawbacks:**
- ⚠️ Two sources of truth
- ⚠️ Sync complexity

## Recommendation

**Start with Option A** (Shared Keyword Table):

### Phase 1: Schema Migration
1. Create `keyword_canonical` and `keyword_occurrences` tables
2. Write migration script to backfill from existing `keywords` table
3. Deduplicate by keyword text, merge embeddings (average or first)

### Phase 2: Update Ingestion
1. Modify `ingestion-chunks.ts` to upsert into `keyword_canonical`
2. Create links in `keyword_occurrences`
3. Verify with small test import

### Phase 3: Update Queries
1. Update `get_keyword_graph()` to use `keyword_canonical`
2. Update cache refresh to use canonical keywords
3. Update content loading queries to join through `keyword_occurrences`

### Phase 4: Clean Up
1. Remove old `keywords` table (after verification)
2. Update all references
3. Document new schema in `schema.sql`

## Migration Script Outline

```typescript
// scripts/migrate-to-canonical-keywords.ts

async function migrateToCanonicalKeywords(supabase: SupabaseClient) {
  // 1. Extract unique keywords with their first embedding
  const { data: keywords } = await supabase
    .from('keywords')
    .select('keyword, embedding, embedding_256')
    .order('created_at', { ascending: true });

  // 2. Deduplicate by keyword text
  const canonical = new Map<string, { embedding: number[], embedding_256: number[] }>();
  for (const kw of keywords) {
    if (!canonical.has(kw.keyword)) {
      canonical.set(kw.keyword, {
        embedding: kw.embedding,
        embedding_256: kw.embedding_256
      });
    }
  }

  // 3. Insert into keyword_canonical
  const canonicalInserts = Array.from(canonical.entries()).map(([keyword, data]) => ({
    keyword,
    embedding: data.embedding,
    embedding_256: data.embedding_256
  }));

  await supabase.from('keyword_canonical').insert(canonicalInserts);

  // 4. Get canonical IDs
  const { data: canonicalKeywords } = await supabase
    .from('keyword_canonical')
    .select('id, keyword');

  const keywordToCanonicalId = new Map(
    canonicalKeywords.map(k => [k.keyword, k.id])
  );

  // 5. Create keyword_occurrences from old keywords table
  const { data: oldKeywords } = await supabase
    .from('keywords')
    .select('keyword, node_id, node_type');

  const occurrences = oldKeywords.map(kw => ({
    keyword_id: keywordToCanonicalId.get(kw.keyword),
    node_id: kw.node_id,
    node_type: kw.node_type
  }));

  await supabase.from('keyword_occurrences').insert(occurrences);

  console.log(`Migrated ${canonical.size} unique keywords`);
  console.log(`Created ${occurrences.length} occurrences`);
}
```

## Expected Results

**Before:**
- Keywords: 1,617 (many duplicates)
- Edges: 16,090 (includes duplicate-to-duplicate edges)
- Graph: Cluttered with "active inference" × 11

**After:**
- Canonical keywords: ~300-400 (estimate)
- Edges: ~2,000-3,000 (connecting unique keywords)
- Graph: One "active inference" node with merged connections

## Open Questions

1. **Embedding strategy**: Average, first occurrence, or retrain?
2. **Context preservation**: Store original context embeddings in `keyword_occurrences`?
3. **Breaking changes**: How to handle existing projects/bookmarks?
4. **Community IDs**: Do they reference keywords table? Need migration too?

## Next Steps

1. ✅ Document investigation (this file)
2. ⬜ Prototype canonical schema in local database
3. ⬜ Write and test migration script
4. ⬜ Update ingestion code
5. ⬜ Update graph queries
6. ⬜ Update cache rebuild
7. ⬜ Test end-to-end with full import
8. ⬜ Deploy migration to production

## Related Files

- [`src/lib/ingestion-chunks.ts`](../../src/lib/ingestion-chunks.ts) - Keyword insertion
- [`src/lib/graph-queries.ts`](../../src/lib/graph-queries.ts) - Keyword deduplication workaround
- [`supabase/schema.sql`](../../supabase/schema.sql) - Current schema definition
- [`docs/investigations/topics-loading-optimization-2026-02-08.md`](./topics-loading-optimization-2026-02-08.md) - Cache optimization context
