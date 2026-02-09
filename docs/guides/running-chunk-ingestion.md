# Running the Chunk Ingestion Pipeline

Quick start guide for running the complete chunk-based ingestion pipeline (Steps 1-9).

## Prerequisites

1. **Environment variables** configured in `.env.local`:
   - `VAULT_PATH` - Path to markdown vault
   - `OPENAI_API_KEY` - For embeddings
   - `ANTHROPIC_API_KEY` - For LLM calls (chunking, deduplication, summaries)
   - Supabase credentials

2. **Database ready**: Supabase instance with tables created

3. **Vault content**: Markdown files to process

## Quick Start

### 1. Test the Implementation

Verify Steps 6-9 are working:

```bash
npm run script scripts/test-steps-6-9.ts
```

Expected output:
```
Testing Steps 6-9 implementation...

=== Testing Step 6: Content Embeddings ===
Loaded 5 article summaries
✓ Step 6 data structures validated

=== Testing Step 7: Content Hashing ===
✓ Hash function is deterministic
✓ Different content produces different hash

=== Testing Step 8: Database Payload Preparation ===
Loaded 79 keyword records
✓ Keyword data structure validated

✓ All tests passed!
```

### 2. Run the Full Pipeline

Process files and generate all caches:

```bash
npm run script scripts/repl-explore-chunking.ts
```

The script will:
- ✅ Load 5 files from `Writing/Have a Little Think` (configurable)
- ✅ Generate chunks (Step 1) - cached if already exists
- ✅ Build similarity matrix (Step 2) - cached
- ✅ Deduplicate keywords (Step 3) - cached
- ✅ Prepare keyword records (Step 4) - cached
- ✅ Generate article summaries (Step 5) - cached
- ✅ **NEW**: Generate content embeddings (Step 6)
- ✅ **NEW**: Generate content hashes (Step 7)
- ✅ **NEW**: Prepare database payloads (Step 8)
- ⏸️ Step 9 is commented out by default (dry-run mode)

### 3. Review Generated Data

Check the cache files:

```bash
ls -lh data/
```

You should see:
```
chunks-cache.json                   # Step 1
top-similar.json                    # Step 2
chunks-keywords-deduplicated.json   # Step 3
keywords-prepared.json              # Step 4
article-summaries.json              # Step 5
content-embeddings.json             # Step 6 (NEW)
content-hashes.json                 # Step 7 (NEW)
db-payloads.json                    # Step 8 (NEW)
```

Inspect the final payload:

```bash
cat data/db-payloads.json | jq '. | keys'
# ["articles", "articleKeywords", "chunkKeywords", "chunks", "containmentEdges", "keywords"]

cat data/db-payloads.json | jq '.articles | length'
# 5 (number of files processed)

cat data/db-payloads.json | jq '.chunks | length'
# ~20-30 (number of chunks across all files)
```

### 4. Insert to Database (Dry Run)

Test database insertion without writing:

```bash
npm run script scripts/repl-explore-chunking.ts
```

In the REPL:
```javascript
// Dry run (no database changes)
await insertToDatabase(dbPayloads, { dryRun: true })
```

Expected output:
```
[DRY RUN] Inserting to database...
  5 articles
  22 chunks
  79 keywords
  22 containment edges

✓ Dry run complete (no database changes)
```

### 5. Insert to Database (Live)

Execute the actual database insertion:

```javascript
// Live insertion
let stats = await insertToDatabase(dbPayloads, { dryRun: false })

console.log(`Created: ${stats.created}, Updated: ${stats.updated}, Skipped: ${stats.skipped}`)
```

Expected output:
```
Inserting to database...
  5 articles
  22 chunks
  79 keywords
  22 containment edges

[1/5] Processing: file1.md
  → Create (new)
  ✓ Article created: 123e4567-e89b-12d3-a456-426614174000
  ✓ 4 chunks created
  ✓ 4 containment edges created
  ✓ 15 keywords upserted with occurrences

[2/5] Processing: file2.md
...

✓ Database insertion complete
  5 created, 0 updated, 0 skipped
```

## Common Workflows

### Process a Different Folder

Edit `scripts/repl-explore-chunking.ts`:

```javascript
// Change this line (around line 63)
let folderPath = 'Writing/Have a Little Think'

// To your target folder:
let folderPath = 'Articles/Technical'
```

Then re-run:
```bash
npm run script scripts/repl-explore-chunking.ts
```

### Process More Files

