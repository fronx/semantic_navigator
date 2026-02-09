# Chunk Ingestion Pipeline: Steps 6-9 Implementation

This guide documents the implementation of Steps 6-9 of the chunk-based ingestion pipeline, completing the database insertion workflow.

## Overview

Steps 6-9 transform processed chunks and keywords into database-ready payloads and handle idempotent database insertion:

- **Step 6**: Generate embeddings for article summaries and chunk content
- **Step 7**: Generate content hashes for change detection
- **Step 8**: Prepare complete database insertion payloads
- **Step 9**: Execute idempotent database insertion with change detection

## Step 6: Content Embeddings

### Function: `getOrGenerateContentEmbeddings()`

Generates embeddings for all article summaries and chunk contents in a single batched operation.

**Input:**
- `articleSummaries`: Map of file paths to summary objects `{title, type, teaser?, content?}`
- `dedupedChunks`: Map of file paths to arrays of deduplicated chunks
- `cachePath`: Optional path to cache file (default: `./data/content-embeddings.json`)

**Operation:**
1. Check cache first - return immediately if cached
2. Collect all texts to embed: article summaries, then chunk contents
3. Batch generate embeddings using `generateEmbeddingsBatched()`
4. Split results back into articles and chunks
5. Structure as nested object: `{articles: {path: embedding}, chunks: {path: {position: embedding}}}`
6. Save to cache

**Output Cache Format:**
```json
{
  "articles": {
    "path/to/file.md": [0.123, 0.456, ...],  // 1536-dim vector
  },
  "chunks": {
    "path/to/file.md": {
      "0": [0.123, 0.456, ...],  // 1536-dim vector per chunk
      "1": [0.789, 0.012, ...]
    }
  }
}
```

**Key Implementation Details:**
- Uses `summary.content` (LLM-generated summary) if available, falls back to `summary.teaser`
- Batches all texts in a single operation for efficiency
- Progress callback reports every 100 embeddings
- Preserves chunk position for accurate mapping

## Step 7: Content Hashing

### Function: `getOrGenerateContentHashes()`

Generates SHA256 hashes (first 16 chars) for content change detection.

**Input:**
- `files`: Array of `{path, content}` objects
- `cachePath`: Optional path to cache file (default: `./data/content-hashes.json`)

**Operation:**
1. Uses `getOrCompute()` pattern for per-file caching
2. Parses each file to strip frontmatter (matches ingestion behavior)
3. Hashes the parsed content using `hash()` from `cache-utils.ts`
4. Returns Map of file paths to hashes

**Output Cache Format:**
```json
{
  "path/to/file.md": "a1b2c3d4e5f6g7h8"  // 16-char hex hash
}
```

**Key Implementation Details:**
- Hash function extracted from `ingestion-chunks.ts` to `cache-utils.ts` for reuse
- Uses parsed content (without frontmatter) to match production ingestion
- Deterministic: same content always produces same hash
- Fast: can re-hash on every run without significant cost

## Step 8: Database Payload Preparation

### Function: `prepareDatabasePayloads()`

Transforms all cached data into complete, validated database insertion payloads.

**Input:**
- `articleSummaries`: From Step 5
- `contentEmbeddings`: From Step 6
- `contentHashes`: From Step 7
- `dedupedChunks`: From Step 3
- `preparedData`: From Step 4 (`{keywordRecords, keywordOccurrences}`)
- `cachePath`: Optional path (default: `./data/db-payloads.json`)

**Operation:**
1. Check cache first - return immediately if cached
2. Build article nodes with summaries and embeddings
3. Build chunk nodes with content and embeddings
4. Collect article-level keywords (unique keywords from all chunks)
5. Collect chunk-level keywords (per chunk)
6. Build containment edges (article → chunks)
7. Validate all required fields present
8. Save structured payload to cache

