# Scripts

Utility scripts for database inspection and maintenance. Run with:

```bash
npx tsx --env-file=.env.local scripts/<script>.ts
```

## Available Scripts

### query-nodes.ts

Look up specific nodes by UUID.

```bash
npx tsx --env-file=.env.local scripts/query-nodes.ts <uuid> [uuid...]
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
