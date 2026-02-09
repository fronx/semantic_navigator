# Chunk Ingestion Pipeline

Reference guide for the chunk-based ingestion pipeline that processes markdown files into semantic chunks, extracts/deduplicates keywords, and stores everything in Supabase.

## Prerequisites

- `.env.local` configured with `VAULT_PATH`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and Supabase credentials
- Database ready (run `npx supabase db push` if needed)
- Markdown files in the vault directory

## Usage

```bash
npm run script scripts/repl-explore-chunking.ts [limit]
```

- `limit` can be a number (e.g. `20`), `all`, `unlimited`, or `0` for no limit. Default: `5`.
- The script runs all phases automatically, then drops into a REPL for manual commands.

## Pipeline Phases

### Phase 1: Keyword Analysis (full corpus, upfront)

Runs on all selected files to build global keyword deduplication mapping.

| Step | Operation | Cache File |
|------|-----------|------------|
| 1 | Load files, generate/cache chunks | `data/chunks-cache.json` |
| 2 | Extract unique keywords, generate/cache keyword embeddings | `data/keyword-embeddings.json` |
| 3 | Build similarity matrix, compute topSimilar | `data/top-similar.json` |
| 4 | LLM-based keyword deduplication (cached by pair-set hash) | `data/keyword-dedup-mapping.json` |
| 5 | Apply dedup, build keyword records, prepare occurrences | `data/keywords-prepared.json`, `data/chunks-keywords-deduplicated.json` |

**Why full corpus**: Global synonym detection requires seeing all keywords across all articles (e.g., "ML" and "machine learning" in different files).

### Phase 2: Incremental Database Ingestion

Processes articles in batches. Skips articles already in the database (content-hash based idempotency).

1. Load prepared keyword data from Phase 1 cache
2. Bulk upsert ALL keywords once upfront (not per-batch)
3. Query DB for already-ingested articles (by content hash)
4. Process remaining articles in batches (default batch size: 5):
   - Generate article summaries (cached per-file)
   - Generate chunks (reused from Phase 1 cache)
   - Apply keyword deduplication
   - Generate content embeddings incrementally (only missing ones)
   - Generate content hashes (cached per-file)
   - Prepare database payloads (pure transformation, not cached)
   - Insert to DB: article node, chunk nodes, containment edges, keyword occurrences

Per-batch caches:

| Data | Cache File |
|------|------------|
| Article summaries | `data/article-summaries.json` |
| Content embeddings | `data/content-embeddings.json` |
| Content hashes | `data/content-hashes.json` |

Database payloads are NOT cached (cheap computation, always recomputed).

### Phase 3: Post-Ingestion

PCA runs automatically after ingestion:

1. Compute PCA transform for semantic colors, saved to `public/data/embedding-pca-transform.json`

Cluster precomputation must be run manually from the REPL:

```javascript
await precomputeTopicClusters("chunk", undefined, { dryRun: false })
await precomputeTopicClusters("article", undefined, { dryRun: false })
```

## Cache Strategy

All caching uses the `getOrCompute` pattern: check cache, return if exists, otherwise compute, save, and return.

| Pattern | Used By | Behavior |
|---------|---------|----------|
| Per-item incremental | Chunks, summaries, hashes | Keyed by file path. New files get computed, existing files reuse cache. |
| Incremental merge | Content embeddings | Load partial cache, find missing items, generate only missing, merge back. |
| Incremental | Keyword embeddings | Generate only missing keywords. |
| Hash-based | Keyword deduplication | Cached by hash of similarity pairs. Invalidates when keyword set changes. |
| Not cached | Database payloads | Always recomputed (cheap transformation). |

**To force regeneration**, delete the relevant cache file:

```bash
rm data/content-embeddings.json    # Regenerate embeddings
rm data/article-summaries.json     # Regenerate summaries
rm data/*.json                     # Full clean slate
```

Then re-run the script. Earlier phases return cached data instantly; only invalidated steps re-execute.

## Incremental Runs

On subsequent runs, the pipeline reuses work at every level:

- **Phase 1**: All keyword analysis is cached. Only re-runs if cache files are deleted or the keyword set changes (which invalidates the dedup mapping).
- **Phase 2**: Checks the database for existing articles by content hash. Articles with matching hashes are skipped entirely. Changed files are reimported (old data deleted, new data inserted).
- **New files**: Automatically detected and processed. Summaries, embeddings, and hashes are generated only for the new files.

## REPL Commands

After the automatic pipeline completes, the script drops into a REPL with these functions available:

```javascript
// Main ingestion entry point (re-run with different options)
await runIncrementalIngestionWithProgress({ batchSize: 5, dryRun: false })

// Dry run (preview without DB writes)
await runIncrementalIngestionWithProgress({ batchSize: 5, dryRun: true })

// Post-ingestion: recompute clusters
await precomputeTopicClusters("chunk", undefined, { dryRun: false })

// Post-ingestion: recompute PCA transform
await computeAndSavePCA()
```

## Verification

After ingestion, verify database state:

```sql
-- Count nodes by type
SELECT node_type, COUNT(*) FROM nodes GROUP BY node_type;

-- Count keywords and occurrences
SELECT COUNT(*) FROM keywords;
SELECT node_type, COUNT(*) FROM keyword_occurrences GROUP BY node_type;

-- Verify all chunks have parent articles (should return 0)
SELECT COUNT(*) FROM nodes n
WHERE n.node_type = 'chunk'
  AND NOT EXISTS (
    SELECT 1 FROM containment_edges ce WHERE ce.child_id = n.id
  );
```

## Troubleshooting

**Rate limits (OpenAI/Anthropic)**: Process fewer files by passing a lower limit. Re-run after the rate limit resets -- cached steps are preserved.

**"Embedding not found" warnings**: Content embeddings cache may be incomplete. Delete `data/content-embeddings.json` and re-run.

**Database connection errors**: Verify Supabase credentials in `.env.local`.

## Related

- Script: `scripts/repl-explore-chunking.ts`
- Core libs: `src/lib/ingestion.ts`, `src/lib/cache-utils.ts`, `src/lib/embeddings.ts`
- [Incremental Ingestion Pipeline plan](../plans/incremental-ingestion-pipeline.md) (historical)
- [Chunk Ingestion Plan](../plans/chunk-ingestion-plan.md) (historical)
