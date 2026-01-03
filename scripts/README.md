# Scripts

Utility scripts for database inspection and maintenance. Run with:

```bash
npm run script scripts/<script>.ts
```

This uses the `script` npm command which auto-loads `.env.local`.

## Available Scripts

### query-nodes.ts

Look up specific nodes by UUID.

```bash
npm run script scripts/query-nodes.ts <uuid> [uuid...]
```

### check-keywords.ts

Audit keyword quality by listing keywords sorted by length. Useful for spotting problematic keywords (sentences, section headings, etc.).

### check-duplicates.ts

Check for duplicate article nodes. Reports node counts by type and warns if multiple articles share the same source path.

### deduplicate-nodes.ts

Remove duplicate nodes from the database. Keeps the oldest node in each duplicate group. Processes in order: paragraphs, sections, articles.

### find-junk-nodes.ts

Find paragraph nodes with junk content patterns:
- Image-only paragraphs
- Single brackets
- Broken link closures

Reports matching nodes with their IDs for manual review.

### test-map-api.ts

Test the `/api/map` endpoint and display statistics about the graph data (node counts, edge counts, similarity distribution).

## Keyword Clustering Scripts

These scripts compute keyword communities for the MapView's "Cluster synonyms" feature. Run them in order after importing new articles.

### backfill-keyword-similarities.ts

Computes pairwise cosine similarities between article-level keywords and stores pairs above 0.5 threshold in `keyword_similarities` table.

```bash
npm run script scripts/backfill-keyword-similarities.ts
```

**When to run:** After importing articles, or after changing the similarity threshold.

### compute-keyword-communities.ts

Runs Louvain community detection on the keyword similarity graph. Assigns `community_id` and `is_community_hub` to keywords.

```bash
npm run script scripts/compute-keyword-communities.ts
```

**When to run:** After `backfill-keyword-similarities.ts` completes.

### check-communities.ts

Diagnostic script to verify community assignments. Shows:
- Total keywords with community assignments
- Number of hubs
- Sample communities with their members

```bash
npm run script scripts/check-communities.ts
```

### check-semantic-similarity.ts

Diagnostic script to check actual similarity values between keywords matching a pattern. Useful for tuning the similarity threshold.

```bash
npm run script scripts/check-semantic-similarity.ts
```