```javascript
// Current: processes first 5 files
let chunksMap = await getOrGenerateChunks(files.slice(0, 5))

// Process all files:
let chunksMap = await getOrGenerateChunks(files)

// Process first 20:
let chunksMap = await getOrGenerateChunks(files.slice(0, 20))
```

### Clear Cache and Re-run

To regenerate from scratch:

```bash
# Clear specific steps
rm data/content-embeddings.json
rm data/content-hashes.json
rm data/db-payloads.json

# Clear everything
rm data/*.json

# Re-run
npm run script scripts/repl-explore-chunking.ts
```

### Reimport Modified Files

After editing a file:

```bash
# Re-run the script
npm run script scripts/repl-explore-chunking.ts

# In REPL, force reimport
await insertToDatabase(dbPayloads, { dryRun: false, forceReimport: true })

# Or just run normally - hash detection handles it
await insertToDatabase(dbPayloads, { dryRun: false })
```

The system will:
1. Compare content hashes
2. Skip unchanged files
3. Reimport changed files (delete old + create new)

## Verification

After insertion, verify database state:

### Count Nodes
```sql
SELECT node_type, COUNT(*) FROM nodes GROUP BY node_type;
```

Expected:
```
node_type | count
----------+-------
article   |     5
chunk     |    22
```

### Count Keywords
```sql
SELECT COUNT(*) FROM keywords;
```

Expected: ~79 unique keywords

### Count Occurrences
```sql
SELECT node_type, COUNT(*) FROM keyword_occurrences GROUP BY node_type;
```

Expected:
```
node_type | count
----------+-------
article   |    45  (article-level keywords)
chunk     |   106  (chunk-level keywords)
```

### Verify Hierarchy
```sql
SELECT COUNT(*) FROM nodes n
WHERE n.node_type = 'chunk'
  AND NOT EXISTS (
    SELECT 1 FROM containment_edges ce WHERE ce.child_id = n.id
  );
```

Expected: 0 (all chunks have parent articles)

### Spot-Check Article
```sql
SELECT
  n.id,
  n.title,
  n.summary,
  (SELECT COUNT(*) FROM containment_edges WHERE parent_id = n.id) as chunk_count,
  (SELECT COUNT(*) FROM keyword_occurrences WHERE node_id = n.id) as keyword_count
FROM nodes n
WHERE n.node_type = 'article'
LIMIT 1;
```

## Troubleshooting

### "Module not found" errors

Make sure you're running from the project root:
```bash
cd /Users/fnx/code/semantic_navigator
npm run script scripts/repl-explore-chunking.ts
```

### OpenAI rate limits

If you hit rate limits:
1. Process fewer files: `files.slice(0, 5)`
2. Wait a few minutes and re-run (cached steps are skipped)
3. Increase `RATE_LIMIT_DELAY_MS` in `src/lib/embeddings.ts`

### Anthropic rate limits

Similar to OpenAI:
1. Process fewer files
2. Re-run after rate limit resets
3. Cached steps are preserved

### Database connection errors

Check `.env.local`:
```bash
grep SUPABASE .env.local
```

Verify credentials are correct.

### "Embedding not found" warnings

This happens if Step 6 didn't process all chunks. Causes:
- Cache file corrupted
- Process interrupted mid-generation

Fix:
```bash
rm data/content-embeddings.json
npm run script scripts/repl-explore-chunking.ts
```

## Performance Tips

### For Large Batches (100+ files)

1. **Process in batches**:
```javascript
// Process 50 files at a time
for (let i = 0; i < files.length; i += 50) {
  let batch = files.slice(i, i + 50)
  let chunksMap = await getOrGenerateChunks(batch)
  // ... process batch
}
```

2. **Use database transactions** (future enhancement)

3. **Parallel article insertion** (future enhancement)

### For Development

1. **Use small test set**: `files.slice(0, 3)`
2. **Clear only what you need**: Don't delete all caches
3. **Use dry-run first**: Always test with `dryRun: true`

## Next Steps

After successful insertion:

1. **Verify in UI**: Load TopicsView and check if keywords/chunks appear
2. **Test search**: Search for keywords and verify results
3. **Test reimport**: Modify a file and re-run to verify skip/reimport logic
4. **Scale up**: Process larger batches once comfortable with workflow

## Related Documentation

- [Implementation Guide](chunk-ingestion-steps-6-9.md) - Detailed function documentation
- [Pipeline Plan](../plans/chunk-ingestion-plan.md) - Overall design and architecture
- [Summary](steps-6-9-summary.md) - What was implemented and why