**Output Cache Format:**
```json
{
  "articles": [{
    "title": "Article Name",
    "summary": "Two-sentence summary",
    "embedding": [0.123, ...],
    "source_path": "path/to/file.md",
    "content_hash": "a1b2c3d4e5f6g7h8",
    "node_type": "article"
  }],
  "chunks": [{
    "content": "Chunk text...",
    "embedding": [0.456, ...],
    "source_path": "path/to/file.md",
    "content_hash": "a1b2c3d4e5f6g7h8",
    "node_type": "chunk",
    "chunk_type": "definition",
    "heading_context": ["Introduction", "Background"],
    "position": 0
  }],
  "keywords": [{
    "keyword": "canonical keyword",
    "embedding": [0.789, ...],
    "embedding_256": [0.789, ...]
  }],
  "articleKeywords": {
    "path/to/file.md": ["keyword1", "keyword2"]
  },
  "chunkKeywords": {
    "path/to/file.md": {
      "0": ["keyword1", "keyword3"],
      "1": ["keyword2", "keyword4"]
    }
  },
  "containmentEdges": [{
    "parent_source_path": "path/to/file.md",
    "child_position": 0,
    "position": 0
  }]
}
```

**Key Implementation Details:**
- Pure transformation - no database access
- Article keywords: currently collects all unique keywords from chunks (can be reduced by LLM later)
- Chunk keywords: preserved from deduplicated chunks
- Containment edges use position-based references (resolved to UUIDs in Step 9)
- Validation: warns if missing embeddings or hashes

## Step 9: Database Insertion

### Function: `insertToDatabase()`

Executes idempotent database insertion with change detection.

**Input:**
- `payload`: Prepared payloads from Step 8
- `options`: Optional `{dryRun: boolean, forceReimport: boolean}`

**Operation (per article):**
1. Check if article exists by `source_path`
2. Determine action using `determineImportAction()`:
   - **Skip**: Hash matches, no changes
   - **Create**: Article doesn't exist
   - **Reimport**: Hash differs (content changed)
3. If reimport: Delete existing article and all descendants
4. Insert article node, capture UUID
5. Insert chunk nodes (batched), capture UUIDs
6. Upsert keywords (canonical table, `ON CONFLICT (keyword) DO UPDATE`)
7. Insert containment edges (article → chunks)
8. Insert keyword occurrences (article keywords + chunk keywords)

**Output:**
- Returns stats: `{created, updated, skipped}`
- No cache file (operation is idempotent via hash-based change detection)

**Key Implementation Details:**
- Uses `determineImportAction()` from `ingestion-chunks.ts` for consistency
- Supports dry-run mode for testing without database writes
- Processes articles sequentially (for better progress tracking and error isolation)
- Groups chunks, edges, and occurrences per article for atomicity
- Keyword upsert: `ON CONFLICT (keyword) DO UPDATE` ensures canonical uniqueness
- Occurrence upsert: `ON CONFLICT (keyword_id, node_id) DO NOTHING` handles duplicates

**Database Operations:**
```typescript
// 1. Check existing article
SELECT id, content_hash FROM nodes
WHERE source_path = $path AND node_type = 'article'

// 2. If reimport, delete article (cascades via FK)
DELETE FROM nodes WHERE id = $article_id

// 3. Insert article
INSERT INTO nodes (title, summary, embedding, source_path, content_hash, node_type, ...)
VALUES (...)
RETURNING id

// 4. Insert chunks
INSERT INTO nodes (content, embedding, source_path, content_hash, node_type, chunk_type, heading_context, ...)
VALUES (...)
RETURNING id

// 5. Upsert keywords
INSERT INTO keywords (keyword, embedding, embedding_256)
VALUES (...)
ON CONFLICT (keyword) DO UPDATE SET embedding = EXCLUDED.embedding
RETURNING id, keyword

// 6. Insert containment edges
INSERT INTO containment_edges (parent_id, child_id, position)
VALUES (...)

// 7. Insert keyword occurrences
INSERT INTO keyword_occurrences (keyword_id, node_id, node_type)
VALUES (...)
ON CONFLICT (keyword_id, node_id) DO NOTHING
```

## Usage Example

