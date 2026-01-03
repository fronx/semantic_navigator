# ADR-006: Denormalize node_type into Keywords Table

## Status
Accepted (implemented 2026-01-03)

## Context
The Map view's `get_article_keyword_graph` RPC was timing out (8+ seconds) when computing keyword similarity pairs. The function needs to find semantically similar keywords, but only among **article-level** keywords.

**The problem**: To filter keywords by `node_type = 'article'`, the query had to JOIN to the `nodes` table:

```sql
SELECT ... FROM keywords k
JOIN nodes n ON n.id = k.node_id
WHERE n.node_type = 'article'
ORDER BY k.embedding <=> query_embedding
LIMIT 5;
```

This JOIN prevented PostgreSQL from using the pgvector index efficiently. The query planner couldn't push the `node_type` filter into the index scan, resulting in sequential scans of the entire keywords table.

**Scale**: ~1600 article-level keywords out of ~2400 total keywords.

## Decision
Denormalize `node_type` into the `keywords` table and create a **partial index** on article-level keyword embeddings only.

### Schema Change
```sql
-- Add denormalized column
ALTER TABLE keywords ADD COLUMN node_type text;

-- Backfill from nodes table
UPDATE keywords k SET node_type = n.node_type
FROM nodes n WHERE k.node_id = n.id;

-- Partial HNSW index for article keywords only
CREATE INDEX idx_keywords_article_embedding
ON keywords USING hnsw (embedding vector_cosine_ops)
WHERE node_type = 'article';
```

### Why HNSW over IVFFlat
IVFFlat index creation failed with "memory required is 62 MB, maintenance_work_mem is 32 MB". HNSW is more memory-efficient during index building.

## Performance Results
- **Before**: 8+ seconds (timeout)
- **After**: ~1 second

The partial index allows queries like:
```sql
SELECT * FROM keywords
WHERE node_type = 'article'
ORDER BY embedding <=> query_embedding
LIMIT 5;
```
to use the index directly without any JOIN.

## Trade-offs

### Pros
- 8x performance improvement for map queries
- Simple schema change, no application logic changes needed
- Partial index only indexes relevant rows, saving space

### Cons
- Data duplication (node_type stored in both tables)
- Must maintain consistency when updating node types (rare operation)
- Ingestion code must set `node_type` on keyword insert

## Implementation

### Migration
`supabase/migrations/017_denormalize_keyword_node_type.sql`

### Ingestion Changes
Updated `src/lib/ingestion-chunks.ts` to set `node_type` when upserting keywords:

```typescript
await supabase.from("keywords").upsert({
  keyword,
  embedding,
  embedding_256: truncateEmbedding(embedding, 256),
  node_id: chunkNode.id,
  node_type: "chunk",  // Denormalized for efficient filtering
}, { onConflict: "node_id,keyword" });
```

### RPC Updates
- `get_article_keyword_graph` - Uses `k.node_type = 'article'` instead of joining
- `find_similar_keywords_for_node` - Same optimization

## Related
- ADR-005: Hierarchical keyword bubbling (created article-level keywords)
- `docs/architecture/search-performance-investigation.md` - Similar issue with search queries
