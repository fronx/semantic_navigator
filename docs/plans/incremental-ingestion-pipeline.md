# Incremental Ingestion Pipeline

**Status**: Planning
**Created**: 2026-02-09
**Goal**: Enable processing unlimited articles without loading entire corpus into memory

## Problem

Current REPL script loads all articles into memory, which doesn't scale:
- Memory constraints limit corpus size
- No progress saved until end (not interruptible)
- Expensive operations (LLM calls, embeddings) repeated if interrupted

## Solution: Two-Phase Pipeline

### Phase 1: Keyword Analysis (Full Corpus, Cached)

**Purpose**: Build global keyword deduplication mapping

**Steps**:
1. Load all articles
2. Extract keywords from all chunks
3. Generate embeddings for all unique keywords
4. Compute top-K similarities for each keyword
5. Build deduplication mapping (synonym detection)
6. **Cache to disk**: `keywords-prepared.json`, `top-similar.json`

**Why full corpus**: Global synonym detection requires seeing all keywords (e.g., "ML" ↔ "machine learning" ↔ "deep learning" across different articles)

**Status**: Already implemented in Steps 1-6 ✓

### Phase 2: Article Ingestion (Incremental, Batched)

**Purpose**: Process articles in small batches, insert to DB incrementally

**Steps per batch** (5 articles):
1. Load cached deduplication mapping
2. Generate article summaries (LLM)
3. Generate content embeddings & hashes
4. Apply dedup mapping to keywords
5. Build database payloads
6. **Insert to database** ✓
7. Continue to next batch

**Batch size**: 5 articles (configurable)

**Status**: Needs implementation

## Implementation Plan

### 1. Add Idempotency Checks

**Goal**: Allow resuming from interruption without duplicating work

**Approach**: Check `content_hashes` table before processing

```typescript
async function getAlreadyProcessedHashes(supabase): Promise<Set<string>> {
  const { data } = await supabase
    .from('content_hashes')
    .select('content_hash')
  return new Set(data?.map(r => r.content_hash) || [])
}

// In batch processing:
const processedHashes = await getAlreadyProcessedHashes(supabase)
const articlesToProcess = articles.filter(a => {
  const hash = computeHash(a.content)
  return !processedHashes.has(hash)
})
```

**Database constraints** (already exist):
- `nodes` table: `UNIQUE(content_hash)`
- Insert with `ON CONFLICT (content_hash) DO NOTHING`
- Keywords: `ON CONFLICT (keyword, node_id) DO UPDATE`
- Edges: `ON CONFLICT (parent_id, child_id) DO UPDATE`

### 2. Refactor Step 7-9 for Batching

**Current structure** (operates on full `dbPayloads` array):
```typescript
let dbPayloads = prepareDatabasePayloads(...)
await insertToDatabase(dbPayloads, { dryRun: false })
```

**New structure** (batched):
```typescript
// Load cached prerequisites
const dedupMapping = loadDeduplicationMapping()
const processedHashes = await getAlreadyProcessedHashes(supabase)

// Process in batches
for (let batch of batchArticles(articles, 5)) {
  // Filter already processed
  batch = batch.filter(a => !processedHashes.has(computeHash(a)))

  // Generate summaries (LLM - expensive!)
  const summaries = await generateArticleSummaries(batch)

  // Generate embeddings & hashes
  const embeddings = await generateContentEmbeddings(batch, summaries)
  const hashes = computeContentHashes(batch)

  // Build payloads using cached dedup mapping
  const payloads = prepareDatabasePayloads(batch, dedupMapping)

  // Insert to DB
  await insertToDatabase(payloads, { dryRun: false })

  // Update processed set for next iteration
  batch.forEach(a => processedHashes.add(computeHash(a)))

  console.log(`✓ Processed batch (${processedHashes.size}/${articles.length})`)
}
```

### 3. New Functions to Implement

#### `batchArticles(articles, batchSize)`
Split articles array into batches

#### `getAlreadyProcessedHashes(supabase)`
Query `content_hashes` table for skip list

#### `processArticleBatch(batch, options)`
Orchestrate: summaries → embeddings → hashes → payloads → insert

#### `runIncrementalIngestion(options)`
Main entry point for Phase 2