```typescript
// In REPL or script:

// Step 6: Generate content embeddings
let contentEmbeddings = await getOrGenerateContentEmbeddings(
  articleSummaries,
  dedupedChunks
)

// Step 7: Generate content hashes
let contentHashes = await getOrGenerateContentHashes(files)

// Step 8: Prepare database payloads
let dbPayloads = await prepareDatabasePayloads(
  articleSummaries,
  contentEmbeddings,
  contentHashes,
  dedupedChunks,
  { keywordRecords, keywordOccurrences }
)

// Step 9a: Dry run (no database changes)
let stats = await insertToDatabase(dbPayloads, { dryRun: true })

// Step 9b: Live insertion
let stats = await insertToDatabase(dbPayloads, { dryRun: false })

console.log(`Created: ${stats.created}, Updated: ${stats.updated}, Skipped: ${stats.skipped}`)
```

## Verification Queries

After running Step 9, verify with these SQL queries:

```sql
-- Count articles and chunks
SELECT node_type, COUNT(*) FROM nodes GROUP BY node_type;

-- Count unique keywords
SELECT COUNT(*) FROM keywords;

-- Count keyword occurrences by type
SELECT node_type, COUNT(*) FROM keyword_occurrences GROUP BY node_type;

-- Verify all chunks have parent articles
SELECT COUNT(*) FROM nodes n
WHERE n.node_type = 'chunk'
  AND NOT EXISTS (
    SELECT 1 FROM containment_edges ce
    WHERE ce.child_id = n.id
  );
-- Should return 0

-- Spot-check: Get article with chunks
SELECT n.id, n.title, n.summary,
  (SELECT COUNT(*) FROM containment_edges WHERE parent_id = n.id) as chunk_count
FROM nodes n
WHERE n.source_path = 'path/to/file.md' AND n.node_type = 'article';

-- Spot-check: Get keywords for a chunk
SELECT k.keyword
FROM keywords k
JOIN keyword_occurrences ko ON ko.keyword_id = k.id
WHERE ko.node_id = $chunk_id AND ko.node_type = 'chunk';
```

## Cache Files

The implementation creates these cache files:

```
data/
  content-embeddings.json    # Step 6: Article and chunk embeddings
  content-hashes.json        # Step 7: Content hashes for change detection
  db-payloads.json          # Step 8: Complete database insertion payloads
```

## Error Handling

- Missing embeddings or hashes: Logs warning, skips that article
- Database errors: Throws immediately (no silent failures)
- Keyword not in prepared data: Logs warning, skips that keyword
- Dry-run mode: Returns early with mock stats, no database access

## Performance Characteristics

**Step 6 (Content Embeddings):**
- Time: ~100ms per 100 texts (depends on OpenAI API)
- Memory: Holds all embeddings in memory temporarily
- Caching: Skips entirely on re-run if cache exists

**Step 7 (Content Hashing):**
- Time: <1ms per file (SHA256 is fast)
- Memory: Minimal (processes files one at a time via getOrCompute)
- Caching: Per-file, can update individual files without rehashing all

**Step 8 (Payload Preparation):**
- Time: <100ms for hundreds of files
- Memory: Holds all payloads in memory (reasonable for typical corpus size)
- Caching: Skips entirely on re-run if cache exists

**Step 9 (Database Insertion):**
- Time: ~500ms per article (depends on database round-trips)
- Memory: Minimal (processes articles sequentially)
- No caching: Idempotent via hash comparison, safe to re-run

## Future Improvements

1. **Batch article processing**: Process multiple articles in parallel for faster insertion
2. **Article keyword reduction**: Use LLM to reduce article keywords (currently collects all chunk keywords)
3. **Transaction support**: Wrap per-article operations in transactions for atomicity
4. **Progress persistence**: Save insertion progress to resume after interruption
5. **Backlink extraction**: Add Step 10 for wiki-style backlink parsing and insertion

## Related Files

- `scripts/repl-explore-chunking.ts` - Main REPL script with all steps
- `src/lib/cache-utils.ts` - Caching utilities and hash function
- `src/lib/ingestion-chunks.ts` - Production ingestion logic (reference)
- `docs/plans/chunk-ingestion-plan.md` - Overall pipeline design