**Options**:
```typescript
{
  batchSize: 5,           // Articles per batch
  dryRun: false,          // Preview without inserting
  skipCache: false,       // Force regenerate cached data
  resumeFromHash: null    // Resume from specific hash (for recovery)
}
```

### 4. Caching Strategy

**Phase 1 cache** (global, recompute when corpus changes):
- `keywords-prepared.json` - Final deduplicated keywords
- `top-similar.json` - Keyword similarity matrix
- `keyword-embeddings.json` - Embeddings for all keywords

**Phase 2 cache** (per-article, skip if exists in DB):
- Check `content_hashes` table
- Skip articles already processed

**Cache invalidation**:
- Phase 1: Delete cache files when corpus structure changes
- Phase 2: Automatic (DB is source of truth)

### 5. Progress Tracking

**Console output**:
```
Phase 1: Keyword Analysis
✓ Loaded 247 keywords from cache
✓ Deduplication mapping ready

Phase 2: Article Ingestion
Batch 1/50 (5 articles)
  → Generating summaries... ✓
  → Computing embeddings... ✓
  → Inserting to DB... ✓
  → Progress: 5/247 articles (2%)

Batch 2/50 (5 articles)
  → Generating summaries... ✓
  → Computing embeddings... ✓
  → Inserting to DB... ✓
  → Progress: 10/247 articles (4%)
...
```

**Resume capability**:
```
Phase 2: Article Ingestion
Found 150 already processed articles
Remaining: 97 articles
Starting from batch 31/50...
```

## Testing Plan

### 1. Small Corpus Test (10 articles)
- Run full pipeline
- Verify all data in DB
- Interrupt at batch 2, resume
- Verify idempotency (no duplicates)

### 2. Medium Corpus Test (100 articles)
- Process 50 articles
- Interrupt
- Resume and complete
- Verify clustering works

### 3. Large Corpus Test (1000+ articles)
- Process incrementally
- Monitor memory usage (should be constant)
- Verify scalability

## Migration Path

**For existing users**:
1. Phase 1 works as before (already implemented)
2. Phase 2 is opt-in: `runIncrementalIngestion()` vs. old `insertToDatabase(dbPayloads)`
3. Both methods produce identical DB state

**Deprecation**:
- Keep old `insertToDatabase(dbPayloads)` for small corpora
- Document incremental approach for production use

## Success Criteria

- ✅ Can process 1000+ articles without memory issues
- ✅ Can interrupt and resume without losing progress
- ✅ Idempotent (re-running produces same result)
- ✅ Progress tracking visible
- ✅ All existing features work (clustering, search, visualization)

## Known Limitations

### Cache Invalidation Issue
**Problem**: Local cache files (summaries, chunks, embeddings) are keyed by file path only, not content hash. If a file's content changes but the path stays the same, the cached data becomes stale.

**Current workaround**: Manually delete cache files when content changes:
```bash
rm ./data/article-summaries.json
rm ./data/chunks-cache.json
rm ./data/content-embeddings.json
```

**Future fix**: Add content-aware caching that invalidates when content hash changes.

## Open Questions

1. **Batch size tuning**: 5 articles optimal? Test different sizes.
2. **Parallel batches**: Process multiple batches concurrently? (Risk: API rate limits)
3. **Content hash collisions**: How to handle? (Very unlikely with SHA-256)
4. **Partial batch failures**: Rollback batch or continue? (Continue - DB constraints handle it)

## Implementation Phases

### Phase A: Core Refactoring (High Priority)
- [x] Extract `batchArticles()` utility
- [x] Implement `getAlreadyProcessedHashes()`
- [x] Refactor Step 7-9 into `processArticleBatch()`
- [x] Add progress tracking

### Phase B: Orchestration (High Priority)
- [x] Implement `runIncrementalIngestion()`
- [x] Add dry-run mode
- [ ] Test with 10-article corpus
- [ ] Verify idempotency

### Phase C: Polish (Medium Priority)
- [ ] Resume from specific hash
- [ ] Batch size tuning
- [ ] Memory profiling
- [ ] Documentation

### Phase D: Production Hardening (Low Priority)
- [ ] Error recovery strategies
- [ ] Parallel batch processing
- [ ] Rate limit handling
- [ ] Monitoring/metrics
